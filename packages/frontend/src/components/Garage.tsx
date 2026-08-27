import {
  ContactShadows,
  Environment,
  MeshReflectorMaterial,
  OrbitControls,
  Text,
  Float,
} from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Group, Vector3 } from "three";
import type { OrbitControls as OrbitControlsType } from "three/examples/jsm/controls/OrbitControls.js";
import type { CarNFT } from "@chain-drift/shared";
import { Car3D } from "./Car3D";
import { CarHUD } from "./CarHUD";
import { WalletHUD } from "./WalletHeader";
import { GarageEmptyState } from "./GarageEmptyState";

const DS = {
  bg: "#000000",
  surface: "#111111",
  border: "#2A2A2A",
  divider: "#1A1A1A",
  textPrimary: "#FFFFFF",
  textSecondary: "#E5E5E5",
  textMeta: "#BFBFBF",
  textDisabled: "#3A3A3A",
  font: "'JetBrains Mono', monospace",
};

interface GarageProps {
  cars: CarNFT[];
  /** True while the on-chain read is in flight — an empty list is not yet news. */
  loading?: boolean;
  playerId: string;
  onStartRace?: (carId: string) => void;
  onMintSuccess?: () => void;
  onOpenLeaderboard?: () => void;
}

// ─── Carousel slot system ────────────────────────────────────────────────────

type SlotRole = "featured" | "left" | "right" | "exit-left" | "exit-right";

interface VisibleSlot {
  car: CarNFT;
  role: SlotRole;
  entryPos?: [number, number, number];
}

const SLOT_TARGETS: Record<
  SlotRole,
  {
    pos: [number, number, number];
    rotY: number;
    scale: number;
    dimmed: boolean;
    platformR: number;
    platformRI: number;
    platformSeg: number;
  }
> = {
  featured:    { pos: [0, 0, 0],        rotY: -Math.PI / 6,  scale: 1.0, dimmed: false, platformR: 5,   platformRI: 5.2, platformSeg: 64 },
  left:        { pos: [-9.5, 0, -2.5],  rotY: Math.PI / 7,   scale: 0.8, dimmed: true,  platformR: 3.5, platformRI: 3.7, platformSeg: 48 },
  right:       { pos: [9.5, 0, -2.5],   rotY: -Math.PI / 7,  scale: 0.8, dimmed: true,  platformR: 3.5, platformRI: 3.7, platformSeg: 48 },
  "exit-left":  { pos: [-22, 0, -5],    rotY: Math.PI / 7,   scale: 0.3, dimmed: true,  platformR: 3.5, platformRI: 3.7, platformSeg: 48 },
  "exit-right": { pos: [22, 0, -5],     rotY: -Math.PI / 7,  scale: 0.3, dimmed: true,  platformR: 3.5, platformRI: 3.7, platformSeg: 48 },
};

function computeActiveSlots(cars: CarNFT[], idx: number): VisibleSlot[] {
  const total = cars.length;
  if (total === 0) return [];
  const slots: VisibleSlot[] = [{ car: cars[idx], role: "featured" }];
  if (total >= 2) slots.push({ car: cars[(idx - 1 + total) % total], role: "left" });
  if (total >= 3) slots.push({ car: cars[(idx + 1) % total], role: "right" });
  return slots;
}

// ─── AnimatedGroup ───────────────────────────────────────────────────────────
// Keeps its own position/scale/rotY in refs and lerps toward targets every frame.
// key={car.id} in parent ensures the same instance is reused when a car changes
// slots — so it smoothly lerps from its current position to the new target.

