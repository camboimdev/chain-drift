import { Canvas } from "@react-three/fiber";
import { Environment, Stars } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { ACESFilmicToneMapping } from "three";
import { Suspense, useEffect, useRef, useState } from "react";
import { RaceDirector } from "./RaceDirector";
import { RaceCamera } from "./RaceCamera";
import { RaceUI } from "./RaceUI";
import { useRaceStore } from "../stores/raceStore";
import { preloadCarModels } from "../services/carModelPreloader";
import { TRACK_CONFIG } from "../config/trackConfig";
import { calculateCarStats } from "@chain-drift/shared";
import type { CarNFT } from "@chain-drift/shared";

// ─── Design System ────────────────────────────────────────────────
const DS = {
  bg: "#000000",
  bgSec: "#0A0A0A",
  surface: "#111111",
  divider: "#1A1A1A",
  border: "#2A2A2A",
  textPrimary: "#FFFFFF",
  textSecondary: "#E5E5E5",
  textMeta: "#BFBFBF",
  textDisabled: "#3A3A3A",
  accent: "#00FF88",
  font: "'JetBrains Mono', monospace",
} as const;

const RARITY_BRIGHTNESS: Record<string, string> = {
  Legendary: DS.textPrimary,
  Epic: DS.textSecondary,
  Rare: DS.textMeta,
  Common: DS.textDisabled,
};

// CSS injected once at module scope into document head
const STYLE_ID = "chain-drift-race-styles";
const RACE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');

