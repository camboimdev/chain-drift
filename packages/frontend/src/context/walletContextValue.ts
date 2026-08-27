/**
 * The wallet context object and its hook, kept apart from the provider.
 *
 * Fast Refresh replaces a module's exports wholesale when the module also
 * exports a component; splitting the context out means editing the provider
 * never invalidates the context identity mid-session.
 */

import type { WalletContextType } from "@chain-drift/shared";
import { createContext, useContext } from "react";

export const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function useWallet(): WalletContextType {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
