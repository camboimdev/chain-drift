import { OrbitControls, Text } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CarNFT } from "@chain-drift/shared";
import { CarHUD } from "./CarHUD";
import { GarageEmptyState } from "./GarageEmptyState";
import { WalletHUD } from "./WalletHeader";
import { CarBay } from "./garage/CarBay";
import { GarageBay } from "./garage/GarageBay";
import { GarageCamera } from "./garage/GarageCamera";
import { CornerFrame, GarageHeader, GhostButton, ModeCluster } from "./garage/GarageFrame";
import { FleetIndex } from "./garage/FleetIndex";
import { SpecSheet } from "./garage/SpecSheet";
import { DS, FONT_REGULAR, archetypeOf } from "./garage/design";
import { computeLayout, entryPosition, isOnStage, ringOffset } from "./garage/layout";
import type { GarageMode } from "./garage/layout";
import { preloadCarModels } from "../services/carModelPreloader";

interface GarageProps {
  cars: CarNFT[];
  /** True while the on-chain read is in flight — an empty list is not yet news. */
  loading?: boolean;
  playerId: string;
  onStartRace?: (carId: string) => void;
  onMintSuccess?: () => void;
  onOpenLeaderboard?: () => void;
}

/** How long the carousel ignores a second wheel notch, in ms. */
const WHEEL_COOLDOWN = 220;

function BootText() {
  return (
    <Text
      font={FONT_REGULAR}
      position={[0, 2, 0]}
      fontSize={0.5}
      letterSpacing={0.3}
      color="#2A2A2A"
      anchorX="center"
      anchorY="middle"
    >
      OPENING BAY...
    </Text>
  );
}

function GarageLoadingOverlay() {
  return (
    <div
      style={{
        position:       "absolute",
        inset:          0,
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        zIndex:         20,
        pointerEvents:  "none",
        fontFamily:     DS.font,
      }}
    >
      <div
        style={{
          background:    DS.bg,
          border:        `1px solid ${DS.border}`,
          padding:       "18px 32px",
          fontSize:      9,
          color:         DS.textDisabled,
          letterSpacing: "0.25em",
        }}
      >
        READING GARAGE FROM CHAIN...
      </div>
    </div>
  );
}

/**
 * The garage.
 *
 * Three views of one fleet, and one selection shared between them: GALLERY puts
 * a car on the scan pad with its neighbours receding either side, FLEET parks
 * every unit on a numbered bay so the whole collection is on screen at once,
 * and INSPECT hands the camera to the player. Switching mode re-runs the layout
 * and the bays drive themselves there — there is no separate transition to keep
 * in sync with the state.
 */
