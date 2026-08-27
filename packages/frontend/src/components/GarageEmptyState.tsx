import { useEffect, useState } from "react";
import { useMintCar } from "../hooks/useMintCar";

const DS = {
  bg:          "#000000",
  surface:     "#111111",
  border:      "#2A2A2A",
  divider:     "#1A1A1A",
  textPrimary: "#FFFFFF",
  textMeta:    "#BFBFBF",
  textDisabled:"#3A3A3A",
  accent:      "#00FF88",
  danger:      "#FF4040",
  font:        "'JetBrains Mono', monospace",
};

interface GarageEmptyStateProps {
  onMintSuccess: () => void;
}

/** Geometric top-down car silhouette — wireframe scan aesthetic */
function CarSilhouette() {
  return (
    <svg
      width="320"
      height="110"
      viewBox="0 0 320 110"
      fill="none"
      style={{ display: "block", margin: "0 auto" }}
    >
      <style>{`
        @keyframes cd-scan {
          0%   { transform: translateY(0px);   opacity: 0; }
          10%  { opacity: 0.6; }
          90%  { opacity: 0.6; }
          100% { transform: translateY(110px); opacity: 0; }
        }
        .cd-scanline { animation: cd-scan 3s linear infinite; }
      `}</style>

      {/* Main body shell */}
      <path
        d="M32,90 L32,64 L52,64 L72,38 L196,38 L220,64 L288,64 L288,90 Z"
        stroke={DS.border}
        strokeWidth="1"
      />

      {/* Roof / cabin */}
      <path
        d="M80,38 L88,14 L220,14 L228,38"
        stroke={DS.textDisabled}
        strokeWidth="0.75"
        strokeDasharray="4 3"
      />

      {/* Windshield line */}
      <line x1="88" y1="14" x2="80" y2="38" stroke={DS.border} strokeWidth="0.75" />
      <line x1="220" y1="14" x2="228" y2="38" stroke={DS.border} strokeWidth="0.75" />

      {/* Front headlight */}
      <rect x="283" y="58" width="8" height="10" stroke={DS.textDisabled} strokeWidth="0.75" />

      {/* Rear taillight */}
      <rect x="29" y="58" width="8" height="10" stroke={DS.textDisabled} strokeWidth="0.75" />

      {/* Front wheel */}
      <circle cx="236" cy="90" r="22" stroke={DS.border} strokeWidth="1" />
      <circle cx="236" cy="90" r="10" stroke={DS.divider} strokeWidth="0.75" />
      <line x1="236" y1="68" x2="236" y2="112" stroke={DS.divider} strokeWidth="0.5" />
      <line x1="214" y1="90" x2="258" y2="90" stroke={DS.divider} strokeWidth="0.5" />

      {/* Rear wheel */}
      <circle cx="80" cy="90" r="22" stroke={DS.border} strokeWidth="1" />
      <circle cx="80" cy="90" r="10" stroke={DS.divider} strokeWidth="0.75" />
      <line x1="80" y1="68" x2="80" y2="112" stroke={DS.divider} strokeWidth="0.5" />
      <line x1="58" y1="90" x2="102" y2="90" stroke={DS.divider} strokeWidth="0.5" />

      {/* Door line */}
      <line x1="140" y1="38" x2="140" y2="90" stroke={DS.divider} strokeWidth="0.5" strokeDasharray="3 2" />

      {/* Cross-section lines */}
      <line x1="32" y1="90" x2="288" y2="90" stroke={DS.divider} strokeWidth="0.5" />

      {/* Scan line (animated) */}
      <rect
        className="cd-scanline"
        x="32"
        y="0"
        width="256"
        height="1"
        fill={DS.accent}
        opacity="0"
      />

      {/* Corner markers */}
      {[[32,38],[288,38],[32,90],[288,90]].map(([x,y], i) => (
        <g key={i}>
          <line x1={x-4} y1={y} x2={x+4} y2={y} stroke={DS.textDisabled} strokeWidth="0.75" />
          <line x1={x} y1={y-4} x2={x} y2={y+4} stroke={DS.textDisabled} strokeWidth="0.75" />
        </g>
      ))}
    </svg>
  );
}

