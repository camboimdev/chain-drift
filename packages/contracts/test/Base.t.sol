// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VRFCoordinatorV2_5Mock} from
    "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol";
import {DriftToken} from "../src/DriftToken.sol";
import {CarNFT} from "../src/CarNFT.sol";
import {RaceEscrow} from "../src/RaceEscrow.sol";
import {Leaderboard} from "../src/Leaderboard.sol";

/// @notice Shared fixture: the whole stack wired against a local VRF mock.
abstract contract BaseTest is Test {
    bytes32 internal constant KEY_HASH = keccak256("gas-lane");
    uint256 internal constant MINT_FEE = 1e18;
    /// @dev The production entry fee. A full grid stakes 100 DRIFT, which makes
    ///      every position's share a whole number of tokens.
    uint128 internal constant ENTRY_FEE = 25e18;

    address internal owner = makeAddr("owner");
    address internal feeRecipient = makeAddr("feeRecipient");

    VRFCoordinatorV2_5Mock internal vrf;
    DriftToken internal drift;
    CarNFT internal carNft;
    RaceEscrow internal escrow;
    Leaderboard internal leaderboard;

    uint256 internal subId;

    function setUp() public virtual {
        vrf = new VRFCoordinatorV2_5Mock(0.1 ether, 1e9, 4e15);
        subId = vrf.createSubscription();
        // RaceEscrow requests randomness with nativePayment on, so the
        // subscription has to hold native balance, not LINK.
        vm.deal(address(this), 100 ether);
        vrf.fundSubscriptionWithNative{value: 100 ether}(subId);

        vm.startPrank(owner);
        drift = new DriftToken(1_000_000e18, owner, true);
        carNft = new CarNFT(address(drift), MINT_FEE, "https://meta.test/", owner);
        leaderboard = new Leaderboard(owner);
        vm.stopPrank();

        escrow = new RaceEscrow(
            address(vrf), subId, KEY_HASH, address(drift), address(carNft), feeRecipient
        );
        vrf.addConsumer(subId, address(escrow));

        vm.prank(owner);
        leaderboard.setRaceEscrow(address(escrow));
    }

    /// @dev Funds `player` with DRIFT, mints them a car, and approves the escrow.
    function _newPlayer(string memory name, uint256 driftAmount)
        internal
        returns (address player, uint256 carTokenId)
    {
        player = makeAddr(name);

        vm.prank(owner);
        drift.mint(player, driftAmount);

        vm.startPrank(player);
        drift.approve(address(carNft), MINT_FEE);
        carTokenId = carNft.mint();
        drift.approve(address(escrow), type(uint256).max);
        vm.stopPrank();
    }
}
