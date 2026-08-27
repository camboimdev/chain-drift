import type { CarNFT } from "@chain-drift/shared";
import { DS, archetypeOf, rarityTextColor, shortAddress, tokenLabel, traitOf } from "./design";
import { ScrambleText } from "./ScrambleText";
import { CarStatBlock } from "./StatBars";

/**
 * The featured car's readout.
 *
 * Identity, driving profile and provenance in one column, in the order a
 * scrutineer would read them. The profile is the same one the race animation
 * uses; the line at the bottom says who actually decides the finish, because a
 * panel of stat bars invites exactly the wrong assumption.
 */

function Divider() {
  return <div style={{ height: 1, background: DS.divider, margin: "12px 0" }} />;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0" }}>
      <span style={{ fontSize: 8, letterSpacing: "0.18em", color: DS.textDisabled, flexShrink: 0 }}>
        {label}
      </span>
      <span
        style={{
          fontSize:      8,
          letterSpacing: "0.06em",
          color:         DS.textMeta,
          overflow:      "hidden",
          textOverflow:  "ellipsis",
          whiteSpace:    "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function SpecSheet({ car }: { car: CarNFT }) {
  return (
    <div
      style={{
        width:      320,
        background: DS.surface,
        border:     `1px solid ${DS.border}`,
        padding:    "14px 18px 16px",
        fontFamily: DS.font,
      }}
    >
      <div
        style={{
          display:        "flex",
          justifyContent: "space-between",
          alignItems:     "center",
          fontSize:       8,
          letterSpacing:  "0.22em",
          color:          DS.textDisabled,
        }}
      >
        <span>SPEC SHEET</span>
        <span style={{ color: rarityTextColor(car.rarity) }}>{car.rarity.toUpperCase()}</span>
      </div>

      <div
        style={{
          fontSize:      38,
          fontWeight:    700,
          lineHeight:    1.05,
          letterSpacing: "0.02em",
          color:         DS.textPrimary,
          marginTop:     10,
        }}
      >
        <ScrambleText text={tokenLabel(car.tokenId)} />
      </div>

      <div style={{ fontSize: 9, letterSpacing: "0.2em", color: DS.textMeta, marginTop: 6 }}>
        <ScrambleText text={archetypeOf(car)} />
      </div>

      <Divider />

      <CarStatBlock car={car} />

      <Divider />

      <MetaRow label="TOKEN" value={`CDCAR #${car.tokenId} · ${traitOf(car, "Neon Color")}`} />
      <MetaRow label="OWNER" value={shortAddress(car.owner)} />

      <div
        style={{
          marginTop:     12,
          paddingTop:    10,
          borderTop:     `1px solid ${DS.divider}`,
          fontSize:      7,
          letterSpacing: "0.2em",
          color:         DS.textDisabled,
        }}
      >
        PROFILE DRIVES THE ANIMATION · FINISH ORDER SETTLES ON CHAINLINK VRF
      </div>
    </div>
  );
}
