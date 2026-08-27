/**
 * useWinnings — the DRIFT the escrow owes this wallet, and the call that takes
 * it out.
 *
 * `RaceEscrow` pays by credit, not by transfer: the VRF callback runs under a
 * fixed gas limit, so it books each racer's share into `pendingWithdrawals` and
 * leaves the transfer to a separate `claim()`. Winning a race therefore does
 * not move any DRIFT until this runs.
 */

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "../context/WalletContext";
import { claimWinnings, getPendingWithdrawals } from "../services/raceContract";

export type ClaimState = "idle" | "claiming" | "success" | "error";

export interface UseWinnings {
  /** Unclaimed DRIFT in wei, or `null` before the first read. */
  pending: bigint | null;
  state: ClaimState;
  error: string;
  claim: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useWinnings(): UseWinnings {
  const { wallet, refreshBalances } = useWallet();
  const [pending, setPending] = useState<bigint | null>(null);
  const [state, setState] = useState<ClaimState>("idle");
  const [error, setError] = useState("");

  const address = wallet?.address;

  const refresh = useCallback(async () => {
    if (!address) {
      setPending(null);
      return;
    }
    try {
      setPending(await getPendingWithdrawals(address));
    } catch (err) {
      console.error("[useWinnings] Failed to read pending withdrawals:", err);
      setPending(null);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const claim = useCallback(async () => {
    if (state === "claiming") return;
    setState("claiming");
    setError("");
    try {
      await claimWinnings();
      setState("success");
      await Promise.all([refresh(), refreshBalances()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claim failed");
      setState("error");
    }
  }, [state, refresh, refreshBalances]);

  return { pending, state, error, claim, refresh };
}
