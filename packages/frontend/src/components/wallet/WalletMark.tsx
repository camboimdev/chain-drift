/**
 * WalletMark — the 32px tile in front of every row in the connect modal.
 *
 * A wallet discovered over EIP-6963 ships its own icon, so that one is used
 * as-is; the SDK connectors get a monochrome mark drawn to the design system
 * instead of a stock logo.
 */

import type { WalletKind } from "../../hooks/useWalletOptions";
import { DS } from "./design";

const SIZE = 32;

function WalletConnectMark({ color }: { color: string }) {
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" fill="none" aria-hidden>
      <path
        d="M3 6.2c3.9-3.8 10.1-3.8 14 0"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="square"
      />
      <path
        d="M6 9.4c2.2-2.1 5.8-2.1 8 0"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="square"
      />
      <rect x="9" y="11.6" width="2" height="2" fill={color} />
    </svg>
  );
}

function CoinbaseMark({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="9" cy="9" r="8" stroke={color} strokeWidth="1.4" />
      <rect x="6" y="6" width="6" height="6" fill={color} />
    </svg>
  );
}

function BrowserWalletMark({ color }: { color: string }) {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden>
      <rect x="0.7" y="0.7" width="16.6" height="12.6" stroke={color} strokeWidth="1.4" />
      <line x1="0.7" y1="4.3" x2="17.3" y2="4.3" stroke={color} strokeWidth="1.4" />
      <rect x="11" y="6.5" width="4" height="3" fill={color} />
    </svg>
  );
}

interface WalletMarkProps {
  kind: WalletKind;
  name: string;
  icon?: string;
  color?: string;
}

export function WalletMark({ kind, name, icon, color = DS.textPrimary }: WalletMarkProps) {
  return (
    <span
      style={{
        width: SIZE,
        height: SIZE,
        flexShrink: 0,
        border: `1px solid ${DS.border}`,
        background: DS.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {icon ? (
        <img src={icon} alt={name} width={SIZE - 2} height={SIZE - 2} style={{ display: "block" }} />
      ) : kind === "walletconnect" ? (
        <WalletConnectMark color={color} />
      ) : kind === "coinbase" ? (
        <CoinbaseMark color={color} />
      ) : (
        <BrowserWalletMark color={color} />
      )}
    </span>
  );
}
