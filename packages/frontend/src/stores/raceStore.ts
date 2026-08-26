import { create } from "zustand";
import type { CarNFT, RaceState, RaceParticipant, RaceResult, RaceConfig, CameraState, CameraMode } from "@chain-drift/shared";
import { calculateCarStats, calculateWinProbabilities, selectWinner } from "@chain-drift/shared";
import { TRACK_CONFIG } from "../config/trackConfig";
import { enterRace } from "../services/raceContract";

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

  // Actions
  initializeRace: (cars: CarNFT[], userCarId: string) => void;
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
  prizePool: 1000,
  entryFee: 100,
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

  initializeRace: (cars: CarNFT[], userCarId: string) => {
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

    // Pre-determine the race outcome using weighted random
    const winner = selectWinner(participantsWithStats);
    const positions = generateRacePositions(participantsWithStats, winner.car.id);

    set({
      participants: participantsWithStats,
      userCarId,
      predeterminedWinner: winner.car.id,
      predeterminedPositions: positions,
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
