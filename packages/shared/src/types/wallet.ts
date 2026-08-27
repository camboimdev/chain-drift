export interface WalletInfo {
  /** Checksummed EVM address. */
  address: `0x${string}`;
  isConnected: boolean;
  /** Native ETH balance in full units — used for the gas warning in the header. */
  balance?: number;
  /** DRIFT balance in full units. */
  driftBalance?: number;
  /** Human-readable chain name, e.g. "Base Sepolia". */
  network?: string;
  chainId?: number;
}

export interface User {
  walletAddress: `0x${string}`;
  isNewUser: boolean;
  username?: string;
  joinedAt: Date;
}

export type WalletState = "disconnected" | "connecting" | "connected";

export interface WalletContextType {
  wallet: WalletInfo | null;
  user: User | null;
  state: WalletState;
  /** Opens the connect modal; the wallet choice is made there. */
  connectWallet: () => void;
  disconnectWallet: () => void;
  completeOnboarding: () => void;
  /** True when connected to a chain the game is not deployed on. */
  isWrongNetwork: boolean;
  switchToGameChain: () => Promise<void>;
  refreshBalances: () => Promise<void>;
  /** Last network-switch failure. Connection errors are shown in the modal. */
  error: string | null;
}
