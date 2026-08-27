/**
 * WalletProvider — a thin, game-shaped facade over wagmi.
 *
 * The rest of the app only ever needs "who is connected, on which chain, with
 * how much DRIFT", so wagmi's hooks stay in here and everything else reaches
 * them through `useWallet()` in `walletContextValue.ts`.
 *
 * Picking a wallet is its own flow: `connectWallet()` opens `ConnectModal`,
 * which owns the connector list, the QR and its own error states.
 */

import type {
  User,
  WalletContextType,
  WalletInfo,
  WalletState,
} from "@chain-drift/shared";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther } from "viem";
import { useAccount, useBalance, useDisconnect, useSwitchChain } from "wagmi";
import { ConnectModal } from "../components/wallet/ConnectModal";
import { CHAIN_ID, NETWORK_LABEL } from "../config/chain";
import { fetchDriftBalance } from "../services/driftToken";
import { WalletContext } from "./walletContextValue";

interface WalletProviderProps {
  children: ReactNode;
}

export function WalletProvider({ children }: WalletProviderProps) {
  const { address, isConnected, isConnecting, isReconnecting, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { data: nativeBalance, refetch: refetchNative } = useBalance({ address });

  const [user, setUser] = useState<User | null>(null);
  const [driftBalance, setDriftBalance] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isConnectModalOpen, setConnectModalOpen] = useState(false);

  const isWrongNetwork = isConnected && chainId !== undefined && chainId !== CHAIN_ID;

  // A returning player is recognised by address, so the onboarding flow only
  // runs the first time a given wallet shows up in this browser.
  useEffect(() => {
    if (!address) {
      setUser(null);
      return;
    }
    setUser({
      walletAddress: address,
      isNewUser: localStorage.getItem(`onboarding_completed_${address}`) === null,
      joinedAt: new Date(),
    });
  }, [address]);

  const refreshBalances = useCallback(async () => {
    if (!address || isWrongNetwork) return;
    const [drift] = await Promise.all([fetchDriftBalance(address), refetchNative()]);
    setDriftBalance(drift);
  }, [address, isWrongNetwork, refetchNative]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  const state: WalletState = useMemo(() => {
    if (isConnected) return "connected";
    return isConnecting || isReconnecting ? "connecting" : "disconnected";
  }, [isConnecting, isReconnecting, isConnected]);

  const wallet: WalletInfo | null = useMemo(() => {
    if (!address || !isConnected) return null;
    return {
      address,
      isConnected: true,
      balance: nativeBalance ? Number(formatEther(nativeBalance.value)) : 0,
      driftBalance,
      network: isWrongNetwork ? "Wrong network" : NETWORK_LABEL,
      chainId,
    };
  }, [address, isConnected, nativeBalance, driftBalance, isWrongNetwork, chainId]);

  const connectWallet = useCallback(() => {
    setError(null);
    setConnectModalOpen(true);
  }, []);

  const disconnectWallet = useCallback(() => {
    disconnect();
    setUser(null);
    setDriftBalance(0);
    setError(null);
  }, [disconnect]);

  const switchToGameChain = useCallback(async () => {
    try {
      await switchChainAsync({ chainId: CHAIN_ID });
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to switch network.";
      setError(message);
    }
  }, [switchChainAsync]);

  const completeOnboarding = useCallback(() => {
    if (!user || !address) return;
    localStorage.setItem(`onboarding_completed_${address}`, "true");
    setUser({ ...user, isNewUser: false });
  }, [user, address]);

  const value: WalletContextType = {
    wallet,
    user,
    state,
    connectWallet,
    disconnectWallet,
    completeOnboarding,
    isWrongNetwork,
    switchToGameChain,
    refreshBalances,
    error,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
      <ConnectModal
        open={isConnectModalOpen}
        onClose={() => setConnectModalOpen(false)}
      />
    </WalletContext.Provider>
  );
}