export function GarageEmptyState({ onMintSuccess }: GarageEmptyStateProps) {
  const {
    mintFee,
    driftBalance,
    canAfford,
    state: mintState,
    txHash,
    error: errorMsg,
    mint,
  } = useMintCar();

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
          width:          560,
          background:     DS.bg,
          border:         `1px solid ${DS.border}`,
          pointerEvents:  "auto",
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display:        "flex",
            justifyContent: "space-between",
            alignItems:     "center",
            padding:        "14px 20px",
            borderBottom:   `1px solid ${DS.divider}`,
          }}
        >
          <span style={{ fontSize: 8, color: DS.textDisabled, letterSpacing: "0.22em" }}>
            CHAIN DRIFT / GARAGE
          </span>
          <span style={{ fontSize: 8, color: DS.textDisabled, letterSpacing: "0.18em" }}>
            VEHICLES REGISTERED:{" "}
            <span style={{ color: DS.danger }}>0</span>
          </span>
        </div>

        {/* ── Car silhouette + title ── */}
        <div style={{ padding: "32px 32px 20px" }}>
          <CarSilhouette />

          <div style={{ marginTop: 28, marginBottom: 6 }}>
            <div
              style={{
                fontSize:      26,
                fontWeight:    700,
                color:         DS.textPrimary,
                letterSpacing: "0.06em",
                lineHeight:    1,
              }}
            >
              GARAGE EMPTY
            </div>
          </div>
          <div style={{ fontSize: 9, color: DS.textDisabled, letterSpacing: "0.18em" }}>
            NO NFT ASSETS DETECTED ON THIS ADDRESS
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${DS.divider}`, margin: "0 20px" }} />

        {/* ── What a mint gives you ── */}
        {mintState !== "success" && (
          <div style={{ padding: "20px 20px 0" }}>
            <div
              style={{
                fontSize:      8,
                color:         DS.textDisabled,
                letterSpacing: "0.22em",
                marginBottom:  10,
              }}
            >
              NEXT IN COLLECTION
            </div>
            <div
              style={{
                fontSize:      8,
                color:         DS.textMeta,
                letterSpacing: "0.1em",
                lineHeight:    1.8,
              }}
            >
              The token ID you receive decides the car. Model, rarity and traits
              are fixed by the collection — nothing here is chosen for you to pick.
            </div>
          </div>
        )}

        {/* ── Mint cost + balance ── */}
        {mintState !== "success" && (
          <div
            style={{
              margin:       "16px 20px",
              padding:      "12px 16px",
              background:   DS.surface,
              border:       `1px solid ${DS.divider}`,
              display:      "flex",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ fontSize: 7, color: DS.textDisabled, letterSpacing: "0.2em", marginBottom: 4 }}>
                MINT COST
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: DS.textPrimary }}>
                {mintFee} DRIFT
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 7, color: DS.textDisabled, letterSpacing: "0.2em", marginBottom: 4 }}>
                YOUR BALANCE
              </div>
              <div
                style={{
                  fontSize:   14,
                  fontWeight: 700,
                  color:      driftBalance === null
                    ? DS.textDisabled
                    : canAfford
                    ? DS.textPrimary
                    : DS.danger,
                }}
              >
                {driftBalance === null ? "—" : `${driftBalance.toFixed(2)} DRIFT`}
              </div>
            </div>
          </div>
        )}

        {/* ── Status messages ── */}
        {mintState === "error" && (
          <div
            style={{
              margin:       "0 20px 14px",
              padding:      "10px 14px",
              border:       `1px solid ${DS.danger}`,
              fontSize:     8,
              color:        DS.danger,
              letterSpacing:"0.1em",
              lineHeight:   1.6,
              wordBreak:    "break-all",
            }}
          >
            ERROR: {errorMsg}
          </div>
        )}

        {mintState === "success" && (
          <div style={{ padding: "28px 20px" }}>
            <div
              style={{
                fontSize:     8,
                color:        DS.accent,
                letterSpacing:"0.22em",
                marginBottom: 12,
              }}
            >
              ● VEHICLE MINTED — TRANSACTION CONFIRMED
            </div>
            <div
              style={{
                padding:    "12px 14px",
                background: DS.surface,
                border:     `1px solid ${DS.divider}`,
                fontSize:   8,
                color:      DS.textMeta,
                letterSpacing: "0.06em",
                wordBreak:  "break-all",
                marginBottom: 20,
              }}
            >
              <span style={{ color: DS.textDisabled, letterSpacing: "0.18em" }}>TX: </span>
              {txHash}
            </div>
            <div style={{ fontSize: 8, color: DS.textDisabled, letterSpacing: "0.12em", marginBottom: 20 }}>
              Your car NFT is being confirmed on-chain.
              <br />
              It will appear in your garage after the next block.
            </div>
          </div>
        )}

        {/* ── CTA button ── */}
        <div style={{ padding: "0 20px 20px" }}>
          {mintState === "success" ? (
            <button
              onClick={onMintSuccess}
              style={{
                width:         "100%",
                padding:       "14px",
                background:    DS.accent,
                border:        `1px solid ${DS.accent}`,
                color:         DS.bg,
                fontFamily:    DS.font,
                fontSize:      10,
                fontWeight:    700,
                letterSpacing: "0.2em",
                cursor:        "pointer",
                transition:    "opacity 150ms",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.85"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
            >
              OPEN GARAGE
            </button>
          ) : mintState === "minting" ? (
            <div
              style={{
                width:         "100%",
                padding:       "14px",
                border:        `1px solid ${DS.border}`,
                color:         DS.textDisabled,
                fontFamily:    DS.font,
                fontSize:      10,
                fontWeight:    700,
                letterSpacing: "0.2em",
                textAlign:     "center",
              }}
            >
              <MintingLabel />
            </div>
          ) : (
            <button
              onClick={canAfford ? mint : undefined}
              disabled={!canAfford}
              style={{
                width:         "100%",
                padding:       "14px",
                background:    "transparent",
                border:        `1px solid ${canAfford ? DS.textPrimary : DS.border}`,
                color:         canAfford ? DS.textPrimary : DS.textDisabled,
                fontFamily:    DS.font,
                fontSize:      10,
                fontWeight:    700,
                letterSpacing: "0.2em",
                cursor:        canAfford ? "pointer" : "not-allowed",
                transition:    "background 150ms, color 150ms",
              }}
              onMouseEnter={(e) => {
                if (canAfford) {
                  (e.currentTarget as HTMLButtonElement).style.background = DS.textPrimary;
                  (e.currentTarget as HTMLButtonElement).style.color = DS.bg;
                }
              }}
              onMouseLeave={(e) => {
                if (canAfford) {
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  (e.currentTarget as HTMLButtonElement).style.color = DS.textPrimary;
                }
              }}
            >
              {canAfford
                ? "MINT FIRST VEHICLE"
                : "INSUFFICIENT DRIFT BALANCE"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MintingLabel() {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const id = setInterval(
      () => setDots((d) => (d.length >= 3 ? "" : d + ".")),
      400
    );
    return () => clearInterval(id);
  }, []);
  return <span>BROADCASTING{dots}</span>;
}
