import { useEffect, useRef } from "react";
import type { CarNFT, CarRarity } from "@chain-drift/shared";
import { DS, archetypeOf, rarityTextColor, tokenLabel } from "./design";

/**
 * The fleet, as a register.
 *
 * Every row is a bay number, a token and a rarity read as brightness. Hovering
 * a row lights the same car in the scene, so the list and the room are two
 * views of one selection rather than two controls.
 */

const RARITY_STEPS: Record<CarRarity, number> = {
  Common: 1,
  Rare: 2,
  Epic: 3,
  Legendary: 4,
};

function RarityMeter({ rarity }: { rarity: CarRarity }) {
  const steps = RARITY_STEPS[rarity];
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          style={{
            width: 8,
            height: 3,
            background: i < steps ? rarityTextColor(rarity) : DS.divider,
          }}
        />
      ))}
    </div>
  );
}

interface FleetIndexProps {
  cars:        CarNFT[];
  selectedId:  string | null;
  hoveredId:   string | null;
  onSelect:    (carId: string) => void;
  onHover:     (carId: string | null) => void;
  onOpen:      (carId: string) => void;
}

export function FleetIndex({
  cars,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  onOpen,
}: FleetIndexProps) {
  const activeRef = useRef<HTMLDivElement>(null);

  // Arrow keys and clicks in the scene both move the selection; the register
  // follows it rather than the other way round.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <div
      style={{
        width:      284,
        background: DS.surface,
        border:     `1px solid ${DS.border}`,
        fontFamily: DS.font,
      }}
    >
      <div
        style={{
          display:        "flex",
          justifyContent: "space-between",
          padding:        "11px 14px",
          borderBottom:   `1px solid ${DS.divider}`,
          fontSize:       8,
          letterSpacing:  "0.22em",
          color:          DS.textDisabled,
        }}
      >
        <span>FLEET REGISTER</span>
        <span>{String(cars.length).padStart(2, "0")} UNITS</span>
      </div>

      <div style={{ maxHeight: "34vh", overflowY: "auto" }}>
        {cars.map((car, i) => {
          const active  = car.id === selectedId;
          const hovered = car.id === hoveredId;

          return (
            <div
              key={car.id}
              ref={active ? activeRef : undefined}
              onClick={() => onSelect(car.id)}
              onDoubleClick={() => onOpen(car.id)}
              onMouseEnter={() => onHover(car.id)}
              onMouseLeave={() => onHover(null)}
              style={{
                display:       "flex",
                alignItems:    "center",
                gap:           12,
                padding:       "10px 14px",
                cursor:        "pointer",
                borderBottom:  `1px solid ${DS.divider}`,
                borderLeft:    `2px solid ${active ? DS.textPrimary : "transparent"}`,
                background:    active ? "#181818" : hovered ? "#141414" : "transparent",
                transition:    "background 120ms linear",
              }}
            >
              <span
                style={{
                  fontSize:   9,
                  fontWeight: 700,
                  color:      active ? DS.textPrimary : DS.textDisabled,
                  width:      18,
                  flexShrink: 0,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize:      11,
                    fontWeight:    active ? 700 : 500,
                    letterSpacing: "0.08em",
                    color:         active ? DS.textPrimary : DS.textMeta,
                  }}
                >
                  {tokenLabel(car.tokenId)}
                </div>
                <div
                  style={{
                    fontSize:      8,
                    letterSpacing: "0.16em",
                    color:         DS.textDisabled,
                    overflow:      "hidden",
                    textOverflow:  "ellipsis",
                    whiteSpace:    "nowrap",
                  }}
                >
                  {archetypeOf(car)}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span style={{ fontSize: 8, letterSpacing: "0.16em", color: rarityTextColor(car.rarity) }}>
                  {car.rarity.toUpperCase()}
                </span>
                <RarityMeter rarity={car.rarity} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
