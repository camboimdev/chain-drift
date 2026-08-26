// ─── DRIFT Token ──────────────────────────────────────────────────────────
//
// Balances, allowances and the testnet faucet.

import { driftTokenAbi } from "@chain-drift/shared";
import { readContract, waitForTransactionReceipt, writeContract } from "@wagmi/core";
import { formatEther, parseEther } from "viem";
import { DRIFT_TOKEN_ADDRESS, requireAddress } from "../config/chain";
import { wagmiConfig } from "../config/wagmi";

function driftAddress(): `0x${string}` {
  return requireAddress(DRIFT_TOKEN_ADDRESS, "VITE_DRIFT_TOKEN_ADDRESS");
}

/** DRIFT balance in full units. */
export async function fetchDriftBalance(address: `0x${string}`): Promise<number> {
  try {
    const raw = await readContract(wagmiConfig, {
      address: driftAddress(),
      abi: driftTokenAbi,
      functionName: "balanceOf",
      args: [address],
    });
    return Number(formatEther(raw));
  } catch (err) {
    console.error("[driftToken] balanceOf failed:", err);
    return 0;
  }
}

/** Current allowance granted to `spender`, in wei. */
export async function fetchAllowance(
  owner: `0x${string}`,
  spender: `0x${string}`
): Promise<bigint> {
  return readContract(wagmiConfig, {
    address: driftAddress(),
    abi: driftTokenAbi,
    functionName: "allowance",
    args: [owner, spender],
  });
}

/**
 * Approve `spender` for `amount` if the current allowance is short.
 *
 * Approving the exact amount every time would double the transaction count for
 * every mint and every race entry, so this only sends when needed.
 */
export async function ensureAllowance(
  owner: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint
): Promise<void> {
  const current = await fetchAllowance(owner, spender);
  if (current >= amount) return;

  const hash = await writeContract(wagmiConfig, {
    address: driftAddress(),
    abi: driftTokenAbi,
    functionName: "approve",
    args: [spender, amount],
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
}

/** Testnet faucet: 100 DRIFT per 12 hours. Reverts on mainnet deployments. */
export async function claimFaucet(): Promise<`0x${string}`> {
  const hash = await writeContract(wagmiConfig, {
    address: driftAddress(),
    abi: driftTokenAbi,
    functionName: "faucet",
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

/** Seconds until `address` may call the faucet again; 0 when it is available. */
export async function faucetCooldownRemaining(address: `0x${string}`): Promise<number> {
  const [last, cooldown] = await Promise.all([
    readContract(wagmiConfig, {
      address: driftAddress(),
      abi: driftTokenAbi,
      functionName: "lastFaucetClaim",
      args: [address],
    }),
    readContract(wagmiConfig, {
      address: driftAddress(),
      abi: driftTokenAbi,
      functionName: "FAUCET_COOLDOWN",
    }),
  ]);
  if (last === 0n) return 0;

  const availableAt = Number(last + cooldown);
  return Math.max(0, availableAt - Math.floor(Date.now() / 1000));
}

export { parseEther as parseDrift, formatEther as formatDrift };
