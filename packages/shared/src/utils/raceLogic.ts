import type { CarNFT, CarRarity } from "../types/car";
import type { CarStats, RaceParticipant } from "../types/race";

/**
 * Rarity multipliers for win probability
 * Higher tier = higher chance, but Commons still have a shot (Underdog effect)
 */
const RARITY_WEIGHTS: Record<CarRarity, number> = {
  Common: 1.0,
  Rare: 1.5,
  Epic: 2.0,
  Legendary: 3.0,
};

/**
 * Base stats for cars without specific part stats
 */
const BASE_STATS: CarStats = {
  speed: 80,
  acceleration: 50,
  handling: 60,
  reliability: 70,
};

/**
 * Calculate a car's racing stats from its equipped parts
 */
export function calculateCarStats(car: CarNFT): CarStats {
  const parts = car.equippedParts;
  
  // Extract stats from performance parts
  const engine = parts.EngineBlock;
  const nitro = parts.Nitro;
  const tires = parts.Tires;
  const suspension = parts.FrontSuspension;
  
  // Calculate speed from engine
  const speed = engine?.stats?.speed ?? BASE_STATS.speed;
  
  // Calculate acceleration from engine + nitro bonus
  const engineAccel = engine?.stats?.acceleration ?? BASE_STATS.acceleration;
  const nitroBonus = nitro?.stats?.acceleration ?? 0;
  const acceleration = Math.min(100, engineAccel + nitroBonus);
  
  // Handling based on tires/suspension rarity (future: add specific stats)
  const tiresBonus = tires ? RARITY_WEIGHTS[tires.rarity] * 5 : 0;
  const suspensionBonus = suspension ? RARITY_WEIGHTS[suspension.rarity] * 5 : 0;
  const handling = Math.min(100, BASE_STATS.handling + tiresBonus + suspensionBonus);
  
  // Reliability based on car rarity (higher tier = more consistent)
  const reliability = Math.min(100, BASE_STATS.reliability + RARITY_WEIGHTS[car.rarity] * 10);
  
  return {
    speed,
    acceleration,
    handling,
    reliability,
  };
}

/**
 * Calculate win probability weights for all participants
 * Uses a combination of stats and rarity for the "weighted random" algorithm
 */
export function calculateWinProbabilities(participants: RaceParticipant[]): number[] {
  const weights = participants.map((p) => {
    const { speed, acceleration, handling, reliability } = p.stats;
    const rarityMultiplier = RARITY_WEIGHTS[p.car.rarity];
    
    // Weighted combination of stats (speed matters most, then handling for this drift game)
    const statScore = 
      speed * 0.35 +           // Speed is important
      acceleration * 0.20 +    // Quick starts help
      handling * 0.30 +        // Handling for drifting
      reliability * 0.15;      // Consistency
    
    // Apply rarity multiplier and add underdog factor
    // Even common cars get a base chance
    const baseChance = 10; // Minimum chance for any car
    const weight = baseChance + (statScore * rarityMultiplier);
    
    return weight;
  });
  
  // Normalize weights to sum to 1
  const total = weights.reduce((sum, w) => sum + w, 0);
  return weights.map((w) => w / total);
}

/**
 * Select a winner using weighted random selection
 * The "brain" of the race - determines outcome before animation starts
 */
export function selectWinner(participants: RaceParticipant[]): RaceParticipant {
  const weights = participants.map((p) => p.weight);
  const random = Math.random();
  
  let cumulative = 0;
  for (let i = 0; i < participants.length; i++) {
    cumulative += weights[i];
    if (random <= cumulative) {
      return participants[i];
    }
  }
  
  // Fallback (shouldn't happen)
  return participants[participants.length - 1];
}

/**
 * Calculate target progress for a car at a given time
 * Implements VERY tight pack racing - all cars stay close together
 * 
 * KEY: Keep cars extremely close for broadcast-style visuals
 */
