import type { CarNFT } from "./car";

export type RaceState = "IDLE" | "LOADING" | "COUNTDOWN" | "RACING" | "FINISHED";

export interface CarStats {
  speed: number;       // Base top speed (0-200)
  acceleration: number; // How fast it reaches top speed (0-100)
  handling: number;    // Cornering ability (0-100)
  reliability: number; // Consistency (0-100)
}

export interface RaceParticipant {
  car: CarNFT;
  stats: CarStats;
  laneIndex: number;   // 0-3 for 4 lanes
  progress: number;    // 0-1 progress along track
  currentSpeed: number; // Current speed during animation
  position: number;    // Current race position (1-4)
  finishTime?: number; // Time when crossed finish line
}

export interface RaceResult {
  winner: RaceParticipant;
  positions: RaceParticipant[];
  /** Total staked by the field, in wei. */
  prizePool: bigint;
  payouts: {
    participantId: string;
    /** Credited to this car by the escrow, in wei. */
    amount: bigint;
    position: number;
  }[];
}

export interface RaceConfig {
  trackLength: number;      // Total track length in units
  lapCount: number;         // Number of laps
  entryFee: bigint;         // Stake per racer, in wei. The pool is this times the field.
  rubberBandStrength: number; // How much slower leaders get near finish (0-1)
  excitementFactor: number;   // How close the finish should feel (0-1)
}

// Camera modes for spectating
export type CameraMode = "OVERVIEW" | "LEADER" | "USER_CAR" | "FINISH_LINE" | "CINEMATIC";

export interface CameraState {
  mode: CameraMode;
  targetCarId: string | null;
  transitionProgress: number;
}
