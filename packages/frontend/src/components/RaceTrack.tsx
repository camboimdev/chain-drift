import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3, RepeatWrapping, CanvasTexture, MeshStandardMaterial } from "three";
import type { Mesh, Group } from "three";
import { useRaceStore } from "../stores/raceStore";
import { TRACK_CONFIG, LANE_WIDTH, getLanePosition } from "../config/trackConfig";

// Re-export config for backward compatibility
export { TRACK_CONFIG, LANE_WIDTH, getLanePosition } from "../config/trackConfig";

/**
 * Get world position for a car given its progress (0-1) and lane
 */
export function getTrackPosition(progress: number, laneIndex: number): Vector3 {
  const z = progress * TRACK_CONFIG.totalDistance;
  const x = getLanePosition(laneIndex);
  return new Vector3(x, 0, z);
}

/**
 * Get rotation (cars face +Z direction)
 */
export function getTrackRotation(_progress: number): number {
  return 0; // Facing +Z
}

/**
 * Check if position is at a "corner" - for forward track, we don't have corners
 * but we can add slight variations or chicanes later
 */
export function isAtCorner(_progress: number): boolean {
  return false;
}

// ============================================
// Grid Texture Generator - Tron Style
// ============================================

function createGridTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  
  // Very dark background with slight blue tint
  ctx.fillStyle = "#050510";
  ctx.fillRect(0, 0, 512, 512);
  
  const gridStep = 64; // pixels per grid cell
  
  // Main grid lines - cyan/blue glow
  ctx.strokeStyle = "#0a3050";
  ctx.lineWidth = 1;
  
  // Vertical lines
  for (let x = 0; x <= 512; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }
  
  // Horizontal lines
  for (let y = 0; y <= 512; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }
  
  // Secondary finer grid
  ctx.strokeStyle = "#061828";
  ctx.lineWidth = 0.5;
  const fineStep = gridStep / 4;
  
  for (let x = 0; x <= 512; x += fineStep) {
    if (x % gridStep !== 0) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 512);
      ctx.stroke();
    }
  }
  
  for (let y = 0; y <= 512; y += fineStep) {
    if (y % gridStep !== 0) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }
  }
  
  // Glowing intersections - cyan dots
  ctx.shadowColor = "#00ffff";
  ctx.shadowBlur = 4;
  ctx.fillStyle = "#00aaaa";
  for (let x = 0; x <= 512; x += gridStep) {
    for (let y = 0; y <= 512; y += gridStep) {
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(
    TRACK_CONFIG.trackWidth / TRACK_CONFIG.gridSize,
    TRACK_CONFIG.chunkLength / TRACK_CONFIG.gridSize
  );
  
  return texture;
}

// ============================================
// Track Chunk Component
// ============================================

interface TrackChunkProps {
  chunkIndex: number;
  leadCarZ: number;
}

function TrackChunk({ chunkIndex }: TrackChunkProps) {
  const chunkZ = chunkIndex * TRACK_CONFIG.chunkLength + TRACK_CONFIG.chunkLength / 2;
  
  const gridTexture = useMemo(() => createGridTexture(), []);
  
  // Lane divider positions
  const laneDividers = useMemo(() => {
    const dividers: number[] = [];
    const halfWidth = TRACK_CONFIG.trackWidth / 2;
    for (let i = 1; i < TRACK_CONFIG.laneCount; i++) {
      dividers.push(-halfWidth + i * LANE_WIDTH);
    }
    return dividers;
  }, []);
  
  return (
    <group position={[0, 0, chunkZ]}>
      {/* Floor with grid texture - Tron style */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
        <planeGeometry args={[TRACK_CONFIG.trackWidth, TRACK_CONFIG.chunkLength]} />
        <meshStandardMaterial 
          map={gridTexture}
          roughness={0.85}
          metalness={0.15}
          emissive="#001020"
          emissiveIntensity={0.1}
        />
      </mesh>
      
      {/* Left neon rail - brighter cyan */}
      <mesh 
        position={[-TRACK_CONFIG.trackWidth / 2 - TRACK_CONFIG.railWidth / 2, TRACK_CONFIG.railHeight / 2, 0]}
        castShadow
      >
        <boxGeometry args={[TRACK_CONFIG.railWidth, TRACK_CONFIG.railHeight, TRACK_CONFIG.chunkLength]} />
        <meshStandardMaterial 
          color="#00ddff"
          emissive="#00ffff"
          emissiveIntensity={1.2}
          toneMapped={false}
        />
      </mesh>
      
      {/* Right neon rail */}
      <mesh 
        position={[TRACK_CONFIG.trackWidth / 2 + TRACK_CONFIG.railWidth / 2, TRACK_CONFIG.railHeight / 2, 0]}
        castShadow
      >
        <boxGeometry args={[TRACK_CONFIG.railWidth, TRACK_CONFIG.railHeight, TRACK_CONFIG.chunkLength]} />
        <meshStandardMaterial 
          color="#00ddff"
          emissive="#00ffff"
          emissiveIntensity={1.2}
          toneMapped={false}
        />
      </mesh>
      
      {/* Inner rail glow strips (floor level) */}
      <mesh 
        position={[-TRACK_CONFIG.trackWidth / 2 + 0.2, 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[0.3, TRACK_CONFIG.chunkLength]} />
        <meshStandardMaterial 
          color="#00ffff"
          emissive="#00ffff"
          emissiveIntensity={0.6}
          transparent
          opacity={0.4}
        />
      </mesh>
      <mesh 
        position={[TRACK_CONFIG.trackWidth / 2 - 0.2, 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[0.3, TRACK_CONFIG.chunkLength]} />
        <meshStandardMaterial 
          color="#00ffff"
          emissive="#00ffff"
          emissiveIntensity={0.6}
          transparent
          opacity={0.4}
        />
      </mesh>
      
      {/* Lane divider lines - subtle cyan dashes */}
      {laneDividers.map((x, dividerIndex) => (
        <group key={`divider-${dividerIndex}`}>
          {Array.from({ length: 10 }).map((_, i) => (
            <mesh 
              key={`dash-${i}`}
              position={[x, 0.015, (i - 4.5) * 5]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <planeGeometry args={[0.08, 2.5]} />
              <meshStandardMaterial 
                color="#006688"
                emissive="#00aacc"
                emissiveIntensity={0.4}
                transparent
                opacity={0.5}
              />
            </mesh>
          ))}
        </group>
      ))}
      
      {/* Distance markers - magenta accent */}
      {chunkIndex > 0 && chunkIndex % 4 === 0 && (
        <mesh position={[0, 0.02, -TRACK_CONFIG.chunkLength / 2 + 1]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[TRACK_CONFIG.trackWidth, 0.8]} />
          <meshStandardMaterial 
            color="#ff00ff"
            emissive="#ff00ff"
            emissiveIntensity={0.8}
            transparent
            opacity={0.5}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
}

// ============================================
// Start Line Component
// ============================================

function StartLine() {
  const startLineRef = useRef<Mesh>(null);
  
  useFrame(({ clock }) => {
    if (startLineRef.current) {
      const mat = startLineRef.current.material as MeshStandardMaterial;
      mat.emissiveIntensity = 0.8 + Math.sin(clock.elapsedTime * 3) * 0.4;
    }
  });
  
  return (
    <group position={[0, 0, 0]}>
      {/* Start line glow - cyan neon */}
      <mesh ref={startLineRef} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[TRACK_CONFIG.trackWidth, 2.5]} />
        <meshStandardMaterial 
          color="#00ffcc"
          emissive="#00ffcc"
          emissiveIntensity={0.8}
          transparent
          opacity={0.7}
          toneMapped={false}
        />
      </mesh>
      
      {/* Checkered pattern with glow */}
      {Array.from({ length: 12 }).map((_, i) => (
        <mesh
          key={`checker-${i}`}
          position={[(i - 5.5) * 2, 0.025, i % 2 === 0 ? -0.5 : 0.5]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[1.8, 0.8]} />
          <meshStandardMaterial 
            color={i % 2 === 0 ? "#050510" : "#ffffff"} 
            emissive={i % 2 === 0 ? "#000000" : "#ffffff"}
            emissiveIntensity={i % 2 === 0 ? 0 : 0.3}
          />
        </mesh>
      ))}
      
      {/* Start gate pillars - dark with cyan accent */}
      <mesh position={[-TRACK_CONFIG.trackWidth / 2 - 1, 4, 0]} castShadow>
        <boxGeometry args={[0.6, 8, 0.6]} />
        <meshStandardMaterial color="#0a0a15" metalness={0.9} roughness={0.1} />
      </mesh>
      <mesh position={[TRACK_CONFIG.trackWidth / 2 + 1, 4, 0]} castShadow>
        <boxGeometry args={[0.6, 8, 0.6]} />
        <meshStandardMaterial color="#0a0a15" metalness={0.9} roughness={0.1} />
      </mesh>
      
      {/* Pillar accent strips */}
      <mesh position={[-TRACK_CONFIG.trackWidth / 2 - 1, 4, 0.35]}>
        <boxGeometry args={[0.1, 7.5, 0.1]} />
        <meshStandardMaterial 
          color="#00ffff"
          emissive="#00ffff"
          emissiveIntensity={1}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[TRACK_CONFIG.trackWidth / 2 + 1, 4, 0.35]}>
        <boxGeometry args={[0.1, 7.5, 0.1]} />
        <meshStandardMaterial 
          color="#00ffff"
          emissive="#00ffff"
          emissiveIntensity={1}
          toneMapped={false}
        />
      </mesh>
      
      {/* Start gate top - neon cyan bar */}
      <mesh position={[0, 8, 0]}>
        <boxGeometry args={[TRACK_CONFIG.trackWidth + 3, 0.4, 0.4]} />
        <meshStandardMaterial 
          color="#00ffff"
          emissive="#00ffff"
          emissiveIntensity={1.5}
          toneMapped={false}
        />
      </mesh>
      
      {/* "START" indicator light */}
      <pointLight 
        position={[0, 8.5, 0]} 
        intensity={15} 
        distance={20} 
        color="#00ffff"
      />
    </group>
  );
}

// ============================================
// Finish Line Component
// ============================================

function FinishLine() {
  const finishZ = TRACK_CONFIG.totalDistance;
  const finishLineRef = useRef<Mesh>(null);
  
  useFrame(({ clock }) => {
    if (finishLineRef.current) {
      const mat = finishLineRef.current.material as MeshStandardMaterial;
      mat.emissiveIntensity = 1 + Math.sin(clock.elapsedTime * 4) * 0.5;
    }
  });
  
  return (
    <group position={[0, 0, finishZ]}>
      {/* Finish line glow - magenta/pink */}
      <mesh ref={finishLineRef} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[TRACK_CONFIG.trackWidth, 4]} />
        <meshStandardMaterial 
          color="#ff00ff"
          emissive="#ff00ff"
          emissiveIntensity={1}
          transparent
          opacity={0.7}
          toneMapped={false}
        />
      </mesh>
      
      {/* Checkered finish pattern */}
      {Array.from({ length: 12 }).map((_, i) => (
        <mesh
          key={`finish-checker-${i}`}
          position={[(i - 5.5) * 2, 0.025, i % 2 === 0 ? -1 : 1]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[1.8, 1.5]} />
          <meshStandardMaterial 
            color={i % 2 === 0 ? "#050510" : "#ffffff"} 
            emissive={i % 2 === 0 ? "#000000" : "#ffffff"}
            emissiveIntensity={i % 2 === 0 ? 0 : 0.4}
          />
        </mesh>
      ))}
      
      {/* Finish gate pillars - dark with magenta accent */}
      <mesh position={[-TRACK_CONFIG.trackWidth / 2 - 1, 5, 0]} castShadow>
        <boxGeometry args={[0.8, 10, 0.8]} />
        <meshStandardMaterial color="#0a0a15" metalness={0.9} roughness={0.1} />
      </mesh>
      <mesh position={[TRACK_CONFIG.trackWidth / 2 + 1, 5, 0]} castShadow>
        <boxGeometry args={[0.8, 10, 0.8]} />
        <meshStandardMaterial color="#0a0a15" metalness={0.9} roughness={0.1} />
      </mesh>
      
      {/* Pillar magenta accent strips */}
      <mesh position={[-TRACK_CONFIG.trackWidth / 2 - 1, 5, 0.45]}>
        <boxGeometry args={[0.1, 9.5, 0.1]} />
        <meshStandardMaterial 
          color="#ff00ff"
          emissive="#ff00ff"
          emissiveIntensity={1.2}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[TRACK_CONFIG.trackWidth / 2 + 1, 5, 0.45]}>
        <boxGeometry args={[0.1, 9.5, 0.1]} />
        <meshStandardMaterial 
          color="#ff00ff"
          emissive="#ff00ff"
          emissiveIntensity={1.2}
          toneMapped={false}
        />
      </mesh>
      
      {/* Finish gate top - intense magenta bar */}
      <mesh position={[0, 10, 0]}>
        <boxGeometry args={[TRACK_CONFIG.trackWidth + 3, 0.6, 0.6]} />
        <meshStandardMaterial 
          color="#ff00ff"
          emissive="#ff00ff"
          emissiveIntensity={2}
          toneMapped={false}
        />
      </mesh>
      
      {/* "FINISH" lights */}
      <pointLight 
        position={[0, 10.5, 0]} 
        intensity={25} 
        distance={30} 
        color="#ff00ff"
      />
      <pointLight 
        position={[-8, 6, 0]} 
        intensity={10} 
        distance={15} 
        color="#ff00ff"
      />
      <pointLight 
        position={[8, 6, 0]} 
        intensity={10} 
        distance={15} 
        color="#ff00ff"
      />
    </group>
  );
}

// ============================================
// Rail Lights (periodic neon accents)
// ============================================

function RailLights({ leadCarZ }: { leadCarZ: number }) {
  const lights = useMemo(() => {
    const result: number[] = [];
    for (let z = 0; z <= TRACK_CONFIG.totalDistance; z += 100) {
      result.push(z);
    }
    return result;
  }, []);
  
  // Only render lights near the lead car
  const visibleLights = lights.filter(
    z => z >= leadCarZ - 100 && z <= leadCarZ + TRACK_CONFIG.chunkLength * TRACK_CONFIG.visibleChunks
  );
  
  return (
    <>
      {visibleLights.map(z => (
        <group key={`lights-${z}`} position={[0, 0, z]}>
          {/* Left light */}
          <pointLight 
            position={[-TRACK_CONFIG.trackWidth / 2, 2, 0]} 
            intensity={5} 
            distance={30} 
            color="#00ffff"
          />
          {/* Right light */}
          <pointLight 
            position={[TRACK_CONFIG.trackWidth / 2, 2, 0]} 
            intensity={5} 
            distance={30} 
            color="#00ffff"
          />
        </group>
      ))}
    </>
  );
}

// ============================================
// Main RaceTrack Component
// ============================================

interface RaceTrackProps {
  showPath?: boolean;
  showBarriers?: boolean;
}

export function RaceTrack({ showPath = true }: RaceTrackProps) {
  const trackGroupRef = useRef<Group>(null);
  // Get lead car position for chunk streaming
  const participants = useRaceStore(state => state.participants);
  
  // Calculate lead car Z position
  const leadCarZ = useMemo(() => {
    if (participants.length === 0) return 0;
    const leader = participants.reduce((prev, curr) => 
      curr.progress > prev.progress ? curr : prev
    );
    return leader.progress * TRACK_CONFIG.totalDistance;
  }, [participants]);
  
  // Determine which chunks should be visible
  const visibleChunks = useMemo(() => {
    const currentChunk = Math.floor(leadCarZ / TRACK_CONFIG.chunkLength);
    const chunks: number[] = [];
    
    const startChunk = Math.max(0, currentChunk - TRACK_CONFIG.behindChunks);
    const endChunk = Math.min(
      Math.ceil(TRACK_CONFIG.totalDistance / TRACK_CONFIG.chunkLength),
      currentChunk + TRACK_CONFIG.visibleChunks
    );
    
    for (let i = startChunk; i <= endChunk; i++) {
      chunks.push(i);
    }
    
    return chunks;
  }, [leadCarZ]);
  
  return (
    <group ref={trackGroupRef}>
      {/* Ambient ground plane (extends beyond track) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, TRACK_CONFIG.totalDistance / 2]} receiveShadow>
        <planeGeometry args={[200, TRACK_CONFIG.totalDistance + 200]} />
        <meshStandardMaterial color="#050510" roughness={1} />
      </mesh>
      
      {/* Track chunks (streaming) */}
      {showPath && visibleChunks.map(chunkIndex => (
        <TrackChunk 
          key={`chunk-${chunkIndex}`} 
          chunkIndex={chunkIndex}
          leadCarZ={leadCarZ}
        />
      ))}
      
      {/* Start line - always visible at start */}
      <StartLine />
      
      {/* Finish line - only render when approaching */}
      {leadCarZ > TRACK_CONFIG.totalDistance - TRACK_CONFIG.chunkLength * TRACK_CONFIG.visibleChunks && (
        <FinishLine />
      )}
      
      {/* Periodic rail lights */}
      <RailLights leadCarZ={leadCarZ} />
      
      {/* Ambient track lighting */}
      <ambientLight intensity={0.15} />
      <directionalLight 
        position={[0, 50, leadCarZ]} 
        intensity={0.5} 
        color="#8888ff"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={100}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
      />
    </group>
  );
}

export default RaceTrack;

// Re-export for compatibility - legacy CORNER_POSITIONS is empty for linear track
export const CORNER_POSITIONS: number[] = [];
export const trackCurve = null; // No curve for linear track
