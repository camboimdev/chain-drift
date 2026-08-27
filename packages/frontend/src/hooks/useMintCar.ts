/**
 * useMintCar — the mint state machine, shared by every surface that offers one.
 *
 * The garage's empty state and the wallet drawer both mint, and both need the
 * same four things: the fee (owner-settable, so it is read from the contract),
 * the player's DRIFT, where the transaction is, and its hash. Keeping that in
 * one place is what stops the two copies drifting apart again.
 */

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "../context/walletContextValue";
import { fetchMintFeeDrift, mintCar } from "../services/carNft";

export type MintState = "idle" | "minting" | "success" | "error";

export interface UseMintCar {
  /** Mint fee in whole DRIFT, read from the contract. */
  mintFee: number;
  /** The player's DRIFT, or `null` until the wallet reports it. */
  driftBalance: number | null;
  canAfford: boolean;
  state: MintState;
  txHash: string;
  error: string;
  mint: () => Promise<void>;
  reset: () => void;
}

export function useMintCar(): UseMintCar {
  const { wallet, refreshBalances } = useWallet();
  const [mintFee, setMintFee] = useState(0);
  const [state, setState] = useState<MintState>("idle");
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchMintFeeDrift().then(setMintFee).catch(() => setMintFee(0));
  }, []);

  const driftBalance = wallet?.address ? wallet.driftBalance ?? 0 : null;
  const canAfford = driftBalance !== null && mintFee > 0 && driftBalance >= mintFee;

  const mint = useCallback(async () => {
    if (state === "minting") return;
    setState("minting");
    setError("");
    try {
      if (!wallet?.address) throw new Error("Wallet not connected");
      const { txHash: hash } = await mintCar(wallet.address);
      setTxHash(hash);
      setState("success");
      // The fee has left the wallet by now; the header would otherwise keep
      // showing the pre-mint balance until something else refreshed it.
      void refreshBalances();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction failed");
      setState("error");
    }
  }, [state, wallet?.address, refreshBalances]);

  const reset = useCallback(() => {
    setState("idle");
    setTxHash("");
    setError("");
  }, []);

  return { mintFee, driftBalance, canAfford, state, txHash, error, mint, reset };
}
