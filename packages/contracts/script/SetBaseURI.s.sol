// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/Script.sol";
import {DeployerKey} from "./DeployerKey.sol";
import {Deployed} from "./Deployed.sol";
import {CarNFT} from "../src/CarNFT.sol";

/// @notice Points the deployed CarNFT at a new metadata base URI.
/// @dev The base URI is `TOKEN_BASE_URI`, the same variable the deploy script
///      reads, so a redeploy and a repoint can never disagree.
///
///      forge script script/SetBaseURI.s.sol:SetBaseURI --rpc-url base_sepolia --broadcast
contract SetBaseURI is DeployerKey, Deployed {
    function run() external {
        CarNFT car = carNft();
        string memory baseURI = vm.envString("TOKEN_BASE_URI");

        console.log("CarNFT:  ", address(car));
        console.log("Base URI:", baseURI);

        vm.startBroadcast(deployerPrivateKey());
        car.setBaseURI(baseURI);
        vm.stopBroadcast();

        if (car.totalSupply() > 0) {
            uint256 tokenId = car.tokenByIndex(0);
            console.log("tokenURI(%s): %s", tokenId, car.tokenURI(tokenId));
        }
    }
}
