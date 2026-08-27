import type { CarNFT } from "@chain-drift/shared";
import { calculateCarStats } from "@chain-drift/shared";
import { DS } from "./design";

/**
 * Segmented telemetry meters.
 *
 * Twelve discrete blocks rather than a bar: a value you can count is more in
 * keeping with a readout than one you have to estimate, and it holds the grid.
 */

const SEGMENTS = 12;

export function StatMeter({
  label,
  value,
  labelWidth = 96,
}: {
  label: string;
  value: number;
  labelWidth?: number;
}) {
  const filled = Math.max(0, Math.min(SEGMENTS, Math.round((value / 100) * SEGMENTS)));

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
      <span
        style={{
          fontSize:      8,
          color:         DS.textDisabled,
          letterSpacing: "0.18em",
          width:         labelWidth,
          flexShrink:    0,
        }}
      >
        {label}
      </span>

      <div style={{ display: "flex", gap: 2, flex: 1 }}>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            style={{
              flex:            1,
              height:          7,
              background:      i < filled ? DS.textPrimary : DS.divider,
              transition:      "background 120ms linear",
              transitionDelay: `${i * 14}ms`,
            }}
          />
        ))}
      </div>

      <span
        style={{
          fontSize:   10,
          fontWeight: 700,
          color:      DS.textPrimary,
          width:      24,
          textAlign:  "right",
          flexShrink: 0,
        }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The car's driving profile, straight from `calculateCarStats` — the same
 * numbers the race animation drives with. They shape how a car looks on the
 * way to a finish order that Chainlink VRF has already settled, which is why
 * the panels that show them say so.
 */
export function CarStatBlock({ car, labelWidth }: { car: CarNFT; labelWidth?: number }) {
  const stats = calculateCarStats(car);

  return (
    <div>
      <StatMeter label="SPEED"       value={stats.speed}        labelWidth={labelWidth} />
      <StatMeter label="ACCEL"       value={stats.acceleration} labelWidth={labelWidth} />
      <StatMeter label="HANDLING"    value={stats.handling}     labelWidth={labelWidth} />
      <StatMeter label="RELIABILITY" value={stats.reliability}  labelWidth={labelWidth} />
    </div>
  );
}
