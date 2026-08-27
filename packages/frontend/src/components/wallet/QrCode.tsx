/**
 * QrCode — the WalletConnect pairing URI, drawn as hard squares.
 *
 * The matrix is rendered by hand rather than through `qrcode`'s canvas helper
 * so the modules stay pixel-aligned and the quiet zone is explicit; scanners
 * need dark-on-light, so the tile stays white inside the dark panel.
 */

import { useMemo } from "react";
import QRCode from "qrcode";

const QUIET_ZONE = 2;

interface QrCodeProps {
  value: string;
  size?: number;
}

export function QrCode({ value, size = 208 }: QrCodeProps) {
  const matrix = useMemo(() => {
    try {
      const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
      return { size: modules.size, data: modules.data };
    } catch (err) {
      console.error("[Wallet] Failed to encode pairing URI:", err);
      return null;
    }
  }, [value]);

  if (!matrix) return null;

  const span = matrix.size + QUIET_ZONE * 2;
  const cells: string[] = [];
  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (matrix.data[y * matrix.size + x]) {
        cells.push(`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`);
      }
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="WalletConnect pairing QR code"
    >
      <rect width={span} height={span} fill="#FFFFFF" />
      <path d={cells.join("")} fill="#000000" />
    </svg>
  );
}
