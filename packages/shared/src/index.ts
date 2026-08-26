// Types
export type {
  CarRarity,
  PartCategory,
  PartType,
  CarPart,
  CarNFT,
  PlayerGarage,
} from "./types/car";

export type {
  RaceState,
  CarStats,
  RaceParticipant,
  RaceResult,
  RaceBet,
  RaceConfig,
  CameraMode,
  CameraState,
} from "./types/race";

export type {
  User,
  WalletInfo,
  WalletState,
  WalletContextType,
} from "./types/wallet";

export type { ChainId, Deployment, RaceStatus } from "./types/chain";
export { CHAIN_IDS, CHAIN_LABELS, RACE_STATUSES, raceStatusFromEnum } from "./types/chain";

// Contract ABIs (generated from the Solidity sources)
export {
  driftTokenAbi,
  carNftAbi,
  raceEscrowAbi,
  leaderboardAbi,
} from "./abis";

// Car builder
export { buildCarNFT } from "./data/carGenerator";

// Race logic
export {
  calculateCarStats,
  calculateWinProbabilities,
  selectWinner,
  calculateTargetProgress,
  calculateSpeedVariation,
  initializeAIBoostState,
  updateAIBoostState,
  calculateLaneDrift,
  isCornerPosition,
  generateRaceEvents,
} from "./utils/raceLogic";

export type { AIBoostState, RaceEvent } from "./utils/raceLogic";

// Economy — prices and prize splits, mirroring the on-chain constants
export {
  DRIFT_DECIMALS,
  drift,
  CAR_MINT_FEE,
  RACE_ENTRY_FEE,
  BPS_DENOMINATOR,
  PLATFORM_FEE_BPS,
  PAYOUT_BPS,
  MAX_PARTICIPANTS,
  calculateRacePayouts,
  formatDrift,
} from "./utils/economy";

export type { RacePayoutBreakdown } from "./utils/economy";
