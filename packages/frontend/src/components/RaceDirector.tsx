import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useRef } from "react";
import { Group, MathUtils } from "three";
import { useRaceStore } from "../stores/raceStore";
import type { RaceParticipant, AIBoostState } from "@chain-drift/shared";
import {
  calculateSpeedVariation,
  calculateTargetProgress,
  initializeAIBoostState,
  updateAIBoostState,
  calculateLaneDrift,
} from "@chain-drift/shared";
import { Car3D } from "./Car3D";
import {
  RaceTrack,
  getTrackPosition,
  getTrackRotation,
  isAtCorner,
} from "./RaceTrack";
import { TRACK_CONFIG } from "../config/trackConfig";

// Ground clamp constants - cars should NEVER go below ground
const GROUND_HEIGHT = 0;
const CAR_HEIGHT_OFFSET = 0.5; // Distance from ground to car center (half car height)
const MIN_CAR_Y = GROUND_HEIGHT + CAR_HEIGHT_OFFSET; // Absolute minimum Y position
const MAX_BOUNCE_AMPLITUDE = 0.02; // Max bounce height to prevent visual issues

interface RacingCarProps {
  participant: RaceParticipant;
  predeterminedPosition: number;
  totalParticipants: number;
  isUserCar: boolean;
  isRacing: boolean;
  rubberBandStrength: number;
  excitementFactor: number;
}

/**
 * Individual racing car with animation logic
 * Now uses forward track along +Z axis
 */
