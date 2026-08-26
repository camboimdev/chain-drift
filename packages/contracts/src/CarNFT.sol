// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from
    "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title CarNFT — Chain Drift car collection
/// @notice ERC-721 replacement for the Klever KDA collection `CAR-2JT4`.
///         The 3D car is derived client-side from `tokenId` via
///         `generateCar(tokenId)`, so the contract only needs to track
///         ownership, the archetype chosen at mint, and equipped upgrade parts.
/// @dev Token IDs start at 1 and increase monotonically, matching the Klever
///      nonce semantics the renderer and metadata pipeline already assume.
contract CarNFT is ERC721Enumerable, Ownable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    /// @notice DRIFT token accepted for the mint fee.
    IERC20 public immutable paymentToken;

    /// @notice Fee charged per mint, in DRIFT (18 decimals).
    uint256 public mintFee;

    /// @notice Where the mint fees accumulate. Defaults to the deployer.
    address public feeRecipient;

    /// @notice Base URI for `tokenURI` — the metadata-api or an IPFS gateway.
    string private _baseTokenURI;

    uint256 private _nextTokenId = 1;

    /// @notice Archetype chosen at mint: "sport" | "muscle" | "stealth" | "electric" | "street".
    mapping(uint256 tokenId => string archetype) public archetypeOf;

    /// Equipped parts, keyed by `keccak256(slot)` so slots stay free-form strings.
    mapping(uint256 tokenId => mapping(bytes32 slotHash => string partId)) private _equipped;
    mapping(uint256 tokenId => EnumerableSet.Bytes32Set slotHashes) private _filledSlots;
    mapping(bytes32 slotHash => string slot) private _slotName;

    error NotCarOwner(uint256 tokenId, address caller);
    error UnknownArchetype(string archetype);
    error SlotEmpty(uint256 tokenId, string slot);
    error ZeroAddress();

    event CarMinted(address indexed owner, uint256 indexed tokenId, string archetype);
    event PartEquipped(uint256 indexed tokenId, string slot, string partId);
    event PartUnequipped(uint256 indexed tokenId, string slot);
    event MintFeeSet(uint256 newFee);
    event FeeRecipientSet(address indexed newRecipient);
    event BaseURISet(string newBaseURI);

    /// @param paymentToken_ DRIFT token address.
    /// @param mintFee_      Fee per mint in DRIFT (18 decimals).
    /// @param baseURI_      Metadata base URI, e.g. "https://api.chaindrift.xyz/metadata/".
    /// @param owner_        Contract admin and initial fee recipient.
    constructor(address paymentToken_, uint256 mintFee_, string memory baseURI_, address owner_)
        ERC721("Chain Drift Car", "CDCAR")
        Ownable(owner_)
    {
        if (paymentToken_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        paymentToken = IERC20(paymentToken_);
        mintFee = mintFee_;
        feeRecipient = owner_;
        _baseTokenURI = baseURI_;
    }

    // ─── Minting ────────────────────────────────────────────────────────────

    /// @notice Mint one car. Caller must have approved `mintFee` DRIFT first.
    /// @param archetype One of "sport", "muscle", "stealth", "electric", "street".
    /// @return tokenId The freshly minted token ID.
    function mint(string calldata archetype) external returns (uint256 tokenId) {
        return _mintCar(msg.sender, archetype);
    }

    /// @notice Mint one car, taking the DRIFT allowance from an EIP-2612 signature
    ///         so the player only signs and sends a single transaction.
    function mintWithPermit(
        string calldata archetype,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 tokenId) {
        // A front-run of the permit would make this call revert while leaving the
        // allowance in place, so ignore the failure and let the transfer decide.
        try IERC20Permit(address(paymentToken)).permit(
            msg.sender, address(this), mintFee, deadline, v, r, s
        ) {} catch {}
        return _mintCar(msg.sender, archetype);
    }

    function _mintCar(address to, string calldata archetype) private returns (uint256 tokenId) {
        if (!_isValidArchetype(archetype)) revert UnknownArchetype(archetype);

        uint256 fee = mintFee;
        if (fee > 0) {
            paymentToken.safeTransferFrom(to, feeRecipient, fee);
        }

        tokenId = _nextTokenId++;
        archetypeOf[tokenId] = archetype;
        _safeMint(to, tokenId);

        emit CarMinted(to, tokenId, archetype);
    }

    // ─── Parts ──────────────────────────────────────────────────────────────

    /// @notice Equip an upgrade part onto a car the caller owns.
    /// @param slot   Slot key, e.g. "Wheels", "Spoiler".
    /// @param partId Part variant ID, e.g. "wheel-spoked-01".
    function equipPart(uint256 tokenId, string calldata slot, string calldata partId) external {
        _requireCarOwner(tokenId);

        bytes32 slotHash = keccak256(bytes(slot));
        _equipped[tokenId][slotHash] = partId;
        if (_filledSlots[tokenId].add(slotHash)) {
            // Remember the readable name once so `getEquippedParts` can return it.
            if (bytes(_slotName[slotHash]).length == 0) {
                _slotName[slotHash] = slot;
            }
        }

        emit PartEquipped(tokenId, slot, partId);
    }

    /// @notice Remove a part, reverting the slot to stock.
    function unequipPart(uint256 tokenId, string calldata slot) external {
        _requireCarOwner(tokenId);

        bytes32 slotHash = keccak256(bytes(slot));
        if (!_filledSlots[tokenId].remove(slotHash)) revert SlotEmpty(tokenId, slot);
        delete _equipped[tokenId][slotHash];

        emit PartUnequipped(tokenId, slot);
    }

    /// @notice Part equipped in one slot, or the empty string if stock.
    function getEquippedPart(uint256 tokenId, string calldata slot)
        external
        view
        returns (string memory)
    {
        return _equipped[tokenId][keccak256(bytes(slot))];
    }

    /// @notice Every non-stock slot on a car, in one call.
    /// @dev The garage needs the whole loadout at once; per-slot reads would be
    ///      one RPC round trip per slot.
    function getEquippedParts(uint256 tokenId)
        external
        view
        returns (string[] memory slots, string[] memory partIds)
    {
        EnumerableSet.Bytes32Set storage filled = _filledSlots[tokenId];
        uint256 len = filled.length();

        slots = new string[](len);
        partIds = new string[](len);
        for (uint256 i = 0; i < len; ++i) {
            bytes32 slotHash = filled.at(i);
            slots[i] = _slotName[slotHash];
            partIds[i] = _equipped[tokenId][slotHash];
        }
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    /// @notice All token IDs owned by `owner`, for the garage view.
    function tokensOfOwner(address owner) external view returns (uint256[] memory tokenIds) {
        uint256 len = balanceOf(owner);
        tokenIds = new uint256[](len);
        for (uint256 i = 0; i < len; ++i) {
            tokenIds[i] = tokenOfOwnerByIndex(owner, i);
        }
    }

    /// @notice Next token ID that will be assigned.
    function nextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory base = _baseTokenURI;
        return bytes(base).length == 0 ? "" : string.concat(base, Strings.toString(tokenId));
    }

    // ─── Owner ──────────────────────────────────────────────────────────────

    function setMintFee(uint256 newFee) external onlyOwner {
        mintFee = newFee;
        emit MintFeeSet(newFee);
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        feeRecipient = newRecipient;
        emit FeeRecipientSet(newRecipient);
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        _baseTokenURI = newBaseURI;
        emit BaseURISet(newBaseURI);
    }

    // ─── Internals ──────────────────────────────────────────────────────────

    function _requireCarOwner(uint256 tokenId) private view {
        if (ownerOf(tokenId) != msg.sender) revert NotCarOwner(tokenId, msg.sender);
    }

    function _isValidArchetype(string calldata archetype) private pure returns (bool) {
        bytes32 h = keccak256(bytes(archetype));
        return h == keccak256("sport") || h == keccak256("muscle") || h == keccak256("stealth")
            || h == keccak256("electric") || h == keccak256("street");
    }
}
