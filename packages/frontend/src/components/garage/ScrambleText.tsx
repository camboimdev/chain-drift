import { useEffect, useState } from "react";

/**
 * A readout settling on a new value.
 *
 * Characters resolve left to right out of hex noise — the way a field updates
 * on a telemetry bus, not a fade. Short enough (200ms) to stay mechanical.
 */

const GLYPHS = "0123456789ABCDEF";

function noise(): string {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
}

function useScramble(value: string, duration = 200): string {
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    let frame = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const resolved = Math.floor(t * value.length);
      setDisplay(
        value
          .split("")
          .map((ch, i) => (i < resolved || ch === " " || ch === "#" ? ch : noise()))
          .join("")
      );
      if (t < 1) frame = requestAnimationFrame(tick);
      else setDisplay(value);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return display;
}

export function ScrambleText({
  text,
  duration,
  style,
}: {
  text: string;
  duration?: number;
  style?: React.CSSProperties;
}) {
  const display = useScramble(text, duration);
  return <span style={style}>{display}</span>;
}
