/**
 * Web3Provider — wagmi plus its TanStack Query cache.
 *
 * wagmi keeps every contract read in a Query cache, so both providers have to
 * sit above anything that touches the chain.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "../config/wagmi";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Chain state moves on block time; refetching on every window focus just
      // burns RPC calls during a race.
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export function Web3Provider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
