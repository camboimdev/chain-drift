// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IVRFSubscriptionV2Plus} from
    "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFSubscriptionV2Plus.sol";
import {DriftToken} from "../src/DriftToken.sol";
import {CarNFT} from "../src/CarNFT.sol";
import {RaceEscrow} from "../src/RaceEscrow.sol";
import {Leaderboard} from "../src/Leaderboard.sol";

/// @notice Deploys the full Chain Drift stack, provisions its Chainlink VRF
///         subscription, and writes the addresses to `deployments/<chainid>.json`
///         for the frontend and the recorder to read.
///
/// The subscription is created and funded here rather than through the
/// Chainlink UI so a fresh chain goes from nothing to a playable game in one
/// command. It is funded in **native ETH** — VRF v2.5 bills a native-funded
/// subscription in the chain's own token, so the ETH that pays for gas also
/// pays for the randomness and no LINK faucet is involved.
///
/// Required env:
///   PRIVATE_KEY           deployer key
///   VRF_COORDINATOR       Chainlink VRF v2.5 coordinator for this chain
///   VRF_KEY_HASH          gas lane key hash
///
/// Optional env:
///   VRF_SUBSCRIPTION_ID   reuse an existing subscription instead of creating one
///   VRF_FUND_WEI          native funding for a newly created subscription
///                         (default 0.01 ether; 0 skips funding)
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
        uint256 vrfFundWei;
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
        uint256 subscriptionId;
    }

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        Config memory cfg = _readConfig(vm.addr(deployerKey));

        _logPreflight(cfg);

        vm.startBroadcast(deployerKey);
        Deployment memory d = _deploy(cfg);
        vm.stopBroadcast();

        console2.log("");
        console2.log("DriftToken  ", address(d.drift));
        console2.log("CarNFT      ", address(d.carNft));
        console2.log("RaceEscrow  ", address(d.escrow));
        console2.log("Leaderboard ", address(d.leaderboard));
        console2.log("VRF sub id  ", d.subscriptionId);

        _writeDeployment(d);
    }

    // ─── Config ─────────────────────────────────────────────────────────────

    function _readConfig(address deployer) private view returns (Config memory cfg) {
        cfg.deployer = deployer;
        cfg.vrfCoordinator = vm.envAddress("VRF_COORDINATOR");
        cfg.keyHash = vm.envBytes32("VRF_KEY_HASH");
        // 0 means "create a fresh subscription".
        cfg.subscriptionId = vm.envOr("VRF_SUBSCRIPTION_ID", uint256(0));
        cfg.vrfFundWei = vm.envOr("VRF_FUND_WEI", uint256(0.01 ether));
        cfg.mintFee = vm.envOr("MINT_FEE_DRIFT", uint256(1)) * 1e18;
        cfg.initialSupply = vm.envOr("INITIAL_SUPPLY_DRIFT", uint256(10_000_000)) * 1e18;
        cfg.baseURI = vm.envOr("TOKEN_BASE_URI", string("http://localhost:3001/metadata/"));
        cfg.faucetEnabled = vm.envOr("FAUCET_ENABLED", true);
        cfg.recorder = vm.envOr("RECORDER_ADDRESS", deployer);
    }

    /// @dev Deploying with too little ETH strands a half-built system, so the
    ///      balance is checked before the first transaction goes out.
    function _logPreflight(Config memory cfg) private view {
        uint256 balance = cfg.deployer.balance;
        uint256 needed = 7_000_000 * tx.gasprice + cfg.vrfFundWei;

        console2.log("deployer    ", cfg.deployer);
        console2.log("balance wei ", balance);
        console2.log("gas price   ", tx.gasprice);
        console2.log("est. need   ", needed);

        if (balance < needed) {
            console2.log("");
            console2.log("!! balance looks short for deploy + VRF funding.");
            console2.log("!! top up, or lower VRF_FUND_WEI, before broadcasting.");
        }
    }

    // ─── Deploy ─────────────────────────────────────────────────────────────

    function _deploy(Config memory cfg) private returns (Deployment memory d) {
        IVRFSubscriptionV2Plus coordinator = IVRFSubscriptionV2Plus(cfg.vrfCoordinator);

        // The subscription ID is a constructor argument, so it has to exist
        // before RaceEscrow is deployed; the consumer is added afterwards.
        d.subscriptionId = cfg.subscriptionId == 0
            ? coordinator.createSubscription()
            : cfg.subscriptionId;

        d.drift = new DriftToken(cfg.initialSupply, cfg.deployer, cfg.faucetEnabled);
        d.carNft = new CarNFT(address(d.drift), cfg.mintFee, cfg.baseURI, cfg.deployer);
        d.escrow = new RaceEscrow(
            cfg.vrfCoordinator,
            d.subscriptionId,
            cfg.keyHash,
            address(d.drift),
            address(d.carNft),
            cfg.deployer
        );
        d.leaderboard = new Leaderboard(cfg.deployer);

        d.leaderboard.setRaceEscrow(address(d.escrow));
        d.leaderboard.setRecorder(cfg.recorder);

        coordinator.addConsumer(d.subscriptionId, address(d.escrow));

        // Funding last: if it fails, everything else is already on-chain and the
        // subscription can be topped up separately.
        if (cfg.subscriptionId == 0 && cfg.vrfFundWei > 0) {
            coordinator.fundSubscriptionWithNative{value: cfg.vrfFundWei}(d.subscriptionId);
        }
    }

    function _writeDeployment(Deployment memory d) private {
        string memory json = string.concat(
            "{\n",
            '  "chainId": ', vm.toString(block.chainid), ",\n",
            '  "driftToken": "', vm.toString(address(d.drift)), '",\n',
            '  "carNft": "', vm.toString(address(d.carNft)), '",\n',
            '  "raceEscrow": "', vm.toString(address(d.escrow)), '",\n',
            '  "leaderboard": "', vm.toString(address(d.leaderboard)), '",\n',
            '  "vrfSubscriptionId": "', vm.toString(d.subscriptionId), '"\n',
            "}\n"
        );
        vm.writeFile(string.concat("deployments/", vm.toString(block.chainid), ".json"), json);
    }
}
