/**
 * Race Contract Service — Chain Drift
 *
 * Every on-chain interaction with RaceEscrow. Reads go through the public
 * client and need no wallet; writes go through the connected wallet.
 *
 * Resolution is asynchronous: `requestResolve` asks Chainlink VRF for a random
 * word and the coordinator calls back a few blocks later. The UI therefore
 * waits on the `RaceFinished` event rather than on the resolve transaction.
 */

import { raceEscrowAbi, raceStatusFromEnum, type RaceStatus } from "@chain-drift/shared";
import {
  getPublicClient,
  readContract,
  waitForTransactionReceipt,
  writeContract,
} from "@wagmi/core";
import { parseEventLogs } from "viem";
import { RACE_ESCROW_ADDRESS, requireAddress } from "../config/chain";
import { wagmiConfig } from "../config/wagmi";
import { ensureAllowance } from "./driftToken";

// ─── Types ────────────────────────────────────────────────────────────────

export type OnChainRaceStatus = RaceStatus;

export interface OnChainParticipant {
  owner: `0x${string}`;
  carTokenId: bigint;
}

export interface OnChainRace {
  id: bigint;
  status: OnChainRaceStatus;
  entryFee: bigint;
  maxParticipants: number;
  participantCount: number;
  participants: OnChainParticipant[];
}

export interface RaceFinish {
  raceId: bigint;
  /** Ordered 1st to last. */
  players: readonly `0x${string}`[];
  carTokenIds: readonly bigint[];
  payouts: readonly bigint[];
}

function escrowAddress(): `0x${string}` {
  return requireAddress(RACE_ESCROW_ADDRESS, "VITE_RACE_ESCROW_ADDRESS");
}

// ─── Reads ────────────────────────────────────────────────────────────────

export async function getRaceStatus(raceId: bigint): Promise<OnChainRaceStatus> {
  const status = await readContract(wagmiConfig, {
    address: escrowAddress(),
    abi: raceEscrowAbi,
    functionName: "getRaceStatus",
    args: [raceId],
  });
  return raceStatusFromEnum(status);
}

export async function getParticipants(raceId: bigint): Promise<OnChainParticipant[]> {
  const entries = await readContract(wagmiConfig, {
    address: escrowAddress(),
    abi: raceEscrowAbi,
    functionName: "getParticipants",
    args: [raceId],
  });
  return entries.map((e) => ({ owner: e.player, carTokenId: e.carTokenId }));
}

export async function getParticipantCount(raceId: bigint): Promise<number> {
  const count = await readContract(wagmiConfig, {
    address: escrowAddress(),
    abi: raceEscrowAbi,
    functionName: "getParticipantCount",
    args: [raceId],
  });
  return Number(count);
}

export async function getRace(raceId: bigint): Promise<OnChainRace> {
  const address = escrowAddress();
  const [race, participants] = await Promise.all([
    readContract(wagmiConfig, {
      address,
      abi: raceEscrowAbi,
      functionName: "getRace",
      args: [raceId],
    }),
    getParticipants(raceId),
  ]);

  return {
    id: raceId,
    status: raceStatusFromEnum(race.status),
    entryFee: race.entryFee,
    maxParticipants: race.maxParticipants,
    participantCount: participants.length,
    participants,
  };
}

/**
 * Race rooms still accepting players, newest first.
 *
 * The contract does the scan, so this is one RPC round trip plus one per room
 * shown, rather than one call per candidate ID.
 */
export async function getOpenRaces(limit = 10, maxScan = 30): Promise<OnChainRace[]> {
  const raceIds = await readContract(wagmiConfig, {
    address: escrowAddress(),
    abi: raceEscrowAbi,
    functionName: "getOpenRaces",
    args: [BigInt(limit), BigInt(maxScan)],
  });

  return Promise.all(raceIds.map((id) => getRace(id)));
}

/** DRIFT waiting to be withdrawn by `address` — winnings and refunds. */
export async function getPendingWithdrawals(address: `0x${string}`): Promise<bigint> {
  return readContract(wagmiConfig, {
    address: escrowAddress(),
    abi: raceEscrowAbi,
    functionName: "pendingWithdrawals",
    args: [address],
  });
}

// ─── Writes ───────────────────────────────────────────────────────────────

/** Open a race room. Returns the new race ID, read back from `RaceCreated`. */
export async function createRace(
  entryFee: bigint,
  maxPlayers = 4
): Promise<{ txHash: `0x${string}`; raceId: bigint }> {
  const address = escrowAddress();

  const txHash = await writeContract(wagmiConfig, {
    address,
    abi: raceEscrowAbi,
    functionName: "createRace",
    args: [entryFee, maxPlayers],
  });
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash: txHash });

  const [created] = parseEventLogs({
    abi: raceEscrowAbi,
    eventName: "RaceCreated",
    logs: [...receipt.logs],
  });
  if (!created) throw new Error("createRace: RaceCreated event missing from receipt");

  return { txHash, raceId: created.args.raceId };
}

