// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/Script.sol";
import {DeployerKey} from "./DeployerKey.sol";
import {Deployed} from "./Deployed.sol";
import {CarNFT} from "../src/CarNFT.sol";

/// @notice Makes block explorers re-fetch the metadata of already-minted cars.
/// @dev Explorers cache `tokenURI` when they first index a token, so every car
///      minted before a `setBaseURI` keeps showing the old metadata — and none
///      of them expose a refresh button on testnets. Transferring a car to its
///      own owner changes no state but emits the `Transfer` event that makes
///      them index it again.
///
///      Runs over every token the deployer holds, or over `TOKEN_IDS` when set:
///      forge script script/RefreshMetadata.s.sol:RefreshMetadata \
///          --rpc-url base_sepolia --broadcast
contract RefreshMetadata is DeployerKey, Deployed {
    error NotHeldByDeployer(uint256 tokenId, address holder);

    function run() external {
        CarNFT car = carNft();
        uint256 key = deployerPrivateKey();
        address holder = vm.addr(key);
        uint256[] memory tokenIds = _tokenIds(car, holder);

        console.log("CarNFT:", address(car));
        console.log("Holder:", holder);

        vm.startBroadcast(key);
        for (uint256 i = 0; i < tokenIds.length; ++i) {
            uint256 tokenId = tokenIds[i];
            address current = car.ownerOf(tokenId);
            if (current != holder) revert NotHeldByDeployer(tokenId, current);

            car.transferFrom(holder, holder, tokenId);
            console.log("refreshed %s -> %s", tokenId, car.tokenURI(tokenId));
        }
        vm.stopBroadcast();
    }

    function _tokenIds(CarNFT car, address holder) private view returns (uint256[] memory) {
        uint256[] memory configured = vm.envOr("TOKEN_IDS", ",", new uint256[](0));
        return configured.length > 0 ? configured : car.tokensOfOwner(holder);
    }
}