export function Garage({
  cars,
  loading = false,
  playerId,
  onStartRace,
  onMintSuccess,
  onOpenLeaderboard,
}: GarageProps) {
  const [selectedCarId, setSelectedCarId] = useState<string | null>(null);
  const [hoveredCarId, setHoveredCarId]   = useState<string | null>(null);
  const [mode, setMode]                   = useState<GarageMode>("gallery");

  // The list is a prop, not a snapshot: a fresh mint has to show up without a
  // remount, and the selection has to survive the car it points at going away.
  const selectedIndex = cars.findIndex((c) => c.id === selectedCarId);
  const index         = selectedIndex >= 0 ? selectedIndex : 0;
  const selectedCar   = cars[index] ?? null;

  useEffect(() => {
    if (selectedCarId !== null && selectedIndex >= 0) return;
    setSelectedCarId(cars[0]?.id ?? null);
  }, [cars, selectedCarId, selectedIndex]);

  // Fleet view puts every model on screen at once, so warm them all up front
  // rather than watching wireframes resolve row by row.
  useEffect(() => {
    if (cars.length === 0) return;
    void preloadCarModels(cars.map((car) => car.tokenId));
  }, [cars]);

  const layout = useMemo(() => computeLayout(cars, index, mode), [cars, index, mode]);

  const navigate = useCallback(
    (step: number) => {
      if (cars.length <= 1) return;
      const next = (index + step + cars.length) % cars.length;
      setSelectedCarId(cars[next].id);
    },
    [cars, index]
  );

  const handleBayClick = useCallback(
    (car: CarNFT) => {
      // Clicking the car already on the mark is the way further in; clicking
      // any other car brings it to the mark first.
      if (car.id !== selectedCarId) {
        setSelectedCarId(car.id);
        return;
      }
      if (mode === "gallery") setMode("inspect");
      if (mode === "fleet")   setMode("gallery");
    },
    [mode, selectedCarId]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // A focused control owns its own keys — Enter on the mode buttons must
      // press the button, not race the global shortcut for the same key.
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) return;

      switch (e.key) {
        case "ArrowLeft":  e.preventDefault(); navigate(-1); break;
        case "ArrowRight": e.preventDefault(); navigate(1); break;
        case "g":
        case "G":          setMode((m) => (m === "fleet" ? "gallery" : "fleet")); break;
        case "Enter":      setMode("inspect"); break;
        case "Escape":     setMode("gallery"); break;
        default: return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  const wheelAt = useRef(0);
  const handleWheel = (e: React.WheelEvent) => {
    if (mode !== "gallery") return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(delta) < 12) return;
    const now = performance.now();
    if (now - wheelAt.current < WHEEL_COOLDOWN) return;
    wheelAt.current = now;
    navigate(delta > 0 ? 1 : -1);
  };

  const inspecting = mode === "inspect" && selectedCar !== null;
  const hasFleet   = !inspecting && cars.length > 0;
  // Fleet view is the overview — the register and the spec sheet would only
  // cover the two bays nearest the camera.
  const showPanels = hasFleet && mode === "gallery";

  return (
    <div
      onWheel={handleWheel}
      style={{
        width:      "100%",
        height:     "100vh",
        background: DS.bg,
        position:   "relative",
        overflow:   "hidden",
        fontFamily: DS.font,
      }}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 3.9, 15.4], fov: 48 }}
        style={{ width: "100%", height: "100%" }}
      >
        <Suspense fallback={<BootText />}>
          <GarageBay
            tokenId={selectedCar?.tokenId ?? 0}
            subtitle={selectedCar ? archetypeOf(selectedCar) : "NO UNITS ON RECORD"}
            showPlate={mode !== "inspect"}
          />

          {cars.map((car, i) => {
            const placement = layout.get(car.id);
            if (!placement || !isOnStage(placement.tier)) return null;
            return (
              <CarBay
                key={car.id}
                car={car}
                placement={placement}
                entryPos={entryPosition(ringOffset(i, index, cars.length))}
                mode={mode}
                active={car.id === selectedCarId}
                highlighted={car.id === hoveredCarId}
                onClick={() => handleBayClick(car)}
              />
            );
          })}

          <GarageCamera mode={mode} fleetSize={cars.length} />

          {/* One controls instance across every mode. React reuses it on a mode
              switch, and a prop set in only one branch is reset — maxDistance
              would come back as 0 and pin the camera onto the orbit target,
              i.e. inside the car. Every prop is therefore spelled out. */}
          <OrbitControls
            makeDefault
            enablePan={false}
            enableZoom={mode === "inspect"}
            enableRotate={mode === "inspect"}
            minDistance={mode === "inspect" ? 4 : 0}
            maxDistance={mode === "inspect" ? 16 : Infinity}
            maxPolarAngle={Math.PI / 2.05}
          />

          <EffectComposer>
            {/* Only the light rig and the pad rings clear the threshold — the
                floor must not bloom into a grey haze. */}
            <Bloom intensity={0.55} luminanceThreshold={0.72} luminanceSmoothing={0.9} mipmapBlur />
            <Vignette offset={0.26} darkness={0.72} blendFunction={BlendFunction.NORMAL} />
          </EffectComposer>
        </Suspense>
      </Canvas>

      <CornerFrame />
      <WalletHUD fleetCount={cars.length} onMintSuccess={onMintSuccess} />

      {loading && <GarageLoadingOverlay />}

      {!loading && cars.length === 0 && onMintSuccess && (
        <GarageEmptyState onMintSuccess={onMintSuccess} />
      )}

      {inspecting && selectedCar && (
        <CarHUD car={selectedCar} onClose={() => setMode("gallery")} />
      )}

      {hasFleet && (
        <>
          <GarageHeader
            playerId={playerId}
            index={index}
            total={cars.length}
            onOpenLeaderboard={onOpenLeaderboard}
          />

          {showPanels && (
          <div style={{ position: "absolute", bottom: 34, left: 34, pointerEvents: "auto" }}>
            <FleetIndex
              cars={cars}
              selectedId={selectedCarId}
              hoveredId={hoveredCarId}
              onSelect={setSelectedCarId}
              onHover={setHoveredCarId}
              onOpen={(id) => {
                setSelectedCarId(id);
                setMode("inspect");
              }}
            />
          </div>
          )}

          <ModeCluster
            mode={mode}
            onMode={setMode}
            index={index}
            total={cars.length}
            onStep={navigate}
          />

          {selectedCar && (
            <div
              style={{
                position:      "absolute",
                bottom:        34,
                right:         34,
                pointerEvents: "auto",
                display:       "flex",
                flexDirection: "column",
                alignItems:    "flex-end",
                gap:           14,
              }}
            >
              {showPanels && <SpecSheet car={selectedCar} />}
              {onStartRace && (
                <GhostButton
                  primary
                  label="ENTER RACE"
                  onClick={() => onStartRace(selectedCar.id)}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
