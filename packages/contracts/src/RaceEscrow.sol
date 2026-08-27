// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/// @title RaceEscrow — Chain Drift race rooms and prize distribution
///
/// @notice Lifecycle: OPEN → LOCKED → RESOLVING → PAID  (or CANCELLED on timeout).
///
/// Players enter by paying the entry fee in DRIFT. Once `maxParticipants` have
/// joined the room LOCKs. Anyone may then call `requestResolve`, which asks
/// Chainlink VRF for one random word. The VRF callback scores every car, sorts
/// the field, and credits the prize split.
///
/// @dev Why VRF and not a block value: `block.prevrandao` and `blockhash` are
///      the only on-chain alternatives and both are influenceable by the
///      proposer, and this contract pays out real value on that number.
///
/// @dev Why pull payments: the payout runs inside the VRF callback, which has a
///      fixed `callbackGasLimit`. Crediting balances and letting winners `claim`
///      keeps the callback cheap and means no single recipient can make the
///      callback revert and strand the randomness.
///
/// Payout split, mirroring `economy.ts`. Shares are of the **gross** pool, so
/// on a full four-car grid they read straight off what the field staked:
///   1st 50%   2nd 25%   3rd 10%   4th 5%   platform 10%
///
/// A short field renormalises the position weights over the places that were
/// actually filled, so the platform still takes exactly `PLATFORM_FEE_BPS` and
/// the missing places' shares go to the racers who turned up. Rounding dust is
/// swept to the fee recipient rather than being stranded in the contract.
contract RaceEscrow is VRFConsumerBaseV2Plus, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ──────────────────────────────────────────────────────────

    uint256 public constant PLATFORM_FEE_BPS = 1000; // 10%
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint8 public constant MAX_PARTICIPANTS = 4;

    /// @notice After this long without filling, entries can be refunded.
    uint256 public constant REFUND_TIMEOUT = 1 hours;

    /// @notice How long to wait on the VRF callback before a race may be cancelled.
    /// @dev A fulfilment normally lands within a minute. Waiting an hour before
    ///      allowing a refund keeps a slow coordinator from being mistaken for a
    ///      dead one, while still guaranteeing the entry fees are recoverable —
    ///      a subscription that runs out of balance leaves the request pending
    ///      indefinitely, and without this the stake would be locked forever.
    uint256 public constant VRF_CALLBACK_TIMEOUT = 1 hours;

    /// @dev Shares of the gross pool; they sum to `10_000 - PLATFORM_FEE_BPS`.
    uint16 private constant PAYOUT_BPS_1ST = 5000;
    uint16 private constant PAYOUT_BPS_2ND = 2500;
    uint16 private constant PAYOUT_BPS_3RD = 1000;
    uint16 private constant PAYOUT_BPS_4TH = 500;

    // ─── Types ──────────────────────────────────────────────────────────────

    enum RaceStatus {
        None,
        Open,
        Locked,
        Resolving,
        Paid,
        Cancelled
    }

    struct Participant {
        address player;
        uint256 carTokenId;
    }

    struct Race {
        uint128 entryFee;
        uint8 maxParticipants;
        RaceStatus status;
        uint64 createdAt;
        /// @dev Packs into the same slot; uint48 covers timestamps past year 8.9M.
        uint48 resolveRequestedAt;
        uint256 vrfRequestId;
    }

    // ─── Storage ────────────────────────────────────────────────────────────

    /// @notice DRIFT token used for entry fees and payouts.
    IERC20 public immutable paymentToken;

    /// @notice Car collection; entrants must own the car they race.
    IERC721 public immutable carNft;

    address public feeRecipient;

    uint256 public nextRaceId = 1;

    mapping(uint256 raceId => Race) private _races;
    mapping(uint256 raceId => Participant[]) private _participants;
    mapping(uint256 raceId => mapping(address player => bool)) public hasEntered;
    mapping(uint256 requestId => uint256 raceId) public raceOfRequest;

    /// @notice Winnings and refunds waiting to be withdrawn via `claim`.
    mapping(address account => uint256 amount) public pendingWithdrawals;

    // ─── VRF config ─────────────────────────────────────────────────────────

    uint256 public subscriptionId;
    bytes32 public keyHash;
    /// @dev A four-player fulfilment measures at ~195k gas. The limit matters
    ///      beyond safety: the DON reserves the full amount at the gas lane's max
    ///      price when deciding whether a subscription can afford a request, so
    ///      an inflated limit raises the balance needed to get fulfilled at all.
    uint32 public callbackGasLimit = 300_000;
    uint16 public requestConfirmations = 3;

    /// @notice Pay for randomness in the chain's native token instead of LINK.
    /// @dev Defaults to true. VRF v2.5 bills a native-funded subscription in ETH,
    ///      which removes the LINK faucet from the path to a working testnet —
    ///      the same ETH that pays for gas also pays for the randomness.
    bool public nativePayment = true;

    // ─── Errors ─────────────────────────────────────────────────────────────

    error InvalidMaxPlayers(uint8 maxPlayers);
    error RaceNotOpen(uint256 raceId, RaceStatus status);
    error RaceNotLocked(uint256 raceId, RaceStatus status);
    error AlreadyEntered(uint256 raceId, address player);
    error NotCarOwner(uint256 carTokenId, address caller);
    error RefundTimeoutNotReached(uint256 availableAt);
    error RaceNotRefundable(uint256 raceId, RaceStatus status);
    error NothingToClaim();
    error UnknownRequest(uint256 requestId);

    // ─── Events ─────────────────────────────────────────────────────────────

    event RaceCreated(uint256 indexed raceId, uint256 entryFee, uint8 maxParticipants);
    event PlayerEntered(uint256 indexed raceId, address indexed player, uint256 carTokenId);
    event RaceReady(uint256 indexed raceId);
    event ResolveRequested(uint256 indexed raceId, uint256 indexed requestId);

    /// @notice Final classification. Arrays are parallel and ordered 1st to last.
    /// @dev The leaderboard recorder consumes exactly this event.
    event RaceFinished(
        uint256 indexed raceId, address[] players, uint256[] carTokenIds, uint256[] payouts
    );

    event RaceCancelled(uint256 indexed raceId);
    event Claimed(address indexed account, uint256 amount);
    event FeeRecipientSet(address indexed newRecipient);
    event VrfSubscriptionSet(uint256 indexed subscriptionId, bool selfProvisioned);
    event VrfConfigSet(
        uint256 subscriptionId,
        bytes32 keyHash,
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        bool nativePayment
    );

    // ─── Init ───────────────────────────────────────────────────────────────

    /// @param vrfCoordinator  Chainlink VRF v2.5 coordinator for this chain.
    /// @param subscriptionId_ Existing VRF subscription that already lists this
    ///                        contract as a consumer, or **0** to have the
    ///                        contract create and own one for itself.
    /// @param keyHash_        Gas lane key hash.
    /// @param paymentToken_   DRIFT token address.
    /// @param carNft_         CarNFT collection address.
    /// @param feeRecipient_   Receives the platform fee.
    constructor(
        address vrfCoordinator,
        uint256 subscriptionId_,
        bytes32 keyHash_,
        address paymentToken_,
        address carNft_,
        address feeRecipient_
    ) VRFConsumerBaseV2Plus(vrfCoordinator) {
        if (paymentToken_ == address(0) || carNft_ == address(0) || feeRecipient_ == address(0)) {
            revert ZeroAddress();
        }
        paymentToken = IERC20(paymentToken_);
        carNft = IERC721(carNft_);
        feeRecipient = feeRecipient_;
        keyHash = keyHash_;

        if (subscriptionId_ == 0) {
            // Self-provision. A subscription ID is derived from
            // `blockhash(block.number - 1)`, so it cannot be created by one
            // transaction and consumed by another that was built in advance —
            // a deploy script would record `addConsumer` against an ID that no
            // longer matches by the time it lands. Doing both inside this
            // constructor keeps it to a single atomic transaction.
            subscriptionId = s_vrfCoordinator.createSubscription();
            s_vrfCoordinator.addConsumer(subscriptionId, address(this));
        } else {
            subscriptionId = subscriptionId_;
        }

        emit VrfSubscriptionSet(subscriptionId, subscriptionId_ == 0);
    }

    // ─── VRF subscription ───────────────────────────────────────────────────

    /// @notice Top up the VRF subscription with native ETH.
    /// @dev Anyone may fund it — a race that cannot pay for its randomness is
    ///      everyone's problem, not just the owner's.
    function fundVrfSubscription() external payable {
        s_vrfCoordinator.fundSubscriptionWithNative{value: msg.value}(subscriptionId);
    }

    /// @notice Native balance left in the VRF subscription.
    /// @dev Roughly `balance / costPerRace` races remain; the UI surfaces this
    ///      so a stalled lobby is diagnosable without reading the coordinator.
    function vrfNativeBalance() external view returns (uint96 nativeBalance) {
        (, nativeBalance,,,) = s_vrfCoordinator.getSubscription(subscriptionId);
    }

    /// @notice Close the self-provisioned subscription and send its balance to `to`.
    /// @dev Only meaningful when this contract owns the subscription. Reverts
    ///      while any request is still pending.
    function cancelVrfSubscription(address to) external onlyOwner {
        s_vrfCoordinator.cancelSubscription(subscriptionId, to);
    }

    // ─── Race lifecycle ─────────────────────────────────────────────────────

    /// @notice Open a new race room. Anyone can create one.
    /// @param entryFee   Entry cost in DRIFT (18 decimals).
    /// @param maxPlayers 1 to 4.
    function createRace(uint128 entryFee, uint8 maxPlayers) external returns (uint256 raceId) {
        if (maxPlayers == 0 || maxPlayers > MAX_PARTICIPANTS) revert InvalidMaxPlayers(maxPlayers);

        raceId = nextRaceId++;
        _races[raceId] = Race({
            entryFee: entryFee,
            maxParticipants: maxPlayers,
            status: RaceStatus.Open,
            createdAt: uint64(block.timestamp),
            resolveRequestedAt: 0,
            vrfRequestId: 0
        });

        emit RaceCreated(raceId, entryFee, maxPlayers);
    }

    /// @notice Enter a race with a car you own. Requires a DRIFT allowance.
    function enterRace(uint256 raceId, uint256 carTokenId) external {
        _enterRace(raceId, carTokenId);
    }

    /// @notice Enter a race, taking the DRIFT allowance from an EIP-2612 signature
    ///         so the player signs and sends a single transaction.
    function enterRaceWithPermit(
        uint256 raceId,
        uint256 carTokenId,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        // A front-run of the permit leaves the allowance in place but makes this
        // call revert, so swallow the failure and let the transfer decide.
        try IERC20Permit(address(paymentToken)).permit(
            msg.sender, address(this), _races[raceId].entryFee, deadline, v, r, s
        ) {} catch {}
        _enterRace(raceId, carTokenId);
    }

    function _enterRace(uint256 raceId, uint256 carTokenId) private {
        Race storage race = _races[raceId];
        if (race.status != RaceStatus.Open) revert RaceNotOpen(raceId, race.status);
        if (hasEntered[raceId][msg.sender]) revert AlreadyEntered(raceId, msg.sender);
        // Racing a car you do not own would corrupt the leaderboard and the
        // replay, so ownership is checked here rather than taken on trust.
        if (carNft.ownerOf(carTokenId) != msg.sender) revert NotCarOwner(carTokenId, msg.sender);

        hasEntered[raceId][msg.sender] = true;
        _participants[raceId].push(Participant({player: msg.sender, carTokenId: carTokenId}));

        if (race.entryFee > 0) {
            paymentToken.safeTransferFrom(msg.sender, address(this), race.entryFee);
        }

        emit PlayerEntered(raceId, msg.sender, carTokenId);

        if (_participants[raceId].length == race.maxParticipants) {
            race.status = RaceStatus.Locked;
            emit RaceReady(raceId);
        }
    }

    /// @notice Ask Chainlink VRF for the randomness that decides a locked race.
    ///         Callable by anyone.
    function requestResolve(uint256 raceId) external returns (uint256 requestId) {
        Race storage race = _races[raceId];
        if (race.status != RaceStatus.Locked) revert RaceNotLocked(raceId, race.status);

        race.status = RaceStatus.Resolving;

        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: nativePayment})
                )
            })
        );

        race.vrfRequestId = requestId;
        race.resolveRequestedAt = uint48(block.timestamp);
        raceOfRequest[requestId] = raceId;

        emit ResolveRequested(raceId, requestId);
    }

    /// @inheritdoc VRFConsumerBaseV2Plus
    /// @dev Scores each car as `keccak256(randomWord, carTokenId)` and sorts
    ///      descending, so one VRF word settles the whole grid.
    function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords)
        internal
        override
    {
        uint256 raceId = raceOfRequest[requestId];
        if (raceId == 0) revert UnknownRequest(requestId);
        Race storage race = _races[raceId];
        // The coordinator never fulfils the same request twice, but a race that
        // is no longer Resolving must not be paid out again.
        if (race.status != RaceStatus.Resolving) return;

        Participant[] storage entries = _participants[raceId];
        uint256 n = entries.length;

        uint256[] memory scores = new uint256[](n);
        address[] memory players = new address[](n);
        uint256[] memory carTokenIds = new uint256[](n);

        for (uint256 i = 0; i < n; ++i) {
            scores[i] = uint256(keccak256(abi.encodePacked(randomWords[0], entries[i].carTokenId)));
            players[i] = entries[i].player;
            carTokenIds[i] = entries[i].carTokenId;
        }

        // Insertion sort, descending. At most 4 entries.
        for (uint256 i = 1; i < n; ++i) {
            uint256 j = i;
            while (j > 0 && scores[j - 1] < scores[j]) {
                (scores[j - 1], scores[j]) = (scores[j], scores[j - 1]);
                (players[j - 1], players[j]) = (players[j], players[j - 1]);
                (carTokenIds[j - 1], carTokenIds[j]) = (carTokenIds[j], carTokenIds[j - 1]);
                --j;
            }
        }

        uint256[] memory payouts = _creditPayouts(raceId, players, n);

        race.status = RaceStatus.Paid;
        emit RaceFinished(raceId, players, carTokenIds, payouts);
    }

    function _creditPayouts(uint256 raceId, address[] memory players, uint256 n)
        private
        returns (uint256[] memory payouts)
    {
        uint256 prizePool = uint256(_races[raceId].entryFee) * n;
        uint256 platformFee = (prizePool * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 distributable = prizePool - platformFee;

        // Weights are renormalised over the places that were filled. Dividing by
        // BPS_DENOMINATOR instead would hand the 3rd and 4th shares of a short
        // field to the fee recipient, quietly turning a 10% rake into 25% on a
        // two-car race.
        uint256 totalWeight;
        for (uint256 i = 0; i < n; ++i) {
            totalWeight += _payoutBps(i);
        }

        payouts = new uint256[](n);
        uint256 distributed;

        for (uint256 i = 0; i < n; ++i) {
            uint256 bps = _payoutBps(i);
            if (bps == 0) continue;
            uint256 amount = (distributable * bps) / totalWeight;
            payouts[i] = amount;
            distributed += amount;
            pendingWithdrawals[players[i]] += amount;
        }

        // Integer division leaves dust behind. Sweep it with the fee rather
        // than stranding it in the contract.
        pendingWithdrawals[feeRecipient] += platformFee + (distributable - distributed);
    }

    function _payoutBps(uint256 position) private pure returns (uint256) {
        if (position == 0) return PAYOUT_BPS_1ST;
        if (position == 1) return PAYOUT_BPS_2ND;
        if (position == 2) return PAYOUT_BPS_3RD;
        if (position == 3) return PAYOUT_BPS_4TH;
        return 0;
    }

    /// @notice Cancel a stalled race and credit every entrant a refund.
    ///         Callable by anyone once the relevant timeout has elapsed.
    ///
    /// @dev Covers two different kinds of stall:
    ///      - Open or Locked, measured from creation: the room never filled, or
    ///        nobody ever asked for it to be resolved.
    ///      - Resolving, measured from the resolve request: the VRF callback
    ///        never arrived. A subscription without enough balance leaves the
    ///        request pending forever, and the stake has to be recoverable.
    ///
    ///      A callback that arrives after a cancellation is harmless:
    ///      `fulfillRandomWords` returns early for any race that is no longer
    ///      Resolving, so the refund cannot be paid twice.
    ///
    /// @dev Every entrant is credited, not just the caller: crediting one and
    ///      then marking the race Cancelled would lock the rest out of their
    ///      own refund.
    function cancelRace(uint256 raceId) external {
        Race storage race = _races[raceId];

        uint256 availableAt;
        if (race.status == RaceStatus.Open || race.status == RaceStatus.Locked) {
            availableAt = race.createdAt + REFUND_TIMEOUT;
        } else if (race.status == RaceStatus.Resolving) {
            availableAt = race.resolveRequestedAt + VRF_CALLBACK_TIMEOUT;
        } else {
            revert RaceNotRefundable(raceId, race.status);
        }

        if (block.timestamp < availableAt) revert RefundTimeoutNotReached(availableAt);

        race.status = RaceStatus.Cancelled;

        Participant[] storage entries = _participants[raceId];
        uint256 fee = race.entryFee;
        for (uint256 i = 0; i < entries.length; ++i) {
            pendingWithdrawals[entries[i].player] += fee;
        }

        emit RaceCancelled(raceId);
    }

    /// @notice Withdraw winnings and refunds.
    function claim() external nonReentrant returns (uint256 amount) {
        amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToClaim();

        pendingWithdrawals[msg.sender] = 0;
        paymentToken.safeTransfer(msg.sender, amount);

        emit Claimed(msg.sender, amount);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function getRace(uint256 raceId) external view returns (Race memory) {
        return _races[raceId];
    }

    function getRaceStatus(uint256 raceId) external view returns (RaceStatus) {
        return _races[raceId].status;
    }

    function getParticipants(uint256 raceId) external view returns (Participant[] memory) {
        return _participants[raceId];
    }

    function getParticipantCount(uint256 raceId) external view returns (uint256) {
        return _participants[raceId].length;
    }

    /// @notice Race rooms still accepting players, newest first.
    /// @dev Replaces the frontend's backwards scan over `getRaceStatus`, which
    ///      cost one RPC call per race ID.
    function getOpenRaces(uint256 limit, uint256 maxScan)
        external
        view
        returns (uint256[] memory raceIds)
    {
        uint256 newest = nextRaceId - 1;
        uint256 oldest = newest > maxScan ? newest - maxScan + 1 : 1;

        uint256[] memory found = new uint256[](limit);
        uint256 count;
        for (uint256 id = newest; id >= oldest && count < limit; --id) {
            if (_races[id].status == RaceStatus.Open) {
                found[count++] = id;
            }
            if (id == 1) break;
        }

        raceIds = new uint256[](count);
        for (uint256 i = 0; i < count; ++i) {
            raceIds[i] = found[i];
        }
    }

    // ─── Owner ──────────────────────────────────────────────────────────────

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        feeRecipient = newRecipient;
        emit FeeRecipientSet(newRecipient);
    }

    function setVrfConfig(
        uint256 subscriptionId_,
        bytes32 keyHash_,
        uint32 callbackGasLimit_,
        uint16 requestConfirmations_,
        bool nativePayment_
    ) external onlyOwner {
        subscriptionId = subscriptionId_;
        keyHash = keyHash_;
        callbackGasLimit = callbackGasLimit_;
        requestConfirmations = requestConfirmations_;
        nativePayment = nativePayment_;
        emit VrfConfigSet(
            subscriptionId_, keyHash_, callbackGasLimit_, requestConfirmations_, nativePayment_
        );
    }
}
