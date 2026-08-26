// ─── wagmi Config ─────────────────────────────────────────────────────────
//
// Two connectors, deliberately:
//   - `injected`      picks up MetaMask, Rabby, Brave and the rest.
//   - `coinbaseWallet` in "all" mode also offers Coinbase Smart Wallet, which
//     onboards a player with a passkey and no seed phrase — the closest thing
//     to the zero-friction start a racing game wants.
//
// WalletConnect is left out on purpose: it needs a project ID before anything
// works locally, which is friction during development.

import { base, baseSepolia } from "viem/chains";
import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { CHAIN_ID, RPC_URL } from "./chain";

// Both chains are registered so `switchChain` has somewhere to send a wallet
// that connected on the wrong one; only the active chain gets the custom RPC.
export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  connectors: [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: "Chain Drift", preference: "all" }),
  ],
  transports: {
    [base.id]: http(CHAIN_ID === base.id ? RPC_URL : undefined),
    [baseSepolia.id]: http(CHAIN_ID === baseSepolia.id ? RPC_URL : undefined),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
