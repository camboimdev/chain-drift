import { create } from "zustand";
import type { CarNFT, RaceState, RaceParticipant, RaceResult, RaceConfig, CameraState, CameraMode } from "@chain-drift/shared";
import {
  calculateCarStats,
  calculateRacePayouts,
  calculateWinProbabilities,
  selectWinner,
  RACE_ENTRY_FEE,
} from "@chain-drift/shared";
import { TRACK_CONFIG } from "../config/trackConfig";
import { enterRace } from "../services/raceContract";

/**
 * The settled result of an on-chain race, as emitted by `RaceFinished`.
 *
 * When present it is authoritative: the animation finishes in this order and
 * the results screen shows these exact amounts. Without it the race is a local
 * exhibition run and the outcome is simulated.
 */
export interface OnChainOutcome {
  /** Car token IDs, index 0 = winner. */
  carTokenIds: number[];
  /** Payout credited to each position, in wei. Parallel to `carTokenIds`. */
  payouts: bigint[];
}

interface RaceStore {
  // State
  raceState: RaceState;
  participants: RaceParticipant[];
  result: RaceResult | null;
  userCarId: string | null;
  camera: CameraState;
  countdown: number;
  elapsedTime: number;
  config: RaceConfig;

  // Pre-determined race outcome
  predeterminedWinner: string | null;
  predeterminedPositions: string[]; // Car IDs in finish order
  /** Payout per finishing position, in wei. Index 0 = winner. */
  positionPayouts: bigint[];

  // Actions
  initializeRace: (cars: CarNFT[], userCarId: string, outcome?: OnChainOutcome) => void;
  startMatchmaking: () => void;
  startCountdown: () => void;
  startRace: () => void;
  updateProgress: (carId: string, progress: number, speed: number) => void;
  updatePositions: () => void;
  finishRace: (result: RaceResult) => void;
  resetRace: () => void;
  setCameraMode: (mode: CameraMode, targetCarId?: string) => void;
  setCountdown: (value: number) => void;
  setElapsedTime: (time: number) => void;
  /** Enter a race on-chain by paying the entry fee to the Race Escrow contract. */
  enterRaceOnChain: (
    owner: `0x${string}`,
    raceId: bigint,
    carTokenId: bigint,
    entryFee: bigint
  ) => Promise<string>;
}

const DEFAULT_CONFIG: RaceConfig = {
  trackLength: TRACK_CONFIG.totalDistance, // 1200m forward track
  lapCount: 1,
  entryFee: RACE_ENTRY_FEE,
  rubberBandStrength: 0.5,  // Stronger rubber banding for tight pack
  excitementFactor: 0.75,   // Earlier convergence for dramatic final quarter
};