function AnimatedGroup({
  targetPos,
  targetRotY,
  targetScale,
  entryPos,
  children,
}: {
  targetPos: [number, number, number];
  targetRotY: number;
  targetScale: number;
  entryPos?: [number, number, number];
  children: React.ReactNode;
}) {
  const groupRef = useRef<Group>(null);
  // Initialise at entryPos (off-screen) when the car is newly entering the scene.
  const animPos = useRef(new Vector3(...(entryPos ?? targetPos)));
  const animScale = useRef(entryPos ? 0.3 : targetScale);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const tPos   = Math.min(1, 6 * delta);
    const tScale = Math.min(1, 8 * delta);

    animPos.current.lerp(new Vector3(...targetPos), tPos);
    animScale.current += (targetScale - animScale.current) * tScale;

    groupRef.current.position.copy(animPos.current);
    groupRef.current.scale.setScalar(animScale.current);

    // Smooth rotation — wrap delta to [-π, π] to avoid spinning the wrong way
    let dr = targetRotY - groupRef.current.rotation.y;
    if (dr > Math.PI)  dr -= 2 * Math.PI;
    if (dr < -Math.PI) dr += 2 * Math.PI;
    groupRef.current.rotation.y += dr * tPos;
  });

  return <group ref={groupRef}>{children}</group>;
}

// ─── Environment ─────────────────────────────────────────────────────────────

function ShowroomEnvironment() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <MeshReflectorMaterial
          blur={[300, 100]}
          resolution={1024}
          mixBlur={1}
          mixStrength={60}
          roughness={0.4}
          depthScale={1.2}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          color="#1a1a1a"
          metalness={0.6}
          mirror={0}
        />
      </mesh>

      {[-20, 20].map((x) => (
        <group key={x}>
          {[-20, 0, 20].map((z) => (
            <mesh key={z} position={[x, 10, z]} receiveShadow castShadow>
              <boxGeometry args={[2, 20, 2]} />
              <meshStandardMaterial color="#333" roughness={0.2} metalness={0.8} />
            </mesh>
          ))}
        </group>
      ))}

      <mesh position={[0, 19, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial color="#111" />
      </mesh>

      <mesh position={[0, 10, -30]}>
        <planeGeometry args={[100, 20]} />
        <meshStandardMaterial color="#222" roughness={0.8} />
      </mesh>

      <mesh position={[0, 5, -29.5]}>
        <boxGeometry args={[100, 0.5, 0.5]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
    </group>
  );
}

// ─── Camera controllers ───────────────────────────────────────────────────────

function StudioCameraSetup() {
  const { camera } = useThree();
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current) {
      camera.position.set(4, 3, 7);
      camera.lookAt(0, 0.5, 0);
      initialized.current = true;
    }
  }, [camera]);
  return null;
}

const GALLERY_POS  = new Vector3(0, 4.5, 15);
const GALLERY_LOOK = new Vector3(0, 0.8, 0);

function GalleryCameraController() {
  useFrame((state, delta) => {
    const d = 4 * delta;
    state.camera.position.lerp(GALLERY_POS, d);
    const controls = state.controls as unknown as OrbitControlsType;
    if (controls) {
      controls.target.lerp(GALLERY_LOOK, d);
      controls.update();
    }
  });
  return null;
}

// ─── GarageScene ─────────────────────────────────────────────────────────────

function LoadingText() {
  return (
    <Text position={[0, 2, 0]} fontSize={1} color="#333" anchorX="center" anchorY="middle">
      Loading Garage...
    </Text>
  );
}

