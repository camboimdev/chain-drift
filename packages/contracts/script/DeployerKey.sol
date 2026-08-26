// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";

/// @notice Derives the deployer key from `MNEMONIC` at `MNEMONIC_INDEX`.
/// @dev Standard BIP-44 Ethereum path, m/44'/60'/0'/0/{index} — the same account
///      MetaMask and Coinbase Wallet show first for a given seed phrase.
///      Shared so the deploy script and `ShowDeployer` can never disagree about
///      which address is being funded.
abstract contract DeployerKey is Script {
    function deployerPrivateKey() internal view returns (uint256) {
        string memory mnemonic = vm.envString("MNEMONIC");
        uint32 index = uint32(vm.envOr("MNEMONIC_INDEX", uint256(0)));
        return vm.deriveKey(mnemonic, index);
    }

    function deployerAddress() internal view returns (address) {
        return vm.addr(deployerPrivateKey());
    }
}
