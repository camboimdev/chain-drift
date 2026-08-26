// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/console2.sol";
import {DeployerKey} from "./DeployerKey.sol";

/// @notice Prints the address `MNEMONIC` derives, and its balance, without ever
///         echoing the seed phrase.
///
/// Run this before deploying to know which address to send faucet ETH to:
///   forge script script/ShowDeployer.s.sol --rpc-url base_sepolia
contract ShowDeployer is DeployerKey {
    function run() external view {
        address deployer = deployerAddress();
        uint256 index = vm.envOr("MNEMONIC_INDEX", uint256(0));

        console2.log("account index", index);
        console2.log("address      ", deployer);
        console2.log("balance wei  ", deployer.balance);
        console2.log("balance ETH  ", _formatEth(deployer.balance));
    }

    /// @dev Six decimals is plenty to tell 0.0001 from 0.1 at a glance.
    function _formatEth(uint256 weiAmount) private pure returns (string memory) {
        uint256 whole = weiAmount / 1 ether;
        uint256 frac = (weiAmount % 1 ether) / 1e12;
        return string.concat(vm.toString(whole), ".", _pad6(frac));
    }

    function _pad6(uint256 value) private pure returns (string memory out) {
        out = vm.toString(value);
        while (bytes(out).length < 6) {
            out = string.concat("0", out);
        }
    }
}
