/**
 * Leaderboard Recorder — Chain Drift
 *
 * Watches `RaceFinished` on RaceEscrow and mirrors each classification into the
 * Leaderboard contract.
 *
 * The escrow could call the leaderboard directly — it is authorised to — but
 * the payout runs inside a Chainlink VRF callback with a fixed gas limit, and
 * these writes would eat into it. Doing it here keeps the callback lean, and
 * `recordResult` is idempotent per race ID so a retry or a restart that replays
 * old logs cannot double-count.
 */

import { leaderboardAbi, raceEscrowAbi } from "@chain-drift/shared";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CHAIN,
  LEADERBOARD_ADDRESS,
  POLL_INTERVAL_MS,
  RACE_ESCROW_ADDRESS,
  RECORDER_PRIVATE_KEY,
  RPC_URL,
  START_BLOCK,
} from "./config.js";

const account = privateKeyToAccount(RECORDER_PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: CHAIN,
  transport: http(RPC_URL),
});

/**
 * The shape both call sites share.
 *
 * `getContractEvents` and `watchContractEvent` return logs with slightly
 * different generic parameters, so the recorder asks only for the fields it
 * reads and validates them itself.
 */
interface RaceFinishedLog {
  args: {
    raceId?: bigint;
    players?: readonly `0x${string}`[];
    carTokenIds?: readonly bigint[];
    payouts?: readonly bigint[];
  };
  transactionHash: `0x${string}` | null;
}

async function recordRace(log: RaceFinishedLog): Promise<void> {
  const { raceId, players, carTokenIds, payouts } = log.args;
  if (raceId === undefined || !players || !payouts) {
    console.warn("[recorder] RaceFinished log missing args, skipping:", log.transactionHash);
    return;
  }

  // Cheap pre-check: skip the transaction entirely for a race already recorded.
  const alreadyRecorded = await publicClient.readContract({
    address: LEADERBOARD_ADDRESS,
    abi: leaderboardAbi,
    functionName: "raceRecorded",
    args: [raceId],
  });
  if (alreadyRecorded) {
    console.log(`[recorder] race ${raceId} already recorded, skipping`);
    return;
  }

  const results = players.map((player, i) => ({
    player,
    position: i + 1,
    payout: payouts[i] ?? 0n,
  }));

  console.log(
    `[recorder] race ${raceId}: ` +
      results
        .map((r, i) => `P${r.position} ${r.player.slice(0, 8)} car#${carTokenIds?.[i]}`)
        .join(", ")
  );

  const hash = await walletClient.writeContract({
    address: LEADERBOARD_ADDRESS,
    abi: leaderboardAbi,
    functionName: "recordResult",
    args: [raceId, results],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`[recorder] race ${raceId} recorded in ${receipt.transactionHash}`);
}

async function main(): Promise<void> {
  console.log("─── Chain Drift leaderboard recorder ───");
  console.log(`chain       ${CHAIN.name} (${CHAIN.id})`);
  console.log(`rpc         ${RPC_URL}`);
  console.log(`escrow      ${RACE_ESCROW_ADDRESS}`);
  console.log(`leaderboard ${LEADERBOARD_ADDRESS}`);
  console.log(`recorder    ${account.address}`);

  if (START_BLOCK !== undefined) {
    console.log(`backfilling from block ${START_BLOCK}`);
    const past = await publicClient.getContractEvents({
      address: RACE_ESCROW_ADDRESS,
      abi: raceEscrowAbi,
      eventName: "RaceFinished",
      fromBlock: START_BLOCK,
      toBlock: "latest",
    });
    console.log(`found ${past.length} past races`);
    for (const log of past) {
      await recordRace(log).catch((err) =>
        console.error("[recorder] backfill failed:", err)
      );
    }
  }

  console.log("watching for RaceFinished…\n");
  publicClient.watchContractEvent({
    address: RACE_ESCROW_ADDRESS,
    abi: raceEscrowAbi,
    eventName: "RaceFinished",
    pollingInterval: POLL_INTERVAL_MS,
    onLogs: (logs) => {
      for (const log of logs) {
        // One failure must not stop the watcher; the next race still records.
        void recordRace(log).catch((err) =>
          console.error("[recorder] failed to record race:", err)
        );
      }
    },
    onError: (err) => console.error("[recorder] watch error:", err),
  });
}

main().catch((err) => {
  console.error("[recorder] fatal:", err);
  process.exit(1);
});
