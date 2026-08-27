// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title DRIFT — Chain Drift in-game economy token
/// @notice ERC-20 used for car mint fees and race entry fees.
/// @dev `ERC20Permit` lets CarNFT and RaceEscrow pull the fee in a single user
///      transaction — no separate `approve` round trip.
contract DriftToken is ERC20, ERC20Permit, Ownable {
    /// @notice Amount handed out per `faucet()` call. Testnet convenience only.
    /// @dev Sized against the game's prices: one claim covers a car (100 DRIFT)
    ///      and sixteen race entries (25 DRIFT each), so a new player can get
    ///      through onboarding and a full session on a single claim.
    uint256 public constant FAUCET_AMOUNT = 500e18;

    /// @notice Cooldown between two `faucet()` calls from the same address.
    uint256 public constant FAUCET_COOLDOWN = 12 hours;

    /// @notice When the faucet is disabled, `faucet()` reverts. Turn this off
    ///         before any mainnet deployment.
    bool public faucetEnabled;

    mapping(address account => uint256 timestamp) public lastFaucetClaim;

    error FaucetDisabled();
    error FaucetCooldownActive(uint256 availableAt);

    event FaucetClaimed(address indexed account, uint256 amount);
    event FaucetEnabledSet(bool enabled);

    /// @param initialSupply Minted to `owner_` at deploy (18 decimals).
    /// @param owner_        Receives the initial supply and admin rights.
    /// @param faucetEnabled_ Whether the public faucet starts open (testnet: true).
    constructor(uint256 initialSupply, address owner_, bool faucetEnabled_)
        ERC20("Chain Drift", "DRIFT")
        ERC20Permit("Chain Drift")
        Ownable(owner_)
    {
        faucetEnabled = faucetEnabled_;
        if (initialSupply > 0) {
            _mint(owner_, initialSupply);
        }
    }

    /// @notice Mint new DRIFT. Owner only.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Burn DRIFT held by the caller.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /// @notice Claim testnet DRIFT so a new player can mint a car and race
    ///         without any manual distribution step.
    function faucet() external {
        if (!faucetEnabled) revert FaucetDisabled();

        uint256 last = lastFaucetClaim[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldownActive(last + FAUCET_COOLDOWN);
        }

        lastFaucetClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Open or close the public faucet. Owner only.
    function setFaucetEnabled(bool enabled) external onlyOwner {
        faucetEnabled = enabled;
        emit FaucetEnabledSet(enabled);
    }
}