export function calculateTargetProgress(
  _participant: RaceParticipant,
  predeterminedPosition: number,
  totalParticipants: number,
  raceProgress: number, // 0-1 overall race progress
  _rubberBandStrength: number,
  excitementFactor: number
): number {
  // Maximum gap between first and last place (as fraction of total race)
  // 0.025 = 2.5% max gap = ~30 meters on 1200m track between first and last
  const maxPackSpread = 0.025;
  
  // Position offset (0 for leader, 1 for last place)
  const normalizedPosition = (predeterminedPosition - 1) / Math.max(1, totalParticipants - 1);
  
  // All cars follow the race progress very closely
  // Small gap based on position
  const positionGap = normalizedPosition * maxPackSpread;
  let targetProgress = raceProgress - positionGap;
  
  // Tiny micro-variations for visual interest (cars jockeying for position)
  const jitter = Math.sin(raceProgress * 50 + predeterminedPosition * 10) * 0.003;
  targetProgress += jitter;
  
  // Near finish: compress pack even tighter for photo finish
  if (raceProgress > excitementFactor) {
    const excitementProgress = (raceProgress - excitementFactor) / (1 - excitementFactor);
    // Gap shrinks to almost nothing at finish
    const finishGap = maxPackSpread * (1 - excitementProgress * 0.95);
    const compressedGap = normalizedPosition * finishGap;
    targetProgress = raceProgress - compressedGap;
  }
  
  // Hard clamp: never more than maxPackSpread behind leader
  targetProgress = Math.max(raceProgress - maxPackSpread, targetProgress);
  targetProgress = Math.min(raceProgress, targetProgress);
  
  return Math.max(0, Math.min(1, targetProgress));
}

/**
 * Calculate speed variation for visual interest
 * Includes acceleration curve, boost events, and micro-variations
 */
export function calculateSpeedVariation(
  baseSpeed: number,
  trackProgress: number,
  isCorner: boolean,
  handling: number,
  acceleration: number,
  raceTime: number,
  boostState?: { active: boolean; intensity: number }
): number {
  // Acceleration curve - cars don't instantly reach top speed
  // Uses acceleration stat (0-100) to determine how quickly they reach top speed
  const accelerationTime = 5 - (acceleration / 100) * 3; // 2-5 seconds to top speed
  const accelerationCurve = Math.min(1, raceTime / accelerationTime);
  const easedAcceleration = 1 - Math.pow(1 - accelerationCurve, 3); // Ease out cubic
  
  // Base speed with acceleration applied
  let speed = baseSpeed * (0.3 + 0.7 * easedAcceleration);
  
  if (isCorner) {
    // Better handling = less slowdown in corners
    const cornerPenalty = 0.3 * (1 - handling / 100);
    speed *= (1 - cornerPenalty);
  } else {
    // Slight speed boost on straights
    speed *= 1.08;
  }
  
  // Apply boost if active
  if (boostState?.active) {
    speed *= (1 + boostState.intensity * 0.25); // Up to 25% boost
  }
  
  // Add micro-variations for visual interest (subtle weaving in speed)
  const microVariation = 1 + (Math.sin(trackProgress * 30 + raceTime * 2) * 0.03);
  speed *= microVariation;
  
  // Add occasional small surge (simulates drafting/slipstream feel)
  const surgeFactor = Math.sin(raceTime * 0.5 + trackProgress * 10) > 0.7 ? 1.05 : 1;
  speed *= surgeFactor;
  
  return speed;
}

/**
 * AI boost system - determines when AI should boost
 */
export interface AIBoostState {
  active: boolean;
  intensity: number;
  cooldown: number;
  nextBoostTime: number;
}

export function initializeAIBoostState(carId: string): AIBoostState {
  // Randomize initial boost timing per car
  const hash = carId.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  const randomOffset = (hash % 100) / 100;
  
  return {
    active: false,
    intensity: 0,
    cooldown: 0,
    nextBoostTime: 5 + randomOffset * 10, // First boost between 5-15 seconds
  };
}

