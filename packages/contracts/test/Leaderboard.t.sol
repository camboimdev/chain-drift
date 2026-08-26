// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {Leaderboard} from "../src/Leaderboard.sol";

contract LeaderboardTest is BaseTest {
    address internal recorder = makeAddr("recorder");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public override {
        super.setUp();
        vm.prank(owner);
        leaderboard.setRecorder(recorder);
    }

    function test_recordResult_accumulatesWinsRacesAndEarnings() public {
        vm.startPrank(recorder);
        leaderboard.recordResult(1, _results(alice, 1, 100e18, bob, 2, 50e18));
        leaderboard.recordResult(2, _results(bob, 1, 100e18, alice, 2, 50e18));
        vm.stopPrank();

        Leaderboard.PlayerStats memory aliceStats = leaderboard.getStats(alice);
        assertEq(aliceStats.races, 2);
        assertEq(aliceStats.wins, 1);
        assertEq(aliceStats.totalEarned, 150e18);

        Leaderboard.PlayerStats memory bobStats = leaderboard.getStats(bob);
        assertEq(bobStats.races, 2);
        assertEq(bobStats.wins, 1);
        assertEq(bobStats.totalEarned, 150e18);
    }

    function test_recordResult_isIdempotentPerRaceId() public {
        vm.startPrank(recorder);
        leaderboard.recordResult(7, _results(alice, 1, 100e18, bob, 2, 0));
        leaderboard.recordResult(7, _results(alice, 1, 100e18, bob, 2, 0));
        vm.stopPrank();

        assertEq(leaderboard.getStats(alice).races, 1);
        assertEq(leaderboard.getStats(alice).totalEarned, 100e18);
    }

    function test_recordResult_rejectsUnauthorizedCaller() public {
        address mallory = makeAddr("mallory");
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(Leaderboard.NotAuthorized.selector, mallory));
        leaderboard.recordResult(1, _results(alice, 1, 0, bob, 2, 0));
    }

    function test_recordResult_acceptsOwnerAndRaceEscrow() public {
        vm.prank(owner);
        leaderboard.recordResult(1, _results(alice, 1, 0, bob, 2, 0));

        vm.prank(address(escrow));
        leaderboard.recordResult(2, _results(alice, 1, 0, bob, 2, 0));

        assertEq(leaderboard.getStats(alice).races, 2);
    }

    function test_recordResult_rejectsEmptyResults() public {
        vm.prank(recorder);
        vm.expectRevert(Leaderboard.EmptyResults.selector);
        leaderboard.recordResult(1, new Leaderboard.PlayerResult[](0));
    }

    function test_getPlayers_paginates() public {
        vm.startPrank(recorder);
        leaderboard.recordResult(1, _results(alice, 1, 10e18, bob, 2, 5e18));
        vm.stopPrank();

        assertEq(leaderboard.playerCount(), 2);

        (address[] memory page, Leaderboard.PlayerStats[] memory stats) =
            leaderboard.getPlayers(0, 1);
        assertEq(page.length, 1);
        assertEq(page[0], alice);
        assertEq(stats[0].totalEarned, 10e18);

        (address[] memory second,) = leaderboard.getPlayers(1, 10);
        assertEq(second.length, 1);
        assertEq(second[0], bob);

        (address[] memory past,) = leaderboard.getPlayers(5, 10);
        assertEq(past.length, 0);
    }

    function _results(
        address p1,
        uint8 pos1,
        uint256 payout1,
        address p2,
        uint8 pos2,
        uint256 payout2
    ) private pure returns (Leaderboard.PlayerResult[] memory results) {
        results = new Leaderboard.PlayerResult[](2);
        results[0] = Leaderboard.PlayerResult({player: p1, position: pos1, payout: payout1});
        results[1] = Leaderboard.PlayerResult({player: p2, position: pos2, payout: payout2});
    }
}