export const useRaceStore = create<RaceStore>((set) => ({
  // Initial state
  raceState: "IDLE",
  participants: [],
  result: null,
  userCarId: null,
  camera: {
    mode: "OVERVIEW",
    targetCarId: null,
    transitionProgress: 0,
  },
  countdown: 3,
  elapsedTime: 0,
  config: DEFAULT_CONFIG,
  predeterminedWinner: null,
  predeterminedPositions: [],
  positionPayouts: [],

  initializeRace: (cars: CarNFT[], userCarId: string, outcome?: OnChainOutcome) => {
    // Calculate stats and weights for each car
    // Assign lanes - spread across available lanes
    const laneCount = Math.min(cars.length, TRACK_CONFIG.laneCount);

    const participantsWithStats = cars.map((car, index) => {
      const stats = calculateCarStats(car);
      // Distribute cars across lanes (center lanes preferred)
      const baseLane = Math.floor(TRACK_CONFIG.laneCount / 2) - Math.floor(laneCount / 2);
      const laneIndex = Math.min(
        TRACK_CONFIG.laneCount - 1,
        Math.max(0, baseLane + index)
      );
      
      return {
        car,
        stats,
        weight: 0, // Will be calculated below
        laneIndex,
        progress: 0,
        currentSpeed: 0,
        position: index + 1,
      };
    });

    // Calculate win probabilities
    const weights = calculateWinProbabilities(participantsWithStats);
    participantsWithStats.forEach((p, i) => {
      p.weight = weights[i];
    });

    // A settled race already has an outcome — Chainlink VRF picked it and the
    // escrow paid it out. The animation replays that order rather than rolling
    // its own, otherwise the car the player watches win is not the car the
    // contract paid.
    let positions: string[];
    let positionPayouts: bigint[];

    if (outcome && outcome.carTokenIds.length > 0) {
      const byTokenId = new Map(participantsWithStats.map((p) => [p.car.tokenId, p.car.id]));
      positions = outcome.carTokenIds
        .map((tokenId) => byTokenId.get(tokenId))
        .filter((id): id is string => id !== undefined);

      // A car on the grid that the settled order does not name would otherwise
      // sort to -1 and be drawn ahead of the winner. Park it at the back.
      for (const p of participantsWithStats) {
        if (!positions.includes(p.car.id)) positions.push(p.car.id);
      }

      positionPayouts = outcome.payouts;
    } else {
      const winner = selectWinner(participantsWithStats);
      positions = generateRacePositions(participantsWithStats, winner.car.id);
      // An exhibition run pays nothing, but it is shown at the stakes a real
      // race of this size would carry.
      positionPayouts = calculateRacePayouts(
        DEFAULT_CONFIG.entryFee,
        participantsWithStats.length
      ).payouts;
    }

    set({
      participants: participantsWithStats,
      userCarId,
      predeterminedWinner: positions[0] ?? null,
      predeterminedPositions: positions,
      positionPayouts,
      raceState: "IDLE",
      result: null,
      countdown: 3,
      elapsedTime: 0,
    });
  },

  startMatchmaking: () => {
    set({ raceState: "MATCHMAKING" });
  },

  startCountdown: () => {
    set({ raceState: "COUNTDOWN", countdown: 3 });
  },

  startRace: () => {
    set({
      raceState: "RACING",
      camera: { mode: "CINEMATIC", targetCarId: null, transitionProgress: 0 },
    });
  },

  updateProgress: (carId: string, progress: number, speed: number) => {
    set((state) => ({
      participants: state.participants.map((p) =>
        p.car.id === carId ? { ...p, progress, currentSpeed: speed } : p
      ),
    }));
  },

  updatePositions: () => {
    set((state) => {
      const sorted = [...state.participants].sort((a, b) => b.progress - a.progress);
      return {
        participants: state.participants.map((p) => ({
          ...p,
          position: sorted.findIndex((s) => s.car.id === p.car.id) + 1,
        })),
      };
    });
  },

  finishRace: (result: RaceResult) => {
    set({
      raceState: "FINISHED",
      result,
      camera: { mode: "FINISH_LINE", targetCarId: result.winner.car.id, transitionProgress: 0 },
    });
  },

  resetRace: () => {
    set({
      raceState: "IDLE",
      participants: [],
      result: null,
      userCarId: null,
      predeterminedWinner: null,
      predeterminedPositions: [],
      positionPayouts: [],
      camera: { mode: "OVERVIEW", targetCarId: null, transitionProgress: 0 },
      countdown: 3,
      elapsedTime: 0,
    });
  },

  setCameraMode: (mode: CameraMode, targetCarId?: string) => {
    set((state) => ({
      camera: {
        ...state.camera,
        mode,
        targetCarId: targetCarId ?? state.camera.targetCarId,
        transitionProgress: 0,
      },
    }));
  },

  setCountdown: (value: number) => {
    set({ countdown: value });
  },

  setElapsedTime: (time: number) => {
    set({ elapsedTime: time });
  },

  enterRaceOnChain: async (
    owner: `0x${string}`,
    raceId: bigint,
    carTokenId: bigint,
    entryFee: bigint
  ): Promise<string> => {
    // `enterRace` tops up the DRIFT allowance when it is short, then waits for
    // the entry transaction to be mined.
    return enterRace(owner, raceId, carTokenId, entryFee);
  },
}));

// Helper function to generate race positions based on predetermined winner
function generateRacePositions(participants: RaceParticipant[], winnerId: string): string[] {
  // Winner is first, then sort others by weight (higher weight = better position)
  const others = participants
    .filter((p) => p.car.id !== winnerId)
    .sort((a, b) => {
      // Add some randomness to other positions
      const aScore = a.weight + Math.random() * 0.3;
      const bScore = b.weight + Math.random() * 0.3;
      return bScore - aScore;
    });

  return [winnerId, ...others.map((p) => p.car.id)];
}
