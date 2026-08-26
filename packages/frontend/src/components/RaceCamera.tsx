import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3, MathUtils, PerspectiveCamera } from "three";
import { useRaceStore } from "../stores/raceStore";
import { getTrackPosition } from "./RaceTrack";
import { TRACK_CONFIG } from "../config/trackConfig";
import type { CameraMode, RaceParticipant } from "@chain-drift/shared";

interface RaceCameraProps {
  enabled?: boolean;
}

// Camera preset configurations for forward track
const CAMERA_PRESETS: Record<CameraMode, {
  distanceBehind: number;
  height: number;
  sideOffset: number;
  lookAheadDistance: number;
  baseFov: number;
  maxFov: number;
}> = {
  OVERVIEW: {
    distanceBehind: 60,
    height: 45,
    sideOffset: 25,
    lookAheadDistance: 40,
    baseFov: 55,
    maxFov: 55,
  },
  LEADER: {
    distanceBehind: 16,
    height: 5.5,
    sideOffset: 4,
    lookAheadDistance: 18,
    baseFov: 58,
    maxFov: 78,
  },
  USER_CAR: {
    distanceBehind: 14,
    height: 4.5,
    sideOffset: 3,
    lookAheadDistance: 15,
    baseFov: 55,
    maxFov: 75,
  },
  FINISH_LINE: {
    distanceBehind: -25,
    height: 6,
    sideOffset: 12,
    lookAheadDistance: 0,
    baseFov: 50,
    maxFov: 50,
  },
  CINEMATIC: {
    distanceBehind: 18,
    height: 7,
    sideOffset: 10,
    lookAheadDistance: 25,
    baseFov: 52,
    maxFov: 72,
  },
};

// Cinematic shot types for variety
type CinematicShot = 
  | "chase_high"      // High behind shot
  | "chase_low"       // Low dramatic angle
  | "side_tracking"   // Side view tracking
  | "wide_pack"       // Wide shot showing multiple cars
  | "hero_angle"      // Dynamic angle on user car
  | "overtake_setup"; // Position for capturing overtakes

// Time intervals - SLOW camera changes for cinematic feel
const CAMERA_SWITCH_INTERVAL = 12; // Switch camera mode every 12 seconds
const SHOT_CHANGE_INTERVAL = 15;   // Change shot type every 15 seconds

/**
 * Broadcast-style cinematic camera controller
 * Features: 
 * - Multiple dynamic shot types
 * - Smooth spring-based following
 * - Speed-based FOV and shake
 * - Automatic dramatic angle changes
 */
