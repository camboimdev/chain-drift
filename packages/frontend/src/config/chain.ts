// ─── Chain Config ─────────────────────────────────────────────────────────
// Overridden via environment variables in .env.local (Vite prefix: VITE_).
//
// Contract addresses come from `packages/contracts/deployments/<chainId>.json`,
// written by the deploy script. Copy them into .env.local after deploying.

import { CHAIN_IDS, CHAIN_LABELS, type ChainId } from "@chain-drift/shared";
import { base, baseSepolia } from "viem/chains";

function envAddress(key: string): `0x${string}` | undefined {
  const value = import.meta.env[key] as string | undefined;
  if (!value) return undefined;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    console.warn(`[chain] ${key} is not a valid address: ${value}`);
    return undefined;
  }
  return value as `0x${string}`;
}

/** Chain the game runs on. Base Sepolia unless explicitly pointed at mainnet. */
export const CHAIN_ID: ChainId =
  Number(import.meta.env.VITE_CHAIN_ID ?? CHAIN_IDS.baseSepolia) === CHAIN_IDS.base
    ? CHAIN_IDS.base
    : CHAIN_IDS.baseSepolia;

export const CHAIN = CHAIN_ID === CHAIN_IDS.base ? base : baseSepolia;

export const NETWORK_LABEL = CHAIN_LABELS[CHAIN_ID];

/** Optional dedicated RPC (Alchemy, QuickNode…). Falls back to the public one. */
export const RPC_URL =
  (import.meta.env.VITE_RPC_URL as string | undefined) ?? CHAIN.rpcUrls.default.http[0];

export const BLOCK_EXPLORER_URL = CHAIN.blockExplorers?.default.url ?? "";

// ─── Deployed contracts ───────────────────────────────────────────────────

export const DRIFT_TOKEN_ADDRESS = envAddress("VITE_DRIFT_TOKEN_ADDRESS");
export const CAR_NFT_ADDRESS = envAddress("VITE_CAR_NFT_ADDRESS");
export const RACE_ESCROW_ADDRESS = envAddress("VITE_RACE_ESCROW_ADDRESS");
export const LEADERBOARD_ADDRESS = envAddress("VITE_LEADERBOARD_ADDRESS");

/** Throws a message that names the missing variable instead of failing deep in viem. */
export function requireAddress(
  address: `0x${string}` | undefined,
  envVar: string
): `0x${string}` {
  if (!address) {
    throw new Error(
      `${envVar} is not configured — deploy the contracts and set it in .env.local`
    );
  }
  return address;
}
