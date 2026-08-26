// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {CarNFT} from "../src/CarNFT.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract CarNFTTest is BaseTest {
    function test_mint_chargesFeeAndAssignsSequentialIds() public {
        (address alice, uint256 firstCar) = _newPlayer("alice", 100e18);
        assertEq(firstCar, 1);
        assertEq(carNft.ownerOf(firstCar), alice);
        assertEq(drift.balanceOf(alice), 100e18 - MINT_FEE);
        assertEq(drift.balanceOf(owner), 1_000_000e18 + MINT_FEE);

        (, uint256 secondCar) = _newPlayer("bob", 100e18);
        assertEq(secondCar, 2);
        assertEq(carNft.nextTokenId(), 3);
    }

    function test_mint_storesArchetype() public {
        address alice = makeAddr("alice");
        vm.prank(owner);
        drift.mint(alice, 10e18);

        vm.startPrank(alice);
        drift.approve(address(carNft), MINT_FEE);
        uint256 tokenId = carNft.mint("stealth");
        vm.stopPrank();

        assertEq(carNft.archetypeOf(tokenId), "stealth");
    }

    function test_mint_rejectsUnknownArchetype() public {
        address alice = makeAddr("alice");
        vm.prank(owner);
        drift.mint(alice, 10e18);

        vm.startPrank(alice);
        drift.approve(address(carNft), MINT_FEE);
        vm.expectRevert(abi.encodeWithSelector(CarNFT.UnknownArchetype.selector, "hovercraft"));
        carNft.mint("hovercraft");
        vm.stopPrank();
    }

    function test_mint_revertsWithoutAllowance() public {
        address alice = makeAddr("alice");
        vm.prank(owner);
        drift.mint(alice, 10e18);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(carNft), 0, MINT_FEE
            )
        );
        carNft.mint("sport");
    }

    function test_mintWithPermit_needsNoSeparateApproval() public {
        (address alice, uint256 aliceKey) = makeAddrAndKey("permitAlice");
        vm.prank(owner);
        drift.mint(alice, 10e18);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) =
            _signPermit(aliceKey, alice, address(carNft), MINT_FEE, deadline);

        vm.prank(alice);
        uint256 tokenId = carNft.mintWithPermit("muscle", deadline, v, r, s);

        assertEq(carNft.ownerOf(tokenId), alice);
        assertEq(drift.balanceOf(alice), 10e18 - MINT_FEE);
    }

    // ─── Parts ──────────────────────────────────────────────────────────────

    function test_equipPart_storesAndListsLoadout() public {
        (address alice, uint256 car) = _newPlayer("alice", 100e18);

        vm.startPrank(alice);
        carNft.equipPart(car, "Wheels", "wheel-spoked-01");
        carNft.equipPart(car, "Spoiler", "spoiler-gt-02");
        vm.stopPrank();

        assertEq(carNft.getEquippedPart(car, "Wheels"), "wheel-spoked-01");

        (string[] memory slots, string[] memory partIds) = carNft.getEquippedParts(car);
        assertEq(slots.length, 2);
        assertEq(slots[0], "Wheels");
        assertEq(partIds[0], "wheel-spoked-01");
        assertEq(slots[1], "Spoiler");
        assertEq(partIds[1], "spoiler-gt-02");
    }

    function test_equipPart_overwritesSameSlotWithoutDuplicating() public {
        (address alice, uint256 car) = _newPlayer("alice", 100e18);

        vm.startPrank(alice);
        carNft.equipPart(car, "Wheels", "wheel-spoked-01");
        carNft.equipPart(car, "Wheels", "wheel-mesh-03");
        vm.stopPrank();

        (string[] memory slots, string[] memory partIds) = carNft.getEquippedParts(car);
        assertEq(slots.length, 1);
        assertEq(partIds[0], "wheel-mesh-03");
    }

    function test_equipPart_rejectsNonOwner() public {
        (, uint256 car) = _newPlayer("alice", 100e18);
        address mallory = makeAddr("mallory");

        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(CarNFT.NotCarOwner.selector, car, mallory));
        carNft.equipPart(car, "Wheels", "wheel-spoked-01");
    }

    function test_unequipPart_clearsSlot() public {
        (address alice, uint256 car) = _newPlayer("alice", 100e18);

        vm.startPrank(alice);
        carNft.equipPart(car, "Wheels", "wheel-spoked-01");
        carNft.unequipPart(car, "Wheels");
        vm.stopPrank();

        assertEq(carNft.getEquippedPart(car, "Wheels"), "");
        (string[] memory slots,) = carNft.getEquippedParts(car);
        assertEq(slots.length, 0);
    }

    function test_unequipPart_rejectsEmptySlot() public {
        (address alice, uint256 car) = _newPlayer("alice", 100e18);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CarNFT.SlotEmpty.selector, car, "Spoiler"));
        carNft.unequipPart(car, "Spoiler");
    }

    // ─── Views and admin ────────────────────────────────────────────────────

    function test_tokensOfOwner_listsWholeGarage() public {
        address alice = makeAddr("alice");
        vm.prank(owner);
        drift.mint(alice, 100e18);

        vm.startPrank(alice);
        drift.approve(address(carNft), type(uint256).max);
        uint256 a = carNft.mint("sport");
        uint256 b = carNft.mint("street");
        vm.stopPrank();

        uint256[] memory owned = carNft.tokensOfOwner(alice);
        assertEq(owned.length, 2);
        assertEq(owned[0], a);
        assertEq(owned[1], b);
    }

    function test_tokenURI_appendsTokenId() public {
        (, uint256 car) = _newPlayer("alice", 100e18);
        assertEq(carNft.tokenURI(car), "https://meta.test/1");
    }

    function test_setMintFee_onlyOwner() public {
        vm.prank(owner);
        carNft.setMintFee(5e18);
        assertEq(carNft.mintFee(), 5e18);

        address mallory = makeAddr("mallory");
        vm.prank(mallory);
        vm.expectRevert();
        carNft.setMintFee(0);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    function _signPermit(
        uint256 signerKey,
        address ownerAddr,
        address spender,
        uint256 value,
        uint256 deadline
    ) private view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
                ),
                ownerAddr,
                spender,
                value,
                drift.nonces(ownerAddr),
                deadline
            )
        );
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", drift.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(signerKey, digest);
    }
}