export function updateAIBoostState(
  state: AIBoostState,
  raceTime: number,
  delta: number,
  predeterminedPosition: number,
  currentVisualPosition: number,
  raceProgress: number
): AIBoostState {
  const newState = { ...state };
  
  // Update cooldown
  if (newState.cooldown > 0) {
    newState.cooldown -= delta;
  }
  
  // Check if should activate boost
  if (!newState.active && raceTime >= newState.nextBoostTime && newState.cooldown <= 0) {
    // More likely to boost if behind their predetermined position
    const needsCatchUp = currentVisualPosition > predeterminedPosition;
    const boostChance = needsCatchUp ? 0.8 : 0.3;
    
    // Don't boost too early or too late in race
    if (raceProgress > 0.15 && raceProgress < 0.95 && Math.random() < boostChance) {
      newState.active = true;
      newState.intensity = 0.5 + Math.random() * 0.5; // 50-100% intensity
      newState.cooldown = 8 + Math.random() * 4; // 8-12 second cooldown
    }
    
    newState.nextBoostTime = raceTime + 3 + Math.random() * 5; // Check again in 3-8 seconds
  }
  
  // Boost duration (1.5-2.5 seconds)
  if (newState.active) {
    newState.intensity -= delta * 0.5; // Fade out
    if (newState.intensity <= 0) {
      newState.active = false;
      newState.intensity = 0;
    }
  }
  
  return newState;
}

/**
 * Calculate lane drift/offset for AI cars
 * Creates more realistic racing lines and enables overtaking visuals
 */
export function calculateLaneDrift(
  _baseLaneIndex: number,
  raceTime: number,
  carId: string,
  raceProgress: number
): number {
  // Create unique pattern per car using car ID
  const hash = carId.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  const phase = hash % 100;
  
  // Base lane position
  let drift = 0;
  
  // Slow weaving within lane (for realism)
  drift += Math.sin(raceTime * 0.8 + phase * 0.1) * 0.3;
  
  // Occasional larger moves (simulates positioning)
  const positioningPhase = Math.sin(raceTime * 0.2 + phase * 0.05);
  if (Math.abs(positioningPhase) > 0.8) {
    drift += positioningPhase * 0.5;
  }
  
  // Near finish, less weaving (more focused)
  if (raceProgress > 0.9) {
    drift *= 0.3;
  }
  
  return drift;
}

/**
 * Determine if a track position is a corner based on curvature
 */
export function isCornerPosition(progress: number, cornerPositions: number[]): boolean {
  const tolerance = 0.05; // 5% of track
  return cornerPositions.some(
    (corner) => Math.abs(progress - corner) < tolerance
  );
}

/**
 * Generate dramatic events during the race
 * These affect visuals but not the predetermined outcome
 */
export interface RaceEvent {
  type: "OVERTAKE" | "NEAR_MISS" | "DRIFT" | "BOOST" | "SLIP";
  carId: string;
  targetCarId?: string;
  progress: number;
  timestamp: number;
}

export function generateRaceEvents(
  participants: RaceParticipant[],
  predeterminedPositions: string[],
  raceProgress: number
): RaceEvent[] {
  const events: RaceEvent[] = [];
  
  // Check for position changes that look like overtakes
  const sortedByProgress = [...participants].sort((a, b) => b.progress - a.progress);
  
  sortedByProgress.forEach((car, visualPosition) => {
    const predeterminedPos = predeterminedPositions.indexOf(car.car.id);
    
    // If car is ahead of its "destined" position, it will be overtaken soon
    if (visualPosition < predeterminedPos && raceProgress < 0.9) {
      const overtaker = sortedByProgress[visualPosition + 1];
      if (overtaker && Math.random() > 0.7) {
        events.push({
          type: "OVERTAKE",
          carId: overtaker.car.id,
          targetCarId: car.car.id,
          progress: car.progress,
          timestamp: Date.now(),
        });
      }
    }
  });
  
  // Random drift events at corners
  if (isCornerPosition(raceProgress, [0.2, 0.4, 0.6, 0.8])) {
    const randomCar = participants[Math.floor(Math.random() * participants.length)];
    if (Math.random() > 0.5) {
      events.push({
        type: "DRIFT",
        carId: randomCar.car.id,
        progress: raceProgress,
        timestamp: Date.now(),
      });
    }
  }
  
  return events;
}

/**
 * Calculate prize distribution based on positions
 */
export function calculatePayouts(
  prizePool: number,
  positions: RaceParticipant[]
): { participantId: string; amount: number; position: number }[] {
  // Prize distribution: 50%, 30%, 15%, 5%
  const distribution = [0.5, 0.3, 0.15, 0.05];
  
  return positions.map((p, index) => ({
    participantId: p.car.id,
    amount: Math.floor(prizePool * (distribution[index] ?? 0)),
    position: index + 1,
  }));
}