function GarageScene({
  visibleSlots,
  featuredCar,
  onCarSelect,
  onCarOpen,
  viewMode,
}: {
  visibleSlots: VisibleSlot[];
  featuredCar: CarNFT | null;
  onCarSelect: (carId: string) => void;
  onCarOpen:  (carId: string) => void;
  viewMode: "Gallery" | "Studio";
}) {
  return (
    <>
      <Environment preset="city" environmentIntensity={0.5} />
      <ambientLight intensity={0.4} />

      <spotLight
        position={[20, 30, 20]}
        angle={0.3}
        penumbra={1}
        intensity={2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        color="#fffaee"
      />
      <spotLight
        position={[-20, 20, -20]}
        angle={0.5}
        penumbra={1}
        intensity={2}
        color="#d0eaff"
      />
      {/* Dedicated featured-car spotlight */}
      <spotLight
        position={[0, 15, 3]}
        angle={0.25}
        penumbra={0.8}
        intensity={3.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        color="#ffffff"
      />

      <ShowroomEnvironment />

      <ContactShadows
        opacity={0.6}
        scale={100}
        blur={1}
        far={4}
        resolution={1024}
        color="#000000"
      />

      {/* Studio mode: single car */}
      {viewMode === "Studio" && featuredCar && (
        <group rotation={[0, -Math.PI / 6, 0]}>
          <Car3D
            tokenId={featuredCar.tokenId}
            position={[0, 0.1, 0]}
            isSelected
            interactive
          />
        </group>
      )}

      {/* Gallery carousel: animated slots */}
      {viewMode === "Gallery" && visibleSlots.map((slot) => {
        const t = SLOT_TARGETS[slot.role];
        const isFeatured = slot.role === "featured";
        const isExiting  = slot.role === "exit-left" || slot.role === "exit-right";

        return (
          <AnimatedGroup
            key={slot.car.id}
            targetPos={t.pos}
            targetRotY={t.rotY}
            targetScale={t.scale}
            entryPos={slot.entryPos}
          >
            {/* Platform disc — not rendered for exiting cars */}
            {!isExiting && (
              <mesh position={[0, 0.05, 0]} receiveShadow>
                <cylinderGeometry args={[t.platformR, t.platformRI, 0.1, t.platformSeg]} />
                <meshStandardMaterial
                  color={isFeatured ? "#444444" : "#222222"}
                  emissive={isFeatured ? "#222222" : "#111111"}
                  roughness={0.2}
                  metalness={0.8}
                />
              </mesh>
            )}

            {isFeatured ? (
              <Float speed={2} rotationIntensity={0.1} floatIntensity={0.5}>
                <Car3D
                  tokenId={slot.car.tokenId}
                  position={[0, 0.5, 0]}
                  isSelected
                  interactive
                  onClick={() => onCarOpen(slot.car.id)}
                />
              </Float>
            ) : (
              <Car3D
                tokenId={slot.car.tokenId}
                position={[0, 0.1, 0]}
                dimmed
                interactive
                onClick={isExiting ? undefined : () => onCarSelect(slot.car.id)}
              />
            )}
          </AnimatedGroup>
        );
      })}

      {viewMode === "Gallery" ? <GalleryCameraController /> : <StudioCameraSetup />}

      {/* One controls instance for both modes. React reuses it across the mode
          switch, and any prop set in only one branch is reset — maxDistance
          would come back as 0 and pin the camera onto the orbit target, i.e.
          inside the car. Every prop is therefore spelled out for both modes. */}
      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom={viewMode === "Studio"}
        enableRotate={viewMode === "Studio"}
        minDistance={viewMode === "Studio" ? 3 : 0}
        maxDistance={viewMode === "Studio" ? 20 : Infinity}
        maxPolarAngle={Math.PI / 2.1}
      />
    </>
  );
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function RarityLabel({ rarity }: { rarity: string }) {
  const color =
    rarity === "Legendary" ? DS.textPrimary  :
    rarity === "Epic"      ? DS.textSecondary :
    rarity === "Rare"      ? DS.textMeta      :
                             DS.textDisabled;
  return (
    <span style={{ fontSize: 9, color, letterSpacing: "0.15em", fontFamily: DS.font }}>
      {rarity.toUpperCase()}
    </span>
  );
}

const NAV_BTN: React.CSSProperties = {
  width: 48,
  height: 48,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.55)",
  border: `1px solid ${DS.border}`,
  color: DS.textPrimary,
  fontFamily: DS.font,
  fontSize: 20,
  cursor: "pointer",
  pointerEvents: "auto",
  userSelect: "none",
  transition: "background 150ms, border-color 150ms",
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
};

function GarageLoadingOverlay() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 20,
        pointerEvents: "none",
        fontFamily: DS.font,
      }}
    >
      <div
        style={{
          background: DS.bg,
          border: `1px solid ${DS.border}`,
          padding: "18px 32px",
          fontSize: 9,
          color: DS.textDisabled,
          letterSpacing: "0.25em",
        }}
      >
        READING GARAGE FROM CHAIN...
      </div>
    </div>
  );
}

// ─── Garage ──────────────────────────────────────────────────────────────────

