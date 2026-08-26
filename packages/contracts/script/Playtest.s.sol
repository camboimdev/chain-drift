// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/console2.sol";
import {DeployerKey} from "./DeployerKey.sol";
import {DriftToken} from "../src/DriftToken.sol";
import {CarNFT} from "../src/CarNFT.sol";
import {RaceEscrow} from "../src/RaceEscrow.sol";
import {Leaderboard} from "../src/Leaderboard.sol";

/// @notice Drives a real race on a live deployment, one step per invocation.
///
/// Each step is a separate `forge script --sig` call on purpose. Anything a
/// later transaction needs from an earlier one — a race ID, a token ID — has to
/// be read back from the chain between runs: a script records its transactions
/// during a simulated pass, so a value produced by one recorded transaction is
/// stale by the time the next one is broadcast.
///
///   forge script script/Playtest.s.sol --sig 'fundVrf(uint256)' 30000000000000 \
///     --rpc-url base_sepolia --broadcast
contract Playtest is DeployerKey {
    DriftToken internal drift;
    CarNFT internal carNft;
    RaceEscrow internal escrow;
    Leaderboard internal leaderboard;

    function setUp() public {
        string memory json = vm.readFile(
            string.concat("deployments/", vm.toString(block.chainid), ".json")
        );
        drift = DriftToken(vm.parseJsonAddress(json, ".driftToken"));
        carNft = CarNFT(vm.parseJsonAddress(json, ".carNft"));
        escrow = RaceEscrow(vm.parseJsonAddress(json, ".raceEscrow"));
        leaderboard = Leaderboard(vm.parseJsonAddress(json, ".leaderboard"));
    }

    // ─── Steps ──────────────────────────────────────────────────────────────

    /// @notice Top up the VRF subscription so races can be resolved.
    function fundVrf(uint256 amountWei) external {
        vm.startBroadcast(deployerPrivateKey());
        escrow.fundVrfSubscription{value: amountWei}();
        vm.stopBroadcast();
    }

    /// @notice Claim DRIFT from the faucet and mint one car.
    function bootstrap() external {
        uint256 key = deployerPrivateKey();
        address me = vm.addr(key);

        vm.startBroadcast(key);
        if (drift.balanceOf(me) < 10e18) {
            drift.faucet();
        }
        drift.approve(address(carNft), type(uint256).max);
        drift.approve(address(escrow), type(uint256).max);
        carNft.mint("sport");
        vm.stopBroadcast();
    }

    /// @notice Mint `count` cars of one archetype to the deployer.
    /// @dev Restores a garage after a redeploy. Token IDs restart at 1 on the
    ///      new collection, so a car keeps its archetype but not its old ID —
    ///      the 3D model and rarity are derived from the ID, not stored.
    function mintCars(uint256 count, string calldata archetype) external {
        uint256 key = deployerPrivateKey();
        address me = vm.addr(key);

        vm.startBroadcast(key);
        if (drift.allowance(me, address(carNft)) < carNft.mintFee() * count) {
            drift.approve(address(carNft), type(uint256).max);
        }
        for (uint256 i = 0; i < count; ++i) {
            carNft.mint(archetype);
        }
        vm.stopBroadcast();
    }

    /// @notice Open a race room.
    /// @dev `maxPlayers` of 1 makes the whole lifecycle testable from a single
    ///      funded wallet — the room locks on the first entry.
    function createRace(uint128 entryFee, uint8 maxPlayers) external {
        vm.startBroadcast(deployerPrivateKey());
        escrow.createRace(entryFee, maxPlayers);
        vm.stopBroadcast();
    }

    function enter(uint256 raceId, uint256 carTokenId) external {
        vm.startBroadcast(deployerPrivateKey());
        escrow.enterRace(raceId, carTokenId);
        vm.stopBroadcast();
    }

    function resolve(uint256 raceId) external {
        vm.startBroadcast(deployerPrivateKey());
        escrow.requestResolve(raceId);
        vm.stopBroadcast();
    }

    function claimPrize() external {
        vm.startBroadcast(deployerPrivateKey());
        escrow.claim();
        vm.stopBroadcast();
    }

    // ─── Read-only ──────────────────────────────────────────────────────────

    function status(uint256 raceId) external view {
        address me = deployerAddress();
        RaceEscrow.Race memory race = escrow.getRace(raceId);

        console2.log("wallet ETH wei ", me.balance);
        console2.log("wallet DRIFT   ", drift.balanceOf(me) / 1e18);
        console2.log("cars owned     ", carNft.balanceOf(me));
        console2.log("vrf sub id     ", escrow.subscriptionId());
        console2.log("vrf balance wei", escrow.vrfNativeBalance());
        console2.log("---");
        console2.log("race           ", raceId);
        console2.log("status (1=Open 2=Locked 3=Resolving 4=Paid)", uint8(race.status));
        console2.log("participants   ", escrow.getParticipantCount(raceId));
        console2.log("vrf request id ", race.vrfRequestId);
        console2.log("claimable wei  ", escrow.pendingWithdrawals(me));

        Leaderboard.PlayerStats memory stats = leaderboard.getStats(me);
        console2.log("---");
        console2.log("leaderboard races ", stats.races);
        console2.log("leaderboard wins  ", stats.wins);
        console2.log("leaderboard earned", stats.totalEarned);
    }
}