export function RaceCamera({ enabled = true }: RaceCameraProps) {
  const { camera } = useThree();
  const {
    raceState,
    participants,
    userCarId,
    camera: cameraState,
    setCameraMode,
  } = useRaceStore();
  
  // Animation refs
  const targetPositionRef = useRef(new Vector3(0, 30, -50));
  const currentPositionRef = useRef(new Vector3(0, 30, -50));
  const targetLookAtRef = useRef(new Vector3(0, 0, 50));
  const smoothLookAtRef = useRef(new Vector3(0, 0, 50));
  const cinematicTimeRef = useRef(0);
  const currentFovRef = useRef(55);
  const cameraShakeRef = useRef({ x: 0, y: 0 });
  const currentShotRef = useRef<CinematicShot>("chase_high");
  const shotChangeTimeRef = useRef(0);
  const velocityRef = useRef(new Vector3(0, 0, 0));
  
  // Get sorted participants by position
  const getSortedParticipants = () => {
    return [...participants].sort((a, b) => b.progress - a.progress);
  };
  
  // Get the car to follow based on camera mode
  // PRIORITY: Focus on user's car most of the time
  const getTargetCar = (): RaceParticipant | null => {
    if (participants.length === 0) return null;
    
    const sorted = getSortedParticipants();
    const userCar = participants.find((p) => p.car.id === userCarId);
    
    switch (cameraState.mode) {
      case "LEADER":
        return sorted[0] || null;
      
      case "USER_CAR":
        return userCar || sorted[0] || null;
      
      case "FINISH_LINE":
        return sorted[0] || null;
      
      case "CINEMATIC": {
        // Mostly follow user car (70% of time), occasionally show leader or pack
        const cycleTime = Math.floor(cinematicTimeRef.current / SHOT_CHANGE_INTERVAL);
        const cycle = cycleTime % 10;
        
        // 7 out of 10 cycles: user car
        // 2 out of 10 cycles: leader  
        // 1 out of 10 cycles: second place
        if (cycle < 7) {
          return userCar || sorted[0];
        } else if (cycle < 9) {
          return sorted[0];
        } else {
          return sorted[1] || sorted[0];
        }
      }
      
      default:
        return userCar || sorted[0] || null;
    }
  };
  
  // Select cinematic shot type
  const selectCinematicShot = (targetCar: RaceParticipant, sorted: RaceParticipant[]): CinematicShot => {
    const time = Math.floor(cinematicTimeRef.current / SHOT_CHANGE_INTERVAL);
    const isUserCar = targetCar.car.id === userCarId;
    const userPosition = sorted.findIndex(p => p.car.id === userCarId) + 1;
    
    // Check for overtake opportunities
    const hasCloseCompetition = sorted.length >= 2 && 
      Math.abs(sorted[0].progress - sorted[1].progress) < 0.03;
    
    if (hasCloseCompetition) {
      return "overtake_setup";
    }
    
    if (isUserCar && userPosition <= 2) {
      return "hero_angle";
    }
    
    // Cycle through shots
    const shots: CinematicShot[] = [
      "chase_high",
      "side_tracking",
      "chase_low",
      "wide_pack",
      "hero_angle",
      "chase_high",
    ];
    
    return shots[time % shots.length];
  };
  
  // Calculate camera position for a specific shot type
  const calculateShotPosition = (
    shot: CinematicShot,
    targetCar: RaceParticipant,
    preset: typeof CAMERA_PRESETS["CINEMATIC"],
    time: number,
    speedFactor: number
  ): { position: Vector3; lookAt: Vector3 } => {
    const carZ = targetCar.progress * TRACK_CONFIG.totalDistance;
    const carX = getTrackPosition(targetCar.progress, targetCar.laneIndex).x;
    const carY = 0.5;
    
    switch (shot) {
      case "chase_high": {
        // High behind angle with slight orbit
        const orbitAngle = Math.sin(time * 0.15) * 0.3;
        const height = preset.height + 3 + speedFactor * 2;
        const distance = preset.distanceBehind + 5;
        
        return {
          position: new Vector3(
            carX + Math.sin(orbitAngle) * preset.sideOffset * 0.5,
            height,
            carZ - distance
          ),
          lookAt: new Vector3(carX, carY + 1, carZ + preset.lookAheadDistance)
        };
      }
      
      case "chase_low": {
        // Low dramatic angle
        const sway = Math.sin(time * 0.2) * 2;
        return {
          position: new Vector3(
            carX + sway,
            2.5 + speedFactor,
            carZ - preset.distanceBehind - 2
          ),
          lookAt: new Vector3(carX, carY + 0.5, carZ + preset.lookAheadDistance * 0.8)
        };
      }
      
      case "side_tracking": {
        // Side view that tracks alongside
        const side = Math.sin(time * 0.1) > 0 ? 1 : -1;
        const sideDistance = TRACK_CONFIG.trackWidth * 0.6;
        
        return {
          position: new Vector3(
            carX + side * sideDistance,
            4 + Math.sin(time * 0.3) * 1.5,
            carZ - 5 + Math.sin(time * 0.2) * 3
          ),
          lookAt: new Vector3(carX, carY + 0.8, carZ + 8)
        };
      }
      
      case "wide_pack": {
        // Wide shot showing the pack
        const sorted = getSortedParticipants();
        const avgZ = sorted.reduce((sum, p) => sum + p.progress, 0) / sorted.length * TRACK_CONFIG.totalDistance;
        const swing = Math.sin(time * 0.1) * preset.sideOffset;
        
        return {
          position: new Vector3(
            swing,
            preset.height + 10,
            avgZ - preset.distanceBehind - 20
          ),
          lookAt: new Vector3(0, 0, avgZ + 30)
        };
      }
      
      case "hero_angle": {
        // Dynamic hero shot on the target car
        const orbitSpeed = 0.2;
        const orbitRadius = preset.distanceBehind * 0.8;
        const angle = time * orbitSpeed;
        const heightWave = Math.sin(time * 0.25) * 2;
        
        return {
          position: new Vector3(
            carX + Math.sin(angle) * orbitRadius * 0.6,
            preset.height + heightWave,
            carZ - Math.cos(angle) * orbitRadius
          ),
          lookAt: new Vector3(carX, carY + 1.2, carZ + preset.lookAheadDistance * 0.7)
        };
      }
      
      case "overtake_setup": {
        // Position to capture overtake action
        const sorted = getSortedParticipants();
        const leader = sorted[0];
        const challenger = sorted[1];
        
        if (leader && challenger) {
          const midZ = (leader.progress + challenger.progress) / 2 * TRACK_CONFIG.totalDistance;
          const midX = (getTrackPosition(leader.progress, leader.laneIndex).x + 
                       getTrackPosition(challenger.progress, challenger.laneIndex).x) / 2;
          
          return {
            position: new Vector3(
              midX + preset.sideOffset * 0.8,
              preset.height - 1,
              midZ - preset.distanceBehind * 0.6
            ),
            lookAt: new Vector3(midX, carY + 0.5, midZ + 15)
          };
        }
        
        // Fallback to chase high
        return calculateShotPosition("chase_high", targetCar, preset, time, speedFactor);
      }
    }
  };
  
  // Automatic camera mode switching - MINIMAL switching for smooth viewing
  useEffect(() => {
    if (raceState !== "RACING") return;
    
    // Start in cinematic mode (which focuses mostly on user car)
    setCameraMode("CINEMATIC");
    
    const interval = setInterval(() => {
      const sorted = getSortedParticipants();
      if (sorted.length === 0) return;
      
      const leader = sorted[0];
      
      // Only switch modes at key moments:
      
      // Very near finish (last 5%) - switch to finish line view
      if (leader && leader.progress > 0.95) {
        setCameraMode("FINISH_LINE");
        return;
      }
      
      // Otherwise stay in CINEMATIC mode (which handles user car focus)
      if (cameraState.mode !== "CINEMATIC" && leader.progress < 0.95) {
        setCameraMode("CINEMATIC");
      }
    }, CAMERA_SWITCH_INTERVAL * 1000);
    
    return () => clearInterval(interval);
  }, [raceState, participants, setCameraMode, cameraState.mode]);
  
  // Main camera animation loop
  useFrame((_state, delta) => {
    if (!enabled) return;
    
    const preset = CAMERA_PRESETS[cameraState.mode];
    const targetCar = getTargetCar();
    const sorted = getSortedParticipants();
    
    // Increment cinematic time
    cinematicTimeRef.current += delta;
    
    // Calculate camera position based on mode
    if (cameraState.mode === "OVERVIEW" || !targetCar) {
      // Bird's eye view following the pack
      const avgZ = participants.length > 0
        ? participants.reduce((sum, p) => sum + p.progress, 0) / participants.length * TRACK_CONFIG.totalDistance
        : 100;
      
      const swingAngle = Math.sin(cinematicTimeRef.current * 0.08) * 0.4;
      
      targetPositionRef.current.set(
        Math.sin(swingAngle) * preset.sideOffset,
        preset.height,
        avgZ - preset.distanceBehind
      );
      targetLookAtRef.current.set(0, 2, avgZ + preset.lookAheadDistance);
      
    } else {
      // Calculate speed for dynamic effects
      const speedFactor = Math.min(1, targetCar.currentSpeed / 140);
      
      if (cameraState.mode === "CINEMATIC") {
        // Select and apply cinematic shot
        const shot = selectCinematicShot(targetCar, sorted);
        
        // Update shot if changed
        if (shot !== currentShotRef.current) {
          currentShotRef.current = shot;
          shotChangeTimeRef.current = cinematicTimeRef.current;
        }
        
        const { position, lookAt } = calculateShotPosition(
          shot,
          targetCar,
          preset,
          cinematicTimeRef.current,
          speedFactor
        );
        
        targetPositionRef.current.copy(position);
        targetLookAtRef.current.copy(lookAt);
        
      } else if (cameraState.mode === "FINISH_LINE") {
        // Dramatic finish line camera
        const finishZ = TRACK_CONFIG.totalDistance;
        const carZ = targetCar.progress * TRACK_CONFIG.totalDistance;
        const swayAmount = Math.sin(cinematicTimeRef.current * 0.3) * preset.sideOffset * 0.5;
        
        targetPositionRef.current.set(
          swayAmount,
          preset.height + 2,
          finishZ + 15
        );
        targetLookAtRef.current.set(0, 0.5, carZ);
        
      } else {
        // Standard chase camera (LEADER or USER_CAR modes)
        const carZ = targetCar.progress * TRACK_CONFIG.totalDistance;
        const carX = getTrackPosition(targetCar.progress, targetCar.laneIndex).x;
        const carY = 0.5;
        
        // Dynamic height and distance based on speed
        const dynamicHeight = preset.height + speedFactor * 2.5;
        const dynamicDistance = preset.distanceBehind + speedFactor * 4;
        
        // Gentle side drift for visual interest
        const sideDrift = Math.sin(cinematicTimeRef.current * 0.25) * preset.sideOffset * 0.4;
        
        targetPositionRef.current.set(
          carX + sideDrift,
          dynamicHeight,
          carZ - dynamicDistance
        );
        
        targetLookAtRef.current.set(
          carX,
          carY + 1.5,
          carZ + preset.lookAheadDistance
        );
      }
      
      // Speed-based camera shake (subtle high-frequency vibration)
      if (speedFactor > 0.65) {
        const shakeIntensity = (speedFactor - 0.65) * 0.25;
        const shake = {
          x: (Math.random() - 0.5) * shakeIntensity,
          y: (Math.random() - 0.5) * shakeIntensity * 0.4,
        };
        cameraShakeRef.current.x = MathUtils.lerp(cameraShakeRef.current.x, shake.x, 0.3);
        cameraShakeRef.current.y = MathUtils.lerp(cameraShakeRef.current.y, shake.y, 0.3);
      } else {
        cameraShakeRef.current.x *= 0.85;
        cameraShakeRef.current.y *= 0.85;
      }
      
      // Speed-based FOV (wider FOV = more speed sensation)
      const targetFov = MathUtils.lerp(preset.baseFov, preset.maxFov, speedFactor);
      currentFovRef.current = MathUtils.lerp(currentFovRef.current, targetFov, delta * 1.5);
      (camera as PerspectiveCamera).fov = currentFovRef.current;
      (camera as PerspectiveCamera).updateProjectionMatrix();
    }
    
    // Spring-based camera position interpolation (smoother than lerp)
    const springStrength = cameraState.mode === "CINEMATIC" ? 2 : 4;
    const damping = 0.75;
    
    const diff = targetPositionRef.current.clone().sub(currentPositionRef.current);
    velocityRef.current.add(diff.multiplyScalar(springStrength * delta));
    velocityRef.current.multiplyScalar(damping);
    currentPositionRef.current.add(velocityRef.current);
    
    camera.position.copy(currentPositionRef.current);
    
    // Apply camera shake
    camera.position.x += cameraShakeRef.current.x;
    camera.position.y += cameraShakeRef.current.y;
    
    // Smooth look-at interpolation
    const lookLerpFactor = cameraState.mode === "CINEMATIC" ? 0.035 : 0.065;
    smoothLookAtRef.current.lerp(targetLookAtRef.current, lookLerpFactor);
    camera.lookAt(smoothLookAtRef.current);
  });
  
  // Set initial camera position based on race state
  useEffect(() => {
    if (raceState === "IDLE" || raceState === "MATCHMAKING" || raceState === "COUNTDOWN") {
      // Starting position - dramatic overview of start line
      const startPos = new Vector3(15, 20, -25);
      camera.position.copy(startPos);
      currentPositionRef.current.copy(startPos);
      velocityRef.current.set(0, 0, 0);
      
      camera.lookAt(0, 0, 40);
      smoothLookAtRef.current.set(0, 0, 40);
      targetLookAtRef.current.set(0, 0, 40);
      
      (camera as PerspectiveCamera).fov = 55;
      (camera as PerspectiveCamera).updateProjectionMatrix();
      currentFovRef.current = 55;
    }
  }, [raceState, camera]);
  
  return null;
}

export default RaceCamera;
