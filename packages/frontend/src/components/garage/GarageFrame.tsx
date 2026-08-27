import { DS, shortAddress } from "./design";
import type { GarageMode } from "./layout";

/**
 * The chrome around the bay: frame, header, mode cluster.
 *
 * Everything here is 1px and aligned to the same edges — the HUD should read as
 * an instrument bezel over the scene, never as a window on top of it.
 */

const CORNER = 22;

/** Reticle brackets at the four corners of the viewport. */
export function CornerFrame() {
  const corners: React.CSSProperties[] = [
    { top: 16, left: 16,  borderTop: `1px solid ${DS.border}`, borderLeft: `1px solid ${DS.border}` },
    { top: 16, right: 16, borderTop: `1px solid ${DS.border}`, borderRight: `1px solid ${DS.border}` },
    { bottom: 16, left: 16,  borderBottom: `1px solid ${DS.border}`, borderLeft: `1px solid ${DS.border}` },
    { bottom: 16, right: 16, borderBottom: `1px solid ${DS.border}`, borderRight: `1px solid ${DS.border}` },
  ];

  return (
    <>
      {corners.map((style, i) => (
        <div
          key={i}
          style={{ position: "absolute", width: CORNER, height: CORNER, pointerEvents: "none", ...style }}
        />
      ))}
    </>
  );
}

export function GhostButton({
  label,
  onClick,
  primary = false,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  const idle = primary ? DS.textPrimary : DS.border;
  const text = primary ? DS.textPrimary : DS.textMeta;

  return (
    <button
      onClick={onClick}
      style={{
        padding:       primary ? "14px 34px" : "8px 16px",
        background:    "transparent",
        border:        `1px solid ${idle}`,
        color:         text,
        fontFamily:    DS.font,
        fontSize:      primary ? 11 : 9,
        fontWeight:    700,
        letterSpacing: "0.2em",
        cursor:        "pointer",
        pointerEvents: "auto",
        transition:    "background 150ms, color 150ms, border-color 150ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background  = DS.textPrimary;
        e.currentTarget.style.color       = DS.bg;
        e.currentTarget.style.borderColor = DS.textPrimary;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background  = "transparent";
        e.currentTarget.style.color       = text;
        e.currentTarget.style.borderColor = idle;
      }}
    >
      {label}
    </button>
  );
}

export function GarageHeader({
  playerId,
  index,
  total,
  onOpenLeaderboard,
}: {
  playerId: string;
  index: number;
  total: number;
  onOpenLeaderboard?: () => void;
}) {
  return (
    <div style={{ position: "absolute", top: 30, left: 34, pointerEvents: "none" }}>
      <div style={{ fontSize: 8, letterSpacing: "0.34em", color: DS.textDisabled }}>
        CHAIN DRIFT
      </div>
      <div
        style={{
          fontSize:      26,
          fontWeight:    700,
          letterSpacing: "0.14em",
          color:         DS.textPrimary,
          lineHeight:    1.1,
          marginTop:     2,
        }}
      >
        GARAGE
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 8, letterSpacing: "0.16em" }}>
        <span style={{ color: DS.textDisabled }}>
          OWNER <span style={{ color: DS.textMeta }}>{shortAddress(playerId)}</span>
        </span>
        {total > 0 && (
          <span style={{ color: DS.textDisabled }}>
            BAY <span style={{ color: DS.textMeta }}>
              {String(index + 1).padStart(2, "0")}/{String(total).padStart(2, "0")}
            </span>
          </span>
        )}
      </div>

      {onOpenLeaderboard && (
        <div style={{ marginTop: 14 }}>
          <GhostButton label="LEADERBOARD" onClick={onOpenLeaderboard} />
        </div>
      )}
    </div>
  );
}

// ─── Mode cluster ────────────────────────────────────────────────────────────

const MODES: { id: GarageMode; label: string }[] = [
  { id: "gallery", label: "GALLERY" },
  { id: "fleet",   label: "FLEET" },
  { id: "inspect", label: "INSPECT" },
];

function StepButton({ glyph, onClick, disabled }: { glyph: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width:      30,
        height:     30,
        background: "transparent",
        border:     `1px solid ${disabled ? DS.divider : DS.border}`,
        color:      disabled ? DS.textDisabled : DS.textMeta,
        fontFamily: DS.font,
        fontSize:   12,
        cursor:     disabled ? "default" : "pointer",
        transition: "border-color 150ms, color 150ms",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.borderColor = DS.textPrimary;
        e.currentTarget.style.color       = DS.textPrimary;
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.borderColor = DS.border;
        e.currentTarget.style.color       = DS.textMeta;
      }}
    >
      {glyph}
    </button>
  );
}

export function ModeCluster({
  mode,
  onMode,
  index,
  total,
  onStep,
}: {
  mode: GarageMode;
  onMode: (mode: GarageMode) => void;
  index: number;
  total: number;
  onStep: (step: number) => void;
}) {
  const single = total <= 1;

  return (
    <div
      style={{
        position:      "absolute",
        bottom:        34,
        left:          "50%",
        transform:     "translateX(-50%)",
        pointerEvents: "auto",
        fontFamily:    DS.font,
        display:       "flex",
        flexDirection: "column",
        alignItems:    "center",
        gap:           10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <StepButton glyph="←" onClick={() => onStep(-1)} disabled={single} />
        <span
          style={{
            fontSize:      10,
            fontWeight:    700,
            letterSpacing: "0.22em",
            color:         DS.textPrimary,
            minWidth:      64,
            textAlign:     "center",
          }}
        >
          {String(index + 1).padStart(2, "0")}
          <span style={{ color: DS.textDisabled }}> / {String(total).padStart(2, "0")}</span>
        </span>
        <StepButton glyph="→" onClick={() => onStep(1)} disabled={single} />

        <span style={{ width: 1, height: 22, background: DS.divider, margin: "0 6px" }} />

        <div style={{ display: "flex" }}>
          {MODES.map(({ id, label }) => {
            const active = id === mode;
            return (
              <button
                key={id}
                onClick={() => onMode(id)}
                style={{
                  padding:       "8px 16px",
                  background:    active ? DS.textPrimary : "transparent",
                  border:        `1px solid ${active ? DS.textPrimary : DS.border}`,
                  borderLeft:    active ? undefined : `1px solid ${DS.border}`,
                  marginLeft:    -1,
                  color:         active ? DS.bg : DS.textMeta,
                  fontFamily:    DS.font,
                  fontSize:      9,
                  fontWeight:    700,
                  letterSpacing: "0.2em",
                  cursor:        "pointer",
                  transition:    "background 150ms, color 150ms, border-color 150ms",
                }}
                onMouseEnter={(e) => {
                  if (active) return;
                  e.currentTarget.style.borderColor = DS.textDisabled;
                  e.currentTarget.style.color       = DS.textPrimary;
                }}
                onMouseLeave={(e) => {
                  if (active) return;
                  e.currentTarget.style.borderColor = DS.border;
                  e.currentTarget.style.color       = DS.textMeta;
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 18, fontSize: 7, letterSpacing: "0.2em", color: DS.textDisabled }}>
        <span>← → UNIT</span>
        <span>G FLEET</span>
        <span>ENTER INSPECT</span>
        <span>ESC BACK</span>
      </div>
    </div>
  );
}
