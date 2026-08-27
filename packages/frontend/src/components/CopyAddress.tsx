import { useCallback, useEffect, useRef, useState } from "react";
import { DS } from "./garage/design";

/**
 * CopyAddress — an address printed on screen that can leave the screen.
 *
 * Every address the app shows is truncated to fit, so reading one off the HUD
 * is never enough: the player has to be able to take it to an explorer, a
 * wallet or a block scanner. The row itself is the hit target and the glyph is
 * the affordance; the full address rides in `title` for a hover check.
 */

const FEEDBACK_MS = 1200;

/** `0x1234…cdef` — the shortest form still recognisable at a glance. */
function shortenAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // The async clipboard is secure-context only; a LAN dev host over plain http
  // falls back to the selection copy.
  const field = document.createElement("textarea");
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  document.execCommand("copy");
  field.remove();
}

function CopyGlyph({ copied }: { copied: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 10 10"
      fill="none"
      style={{ flexShrink: 0, opacity: copied ? 1 : 0.7 }}
    >
      {copied ? (
        <path d="M1 5.4L3.6 8L9 1.6" stroke="currentColor" strokeWidth="1.2" />
      ) : (
        <>
          <rect x="0.5" y="0.5" width="6" height="6" stroke="currentColor" strokeWidth="1" />
          <path d="M3.5 9.5H9.5V3.5" stroke="currentColor" strokeWidth="1" />
        </>
      )}
    </svg>
  );
}

interface CopyAddressProps {
  address: string;
  /** Rendered text. Defaults to the short form; pass one to keep a panel's own truncation. */
  label?: string;
  color?: string;
  fontSize?: number;
  fontWeight?: number;
  letterSpacing?: string;
}

export function CopyAddress({
  address,
  label,
  color = DS.textMeta,
  fontSize = 9,
  fontWeight = 400,
  letterSpacing = "0.06em",
}: CopyAddressProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(async () => {
    try {
      await writeClipboard(address);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), FEEDBACK_MS);
    } catch {
      // A blocked clipboard is not worth an error state — the address is still
      // on screen and selectable.
    }
  }, [address]);

  const tone = copied ? DS.accent : color;

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); void copy(); }}
      title={address}
      aria-label={copied ? "Address copied" : `Copy address ${address}`}
      style={{
        display:       "inline-flex",
        alignItems:    "center",
        gap:           6,
        maxWidth:      "100%",
        background:    "transparent",
        border:        "none",
        padding:       0,
        margin:        0,
        fontFamily:    DS.font,
        fontSize,
        fontWeight,
        letterSpacing,
        color:         tone,
        cursor:        "pointer",
        pointerEvents: "auto",
        transition:    "color 150ms",
      }}
      onMouseEnter={(e) => {
        if (!copied) e.currentTarget.style.color = DS.textPrimary;
      }}
      onMouseLeave={(e) => {
        if (!copied) e.currentTarget.style.color = color;
      }}
    >
      <span
        style={{
          overflow:     "hidden",
          textOverflow: "ellipsis",
          whiteSpace:   "nowrap",
        }}
      >
        {label ?? shortenAddress(address)}
      </span>
      <CopyGlyph copied={copied} />
    </button>
  );
}
