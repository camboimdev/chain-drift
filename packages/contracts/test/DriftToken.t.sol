// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DriftToken} from "../src/DriftToken.sol";

contract DriftTokenTest is Test {
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    DriftToken internal drift;

    function setUp() public {
        vm.prank(owner);
        drift = new DriftToken(1_000e18, owner, true);
    }

    function test_deploy_mintsInitialSupplyToOwner() public view {
        assertEq(drift.balanceOf(owner), 1_000e18);
        assertEq(drift.decimals(), 18);
        assertEq(drift.symbol(), "DRIFT");
    }

    function test_faucet_paysOutAndEnforcesCooldown() public {
        vm.prank(alice);
        drift.faucet();
        assertEq(drift.balanceOf(alice), drift.FAUCET_AMOUNT());

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                DriftToken.FaucetCooldownActive.selector, block.timestamp + 12 hours
            )
        );
        drift.faucet();

        vm.warp(block.timestamp + 12 hours);
        vm.prank(alice);
        drift.faucet();
        assertEq(drift.balanceOf(alice), drift.FAUCET_AMOUNT() * 2);
    }

    function test_faucet_revertsWhenDisabled() public {
        vm.prank(owner);
        drift.setFaucetEnabled(false);

        vm.prank(alice);
        vm.expectRevert(DriftToken.FaucetDisabled.selector);
        drift.faucet();
    }

    function test_mint_onlyOwner() public {
        vm.prank(owner);
        drift.mint(alice, 5e18);
        assertEq(drift.balanceOf(alice), 5e18);

        vm.prank(alice);
        vm.expectRevert();
        drift.mint(alice, 5e18);
    }

    function test_burn_reducesSupply() public {
        vm.prank(owner);
        drift.burn(400e18);
        assertEq(drift.totalSupply(), 600e18);
    }
}
