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
/// @dev Why VRF and not a block value: the Klever version read
///      `get_block_random_seed()`, which has no safe EVM equivalent —
///      `block.prevrandao` and `blockhash` are both influenceable by the
///      proposer, and this contract pays out real value on that number.
///
/// @dev Why pull payments: the payout runs inside the VRF callback, which has a
///      fixed `callbackGasLimit`. Crediting balances and letting winners `claim`
///      keeps the callback cheap and means no single recipient can make the
///      callback revert and strand the randomness.
///
/// Payout split, mirroring `raceLogic.ts`:
///   1st 50%   2nd 30%   3rd 15%   4th 5%
///   Platform fee: 5% of the pool, taken before the split. Any remainder from a
///   short field (fewer than 4 racers) goes to the fee recipient rather than
///   being stranded in the contract.
contract RaceEscrow is VRFConsumerBaseV2Plus, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ──────────────────────────────────────────────────────────

    uint256 public constant PLATFORM_FEE_BPS = 500; // 5%
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint8 public constant MAX_PARTICIPANTS = 4;

    /// @notice After this long without resolving, entries can be refunded.
    uint256 public constant REFUND_TIMEOUT = 1 hours;

    uint16 private constant PAYOUT_BPS_1ST = 5000;
    uint16 private constant PAYOUT_BPS_2ND = 3000;
    uint16 private constant PAYOUT_BPS_3RD = 1500;
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
    uint32 public callbackGasLimit = 500_000;
    uint16 public requestConfirmations = 3;

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
    event VrfConfigSet(uint256 subscriptionId, bytes32 keyHash, uint32 callbackGasLimit, uint16 requestConfirmations);

    // ─── Init ───────────────────────────────────────────────────────────────

    /// @param vrfCoordinator  Chainlink VRF v2.5 coordinator for this chain.
    /// @param subscriptionId_ Funded VRF subscription that lists this contract as a consumer.
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
        subscriptionId = subscriptionId_;
        keyHash = keyHash_;
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
        // The Klever version took the car ID on trust; racing a car you do not own
        // corrupts the leaderboard and the replay, so it is checked here.
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
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: false})
                )
            })
        );

        race.vrfRequestId = requestId;
        raceOfRequest[requestId] = raceId;

        emit ResolveRequested(raceId, requestId);
    }

    /// @inheritdoc VRFConsumerBaseV2Plus
    /// @dev Scores each car as `keccak256(randomWord, carTokenId)` and sorts
    ///      descending — the same construction as the Klever contract, with
    ///      keccak in place of sha256 because it is far cheaper on the EVM.
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

        payouts = new uint256[](n);
        uint256 distributed;

        for (uint256 i = 0; i < n; ++i) {
            uint256 bps = _payoutBps(i);
            if (bps == 0) continue;
            uint256 amount = (distributable * bps) / BPS_DENOMINATOR;
            payouts[i] = amount;
            distributed += amount;
            pendingWithdrawals[players[i]] += amount;
        }

        // A field of fewer than 4 leaves the unclaimed positions' share behind,
        // as does integer division. Sweep it with the fee rather than stranding it.
        pendingWithdrawals[feeRecipient] += platformFee + (distributable - distributed);
    }

    function _payoutBps(uint256 position) private pure returns (uint256) {
        if (position == 0) return PAYOUT_BPS_1ST;
        if (position == 1) return PAYOUT_BPS_2ND;
        if (position == 2) return PAYOUT_BPS_3RD;
        if (position == 3) return PAYOUT_BPS_4TH;
        return 0;
    }

    /// @notice Cancel a race that never resolved and credit every entrant a refund.
    ///         Callable by anyone once `REFUND_TIMEOUT` has elapsed.
    /// @dev The Klever version refunded only the caller and then marked the race
    ///      Cancelled, which locked everyone else out of their own refund.
    function cancelRace(uint256 raceId) external {
        Race storage race = _races[raceId];
        if (race.status != RaceStatus.Open && race.status != RaceStatus.Locked) {
            revert RaceNotRefundable(raceId, race.status);
        }

        uint256 availableAt = race.createdAt + REFUND_TIMEOUT;
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
        uint16 requestConfirmations_
    ) external onlyOwner {
        subscriptionId = subscriptionId_;
        keyHash = keyHash_;
        callbackGasLimit = callbackGasLimit_;
        requestConfirmations = requestConfirmations_;
        emit VrfConfigSet(subscriptionId_, keyHash_, callbackGasLimit_, requestConfirmations_);
    }
}
