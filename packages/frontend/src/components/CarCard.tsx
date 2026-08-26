import type { CarNFT } from "@chain-drift/shared";

const DS = {
  bg:            "#000000",
  surface:       "#111111",
  border:        "#2A2A2A",
  divider:       "#1A1A1A",
  textPrimary:   "#FFFFFF",
  textSecondary: "#E5E5E5",
  textMeta:      "#BFBFBF",
  textDisabled:  "#3A3A3A",
  font:          "'JetBrains Mono', monospace",
};

const RARITY_BRIGHTNESS: Record<string, string> = {
  Legendary: DS.textPrimary,
  Epic:      DS.textSecondary,
  Rare:      DS.textMeta,
  Common:    DS.textDisabled,
};

const RARITY_SCORE: Record<string, number> = {
  Legendary: 98,
  Epic:      85,
  Rare:      70,
  Common:    50,
};

interface CarCardProps {
  car:        CarNFT;
  isSelected: boolean;
  onSelect:   () => void;
}

export function CarCard({ car, isSelected, onSelect }: CarCardProps) {
  const rarityColor = RARITY_BRIGHTNESS[car.rarity] ?? DS.textDisabled;
  const perfScore   = RARITY_SCORE[car.rarity]      ?? 50;
  const isLegendary = car.rarity === "Legendary";

  // Pull display attributes from collection manifest attributes
  const attrs      = car.attributes ?? [];
  const archetype  = attrs.find((a) => a.trait_type === "Archetype")?.value  ?? "—";
  const neonColor  = attrs.find((a) => a.trait_type === "Neon Color")?.value ?? "—";

  const dataRows = [
    { label: "ARCHETYPE", value: String(archetype).toUpperCase() },
    { label: "NEON",      value: String(neonColor).toUpperCase() },
    { label: "TOKEN",     value: `#${car.tokenId}` },
  ];

  return (
    <div
      onClick={onSelect}
      className={isLegendary && isSelected ? "legendary-glow" : ""}
      style={{
        padding:    "20px",
        border:     `1px solid ${isSelected ? DS.textPrimary : DS.border}`,
        borderLeft: `2px solid ${isSelected ? DS.textPrimary : "transparent"}`,
        background: isSelected ? DS.surface : DS.bg,
        cursor:     "pointer",
        fontFamily: DS.font,
        transition: "border-color 150ms, background 150ms",
      }}
    >
      {/* Header */}
      <div
        style={{
          display:        "flex",
          justifyContent: "space-between",
          alignItems:     "flex-start",
          marginBottom:   16,
        }}
      >
        <div>
          <div
            style={{
              fontSize:      12,
              fontWeight:    700,
              color:         DS.textPrimary,
              letterSpacing: "0.1em",
              marginBottom:  4,
              overflow:      "hidden",
              textOverflow:  "ellipsis",
              whiteSpace:    "nowrap",
              maxWidth:      160,
            }}
          >
            {car.name.toUpperCase()}
          </div>
          <div style={{ fontSize: 8, color: rarityColor, letterSpacing: "0.2em" }}>
            {car.rarity.toUpperCase()}
          </div>
        </div>

        {isSelected && (
          <div style={{ width: 8, height: 8, background: DS.textPrimary, flexShrink: 0 }} />
        )}
      </div>

      {/* Data rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
        {dataRows.map(({ label, value }) => (
          <div
            key={label}
            style={{
              display:        "flex",
              justifyContent: "space-between",
              alignItems:     "center",
              padding:        "6px 8px",
              background:     DS.divider,
            }}
          >
            <span style={{ fontSize: 8, color: DS.textDisabled, letterSpacing: "0.15em" }}>
              {label}
            </span>
            <span
              style={{
                fontSize:      9,
                color:         DS.textMeta,
                overflow:      "hidden",
                textOverflow:  "ellipsis",
                whiteSpace:    "nowrap",
                maxWidth:      120,
              }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Performance bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 8, color: DS.textDisabled, letterSpacing: "0.15em" }}>
            PERFORMANCE
          </span>
          <span style={{ fontSize: 9, fontWeight: 700, color: rarityColor }}>
            {perfScore}/100
          </span>
        </div>
        <div style={{ width: "100%", height: 2, background: DS.divider }}>
          <div style={{ width: `${perfScore}%`, height: "100%", background: rarityColor }} />
        </div>
      </div>
    </div>
  );
}
