// ─── wagmi Config ─────────────────────────────────────────────────────────
//
// Connector line-up, in the order the connect modal shows them:
//   - EIP-6963 discovery      every browser extension that announces itself
//                             (MetaMask, Rabby, Brave…) arrives with its own
//                             name and icon, so the modal can list them.
//   - `injected`              fallback for a legacy `window.ethereum` that
//                             never announced itself.
//   - `coinbaseWallet`        in "all" mode also offers Coinbase Smart Wallet,
//                             which onboards a player with a passkey and no
//                             seed phrase.
//   - `walletConnect`         every mobile wallet, over the QR the modal draws
//                             itself (`showQrModal: false`).
//
// WalletConnect needs a project ID from https://dashboard.reown.com. Without
// one the connector is simply left out and the modal hides that row, so the
// app still runs locally with no setup.

import { base, baseSepolia } from "viem/chains";
import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { CHAIN_ID, RPC_URL } from "./chain";

export const APP_NAME = "Chain Drift";

export const WALLETCONNECT_PROJECT_ID =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() || undefined;

// Shown by the mobile wallet on the approval screen, so it has to be the real
// origin the session is being requested from.
const appUrl = typeof window !== "undefined" ? window.location.origin : "https://chaindrift.xyz";

const walletConnectConnector = WALLETCONNECT_PROJECT_ID
  ? [
      walletConnect({
        projectId: WALLETCONNECT_PROJECT_ID,
        // The QR lives inside our own modal; WalletConnect's would break the
        // visual language and ship a second overlay on top of ours.
        showQrModal: false,
        metadata: {
          name: APP_NAME,
          description: "On-chain racing on Base — NFT cars, VRF payouts.",
          url: appUrl,
          icons: [`${appUrl}/vite.svg`],
        },
      }),
    ]
  : [];

// Both chains are registered so `switchChain` has somewhere to send a wallet
// that connected on the wrong one; only the active chain gets the custom RPC.
export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  connectors: [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: APP_NAME, preference: "all" }),
    ...walletConnectConnector,
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
