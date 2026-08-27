import type { CarNFT, CarRarity } from "../types/car";
import type { CarStats, RaceParticipant } from "../types/race";

/**
 * How consistent a car looks, by rarity.
 *
 * Nothing here decides a race. The finish order comes from Chainlink VRF and is
 * settled on-chain before the animation starts; these numbers only shape how a
 * car drives on the way to a result that is already fixed.
 */
const RARITY_RELIABILITY: Record<CarRarity, number> = {
  Common: 70,
  Rare: 78,
  Epic: 85,
  Legendary: 95,
};

/**
 * Driving profile per collection archetype.
 *
 * The archetype is a trait on the token's manifest entry — the same string the
 * NFT metadata publishes — so two cars of the same archetype handle alike and a
 * Drift Coupe corners better than a Cyber Muscle in every race it appears in.
 */
const ARCHETYPE_PROFILES: Record<string, Omit<CarStats, "reliability">> = {
  "Cyber GT":     { speed: 92, acceleration: 70, handling: 78 },
  "Cyber Muscle": { speed: 95, acceleration: 82, handling: 55 },
  "Drift Coupe":  { speed: 82, acceleration: 66, handling: 94 },
  "Retro Tuner":  { speed: 84, acceleration: 74, handling: 74 },
  "Street Racer": { speed: 86, acceleration: 88, handling: 68 },
};

/** Used for a token the manifest does not cover — a mint past the pinned set. */
const DEFAULT_PROFILE: Omit<CarStats, "reliability"> = {
  speed: 85,
  acceleration: 72,
  handling: 72,
};

function archetypeOf(car: CarNFT): string | undefined {
  const trait = car.attributes?.find((a) => a.trait_type === "Archetype");
  return trait === undefined ? undefined : String(trait.value);
}

/**
 * A car's driving profile, from the traits the collection actually publishes.
 *
 * Cosmetic by design: the animation and the stat bars read this, the payout
 * never does.
 */
export function calculateCarStats(car: CarNFT): CarStats {
  const archetype = archetypeOf(car);
  const profile =
    (archetype !== undefined ? ARCHETYPE_PROFILES[archetype] : undefined) ?? DEFAULT_PROFILE;

  return { ...profile, reliability: RARITY_RELIABILITY[car.rarity] };
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
  acceleration: number,
  raceTime: number,
  boostState?: { active: boolean; intensity: number }
): number {
  // Acceleration curve - cars don't instantly reach top speed
  // Uses acceleration stat (0-100) to determine how quickly they reach top speed
  const accelerationTime = 5 - (acceleration / 100) * 3; // 2-5 seconds to top speed
  const accelerationCurve = Math.min(1, raceTime / accelerationTime);
  const easedAcceleration = 1 - Math.pow(1 - accelerationCurve, 3); // Ease out cubic
  
  // Base speed with acceleration applied. The circuit is a single straight,
  // so there is no cornering term — every metre is a straight-line metre.
  let speed = baseSpeed * (0.3 + 0.7 * easedAcceleration) * 1.08;

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
 * Lateral offset within a car's lane — the weave that makes a straight read as
 * racing rather than four cars on rails.
 *
 * `handling` is what the amplitude scales against: on a straight there is no
 * corner for it to bite in, so it shows up as line-holding instead. A Drift
 * Coupe tracks close to its lane centre; a Cyber Muscle wanders.
 */
export function calculateLaneDrift(
  handling: number,
  raceTime: number,
  carId: string,
  raceProgress: number
): number {
  // A per-car phase, so two cars of the same archetype do not weave in unison.
  const hash = carId.split("").reduce((a, b) => a + b.charCodeAt(0), 0);
  const phase = hash % 100;

  // 100 handling holds the line; 50 wanders at roughly double the amplitude.
  const looseness = 1.5 - handling / 100;

  // Slow weave within the lane.
  let drift = Math.sin(raceTime * 0.8 + phase * 0.1) * 0.3 * looseness;

  // Occasional larger move, as if repositioning.
  const positioningPhase = Math.sin(raceTime * 0.2 + phase * 0.05);
  if (Math.abs(positioningPhase) > 0.8) {
    drift += positioningPhase * 0.5 * looseness;
  }

  // Near the finish everyone tidies up.
  if (raceProgress > 0.9) drift *= 0.3;

  return drift;
}
