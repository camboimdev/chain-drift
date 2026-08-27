/**
 * useWalletOptions — the connector list the connect modal renders.
 *
 * wagmi hands back a flat array that mixes EIP-6963 discovery, the legacy
 * `window.ethereum` shim and the SDK connectors. A dapp modal needs the
 * opposite: one row per wallet a player can actually pick, deduplicated,
 * ordered, and labelled.
 */

import { useMemo } from "react";
import type { Connector } from "wagmi";
import { useConnectors } from "wagmi";

export type WalletKind = "extension" | "coinbase" | "walletconnect" | "browser";

export interface WalletOption {
  connector: Connector;
  name: string;
  kind: WalletKind;
  /** Data URI announced over EIP-6963. Absent for the SDK connectors. */
  icon?: string;
  subtitle: string;
  /** True when the wallet is present in this browser right now. */
  installed: boolean;
}

const LAST_CONNECTOR_KEY = "chain_drift:last_connector";

/** Connector id of the last successful connection, used for the RECENT badge. */
export function readLastConnectorId(): string | null {
  try {
    return localStorage.getItem(LAST_CONNECTOR_KEY);
  } catch {
    return null;
  }
}

export function rememberConnector(id: string): void {
  try {
    localStorage.setItem(LAST_CONNECTOR_KEY, id);
  } catch {
    // Private browsing: the badge is cosmetic, losing it is not an error.
  }
}

function hasLegacyInjected(): boolean {
  return typeof window !== "undefined" && "ethereum" in window;
}

export function useWalletOptions(): WalletOption[] {
  const connectors = useConnectors();
  const lastConnectorId = readLastConnectorId();

  return useMemo(() => {
    // EIP-6963 connectors carry the wallet's own rdns as their id; the generic
    // shim is the one literally called "injected".
    const discovered = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
    const legacy = connectors.find((c) => c.id === "injected");
    const coinbaseSdk = connectors.find((c) => c.type === "coinbaseWallet");
    const walletConnect = connectors.find((c) => c.type === "walletConnect");

    const options: WalletOption[] = discovered.map((connector) => ({
      connector,
      name: connector.name,
      kind: "extension",
      icon: connector.icon,
      subtitle: "BROWSER EXTENSION",
      installed: true,
    }));

    // The Coinbase extension announces itself over EIP-6963, so the SDK
    // connector would be a second row onto the same wallet.
    const coinbaseDiscovered = discovered.some((c) => c.id.toLowerCase().includes("coinbase"));
    if (coinbaseSdk && !coinbaseDiscovered) {
      options.push({
        connector: coinbaseSdk,
        name: "Coinbase Wallet",
        kind: "coinbase",
        subtitle: "PASSKEY · NO SEED PHRASE",
        installed: false,
      });
    }

    if (walletConnect) {
      options.push({
        connector: walletConnect,
        name: "WalletConnect",
        kind: "walletconnect",
        subtitle: "SCAN WITH A MOBILE WALLET",
        installed: false,
      });
    }

    // Only worth offering when nothing announced itself but a provider is
    // still sitting on `window.ethereum`.
    if (legacy && discovered.length === 0 && hasLegacyInjected()) {
      options.push({
        connector: legacy,
        name: "Browser Wallet",
        kind: "browser",
        subtitle: "INJECTED PROVIDER",
        installed: true,
      });
    }

    // The wallet a player used last is the one they almost always want again.
    return options.sort((a, b) => {
      const aRecent = a.connector.id === lastConnectorId ? 1 : 0;
      const bRecent = b.connector.id === lastConnectorId ? 1 : 0;
      return bRecent - aRecent;
    });
  }, [connectors, lastConnectorId]);
}
