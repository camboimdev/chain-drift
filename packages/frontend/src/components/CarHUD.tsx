import type { CarNFT } from "@chain-drift/shared";
import { CarStatBlock } from "./garage/StatBars";
import { CopyAddress } from "./CopyAddress";

const DS = {
  bg:            "#000000",
  surface:       "#111111",
  border:        "#2A2A2A",
  divider:       "#1A1A1A",
  textPrimary:   "#FFFFFF",
  textSecondary: "#E5E5E5",
  textMeta:      "#BFBFBF",
  textDisabled:  "#3A3A3A",
  accent:        "#00FF88",
  font:          "'JetBrains Mono', monospace",
};

interface CarHUDProps {
  car:     CarNFT;
  onClose: () => void;
}

function rarityColor(rarity?: string): string {
  switch (rarity) {
    case "Legendary": return DS.textPrimary;
    case "Epic":      return DS.textSecondary;
    case "Rare":      return DS.textMeta;
    default:          return DS.textDisabled;
  }
}

function AttributeRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        display:       "flex",
        alignItems:    "center",
        gap:           10,
        padding:       "7px 0",
        borderBottom:  `1px solid ${DS.divider}`,
      }}
    >
      <span
        style={{
          fontSize:      8,
          color:         DS.textDisabled,
          letterSpacing: "0.18em",
          width:         90,
          flexShrink:    0,
        }}
      >
        {String(label).toUpperCase()}
      </span>
      <span
        style={{
          flex:          1,
          fontSize:      8,
          color:         DS.textMeta,
          letterSpacing: "0.04em",
          overflow:      "hidden",
          textOverflow:  "ellipsis",
          whiteSpace:    "nowrap",
        }}
      >
        {String(value).toUpperCase()}
      </span>
    </div>
  );
}

