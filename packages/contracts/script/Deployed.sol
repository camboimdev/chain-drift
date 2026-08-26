// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {CarNFT} from "../src/CarNFT.sol";

/// @notice Resolves the CarNFT already deployed on the current chain.
/// @dev Reads `deployments/<chainid>.json`, the file the deploy script writes,
///      unless `CAR_NFT_ADDRESS` overrides it. Shared so no two operational
///      scripts can disagree about which contract they are driving.
abstract contract Deployed is Script {
    function carNft() internal view returns (CarNFT) {
        address configured = vm.envOr("CAR_NFT_ADDRESS", address(0));
        if (configured != address(0)) return CarNFT(configured);

        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        return CarNFT(vm.parseJsonAddress(vm.readFile(path), ".carNft"));
    }
}
