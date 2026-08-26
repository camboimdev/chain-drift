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

    function test_resolve_splitMatchesEconomyPercentages() public {
        uint256 raceId = _fullRace();
        uint256 requestId = escrow.requestResolve(raceId);
        vrf.fulfillRandomWords(requestId, address(escrow));

        // A full grid pays whole shares of the gross pool: 50 / 25 / 10 / 5,
        // with the remaining 10 going to the platform.
        uint256 pool = ENTRY_FEE * 4;

        uint256[4] memory expected = [
            (pool * 5000) / 10_000,
            (pool * 2500) / 10_000,
            (pool * 1000) / 10_000,
            (pool * 500) / 10_000
        ];

        // Finish order is random, so check the multiset of credited amounts.
        uint256[4] memory actual = [
            escrow.pendingWithdrawals(alice),
            escrow.pendingWithdrawals(bob),
            escrow.pendingWithdrawals(carol),
            escrow.pendingWithdrawals(dave)
        ];
        _assertSameMultiset(actual, expected);

        // The platform takes exactly its rake, no more.
        assertEq(escrow.pendingWithdrawals(feeRecipient), (pool * 1000) / 10_000, "rake drifted");
    }

    function test_resolve_fullGridPaysWholeMultiplesOfTheEntry() public {
        uint256 raceId = _fullRace();
        uint256 requestId = escrow.requestResolve(raceId);
        vrf.fulfillRandomWords(requestId, address(escrow));

        // The split a player is shown in the UI: win doubles the stake, 2nd
        // gets it back, 3rd keeps 40%, 4th keeps 20%.
        uint256[4] memory expected = [
            uint256(ENTRY_FEE) * 2,
            uint256(ENTRY_FEE),
            (uint256(ENTRY_FEE) * 40) / 100,
            (uint256(ENTRY_FEE) * 20) / 100
        ];
        uint256[4] memory actual = [
            escrow.pendingWithdrawals(alice),
            escrow.pendingWithdrawals(bob),
            escrow.pendingWithdrawals(carol),
            escrow.pendingWithdrawals(dave)
        ];
        _assertSameMultiset(actual, expected);
    }

    function test_resolve_shortFieldKeepsTheRakeFlat() public {
        uint256 raceId = escrow.createRace(ENTRY_FEE, 2);
        vm.prank(alice);
        escrow.enterRace(raceId, aliceCar);
        vm.prank(bob);
        escrow.enterRace(raceId, bobCar);

        uint256 requestId = escrow.requestResolve(raceId);
        vrf.fulfillRandomWords(requestId, address(escrow));

        uint256 pool = ENTRY_FEE * 2;
        uint256 platformFee = (pool * 1000) / 10_000;
        uint256 credited = escrow.pendingWithdrawals(alice) + escrow.pendingWithdrawals(bob)
            + escrow.pendingWithdrawals(feeRecipient);

        assertEq(credited, pool, "short field left value stranded");

        // The 3rd and 4th shares have no claimant, so they are redistributed to
        // the two racers instead of inflating the rake.
        assertEq(
            escrow.pendingWithdrawals(feeRecipient), platformFee, "short field inflated the rake"
        );

        uint256 distributable = pool - platformFee;
        uint256 totalWeight = 5000 + 2500;
        uint256[2] memory expected =
            [(distributable * 5000) / totalWeight, (distributable * 2500) / totalWeight];
        uint256[2] memory actualShort =
            [escrow.pendingWithdrawals(alice), escrow.pendingWithdrawals(bob)];

        bool inOrder = actualShort[0] == expected[0] && actualShort[1] == expected[1];
        bool reversed = actualShort[0] == expected[1] && actualShort[1] == expected[0];
        assertTrue(inOrder || reversed, "short field split mismatch");
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

        assertEq(escrow.pendingWithdrawals(expectedWinner), (uint256(ENTRY_FEE) * 4 * 5000) / 10_000);
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

    function test_cancelRace_recoversARaceWhoseVrfCallbackNeverArrives() public {
        uint256 raceId = _fullRace();
        escrow.requestResolve(raceId);
        assertEq(uint8(escrow.getRaceStatus(raceId)), uint8(RaceEscrow.RaceStatus.Resolving));

        // Found on Base Sepolia: a subscription without enough balance leaves the
        // request pending forever, and the stake has to stay recoverable.
        vm.warp(block.timestamp + 1 hours);
        escrow.cancelRace(raceId);

        assertEq(uint8(escrow.getRaceStatus(raceId)), uint8(RaceEscrow.RaceStatus.Cancelled));
        assertEq(escrow.pendingWithdrawals(alice), ENTRY_FEE);
        assertEq(escrow.pendingWithdrawals(dave), ENTRY_FEE);
    }

    function test_cancelRace_rejectsResolvingBeforeTheCallbackTimeout() public {
        uint256 raceId = _fullRace();
        escrow.requestResolve(raceId);

        // The clock runs from the resolve request, not from race creation — a
        // race that sat open for an hour still gets a full VRF grace period.
        vm.warp(block.timestamp + 59 minutes);
        vm.expectRevert(
            abi.encodeWithSelector(
                RaceEscrow.RefundTimeoutNotReached.selector, block.timestamp + 1 minutes
            )
        );
        escrow.cancelRace(raceId);
    }

    function test_lateVrfCallbackOnACancelledRacePaysNothing() public {
        uint256 raceId = _fullRace();
        uint256 requestId = escrow.requestResolve(raceId);

        vm.warp(block.timestamp + 1 hours);
        escrow.cancelRace(raceId);

        // The coordinator can still answer afterwards; it must not pay out on
        // top of the refunds that were already credited.
        vrf.fulfillRandomWords(requestId, address(escrow));

        assertEq(uint8(escrow.getRaceStatus(raceId)), uint8(RaceEscrow.RaceStatus.Cancelled));
        assertEq(escrow.pendingWithdrawals(alice), ENTRY_FEE);
        assertEq(escrow.pendingWithdrawals(feeRecipient), 0, "fee taken on a cancelled race");
    }

    function test_callbackGasLimit_coversMeasuredFulfilment() public view {
        // A four-player callback measures at ~195k gas on this code.
        assertGe(escrow.callbackGasLimit(), 250_000);
        // An inflated limit raises the subscription balance the DON demands
        // before it will fulfil at all, so it is capped deliberately.
        assertLe(escrow.callbackGasLimit(), 300_000);
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

    // ─── VRF subscription provisioning ──────────────────────────────────────

    function test_constructor_selfProvisionsSubscriptionWhenIdIsZero() public {
        // Passing 0 makes the contract create and register its own subscription,
        // which is what lets a deploy stay a single atomic transaction.
        RaceEscrow fresh = new RaceEscrow(
            address(vrf), 0, KEY_HASH, address(drift), address(carNft), feeRecipient
        );

        uint256 newSubId = fresh.subscriptionId();
        assertTrue(newSubId != 0, "no subscription created");
        assertTrue(newSubId != subId, "reused the fixture subscription");

        (,,, address subOwner, address[] memory consumers) = vrf.getSubscription(newSubId);
        assertEq(subOwner, address(fresh), "contract does not own its subscription");
        assertEq(consumers.length, 1);
        assertEq(consumers[0], address(fresh), "not registered as a consumer");
    }

    function test_constructor_keepsGivenSubscriptionId() public {
        RaceEscrow fresh = new RaceEscrow(
            address(vrf), subId, KEY_HASH, address(drift), address(carNft), feeRecipient
        );
        assertEq(fresh.subscriptionId(), subId);
    }

    function test_fundVrfSubscription_isOpenToAnyone() public {
        RaceEscrow fresh = new RaceEscrow(
            address(vrf), 0, KEY_HASH, address(drift), address(carNft), feeRecipient
        );

        address stranger = makeAddr("stranger");
        vm.deal(stranger, 1 ether);

        assertEq(fresh.vrfNativeBalance(), 0);

        vm.prank(stranger);
        fresh.fundVrfSubscription{value: 0.25 ether}();

        assertEq(fresh.vrfNativeBalance(), 0.25 ether);
    }

    function test_selfProvisionedSubscription_resolvesARace() public {
        RaceEscrow fresh = new RaceEscrow(
            address(vrf), 0, KEY_HASH, address(drift), address(carNft), feeRecipient
        );
        vm.deal(address(this), 1 ether);
        fresh.fundVrfSubscription{value: 1 ether}();

        uint256 raceId = fresh.createRace(ENTRY_FEE, 2);
        vm.startPrank(alice);
        drift.approve(address(fresh), type(uint256).max);
        fresh.enterRace(raceId, aliceCar);
        vm.stopPrank();
        vm.startPrank(bob);
        drift.approve(address(fresh), type(uint256).max);
        fresh.enterRace(raceId, bobCar);
        vm.stopPrank();

        uint256 requestId = fresh.requestResolve(raceId);
        vrf.fulfillRandomWords(requestId, address(fresh));

        assertEq(uint8(fresh.getRaceStatus(raceId)), uint8(RaceEscrow.RaceStatus.Paid));
        assertLt(fresh.vrfNativeBalance(), 1 ether, "randomness was not billed to the subscription");
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
