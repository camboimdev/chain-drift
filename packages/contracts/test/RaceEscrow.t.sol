// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {RaceEscrow} from "../src/RaceEscrow.sol";

contract RaceEscrowTest is BaseTest {
    address internal alice;
    address internal bob;
    address internal carol;
    address internal dave;
    uint256 internal aliceCar;
    uint256 internal bobCar;
    uint256 internal carolCar;
    uint256 internal daveCar;

    function setUp() public override {
        super.setUp();
        (alice, aliceCar) = _newPlayer("alice", 1000e18);
        (bob, bobCar) = _newPlayer("bob", 1000e18);
        (carol, carolCar) = _newPlayer("carol", 1000e18);
        (dave, daveCar) = _newPlayer("dave", 1000e18);
    }

    // ─── Entry ──────────────────────────────────────────────────────────────

    function test_createRace_assignsSequentialIds() public {
        uint256 first = escrow.createRace(ENTRY_FEE, 4);
        uint256 second = escrow.createRace(ENTRY_FEE, 2);

        assertEq(first, 1);
        assertEq(second, 2);
        assertEq(uint8(escrow.getRaceStatus(first)), uint8(RaceEscrow.RaceStatus.Open));
    }

    function test_createRace_rejectsInvalidMaxPlayers() public {
        vm.expectRevert(abi.encodeWithSelector(RaceEscrow.InvalidMaxPlayers.selector, uint8(0)));
        escrow.createRace(ENTRY_FEE, 0);

        vm.expectRevert(abi.encodeWithSelector(RaceEscrow.InvalidMaxPlayers.selector, uint8(5)));
        escrow.createRace(ENTRY_FEE, 5);
    }

    function test_enterRace_escrowsFeeAndLocksWhenFull() public {
        uint256 raceId = escrow.createRace(ENTRY_FEE, 2);

        vm.prank(alice);
        escrow.enterRace(raceId, aliceCar);
        assertEq(uint8(escrow.getRaceStatus(raceId)), uint8(RaceEscrow.RaceStatus.Open));

        vm.prank(bob);
        escrow.enterRace(raceId, bobCar);

        assertEq(uint8(escrow.getRaceStatus(raceId)), uint8(RaceEscrow.RaceStatus.Locked));
        assertEq(escrow.getParticipantCount(raceId), 2);
        assertEq(drift.balanceOf(address(escrow)), ENTRY_FEE * 2);
    }

    function test_enterRace_rejectsDoubleEntry() public {
        uint256 raceId = escrow.createRace(ENTRY_FEE, 4);

        vm.startPrank(alice);
        escrow.enterRace(raceId, aliceCar);
        vm.expectRevert(
            abi.encodeWithSelector(RaceEscrow.AlreadyEntered.selector, raceId, alice)
        );
        escrow.enterRace(raceId, aliceCar);
        vm.stopPrank();
    }

    function test_enterRace_rejectsCarYouDoNotOwn() public {
        uint256 raceId = escrow.createRace(ENTRY_FEE, 4);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RaceEscrow.NotCarOwner.selector, bobCar, alice));
        escrow.enterRace(raceId, bobCar);
    }

    function test_enterRace_rejectsWhenNotOpen() public {
        uint256 raceId = escrow.createRace(ENTRY_FEE, 1);

        vm.prank(alice);
        escrow.enterRace(raceId, aliceCar);

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                RaceEscrow.RaceNotOpen.selector, raceId, RaceEscrow.RaceStatus.Locked
            )
        );
        escrow.enterRace(raceId, bobCar);
    }

    // ─── Resolution ─────────────────────────────────────────────────────────

    function test_resolve_paysOutFullSplitAndConservesValue() public {
        uint256 raceId = _fullRace();

        uint256 requestId = escrow.requestResolve(raceId);
        assertEq(uint8(escrow.getRaceStatus(raceId)), uint8(RaceEscrow.RaceStatus.Resolving));

        vrf.fulfillRandomWords(requestId, address(escrow));
        assertEq(uint8(escrow.getRaceStatus(raceId)), uint8(RaceEscrow.RaceStatus.Paid));

        uint256 pool = ENTRY_FEE * 4;
        uint256 credited = escrow.pendingWithdrawals(alice) + escrow.pendingWithdrawals(bob)
            + escrow.pendingWithdrawals(carol) + escrow.pendingWithdrawals(dave)
            + escrow.pendingWithdrawals(feeRecipient);

        // Every unit of the pool is accounted for — nothing stranded in the contract.
        assertEq(credited, pool, "pool not fully credited");
        assertEq(drift.balanceOf(address(escrow)), pool);
    }

    function test_resolve_splitMatchesRaceLogicPercentages() public {
        uint256 raceId = _fullRace();
        uint256 requestId = escrow.requestResolve(raceId);
        vrf.fulfillRandomWords(requestId, address(escrow));

        uint256 pool = ENTRY_FEE * 4;
        uint256 distributable = pool - (pool * 500) / 10_000;

        uint256[4] memory expected = [
            (distributable * 5000) / 10_000,
            (distributable * 3000) / 10_000,
            (distributable * 1500) / 10_000,
            (distributable * 500) / 10_000
        ];

        // Finish order is random, so check the multiset of credited amounts.
        uint256[4] memory actual = [
            escrow.pendingWithdrawals(alice),
            escrow.pendingWithdrawals(bob),
            escrow.pendingWithdrawals(carol),
            escrow.pendingWithdrawals(dave)
        ];
        _assertSameMultiset(actual, expected);
    }

    function test_resolve_shortFieldSweepsRemainderToFeeRecipient() public {
        uint256 raceId = escrow.createRace(ENTRY_FEE, 2);
        vm.prank(alice);
        escrow.enterRace(raceId, aliceCar);
        vm.prank(bob);
        escrow.enterRace(raceId, bobCar);

        uint256 requestId = escrow.requestResolve(raceId);
        vrf.fulfillRandomWords(requestId, address(escrow));

        uint256 pool = ENTRY_FEE * 2;
        uint256 credited = escrow.pendingWithdrawals(alice) + escrow.pendingWithdrawals(bob)
            + escrow.pendingWithdrawals(feeRecipient);

        // 3rd and 4th place shares have no claimant with only two racers.
        assertEq(credited, pool, "short field left value stranded");
        assertGt(escrow.pendingWithdrawals(feeRecipient), (pool * 500) / 10_000);
    }

    function test_resolve_rejectsRaceThatIsNotLocked() public {
        uint256 raceId = escrow.createRace(ENTRY_FEE, 4);

        vm.expectRevert(
            abi.encodeWithSelector(
                RaceEscrow.RaceNotLocked.selector, raceId, RaceEscrow.RaceStatus.Open
            )
        );
        escrow.requestResolve(raceId);
    }

    function test_resolve_isDeterministicForAGivenRandomWord() public {
        uint256 raceId = _fullRace();
        uint256 requestId = escrow.requestResolve(raceId);

        uint256[] memory words = new uint256[](1);
        words[0] = 42;
        vrf.fulfillRandomWordsWithOverride(requestId, address(escrow), words);

        // Scores are keccak256(word, carTokenId); the highest takes first place.
        RaceEscrow.Participant[] memory entries = escrow.getParticipants(raceId);
        uint256 bestScore;
        address expectedWinner;
        for (uint256 i = 0; i < entries.length; ++i) {
            uint256 score = uint256(keccak256(abi.encodePacked(words[0], entries[i].carTokenId)));
            if (score > bestScore) {
                bestScore = score;
                expectedWinner = entries[i].player;
            }
        }

        uint256 pool = ENTRY_FEE * 4;
        uint256 distributable = pool - (pool * 500) / 10_000;
        assertEq(escrow.pendingWithdrawals(expectedWinner), (distributable * 5000) / 10_000);
    }

    // ─── Claiming ───────────────────────────────────────────────────────────

    function test_claim_transfersAndZeroesBalance() public {
        uint256 raceId = _fullRace();
        uint256 requestId = escrow.requestResolve(raceId);
        vrf.fulfillRandomWords(requestId, address(escrow));

        uint256 owed = escrow.pendingWithdrawals(alice);
        uint256 before = drift.balanceOf(alice);

        vm.prank(alice);
        escrow.claim();

        assertEq(drift.balanceOf(alice), before + owed);
        assertEq(escrow.pendingWithdrawals(alice), 0);

        vm.prank(alice);
        vm.expectRevert(RaceEscrow.NothingToClaim.selector);
        escrow.claim();
    }

    // ─── Refunds ────────────────────────────────────────────────────────────

    function test_cancelRace_refundsEveryEntrantNotJustTheCaller() public {
        uint256 raceId = escrow.createRace(ENTRY_FEE, 4);
        vm.prank(alice);
        escrow.enterRace(raceId, aliceCar);
        vm.prank(bob);
        escrow.enterRace(raceId, bobCar);

        vm.warp(block.timestamp + 1 hours);
        escrow.cancelRace(raceId);

        assertEq(uint8(escrow.getRaceStatus(raceId)), uint8(RaceEscrow.RaceStatus.Cancelled));
        assertEq(escrow.pendingWithdrawals(alice), ENTRY_FEE);
        assertEq(escrow.pendingWithdrawals(bob), ENTRY_FEE);

        vm.prank(bob);
        escrow.claim();
        assertEq(drift.balanceOf(bob), 1000e18 - MINT_FEE);
    }

    function test_cancelRace_rejectsBeforeTimeout() public {
        uint256 raceId = escrow.createRace(ENTRY_FEE, 4);
        vm.prank(alice);
        escrow.enterRace(raceId, aliceCar);

        vm.expectRevert(
            abi.encodeWithSelector(
                RaceEscrow.RefundTimeoutNotReached.selector, block.timestamp + 1 hours
            )
        );
        escrow.cancelRace(raceId);
    }

    function test_cancelRace_rejectsAlreadyPaidRace() public {
        uint256 raceId = _fullRace();
        uint256 requestId = escrow.requestResolve(raceId);
        vrf.fulfillRandomWords(requestId, address(escrow));

        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(
            abi.encodeWithSelector(
                RaceEscrow.RaceNotRefundable.selector, raceId, RaceEscrow.RaceStatus.Paid
            )
        );
        escrow.cancelRace(raceId);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function test_getOpenRaces_returnsNewestFirstAndSkipsLocked() public {
        uint256 r1 = escrow.createRace(ENTRY_FEE, 4);
        uint256 r2 = escrow.createRace(ENTRY_FEE, 1);
        uint256 r3 = escrow.createRace(ENTRY_FEE, 4);

        vm.prank(alice);
        escrow.enterRace(r2, aliceCar); // fills and locks r2

        uint256[] memory open = escrow.getOpenRaces(10, 30);
        assertEq(open.length, 2);
        assertEq(open[0], r3);
        assertEq(open[1], r1);
    }

    function test_getOpenRaces_honoursLimit() public {
        escrow.createRace(ENTRY_FEE, 4);
        escrow.createRace(ENTRY_FEE, 4);
        escrow.createRace(ENTRY_FEE, 4);

        assertEq(escrow.getOpenRaces(2, 30).length, 2);
    }

    function test_getOpenRaces_emptyWhenNoRaces() public view {
        assertEq(escrow.getOpenRaces(10, 30).length, 0);
    }

    // ─── VRF config ─────────────────────────────────────────────────────────

    function test_vrfConfig_defaultsToNativePayment() public view {
        // A native-funded subscription is billed in ETH, so a working testnet
        // needs no LINK at all.
        assertTrue(escrow.nativePayment());
    }

    function test_setVrfConfig_onlyOwnerAndUpdatesEveryField() public {
        address escrowOwner = escrow.owner();

        vm.prank(escrowOwner);
        escrow.setVrfConfig(99, keccak256("other-lane"), 800_000, 5, false);

        assertEq(escrow.subscriptionId(), 99);
        assertEq(escrow.keyHash(), keccak256("other-lane"));
        assertEq(escrow.callbackGasLimit(), 800_000);
        assertEq(escrow.requestConfirmations(), 5);
        assertFalse(escrow.nativePayment());

        address mallory = makeAddr("mallory");
        vm.prank(mallory);
        vm.expectRevert();
        escrow.setVrfConfig(1, KEY_HASH, 500_000, 3, true);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    function _fullRace() private returns (uint256 raceId) {
        raceId = escrow.createRace(ENTRY_FEE, 4);
        vm.prank(alice);
        escrow.enterRace(raceId, aliceCar);
        vm.prank(bob);
        escrow.enterRace(raceId, bobCar);
        vm.prank(carol);
        escrow.enterRace(raceId, carolCar);
        vm.prank(dave);
        escrow.enterRace(raceId, daveCar);
    }

    function _assertSameMultiset(uint256[4] memory a, uint256[4] memory b) private pure {
        bool[4] memory used;
        for (uint256 i = 0; i < 4; ++i) {
            bool matched;
            for (uint256 j = 0; j < 4; ++j) {
                if (!used[j] && a[i] == b[j]) {
                    used[j] = true;
                    matched = true;
                    break;
                }
            }
            require(matched, "payout multiset mismatch");
        }
    }
}
