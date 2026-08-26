// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {DriftToken} from "../src/DriftToken.sol";
import {CarNFT} from "../src/CarNFT.sol";
import {RaceEscrow} from "../src/RaceEscrow.sol";
import {Leaderboard} from "../src/Leaderboard.sol";

/// @notice Deploys the full Chain Drift stack and writes the addresses to
///         `deployments/<chainid>.json` for the frontend and recorder to read.
///
/// Required env:
///   PRIVATE_KEY           deployer key
///   VRF_COORDINATOR       Chainlink VRF v2.5 coordinator for this chain
///   VRF_SUBSCRIPTION_ID   funded subscription ID
///   VRF_KEY_HASH          gas lane key hash
///
/// Optional env:
///   MINT_FEE_DRIFT        car mint fee in whole DRIFT (default 1)
///   INITIAL_SUPPLY_DRIFT  DRIFT minted to the deployer (default 10_000_000)
///   TOKEN_BASE_URI        metadata base URI (default the local metadata-api)
///   FAUCET_ENABLED        open the DRIFT faucet (default true)
///   RECORDER_ADDRESS      leaderboard recorder (default the deployer)
contract Deploy is Script {
    struct Config {
        address deployer;
        address vrfCoordinator;
        uint256 subscriptionId;
        bytes32 keyHash;
        uint256 mintFee;
        uint256 initialSupply;
        string baseURI;
        bool faucetEnabled;
        address recorder;
    }

    struct Deployment {
        DriftToken drift;
        CarNFT carNft;
        RaceEscrow escrow;
        Leaderboard leaderboard;
    }

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        Config memory cfg = _readConfig(vm.addr(deployerKey));

        vm.startBroadcast(deployerKey);
        Deployment memory d = _deploy(cfg);
        vm.stopBroadcast();

        console2.log("DriftToken  ", address(d.drift));
        console2.log("CarNFT      ", address(d.carNft));
        console2.log("RaceEscrow  ", address(d.escrow));
        console2.log("Leaderboard ", address(d.leaderboard));
        console2.log("");
        console2.log("Next: add RaceEscrow as a consumer on VRF subscription");
        console2.log(cfg.subscriptionId);

        _writeDeployment(d);
    }

    function _readConfig(address deployer) private view returns (Config memory cfg) {
        cfg.deployer = deployer;
        cfg.vrfCoordinator = vm.envAddress("VRF_COORDINATOR");
        cfg.subscriptionId = vm.envUint("VRF_SUBSCRIPTION_ID");
        cfg.keyHash = vm.envBytes32("VRF_KEY_HASH");
        cfg.mintFee = vm.envOr("MINT_FEE_DRIFT", uint256(1)) * 1e18;
        cfg.initialSupply = vm.envOr("INITIAL_SUPPLY_DRIFT", uint256(10_000_000)) * 1e18;
        cfg.baseURI = vm.envOr("TOKEN_BASE_URI", string("http://localhost:8787/metadata/"));
        cfg.faucetEnabled = vm.envOr("FAUCET_ENABLED", true);
        cfg.recorder = vm.envOr("RECORDER_ADDRESS", deployer);
    }

    function _deploy(Config memory cfg) private returns (Deployment memory d) {
        d.drift = new DriftToken(cfg.initialSupply, cfg.deployer, cfg.faucetEnabled);
        d.carNft = new CarNFT(address(d.drift), cfg.mintFee, cfg.baseURI, cfg.deployer);
        d.escrow = new RaceEscrow(
            cfg.vrfCoordinator,
            cfg.subscriptionId,
            cfg.keyHash,
            address(d.drift),
            address(d.carNft),
            cfg.deployer
        );
        d.leaderboard = new Leaderboard(cfg.deployer);

        d.leaderboard.setRaceEscrow(address(d.escrow));
        d.leaderboard.setRecorder(cfg.recorder);
    }

    function _writeDeployment(Deployment memory d) private {
        string memory json = string.concat(
            "{\n",
            '  "chainId": ', vm.toString(block.chainid), ",\n",
            '  "driftToken": "', vm.toString(address(d.drift)), '",\n',
            '  "carNft": "', vm.toString(address(d.carNft)), '",\n',
            '  "raceEscrow": "', vm.toString(address(d.escrow)), '",\n',
            '  "leaderboard": "', vm.toString(address(d.leaderboard)), '"\n',
            "}\n"
        );
        vm.writeFile(string.concat("deployments/", vm.toString(block.chainid), ".json"), json);
    }
}