function RacingCar({
  participant,
  predeterminedPosition,
  totalParticipants,
  isUserCar,
  isRacing,
  rubberBandStrength,
  excitementFactor,
}: RacingCarProps) {
  const carGroupRef = useRef<Group>(null);
  const updateProgress = useRaceStore((state) => state.updateProgress);

  // Animation state refs (for smooth updates without re-renders)
  const progressRef = useRef(0);
  const targetProgressRef = useRef(0);
  const currentSpeedRef = useRef(0);
  const lateralOffsetRef = useRef(0); // Small lateral movement for realism
  const currentYRef = useRef(MIN_CAR_Y); // Smoothed Y position for stability
  const velocityYRef = useRef(0); // Y velocity for suspension simulation
  const startTimeRef = useRef<number | null>(null);
  const boostStateRef = useRef<AIBoostState>(initializeAIBoostState(participant.car.id));
  const laneDriftRef = useRef(0);

  // Racing animation loop
  useFrame((state, delta) => {
    if (!carGroupRef.current) return;
    
    if (!isRacing) {
      // When not racing, keep car at starting position - always above ground
      const startPos = getTrackPosition(0, participant.laneIndex);
      carGroupRef.current.position.set(
        startPos.x,
        MIN_CAR_Y,
        startPos.z
      );
      carGroupRef.current.rotation.set(0, 0, 0); // Face +Z
      return;
    }

    // Initialize start time
    if (startTimeRef.current === null) {
      startTimeRef.current = state.clock.elapsedTime;
    }

    const raceTime = state.clock.elapsedTime - startTimeRef.current;

    // Calculate overall race progress (0-1 over race duration)
    const raceDuration = 30; // 30 seconds for full race
    const raceProgress = Math.min(1, raceTime / raceDuration);

    // Calculate target progress for this car based on predetermined position
    const targetProgress = calculateTargetProgress(
      participant,
      predeterminedPosition,
      totalParticipants,
      raceProgress,
      rubberBandStrength,
      excitementFactor
    );
    targetProgressRef.current = targetProgress;

    // Smooth interpolation toward target (creates rubber-banding effect)
    const smoothingFactor =
      0.02 + (participant.stats.acceleration / 100) * 0.03;
    progressRef.current = MathUtils.lerp(
      progressRef.current,
      targetProgress,
      smoothingFactor
    );

    // Update boost state for AI-controlled feel
    const currentVisualPosition = predeterminedPosition; // Could be calculated from actual progress
    boostStateRef.current = updateAIBoostState(
      boostStateRef.current,
      raceTime,
      delta,
      predeterminedPosition,
      currentVisualPosition,
      raceProgress
    );

    // Calculate current speed with acceleration curve and boost
    const isCorner = isAtCorner(progressRef.current);
    const baseSpeed = participant.stats.speed;
    const visualSpeed = calculateSpeedVariation(
      baseSpeed,
      progressRef.current,
      isCorner,
      participant.stats.handling,
      participant.stats.acceleration,
      raceTime,
      boostStateRef.current
    );
    currentSpeedRef.current = visualSpeed;

    // Calculate lane drift for more realistic racing lines
    const targetLaneDrift = calculateLaneDrift(
      participant.laneIndex,
      raceTime,
      participant.car.id,
      raceProgress
    );
    laneDriftRef.current = MathUtils.lerp(laneDriftRef.current, targetLaneDrift, delta * 2);

    // Get position on track (forward along Z axis)
    const trackPosition = getTrackPosition(
      Math.min(progressRef.current, 1),
      participant.laneIndex
    );
    const trackRotation = getTrackRotation(progressRef.current);

    // Combine lane drift with small lateral weaving
    const weaveFactor = Math.sin(raceTime * 2 + participant.laneIndex * Math.PI) * 0.15;
    const totalLateralOffset = laneDriftRef.current + weaveFactor;
    lateralOffsetRef.current = MathUtils.lerp(
      lateralOffsetRef.current,
      totalLateralOffset,
      delta * 3
    );

    // Suspension simulation - subtle bounce that NEVER goes below ground
    // Use speed-scaled oscillation with absolute guarantee of minimum height
    const speedFactor = Math.min(1, visualSpeed / 120);
    const suspensionTarget = MIN_CAR_Y + Math.abs(Math.sin(raceTime * 12)) * MAX_BOUNCE_AMPLITUDE * speedFactor;
    
    // Smooth spring-like movement toward target
    const springForce = (suspensionTarget - currentYRef.current) * 8;
    velocityYRef.current += springForce * delta;
    velocityYRef.current *= 0.85; // Damping
    currentYRef.current += velocityYRef.current * delta;
    
    // CRITICAL: Absolute floor clamp - no exceptions
    const finalY = Math.max(MIN_CAR_Y, currentYRef.current);
    
    // Apply position with guaranteed ground clamp
    carGroupRef.current.position.set(
      trackPosition.x + lateralOffsetRef.current,
      finalY,
      trackPosition.z
    );
    
    // Safety check - if somehow below ground, snap to minimum
    if (carGroupRef.current.position.y < MIN_CAR_Y) {
      carGroupRef.current.position.y = MIN_CAR_Y;
      velocityYRef.current = 0; // Kill any downward velocity
    }

    // Rotation - face forward (+Z), with slight tilt during weaving
    const tiltAngle = -lateralOffsetRef.current * 0.05; // Slight body roll
    carGroupRef.current.rotation.set(
      0,
      trackRotation, // 0 for straight track
      tiltAngle
    );

    // Update store (throttled)
    if (Math.random() < 0.1) {
      updateProgress(
        participant.car.id,
        progressRef.current,
        currentSpeedRef.current
      );
    }
  });

  // Reset position when race resets
  useEffect(() => {
    if (!isRacing && carGroupRef.current) {
      progressRef.current = 0;
      startTimeRef.current = null;
      currentYRef.current = MIN_CAR_Y;
      velocityYRef.current = 0;
      lateralOffsetRef.current = 0;
      laneDriftRef.current = 0;
      boostStateRef.current = initializeAIBoostState(participant.car.id);
      const startPosition = getTrackPosition(0, participant.laneIndex);
      carGroupRef.current.position.set(
        startPosition.x,
        MIN_CAR_Y,
        startPosition.z
      );
      carGroupRef.current.rotation.set(0, 0, 0);
    }
  }, [isRacing, participant.laneIndex, participant.car.id]);

  return (
    <group ref={carGroupRef}>
      <Car3D
        tokenId={participant.car.tokenId}
        position={[0, 0, 0]}
        isSelected={isUserCar}
      />

      {/* Neon underglow effect for user's car */}
      {isUserCar && (
        <pointLight
          position={[0, 0.2, 0]}
          intensity={3}
          distance={4}
          color="#00ffff"
        />
      )}

      {/* Speed trail effect - exhaust glow */}
      {isRacing && currentSpeedRef.current > 70 && (
        <>
          <mesh position={[0, 0.3, -1.5]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.15 + (currentSpeedRef.current / 500), 1.2 + (currentSpeedRef.current / 80), 8]} />
            <meshBasicMaterial 
              color={boostStateRef.current.active ? "#00ffff" : "#ff4400"} 
              transparent 
              opacity={0.25 + (currentSpeedRef.current / 500)}
            />
          </mesh>
          {/* Second trail for speed emphasis */}
          <mesh position={[0, 0.3, -2.2]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.08, 0.8 + (currentSpeedRef.current / 120), 6]} />
            <meshBasicMaterial 
              color={boostStateRef.current.active ? "#ffffff" : "#ffaa00"} 
              transparent 
              opacity={0.15 + (boostStateRef.current.active ? 0.3 : 0)}
            />
          </mesh>
        </>
      )}

      {/* Boost effect - intense glow when boosting */}
      {isRacing && boostStateRef.current.active && (
        <>
          <pointLight
            position={[0, 0.5, -1]}
            intensity={10 * boostStateRef.current.intensity}
            distance={6}
            color="#00ffff"
          />
          {/* Boost flame trail */}
          <mesh position={[0, 0.3, -2.5]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.25, 2 * boostStateRef.current.intensity, 8]} />
            <meshBasicMaterial 
              color="#00ffff" 
              transparent 
              opacity={0.5 * boostStateRef.current.intensity}
            />
          </mesh>
        </>
      )}
    </group>
  );
}