export function Garage({
  cars,
  loading = false,
  playerId,
  onStartRace,
  onMintSuccess,
  onOpenLeaderboard,
}: GarageProps) {
  const [selectedCarId, setSelectedCarId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"Gallery" | "Studio">("Gallery");

  // The list is a prop, not a snapshot: a fresh mint has to show up without a
  // remount, and the selection has to survive the car it points at going away.
  const selectedIndex = cars.findIndex((c) => c.id === selectedCarId);
  const carouselIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const selectedCar   = cars[carouselIndex] ?? null;

  useEffect(() => {
    if (selectedCarId !== null && selectedIndex >= 0) return;
    setSelectedCarId(cars[0]?.id ?? null);
  }, [cars, selectedCarId, selectedIndex]);

  // Visible slots state — manages smooth carousel transitions
  const [visibleSlots, setVisibleSlots] = useState<VisibleSlot[]>(() =>
    computeActiveSlots(cars, carouselIndex)
  );
  const prevIdxRef = useRef(carouselIndex);

  useEffect(() => {
    const oldIdx = prevIdxRef.current;
    const newIdx = carouselIndex;
    if (oldIdx === newIdx) return;

    const total = cars.length;
    let diff = newIdx - oldIdx;
    if (diff >  total / 2) diff -= total;
    if (diff < -total / 2) diff += total;
    const goingRight = diff > 0;

    const oldSlots     = computeActiveSlots(cars, oldIdx);
    const newActiveSlots = computeActiveSlots(cars, newIdx);
    const oldIds = new Set(oldSlots.map((s) => s.car.id));
    const newIds = new Set(newActiveSlots.map((s) => s.car.id));

    // Exiting cars (were visible, now gone) — animate off-screen
    const exiting: VisibleSlot[] = oldSlots
      .filter((s) => !newIds.has(s.car.id))
      .map((s) => ({ car: s.car, role: (goingRight ? "exit-left" : "exit-right") as SlotRole }));

    // Active cars — newly entering ones start off-screen
    const active: VisibleSlot[] = newActiveSlots.map((s) => ({
      ...s,
      entryPos: !oldIds.has(s.car.id)
        ? (goingRight ? [22, 0, -5] : [-22, 0, -5]) as [number, number, number]
        : undefined,
    }));

    setVisibleSlots([...active, ...exiting]);
    prevIdxRef.current = newIdx;

    // Prune exiting cars once animation completes
    const timer = setTimeout(() => {
      setVisibleSlots(computeActiveSlots(cars, newIdx));
    }, 700);
    return () => clearTimeout(timer);
  }, [carouselIndex, cars]);

  const navigateBy = useCallback(
    (step: number) => {
      if (cars.length <= 1) return;
      const next = (carouselIndex + step + cars.length) % cars.length;
      setSelectedCarId(cars[next].id);
    },
    [cars, carouselIndex]
  );

  const navigatePrev = () => navigateBy(-1);
  const navigateNext = () => navigateBy(1);

  // Keyboard navigation
  useEffect(() => {
    if (viewMode !== "Gallery") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft")  navigateBy(-1);
      if (e.key === "ArrowRight") navigateBy(1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewMode, navigateBy]);

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        background: DS.bg,
        display: "flex",
        position: "relative",
        overflow: "hidden",
        fontFamily: DS.font,
      }}
    >
      <div style={{ flex: 1, position: "relative" }}>
        <Canvas
          shadows
          camera={{ position: [0, 4.5, 15], fov: 55 }}
          style={{ width: "100%", height: "100%" }}
        >
          <Suspense fallback={<LoadingText />}>
            <GarageScene
              visibleSlots={visibleSlots}
              featuredCar={selectedCar}
              onCarSelect={setSelectedCarId}
              onCarOpen={(id) => { setSelectedCarId(id); setViewMode("Studio"); }}
              viewMode={viewMode}
            />
          </Suspense>
        </Canvas>

        <WalletHUD fleetCount={cars.length} onMintSuccess={onMintSuccess} />

        {loading && <GarageLoadingOverlay />}

        {!loading && cars.length === 0 && onMintSuccess && (
          <GarageEmptyState onMintSuccess={onMintSuccess} />
        )}

        {viewMode === "Studio" && selectedCar && (
          <CarHUD car={selectedCar} onClose={() => setViewMode("Gallery")} />
        )}

        {viewMode === "Gallery" && (
          <>
            {/* Header */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                padding: "28px 32px",
                pointerEvents: "none",
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 700, color: DS.textPrimary, letterSpacing: "0.12em", marginBottom: 4 }}>
                MY COLLECTION
              </div>
              <div style={{ fontSize: 10, color: DS.textDisabled, letterSpacing: "0.1em" }}>
                OWNER: {playerId.slice(0, 12)}...
              </div>
              {cars.length > 1 && (
                <div style={{ fontSize: 9, color: DS.textDisabled, letterSpacing: "0.15em", marginTop: 6 }}>
                  {carouselIndex + 1} / {cars.length}
                </div>
              )}
              {onOpenLeaderboard && (
                <button
                  onClick={onOpenLeaderboard}
                  style={{
                    marginTop: 14,
                    padding: "8px 16px",
                    background: "transparent",
                    border: `1px solid ${DS.border}`,
                    color: DS.textMeta,
                    fontFamily: DS.font,
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.2em",
                    cursor: "pointer",
                    pointerEvents: "auto",
                    transition: "border-color 150ms, color 150ms",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = DS.textPrimary;
                    (e.currentTarget as HTMLButtonElement).style.color = DS.textPrimary;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = DS.border;
                    (e.currentTarget as HTMLButtonElement).style.color = DS.textMeta;
                  }}
                >
                  LEADERBOARD
                </button>
              )}
            </div>

            {/* Vehicle list — bottom left */}
            <div style={{ position: "absolute", bottom: 32, left: 32, width: 280, pointerEvents: "auto" }}>
              <div style={{ background: DS.surface, border: `1px solid ${DS.border}`, maxHeight: "55vh", overflowY: "auto" }}>
                <div style={{ padding: "12px 16px", borderBottom: `1px solid ${DS.divider}`, fontSize: 9, color: DS.textDisabled, letterSpacing: "0.2em" }}>
                  VEHICLES
                </div>
                {cars.map((car) => {
                  const isActive = car.id === selectedCarId;
                  return (
                    <div
                      key={car.id}
                      onClick={() => setSelectedCarId(car.id)}
                      style={{
                        padding: "12px 16px",
                        cursor: "pointer",
                        borderBottom: `1px solid ${DS.divider}`,
                        background: isActive ? "#1A1A1A" : "transparent",
                        borderLeft: isActive ? `2px solid ${DS.textPrimary}` : "2px solid transparent",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        transition: "background 150ms",
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: isActive ? 700 : 400, color: isActive ? DS.textPrimary : DS.textMeta, letterSpacing: "0.05em" }}>
                        {car.name}
                      </span>
                      <RarityLabel rarity={car.rarity} />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Carousel nav arrows */}
            {cars.length > 1 && (
              <>
                <button
                  onClick={navigatePrev}
                  style={{ ...NAV_BTN, left: 340 }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#555"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,0,0,0.55)"; (e.currentTarget as HTMLButtonElement).style.borderColor = DS.border; }}
                >
                  ←
                </button>
                <button
                  onClick={navigateNext}
                  style={{ ...NAV_BTN, right: 120 }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#555"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,0,0,0.55)"; (e.currentTarget as HTMLButtonElement).style.borderColor = DS.border; }}
                >
                  →
                </button>
              </>
            )}

            {/* Race button — bottom right */}
            {selectedCar && onStartRace && (
              <div style={{ position: "absolute", bottom: 32, right: 32, pointerEvents: "auto" }}>
                <button
                  onClick={() => onStartRace(selectedCar.id)}
                  style={{
                    padding: "14px 32px",
                    background: "transparent",
                    border: `1px solid ${DS.textPrimary}`,
                    color: DS.textPrimary,
                    fontFamily: DS.font,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.2em",
                    cursor: "pointer",
                    transition: "background 150ms, color 150ms",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = DS.textPrimary; (e.currentTarget as HTMLButtonElement).style.color = DS.bg; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = DS.textPrimary; }}
                >
                  RACE
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
