/// Chain-level identifiers shared by the frontend, the recorder and the metadata API.

/** Chains Chain Drift is deployed to. Base Sepolia is the development default. */
export const CHAIN_IDS = {
  baseSepolia: 84532,
  base: 8453,
} as const;

export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

export const CHAIN_LABELS: Record<ChainId, string> = {
  [CHAIN_IDS.baseSepolia]: "Base Sepolia",
  [CHAIN_IDS.base]: "Base",
};

/** Addresses written by `packages/contracts/script/Deploy.s.sol`. */
export interface Deployment {
  chainId: number;
  driftToken: `0x${string}`;
  carNft: `0x${string}`;
  raceEscrow: `0x${string}`;
  leaderboard: `0x${string}`;
}

/** Mirrors `RaceEscrow.RaceStatus`; the index is the on-chain enum value. */
export const RACE_STATUSES = [
  "None",
  "Open",
  "Locked",
  "Resolving",
  "Paid",
  "Cancelled",
] as const;

export type RaceStatus = (typeof RACE_STATUSES)[number];

export function raceStatusFromEnum(value: number): RaceStatus {
  return RACE_STATUSES[value] ?? "None";
}
