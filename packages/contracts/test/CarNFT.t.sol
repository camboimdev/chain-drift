// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {CarNFT} from "../src/CarNFT.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

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

    /// @dev The car a mint yields is decided entirely by the sequential token
    ///      ID — the collection manifest maps it to a model, rarity and traits.
    ///      Nothing about the car is chosen by the caller, so `CarMinted` needs
    ///      to carry no more than the owner and the ID.
    function test_mint_emitsOwnerAndTokenId() public {
        address alice = makeAddr("alice");
        vm.prank(owner);
        drift.mint(alice, 10e18);

        vm.startPrank(alice);
        drift.approve(address(carNft), MINT_FEE);
        vm.expectEmit(true, true, true, true, address(carNft));
        emit CarNFT.CarMinted(alice, 1);
        uint256 tokenId = carNft.mint();
        vm.stopPrank();

        assertEq(tokenId, 1);
        assertEq(carNft.ownerOf(tokenId), alice);
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
        carNft.mint();
    }

    function test_mintWithPermit_needsNoSeparateApproval() public {
        (address alice, uint256 aliceKey) = makeAddrAndKey("permitAlice");
        vm.prank(owner);
        drift.mint(alice, 10e18);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) =
            _signPermit(aliceKey, alice, address(carNft), MINT_FEE, deadline);

        vm.prank(alice);
        uint256 tokenId = carNft.mintWithPermit(deadline, v, r, s);

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
        uint256 a = carNft.mint();
        uint256 b = carNft.mint();
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

    /// @dev Explorers cache `tokenURI` when they first index a token, so a
    ///      `setBaseURI` leaves older tokens showing stale metadata until they
    ///      see another `Transfer`. Transferring a car to its own owner emits
    ///      that event; this pins down that it costs nothing else — ownership,
    ///      balance and the enumeration indices all have to survive intact.
    function test_transferToSelf_onlyReEmitsTransfer() public {
        address alice = makeAddr("alice");
        vm.prank(owner);
        drift.mint(alice, 100e18);

        vm.startPrank(alice);
        drift.approve(address(carNft), type(uint256).max);
        uint256 first = carNft.mint();
        uint256 second = carNft.mint();

        vm.expectEmit(true, true, true, true, address(carNft));
        emit IERC721.Transfer(alice, alice, first);
        carNft.transferFrom(alice, alice, first);
        vm.stopPrank();

        assertEq(carNft.ownerOf(first), alice);
        assertEq(carNft.balanceOf(alice), 2);
        assertEq(carNft.totalSupply(), 2);

        // The enumeration keeps its order: a self-transfer must not shuffle the
        // garage or drop a token out of the global index.
        uint256[] memory owned = carNft.tokensOfOwner(alice);
        assertEq(owned.length, 2);
        assertEq(owned[0], first);
        assertEq(owned[1], second);
        assertEq(carNft.tokenByIndex(0), first);
        assertEq(carNft.tokenByIndex(1), second);
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