/** Enter a race with a car you own, paying the entry fee in DRIFT. */
export async function enterRace(
  owner: `0x${string}`,
  raceId: bigint,
  carTokenId: bigint,
  entryFee: bigint
): Promise<`0x${string}`> {
  const address = escrowAddress();

  await ensureAllowance(owner, address, entryFee);

  const hash = await writeContract(wagmiConfig, {
    address,
    abi: raceEscrowAbi,
    functionName: "enterRace",
    args: [raceId, carTokenId],
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

/**
 * Ask Chainlink VRF for the randomness that decides a locked race.
 *
 * This returns as soon as the request is mined. The result lands later, when
 * the coordinator calls back — use `waitForRaceFinish` for that.
 */
export async function requestResolve(raceId: bigint): Promise<`0x${string}`> {
  const hash = await writeContract(wagmiConfig, {
    address: escrowAddress(),
    abi: raceEscrowAbi,
    functionName: "requestResolve",
    args: [raceId],
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

/** Withdraw winnings and refunds. */
export async function claimWinnings(): Promise<`0x${string}`> {
  const hash = await writeContract(wagmiConfig, {
    address: escrowAddress(),
    abi: raceEscrowAbi,
    functionName: "claim",
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

/** Cancel a race that never resolved and credit every entrant a refund. */
export async function cancelRace(raceId: bigint): Promise<`0x${string}`> {
  const hash = await writeContract(wagmiConfig, {
    address: escrowAddress(),
    abi: raceEscrowAbi,
    functionName: "cancelRace",
    args: [raceId],
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

/**
 * Blocks scanned back from the head when looking up a finished race.
 *
 * Providers cap the span of a single `eth_getLogs`, so this cannot ask for the
 * whole chain. 500 blocks is ~17 minutes on Base — far more than the gap
 * between a VRF callback landing and the UI asking about it.
 */
const FINISH_LOOKBACK_BLOCKS = 500n;

/**
 * The finish order and payouts of a race that has already resolved.
 *
 * Reads the `RaceFinished` log rather than recomputing the split: the escrow's
 * numbers are the ones the player can actually claim, and rounding dust makes a
 * local estimate drift from them.
 *
 * Returns null while the race is still unresolved.
 */
export async function getRaceFinish(raceId: bigint): Promise<RaceFinish | null> {
  const publicClient = getPublicClient(wagmiConfig);
  if (!publicClient) throw new Error("getRaceFinish: no public client configured");

  const head = await publicClient.getBlockNumber();
  const fromBlock = head > FINISH_LOOKBACK_BLOCKS ? head - FINISH_LOOKBACK_BLOCKS : 0n;

  const logs = await publicClient.getContractEvents({
    address: escrowAddress(),
    abi: raceEscrowAbi,
    eventName: "RaceFinished",
    args: { raceId },
    fromBlock,
    toBlock: head,
  });

  const log = logs[logs.length - 1];
  if (!log) return null;

  return {
    raceId,
    players: log.args.players ?? [],
    carTokenIds: log.args.carTokenIds ?? [],
    payouts: log.args.payouts ?? [],
  };
}

// ─── Waiting on the VRF callback ──────────────────────────────────────────

/**
 * Resolve once `RaceFinished` fires for `raceId`.
 *
 * Subscribes to the event rather than polling `getRaceStatus`: the callback
 * arrives on the coordinator's schedule, and the event carries the finish order
 * and payouts that polling would then have to fetch separately.
 */
export function waitForRaceFinish(
  raceId: bigint,
  timeoutMs = 180_000
): Promise<RaceFinish> {
  const publicClient = getPublicClient(wagmiConfig);
  if (!publicClient) {
    return Promise.reject(new Error("waitForRaceFinish: no public client configured"));
  }

  return new Promise<RaceFinish>((resolve, reject) => {
    const unwatch = publicClient.watchContractEvent({
      address: escrowAddress(),
      abi: raceEscrowAbi,
      eventName: "RaceFinished",
      args: { raceId },
      onLogs: (logs) => {
        const log = logs[0];
        if (!log) return;
        cleanup();
        resolve({
          raceId,
          players: log.args.players ?? [],
          carTokenIds: log.args.carTokenIds ?? [],
          payouts: log.args.payouts ?? [],
        });
      },
      onError: (err) => {
        cleanup();
        reject(err);
      },
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Race ${raceId} did not resolve within ${timeoutMs}ms`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      unwatch();
    }
  });
}
