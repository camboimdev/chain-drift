// ─── Leaderboard Recorder Config ──────────────────────────────────────────
// Watches RaceFinished events from RaceEscrow and calls recordResult on the
// Leaderboard contract. No race outcome is computed here — the contract
// resolves the field on-chain from the Chainlink VRF word.

import { base, baseSepolia } from "viem/chains";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function requireAddress(key: string): `0x${string}` {
  const value = requireEnv(key);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${key} is not a valid address: ${value}`);
  }
  return value as `0x${string}`;
}

export const CHAIN_ID = Number(process.env.CHAIN_ID ?? baseSepolia.id);

export const CHAIN = CHAIN_ID === base.id ? base : baseSepolia;

export const RPC_URL = process.env.RPC_URL ?? CHAIN.rpcUrls.default.http[0];

export const RACE_ESCROW_ADDRESS = requireAddress("RACE_ESCROW_ADDRESS");
export const LEADERBOARD_ADDRESS = requireAddress("LEADERBOARD_ADDRESS");

/** Recorder key. Must be the address set via `Leaderboard.setRecorder`. */
export const RECORDER_PRIVATE_KEY = (() => {
  const key = requireEnv("RECORDER_PRIVATE_KEY");
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
})();

/**
 * Block to start from on a cold start.
 *
 * Leave unset to begin at the current head. Set it to the RaceEscrow deployment
 * block to backfill a leaderboard from scratch.
 */
export const START_BLOCK = process.env.START_BLOCK
  ? BigInt(process.env.START_BLOCK)
  : undefined;

/** How often to poll for new logs (ms). Base blocks are ~2s. */
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 4000);