export function CarHUD({ car, onClose }: CarHUDProps) {
  const attributes = car.attributes ?? [];
  const tokenStr   = `CDCAR #${car.tokenId}`;
  const ownerStr   = car.owner.length > 20 ? `${car.owner.slice(0, 18)}...` : car.owner;

  return (
    <div
      style={{
        position:      "absolute",
        inset:         0,
        pointerEvents: "none",
        fontFamily:    DS.font,
        zIndex:        10,
      }}
    >
      {/* Blink animation */}
      <style>{`
        @keyframes cd-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        .cd-live-dot { animation: cd-blink 1.4s step-start infinite; }
      `}</style>

      {/* ── Top-left: Vehicle identity ── */}
      <div
        style={{
          position:      "absolute",
          top:           28,
          left:          28,
          pointerEvents: "auto",
          background:    DS.surface,
          border:        `1px solid ${DS.border}`,
          padding:       "16px 20px",
          minWidth:      270,
        }}
      >
        <div
          style={{
            display:        "flex",
            justifyContent: "space-between",
            alignItems:     "center",
            marginBottom:   12,
          }}
        >
          <span style={{ fontSize: 8, color: DS.textDisabled, letterSpacing: "0.22em" }}>
            VEHICLE IDENTITY
          </span>
          <span
            style={{
              fontSize:      8,
              color:         DS.accent,
              letterSpacing: "0.1em",
              display:       "flex",
              alignItems:    "center",
              gap:           5,
            }}
          >
            <span className="cd-live-dot">●</span>
            LIVE
          </span>
        </div>

        <div
          style={{
            fontSize:      32,
            fontWeight:    700,
            color:         DS.textPrimary,
            letterSpacing: "0.03em",
            lineHeight:    1,
            marginBottom:  14,
          }}
        >
          #{String(car.tokenId).padStart(4, "0")}
        </div>

        <div
          style={{
            borderTop:      `1px solid ${DS.divider}`,
            paddingTop:     12,
            display:        "flex",
            flexDirection:  "column",
            gap:            9,
          }}
        >
          {[
            { label: "NAME",   value: car.name.toUpperCase(), color: DS.textMeta },
            { label: "RARITY", value: car.rarity.toUpperCase(), color: rarityColor(car.rarity) },
            { label: "TOKEN",  value: tokenStr, color: DS.textMeta },
            {
              label: "OWNER",
              value: (
                <CopyAddress
                  address={car.owner}
                  label={ownerStr}
                  color={DS.textDisabled}
                  fontSize={8}
                  letterSpacing="0.05em"
                />
              ),
              color: DS.textDisabled,
            },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontSize: 8, color: DS.textDisabled, letterSpacing: "0.18em", flexShrink: 0 }}>
                {label}
              </span>
              <span
                style={{
                  fontSize:      8,
                  color,
                  letterSpacing: "0.05em",
                  textAlign:     "right",
                  overflow:      "hidden",
                  textOverflow:  "ellipsis",
                  whiteSpace:    "nowrap",
                  maxWidth:      170,
                }}
              >
                {value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Bottom-left: Attributes ── */}
      <div
        style={{
          position:      "absolute",
          bottom:        28,
          left:          28,
          pointerEvents: "auto",
          background:    DS.surface,
          border:        `1px solid ${DS.border}`,
          padding:       "14px 20px",
          minWidth:      320,
        }}
      >
        <div
          style={{
            fontSize:      8,
            color:         DS.textDisabled,
            letterSpacing: "0.22em",
            marginBottom:  8,
            paddingBottom: 8,
            borderBottom:  `1px solid ${DS.divider}`,
          }}
        >
          DRIVING PROFILE
        </div>

        <CarStatBlock car={car} labelWidth={82} />

        <div
          style={{
            fontSize:      8,
            color:         DS.textDisabled,
            letterSpacing: "0.22em",
            margin:        "14px 0 8px",
            paddingBottom: 8,
            paddingTop:    12,
            borderTop:     `1px solid ${DS.divider}`,
            borderBottom:  `1px solid ${DS.divider}`,
          }}
        >
          ATTRIBUTES
        </div>
        {attributes.length > 0 ? (
          attributes.map(({ trait_type, value }) => (
            <AttributeRow key={trait_type} label={trait_type} value={value} />
          ))
        ) : (
          <div style={{ fontSize: 8, color: DS.textDisabled, padding: "8px 0" }}>
            No attributes
          </div>
        )}
      </div>

      {/* ── Bottom-right: Close ── */}
      <div
        style={{
          position:      "absolute",
          bottom:        28,
          right:         28,
          pointerEvents: "auto",
        }}
      >
        <button
          onClick={onClose}
          style={{
            background:    "transparent",
            border:        `1px solid ${DS.border}`,
            color:         DS.textMeta,
            fontFamily:    DS.font,
            fontSize:      10,
            fontWeight:    700,
            letterSpacing: "0.2em",
            padding:       "12px 26px",
            cursor:        "pointer",
            transition:    "background 150ms, color 150ms, border-color 150ms",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background   = DS.textPrimary;
            e.currentTarget.style.color        = DS.bg;
            e.currentTarget.style.borderColor  = DS.textPrimary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background  = "transparent";
            e.currentTarget.style.color       = DS.textMeta;
            e.currentTarget.style.borderColor = DS.border;
          }}
        >
          ← BACK
        </button>
      </div>

      {/* ── Bottom-center: Status line ── */}
      <div
        style={{
          position:      "absolute",
          bottom:        38,
          left:          "50%",
          transform:     "translateX(-50%)",
          pointerEvents: "none",
          display:       "flex",
          alignItems:    "center",
          gap:           14,
          fontSize:      8,
          letterSpacing: "0.18em",
          whiteSpace:    "nowrap",
        }}
      >
        <span style={{ color: DS.accent }}>SYNC: CONFIRMED</span>
        <span style={{ color: DS.textDisabled }}>·</span>
        <span style={{ color: DS.textDisabled }}>ON-CHAIN ASSET</span>
        <span style={{ color: DS.textDisabled }}>·</span>
        <span style={{ color: DS.textDisabled }}>CHAIN DRIFT PROTOCOL</span>
      </div>
    </div>
  );
}
