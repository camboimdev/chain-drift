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
import { mnemonicToAccount } from "viem/accounts";
import {
  CHAIN,
  LEADERBOARD_ADDRESS,
  MNEMONIC,
  MNEMONIC_INDEX,
  POLL_INTERVAL_MS,
  RACE_ESCROW_ADDRESS,
  RPC_URL,
  START_BLOCK,
} from "./config.js";

// Same BIP-44 path Foundry's `deriveKey` uses, so index 0 is the deployer —
// the address `Leaderboard.setRecorder` defaults to.
const account = mnemonicToAccount(MNEMONIC, { addressIndex: MNEMONIC_INDEX });

/** Blocks to stay behind the head, so a short reorg cannot strand a race. */
const CONFIRMATIONS = 3n;

/** Largest range asked for in one call; providers cap `eth_getLogs` spans. */
const MAX_BLOCK_RANGE = 500n;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  await watchLoop();
}

/**
 * Scan forward over block ranges, one window at a time.
 *
 * Deliberately not `watchContractEvent`: that installs a server-side filter and
 * polls it with `eth_getFilterChanges`. Public RPCs sit behind load balancers,
 * so the follow-up poll routinely lands on a node that never saw the filter and
 * fails with "filter not found" — which is exactly what Base Sepolia's endpoint
 * does. Tracking the last processed block and asking for explicit ranges works
 * on any provider, survives a restart, and makes progress observable.
 */
async function watchLoop(): Promise<void> {
  let lastProcessed = await publicClient.getBlockNumber();

  for (;;) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const head = await publicClient.getBlockNumber();
      // Stay behind the head so a short reorg cannot strand a recorded race on
      // an orphaned block. recordResult is idempotent, so a re-scan is harmless.
      const target = head - CONFIRMATIONS;
      if (target <= lastProcessed) continue;

      const from = lastProcessed + 1n;
      const to = target - from > MAX_BLOCK_RANGE ? from + MAX_BLOCK_RANGE : target;

      const logs = await publicClient.getContractEvents({
        address: RACE_ESCROW_ADDRESS,
        abi: raceEscrowAbi,
        eventName: "RaceFinished",
        fromBlock: from,
        toBlock: to,
      });

      for (const log of logs) {
        await recordRace(log).catch((err) =>
          console.error("[recorder] failed to record race:", err)
        );
      }

      lastProcessed = to;
    } catch (err) {
      // A transient RPC failure must not kill the recorder; the same range is
      // retried on the next tick because lastProcessed did not advance.
      console.error("[recorder] poll failed, retrying:", err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error("[recorder] fatal:", err);
  process.exit(1);
});
