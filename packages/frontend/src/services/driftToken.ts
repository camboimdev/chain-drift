// ─── DRIFT Token ──────────────────────────────────────────────────────────
//
// Balances and allowances. Amounts are formatted through `formatDrift` in
// `@chain-drift/shared` — this module deals in wei and raw reads only.

import { driftTokenAbi } from "@chain-drift/shared";
import { readContract, waitForTransactionReceipt, writeContract } from "@wagmi/core";
import { formatEther } from "viem";
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