/**
 * Race countdown overlay component
 */
function CountdownDisplay({ countdown }: { countdown: number }) {
  const groupRef = useRef<Group>(null);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.scale.setScalar(
        1 + Math.sin(state.clock.elapsedTime * 10) * 0.1
      );
    }
  });

  if (countdown <= 0) return null;

  // Position countdown at start line, above track
  return (
    <group ref={groupRef} position={[0, 10, 20]}>
      <mesh>
        <sphereGeometry args={[2.5, 32, 32]} />
        <meshStandardMaterial
          color={
            countdown === 1
              ? "#00ff00"
              : countdown === 2
              ? "#ffff00"
              : "#ff0000"
          }
          emissive={
            countdown === 1
              ? "#00ff00"
              : countdown === 2
              ? "#ffff00"
              : "#ff0000"
          }
          emissiveIntensity={2}
          transparent
          opacity={0.8}
        />
      </mesh>
    </group>
  );
}

interface RaceDirectorProps {
  onRaceComplete?: () => void;
}

/**
 * Main RaceDirector component - orchestrates the entire race
 */
export function RaceDirector({ onRaceComplete }: RaceDirectorProps) {
  const {
    raceState,
    participants,
    userCarId,
    countdown,
    config,
    predeterminedPositions,
    setCountdown,
    startRace,
    finishRace,
    updatePositions,
    setElapsedTime,
  } = useRaceStore();

  const raceStartTimeRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Handle countdown
  useEffect(() => {
    if (raceState === "COUNTDOWN" && countdown > 0) {
      countdownIntervalRef.current = setInterval(() => {
        setCountdown(countdown - 1);
      }, 1000);

      return () => {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
        }
      };
    }

    if (raceState === "COUNTDOWN" && countdown === 0) {
      // GO!
      setTimeout(() => {
        startRace();
        raceStartTimeRef.current = Date.now();
      }, 500);
    }
  }, [raceState, countdown, setCountdown, startRace]);

  // Main race loop - update positions and check for finish
  useFrame(() => {
    if (raceState !== "RACING") return;

    // Update elapsed time
    if (raceStartTimeRef.current) {
      const elapsed = (Date.now() - raceStartTimeRef.current) / 1000;
      setElapsedTime(elapsed);

      // Update position rankings
      updatePositions();

      // Check if race is finished (leader at 100%)
      const leader = participants.reduce((prev, curr) =>
        curr.progress > prev.progress ? curr : prev
      );

      if (leader.progress >= 0.99) {
        // Race finished!
        const sortedByPosition = [...participants].sort((a, b) => {
          const posA = predeterminedPositions.indexOf(a.car.id);
          const posB = predeterminedPositions.indexOf(b.car.id);
          return posA - posB;
        });

        const winner = sortedByPosition[0];

        finishRace({
          winner,
          positions: sortedByPosition,
          prizePool: config.prizePool,
          payouts: sortedByPosition.map((p, i) => ({
            participantId: p.car.id,
            amount: Math.floor(config.prizePool * [0.5, 0.3, 0.15, 0.05][i]),
            position: i + 1,
          })),
        });

        onRaceComplete?.();
      }
    }
  });

  return (
    <group>
      {/* Race Track */}
      <RaceTrack showPath={true} showBarriers={true} />

      {/* Racing Cars */}
      <Suspense fallback={null}>
        {participants.map((participant) => {
          const predeterminedPosition =
            predeterminedPositions.indexOf(participant.car.id) + 1;

          return (
            <RacingCar
              key={participant.car.id}
              participant={participant}
              predeterminedPosition={predeterminedPosition}
              totalParticipants={participants.length}
              isUserCar={participant.car.id === userCarId}
              isRacing={raceState === "RACING"}
              rubberBandStrength={config.rubberBandStrength}
              excitementFactor={config.excitementFactor}
            />
          );
        })}
      </Suspense>

      {/* Countdown Display */}
      {raceState === "COUNTDOWN" && <CountdownDisplay countdown={countdown} />}

      {/* Finish line celebration effects */}
      {raceState === "FINISHED" && (
        <group position={[0, 5, TRACK_CONFIG.totalDistance]}>
          {/* Confetti/celebration particles would go here */}
          <pointLight intensity={100} color="#ffff00" distance={30} />
          <pointLight
            position={[10, 0, 0]}
            intensity={50}
            color="#ff00ff"
            distance={20}
          />
          <pointLight
            position={[-10, 0, 0]}
            intensity={50}
            color="#00ffff"
            distance={20}
          />
        </group>
      )}
    </group>
  );
}

export default RaceDirector;