@keyframes cd-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
@keyframes cd-fadeInUp {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes cd-slideInRight {
  from { opacity: 0; transform: translateX(12px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes cd-charge {
  from { width: 0%; }
  to   { width: 100%; }
}
@keyframes cd-step-in {
  from { opacity: 0; transform: translateX(-8px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes cd-bar-fill {
  from { width: 0%; }
  to   { width: var(--bar-w); }
}
@keyframes cd-bar-sweep {
  from { transform: translateX(-100%); }
  to   { transform: translateX(500%); }
}

.cd-bar-sweep {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 20%;
  animation: cd-bar-sweep 1.2s ease-in-out infinite;
}

.cd-blink { animation: cd-blink 1s step-end infinite; }

.cd-scanlines {
  background-image: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 3px,
    rgba(255,255,255,0.012) 3px,
    rgba(255,255,255,0.012) 4px
  );
}

.cd-btn {
  position: relative;
  overflow: hidden;
  padding: 14px 52px;
  background: transparent;
  border: 1px solid #FFFFFF;
  color: #FFFFFF;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.25em;
  cursor: pointer;
  transition: color 150ms;
}
.cd-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: #FFFFFF;
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 150ms ease-out;
  z-index: 0;
}
.cd-btn:hover::before { transform: scaleX(1); }
.cd-btn:hover { color: #000000; }
.cd-btn span { position: relative; z-index: 1; }
`;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = RACE_CSS;
  document.head.appendChild(el);
}

// ─── Stat Bar ─────────────────────────────────────────────────────
function StatBar({
  label,
  value,
  max = 100,
  delay = 0,
}: {
  label: string;
  value: number;
  max?: number;
  delay?: number;
}) {
  const pct = Math.round((Math.min(value, max) / max) * 100);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 5,
      }}
    >
      <span
        style={{
          fontSize: 7,
          color: DS.textDisabled,
          letterSpacing: "0.15em",
          width: 24,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 4,
          background: DS.divider,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            // @ts-expect-error css custom property
            "--bar-w": `${pct}%`,
            width: `${pct}%`,
            background: DS.textPrimary,
            animation: `cd-bar-fill 600ms ease-out ${delay}ms both`,
          }}
        />
      </div>
      <span
        style={{
          fontSize: 8,
          color: DS.textMeta,
          width: 22,
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Data Row ─────────────────────────────────────────────────────
function DataRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "6px 0",
        borderBottom: `1px solid ${DS.divider}`,
      }}
    >
      <span
        style={{
          fontSize: 8,
          color: DS.textDisabled,
          letterSpacing: "0.15em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: accent ? DS.accent : DS.textPrimary,
          letterSpacing: "0.1em",
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Participant Panel ────────────────────────────────────────────
function ParticipantPanel({
  car,
  isUser,
  index,
}: {
  car: CarNFT;
  isUser: boolean;
  index: number;
}) {
  const stats = calculateCarStats(car);
  const rarityBrightness = RARITY_BRIGHTNESS[car.rarity] ?? DS.textDisabled;
  const tokenIdFormatted = `#${String(car.tokenId).padStart(4, "0")}`;
  const delay = index * 80;

  return (
    <div
      style={{
        border: `1px solid ${isUser ? DS.textPrimary : DS.border}`,
        background: DS.surface,
        padding: "16px",
        animation: `cd-fadeInUp 400ms ease-out ${delay}ms both`,
        position: "relative",
      }}
    >
      {/* Top line: token id + rarity/you badge */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
          paddingBottom: 8,
          borderBottom: `1px solid ${DS.divider}`,
        }}
      >
        <span
          style={{
            fontSize: 8,
            color: DS.textDisabled,
            letterSpacing: "0.2em",
          }}
        >
          {tokenIdFormatted}
        </span>

        {isUser ? (
          <span
            style={{
              fontSize: 8,
              color: DS.textPrimary,
              fontWeight: 700,
              letterSpacing: "0.2em",
            }}
          >
            YOU
            <span className="cd-blink" style={{ marginLeft: 2 }}>
              ▮
            </span>
          </span>
        ) : (
          <span
            style={{
              fontSize: 7,
              color: rarityBrightness,
              letterSpacing: "0.15em",
            }}
          >
            {car.rarity.toUpperCase()}
          </span>
        )}
      </div>

      {/* Car name */}
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: DS.textPrimary,
          letterSpacing: "0.08em",
          marginBottom: isUser ? 3 : 10,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {car.name.toUpperCase()}
      </div>

      {isUser && (
        <div
          style={{
            fontSize: 7,
            color: rarityBrightness,
            letterSpacing: "0.15em",
            marginBottom: 10,
          }}
        >
          {car.rarity.toUpperCase()}
        </div>
      )}

      {/* Stats */}
      <StatBar label="SPD" value={stats.speed} delay={delay + 200} />
      <StatBar label="ACC" value={stats.acceleration} delay={delay + 280} />
      <StatBar label="HDL" value={stats.handling} delay={delay + 360} />
    </div>
  );
}

// ─── Race Lobby ───────────────────────────────────────────────────
function RaceLobby({
  cars,
  userCarId,
  onStartRace,
}: {
  cars: CarNFT[];
  userCarId: string;
  onStartRace: () => void;
}) {
  useEffect(() => {
    injectStyles();
  }, []);

  const raceId = useRef(
    `#${String(Math.floor(Math.random() * 9999)).padStart(4, "0")}`
  ).current;

  return (
    <div
      className="cd-scanlines"
      style={{
        position: "absolute",
        inset: 0,
        background: DS.bg,
        fontFamily: DS.font,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          padding: "14px 24px",
          borderBottom: `1px solid ${DS.border}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flexShrink: 0,
          animation: "cd-fadeInUp 300ms ease-out both",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 8,
              color: DS.textDisabled,
              letterSpacing: "0.3em",
              marginBottom: 4,
            }}
          >
            CHAIN DRIFT // RACE PROTOCOL
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: DS.textPrimary,
              letterSpacing: "0.15em",
            }}
          >
            RACE LOBBY
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 32,
            alignItems: "flex-end",
            paddingBottom: 2,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 8,
                color: DS.textDisabled,
                letterSpacing: "0.2em",
                marginBottom: 2,
              }}
            >
              RACE_ID
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: DS.textPrimary,
                letterSpacing: "0.1em",
              }}
            >
              {raceId}
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 8,
                color: DS.textDisabled,
                letterSpacing: "0.2em",
                marginBottom: 2,
              }}
            >
              STATUS
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: DS.accent,
                letterSpacing: "0.1em",
              }}
            >
              READY
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 8,
                color: DS.textDisabled,
                letterSpacing: "0.2em",
                marginBottom: 2,
              }}
            >
              BLOCK
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: DS.textMeta,
                letterSpacing: "0.1em",
              }}
            >
              PENDING
            </div>
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        {/* Left: Participants grid */}
        <div
          style={{
            flex: 1,
            padding: "20px 24px",
            borderRight: `1px solid ${DS.border}`,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontSize: 8,
              color: DS.textDisabled,
              letterSpacing: "0.25em",
              marginBottom: 14,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>PARTICIPANTS</span>
            <span style={{ color: DS.accent }}>{cars.length} / 4 CONFIRMED</span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 10,
            }}
          >
            {cars.map((car, i) => (
              <ParticipantPanel
                key={car.id}
                car={car}
                isUser={car.id === userCarId}
                index={i}
              />
            ))}
          </div>
        </div>

        {/* Right: Race Intel */}
        <div
          style={{
            width: 232,
            flexShrink: 0,
            padding: "20px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
            animation: "cd-slideInRight 400ms ease-out 200ms both",
          }}
        >
          {/* Track info */}
          <div>
            <div
              style={{
                fontSize: 8,
                color: DS.textDisabled,
                letterSpacing: "0.25em",
                marginBottom: 10,
                paddingBottom: 8,
                borderBottom: `1px solid ${DS.divider}`,
              }}
            >
              RACE PARAMETERS
            </div>
            <DataRow label="FORMAT" value="SPRINT" />
            <DataRow label="DISTANCE" value={`${TRACK_CONFIG.totalDistance}M`} />
            <DataRow label="LAPS" value="01" />
            <DataRow label="ENTRY FEE" value="1 DRIFT" />
            <DataRow label="PRIZE POOL" value="4 DRIFT" />
          </div>

          {/* Prize breakdown */}
          <div>
            <div
              style={{
                fontSize: 8,
                color: DS.textDisabled,
                letterSpacing: "0.25em",
                marginBottom: 10,
                paddingBottom: 8,
                borderBottom: `1px solid ${DS.divider}`,
              }}
            >
              PRIZE DISTRIBUTION
            </div>
            {(
              [
                { pos: "01", amount: "500", pct: "50%" },
                { pos: "02", amount: "300", pct: "30%" },
                { pos: "03", amount: "150", pct: "15%" },
                { pos: "04", amount: " 50", pct: " 5%" },
              ] as const
            ).map(({ pos, amount, pct }) => (
              <div
                key={pos}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "5px 0",
                  borderBottom: `1px solid ${DS.divider}`,
                }}
              >
                <span
                  style={{
                    fontSize: 8,
                    color: DS.textDisabled,
                    letterSpacing: "0.1em",
                  }}
                >
                  {pos}
                </span>
                <span
                  style={{
                    fontSize: 8,
                    color: DS.textMeta,
                    letterSpacing: "0.08em",
                  }}
                >
                  {pct}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: DS.textPrimary,
                    letterSpacing: "0.08em",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {amount} DRIFT
                </span>
              </div>
            ))}
          </div>

          {/* Betting stub */}
          <div
            style={{
              border: `1px solid ${DS.divider}`,
              padding: 12,
              marginTop: "auto",
            }}
          >
            <div
              style={{
                fontSize: 7,
                color: DS.textDisabled,
                letterSpacing: "0.18em",
                marginBottom: 6,
              }}
            >
              BETTING MODULE
            </div>
            <div
              style={{
                fontSize: 7,
                color: DS.textDisabled,
                lineHeight: 1.7,
                letterSpacing: "0.08em",
              }}
            >
              ON-CHAIN WAGERING
              <br />
              PENDING INTEGRATION
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div
        style={{
          padding: "14px 24px",
          borderTop: `1px solid ${DS.border}`,
          background: DS.bgSec,
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 16,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 8,
            color: DS.textDisabled,
            letterSpacing: "0.15em",
          }}
        >
          {cars.length} PARTICIPANTS LOCKED
        </span>
        <button className="cd-btn" onClick={onStartRace}>
          <span>INITIATE RACE</span>
        </button>
      </div>
    </div>
  );
}

// ─── Asset Preload ────────────────────────────────────────────────
// Real progress of the car GLB preload, shared by the matchmaking and
// loading screens. `null` means nothing is in flight yet.
interface AssetProgress {
  loaded: number;
  total: number;
  done: boolean;
}

// Floor for the matchmaking screen so its staged steps (up to 1050ms) read
// even when every model is already cached.
const MATCHMAKING_MIN_MS = 2000;

// Ceiling on the asset gate. Waiting on the models is right — a wireframe
// placeholder must not be on the starting grid — but IPFS can degrade to
// four gateways timing out in sequence, and holding the player on a loading
// screen for minutes is a worse failure than racing a car that never loaded.
// Past this deadline the race starts with whatever arrived.
const ASSET_DEADLINE_MS = 20000;

// ─── Matchmaking Screen ───────────────────────────────────────────
const MATCHMAKING_STEPS = [
  { label: "CONNECTING TO BASE NETWORK", delay: 0 },
  { label: "VERIFYING CAR NFT OWNERSHIP", delay: 350 },
  { label: "VALIDATING ENTRY FEE ESCROW", delay: 700 },
  { label: "SCANNING FOR OPPONENTS", delay: 1050 },
] as const;

// The asset step is last: it is the one the countdown actually waits on.
const ASSET_STEP_DELAY = 1400;
const STEP_DELAYS = [...MATCHMAKING_STEPS.map((s) => s.delay), ASSET_STEP_DELAY];

function TerminalStep({
  label,
  status,
  visible,
  ok,
}: {
  label: string;
  status: string;
  visible: boolean;
  ok: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 0",
        borderBottom: `1px solid ${DS.divider}`,
        animation: visible ? `cd-step-in 200ms ease-out both` : undefined,
        opacity: visible ? 1 : 0,
        transition: "opacity 100ms",
      }}
    >
      <span
        style={{
          fontSize: 9,
          color: DS.textMeta,
          letterSpacing: "0.08em",
        }}
      >
        {">"} {label}
      </span>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: ok ? DS.accent : DS.textDisabled,
          letterSpacing: "0.12em",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        [{status}]
      </span>
    </div>
  );
}

function MatchmakingScreen({ assets }: { assets: AssetProgress | null }) {
  useEffect(() => {
    injectStyles();
  }, []);

  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    const timers = STEP_DELAYS.map((delay, i) =>
      setTimeout(() => setVisibleCount(i + 1), delay)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  const assetDone   = assets?.done ?? false;
  const assetStatus = !assets
    ? "..."
    : assetDone
      ? "OK"
      : `${assets.loaded}/${assets.total}`;

  return (
    <div
      className="cd-scanlines"
      style={{
        position: "absolute",
        inset: 0,
        background: DS.bg,
        fontFamily: DS.font,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Wordmark */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <div
          style={{
            fontSize: 9,
            color: DS.textDisabled,
            letterSpacing: "0.35em",
            marginBottom: 10,
          }}
        >
          CHAIN DRIFT
        </div>
        <div
          style={{
            width: 200,
            height: 1,
            background: DS.border,
            margin: "0 auto 14px",
          }}
        />
        <div
          style={{
            fontSize: 10,
            color: DS.textDisabled,
            letterSpacing: "0.25em",
          }}
        >
          SIGNAL ACQUISITION
        </div>
      </div>

      {/* Terminal steps */}
      <div style={{ width: 420, maxWidth: "90vw" }}>
        {MATCHMAKING_STEPS.map((step, i) => (
          <TerminalStep
            key={step.label}
            label={step.label}
            status="OK"
            visible={i < visibleCount}
            ok
          />
        ))}
        <TerminalStep
          label="STREAMING CAR ASSETS"
          status={assetStatus}
          visible={visibleCount > MATCHMAKING_STEPS.length}
          ok={assetDone}
        />
      </div>

      {/* Blinking status */}
      <div
        style={{
          marginTop: 28,
          fontSize: 9,
          color: DS.textDisabled,
          letterSpacing: "0.18em",
        }}
      >
        {assetDone ? "GRID READY" : "LOADING RACERS"}
        <span className="cd-blink" style={{ marginLeft: 4 }}>
          ▮
        </span>
      </div>
    </div>
  );
}

// ─── Loading Screen ───────────────────────────────────────────────
function RaceLoadingScreen({ assets }: { assets: AssetProgress | null }) {
  useEffect(() => {
    injectStyles();
  }, []);

  // Without a preload in flight there is nothing honest to report, so the bar
  // sweeps instead of inventing a percentage.
  const total = assets?.total ?? 0;
  const determinate = total > 0;
  const pct = determinate
    ? Math.round(((assets?.loaded ?? 0) / total) * 100)
    : 0;

  return (
    <div
      className="cd-scanlines"
      style={{
        position: "absolute",
        inset: 0,
        background: DS.bg,
        fontFamily: DS.font,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ width: 320, textAlign: "center" }}>
        <div
          style={{
            fontSize: 9,
            color: DS.textDisabled,
            letterSpacing: "0.35em",
            marginBottom: 28,
          }}
        >
          CHAIN DRIFT
        </div>

        {/* Progress bar */}
        <div
          style={{
            height: 2,
            background: DS.border,
            position: "relative",
            overflow: "hidden",
            marginBottom: 12,
          }}
        >
          {determinate ? (
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${pct}%`,
                background: DS.textPrimary,
                transition: "width 200ms linear",
              }}
            />
          ) : (
            <div className="cd-bar-sweep" style={{ background: DS.textPrimary }} />
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 8,
            color: DS.textDisabled,
            letterSpacing: "0.15em",
          }}
        >
          <span>LOADING RACE PROTOCOL</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {determinate ? `${String(pct).padStart(3, " ")}%` : "---%"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── RaceScene (main export) ──────────────────────────────────────
interface RaceSceneProps {
  cars: CarNFT[];
  userCarId: string;
  onReturnToGarage: () => void;
}

export function RaceScene({ cars, userCarId, onReturnToGarage }: RaceSceneProps) {
  const { raceState, participants, initializeRace, startMatchmaking, startCountdown } =
    useRaceStore();

  const [assets, setAssets] = useState<AssetProgress | null>(null);
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (cars.length >= 1) {
      initializeRace(cars.slice(0, 4), userCarId);
    }
  }, [cars, userCarId, initializeRace]);

  // The countdown waits on the models, never on a fixed timer: a car that is
  // still a wireframe placeholder must not be on the starting grid.
  const handleStartRace = () => {
    if (startedRef.current) return;
    startedRef.current = true;

    startMatchmaking();
    setAssets({ loaded: 0, total: 0, done: false });

    const preloaded = preloadCarModels(
      participants.map((p) => p.car.tokenId),
      (loaded, total) => {
        if (mountedRef.current) setAssets({ loaded, total, done: false });
      }
    ).then(() => {
      if (mountedRef.current) {
        setAssets((prev) => ({
          loaded: prev?.total ?? 0,
          total: prev?.total ?? 0,
          done: true,
        }));
      }
    });

    const minimumOnScreen = new Promise<void>((resolve) =>
      setTimeout(resolve, MATCHMAKING_MIN_MS)
    );
    const deadline = new Promise<void>((resolve) =>
      setTimeout(resolve, ASSET_DEADLINE_MS)
    );

    // Race on the assets, but never past the deadline. `preloadCarModels`
    // always resolves, so the only thing the deadline guards against is a
    // gateway that hangs rather than fails.
    const assetsReady = Promise.race([preloaded, deadline]);

    Promise.all([assetsReady, minimumOnScreen]).then(() => {
      if (mountedRef.current) startCountdown();
    });
  };

  if (raceState === "IDLE" && participants.length > 0) {
    return (
      <RaceLobby
        cars={participants.map((p) => p.car)}
        userCarId={userCarId}
        onStartRace={handleStartRace}
      />
    );
  }

  if (raceState === "MATCHMAKING") {
    return <MatchmakingScreen assets={assets} />;
  }

  if (participants.length === 0) {
    return <RaceLoadingScreen assets={assets} />;
  }

  return (
    <div className="relative w-full h-screen bg-black">
      <Canvas
        shadows
        camera={{ position: [0, 25, -30], fov: 60, near: 0.1, far: 2000 }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          stencil: false,
          toneMapping: ACESFilmicToneMapping,
        }}
        dpr={[1, 1.5]}
      >
        <Suspense fallback={null}>
          <color attach="background" args={["#08090B"]} />
          {/* Neutral haze that only bites past the last rendered chunk
              (visibleChunks * chunkLength), so asphalt stays solid ahead. */}
          <fog attach="fog" args={["#08090B", 140, 460]} />
          <Stars
            radius={400}
            depth={150}
            count={1600}
            factor={3}
            saturation={0}
            fade
            speed={0.15}
          />
          <Environment preset="night" />
          <ambientLight intensity={0.08} color="#4488ff" />
          <directionalLight position={[50, 100, 50]} intensity={0.3} color="#6688cc" />
          <RaceDirector onRaceComplete={() => {}} />
          <RaceCamera
            enabled={
              raceState === "RACING" ||
              raceState === "COUNTDOWN" ||
              raceState === "FINISHED"
            }
          />
          <EffectComposer>
            {/* Only emissive trackside elements clear the threshold — the
                asphalt must not bloom into a white haze. */}
            <Bloom
              intensity={0.4}
              luminanceThreshold={0.68}
              luminanceSmoothing={0.9}
              mipmapBlur
            />
            <Vignette
              offset={0.3}
              darkness={0.6}
              blendFunction={BlendFunction.NORMAL}
            />
          </EffectComposer>
        </Suspense>
      </Canvas>

      <RaceUI onReturnToGarage={onReturnToGarage} />
    </div>
  );
}

export default RaceScene;
