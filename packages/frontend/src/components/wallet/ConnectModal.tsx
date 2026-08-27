/**
 * ConnectModal — the wallet picker.
 *
 * Follows the shape players already know from other dapps: every wallet the
 * browser announced over EIP-6963 on top, Coinbase Wallet and WalletConnect
 * below, a per-wallet connecting state, and a QR for mobile wallets drawn
 * inside this panel instead of WalletConnect's own overlay.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { CHAIN_ID, NETWORK_LABEL } from "../../config/chain";
import { WALLETCONNECT_PROJECT_ID } from "../../config/wagmi";
import {
  rememberConnector,
  readLastConnectorId,
  useWalletOptions,
  type WalletOption,
} from "../../hooks/useWalletOptions";
import { DS } from "./design";
import { QrCode } from "./QrCode";
import { WalletMark } from "./WalletMark";

type View = "list" | "connecting" | "qr";

/** How long the pairing code may take before the panel calls it a failure. */
const PAIRING_TIMEOUT_MS = 15_000;

interface ConnectModalProps {
  open: boolean;
  onClose: () => void;
}

/** Wallet errors are verbose and RPC-shaped; players need one short line. */
function readableError(err: unknown): string {
  const code = (err as { code?: number })?.code;
  const raw = err instanceof Error ? err.message : String(err);
  if (code === 4001 || /user rejected|user denied|rejected the request/i.test(raw)) {
    return "REQUEST REJECTED IN WALLET";
  }
  if (/already pending|already processing/i.test(raw)) {
    return "A REQUEST IS ALREADY OPEN IN YOUR WALLET";
  }
  return raw.split("\n")[0]!.slice(0, 140).toUpperCase();
}

export function ConnectModal({ open, onClose }: ConnectModalProps) {
  const options = useWalletOptions();
  const { connectAsync } = useConnect();
  const { isConnected } = useAccount();

  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<WalletOption | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Bumped on every new attempt so a late rejection from an abandoned one
  // cannot repaint the panel the player has already moved on from.
  const attemptRef = useRef(0);
  const lastConnectorId = readLastConnectorId();

  const reset = useCallback(() => {
    attemptRef.current += 1;
    setView("list");
    setSelected(null);
    setUri(null);
    setError(null);
    setCopied(false);
  }, []);

  // The pairing URI only exists while WalletConnect is negotiating, and it
  // arrives on the connector's own event stream.
  useEffect(() => {
    const walletConnect = options.find((o) => o.kind === "walletconnect")?.connector;
    if (!walletConnect) return;
    const onMessage = (payload: { type: string; data?: unknown }) => {
      if (payload.type === "display_uri" && typeof payload.data === "string") {
        setUri(payload.data);
      }
    };
    walletConnect.emitter.on("message", onMessage);
    return () => walletConnect.emitter.off("message", onMessage);
  }, [options]);

  // A blocked relay (bad project ID, firewalled websocket) never rejects — the
  // provider just keeps retrying — so the panel would spin forever without this.
  useEffect(() => {
    if (view !== "qr" || uri || error) return;
    const timer = setTimeout(
      () => setError("COULD NOT REACH THE WALLETCONNECT RELAY"),
      PAIRING_TIMEOUT_MS
    );
    return () => clearTimeout(timer);
  }, [view, uri, error]);

  // Reconnect-on-load or a session approved on the phone both land here.
  useEffect(() => {
    if (open && isConnected) {
      reset();
      onClose();
    }
  }, [open, isConnected, onClose, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (view === "list") onClose();
      else reset();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, view, onClose, reset]);

  // The panel scrolls, the page behind it must not.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const select = useCallback(
    async (option: WalletOption) => {
      attemptRef.current += 1;
      const attempt = attemptRef.current;

      setSelected(option);
      setError(null);
      setUri(null);
      setCopied(false);
      setView(option.kind === "walletconnect" ? "qr" : "connecting");

      try {
        await connectAsync({ connector: option.connector, chainId: CHAIN_ID });
        if (attemptRef.current !== attempt) return;
        rememberConnector(option.connector.id);
        reset();
        onClose();
      } catch (err) {
        if (attemptRef.current !== attempt) return;
        setError(readableError(err));
        console.error("[Wallet] Connection error:", err);
      }
    },
    [connectAsync, onClose, reset]
  );

  const goBack = useCallback(() => {
    // A pairing left half-open would hand out a stale URI on the next attempt.
    if (selected?.kind === "walletconnect") {
      void selected.connector.disconnect().catch(() => {});
    }
    reset();
  }, [selected, reset]);

  const copyUri = useCallback(async () => {
    if (!uri) return;
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("CLIPBOARD UNAVAILABLE");
    }
  }, [uri]);

  if (!open) return null;

  const title =
    view === "list" ? "CONNECT WALLET" : (selected?.name ?? "CONNECT").toUpperCase();

  return (
    <>
      <style>{`
        @keyframes cd-modal-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes cd-modal-rise {
          from { opacity: 0; transform: translateY(8px) }
          to   { opacity: 1; transform: translateY(0) }
        }
        @keyframes cd-scan {
          0%   { transform: translateX(-100%) }
          100% { transform: translateX(100%) }
        }
        .cd-connect-backdrop { animation: cd-modal-fade 120ms ease forwards; }
        .cd-connect-panel { animation: cd-modal-rise 150ms ease forwards; }
        .cd-connect-row:hover { background: ${DS.bg}; border-color: ${DS.textDisabled}; }
        .cd-connect-row:hover .cd-connect-chevron { color: ${DS.textPrimary}; }
      `}</style>

      <div
        className="cd-connect-backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          background: "rgba(0,0,0,0.82)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: DS.font,
        }}
      >
        <div
          className="cd-connect-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Connect wallet"
          style={{
            width: "100%",
            maxWidth: 420,
            maxHeight: "calc(100vh - 48px)",
            overflowY: "auto",
            background: DS.surface,
            border: `1px solid ${DS.border}`,
          }}
        >
          {/* ── Header ── */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 16px",
              borderBottom: `1px solid ${DS.divider}`,
            }}
          >
            {view !== "list" && (
              <button
                onClick={goBack}
                aria-label="Back"
                style={{
                  background: "transparent",
                  border: "none",
                  color: DS.textDisabled,
                  cursor: "pointer",
                  padding: 0,
                  lineHeight: 1,
                  fontSize: 12,
                }}
              >
                ←
              </button>
            )}
            <span
              style={{
                flex: 1,
                fontSize: 9,
                fontWeight: 700,
                color: DS.textPrimary,
                letterSpacing: "0.24em",
              }}
            >
              {title}
            </span>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: "transparent",
                border: "none",
                color: DS.textDisabled,
                cursor: "pointer",
                padding: 0,
                lineHeight: 1,
                fontSize: 12,
              }}
            >
              ✕
            </button>
          </div>

          {/* ── Wallet list ── */}
          {view === "list" && (
            <>
              <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {options.length === 0 && (
                  <div
                    style={{
                      padding: "20px 12px",
                      border: `1px solid ${DS.divider}`,
                      fontSize: 9,
                      color: DS.textMeta,
                      letterSpacing: "0.12em",
                      lineHeight: 1.9,
                      textAlign: "center",
                    }}
                  >
                    NO WALLET DETECTED
                    <br />
                    INSTALL A BROWSER WALLET TO CONTINUE
                  </div>
                )}

                {options.map((option) => {
                  const isRecent = option.connector.id === lastConnectorId;
                  return (
                    <button
                      key={option.connector.uid}
                      className="cd-connect-row"
                      onClick={() => void select(option)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        width: "100%",
                        padding: "10px 12px",
                        background: "transparent",
                        border: `1px solid ${DS.divider}`,
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: DS.font,
                        transition: "background 150ms, border-color 150ms",
                      }}
                    >
                      <WalletMark kind={option.kind} name={option.name} icon={option.icon} />

                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span
                          style={{
                            display: "block",
                            fontSize: 11,
                            fontWeight: 700,
                            color: DS.textPrimary,
                            letterSpacing: "0.08em",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {option.name.toUpperCase()}
                        </span>
                        <span
                          style={{
                            display: "block",
                            marginTop: 3,
                            fontSize: 7,
                            color: DS.textDisabled,
                            letterSpacing: "0.18em",
                          }}
                        >
                          {option.subtitle}
                        </span>
                      </span>

                      {isRecent ? (
                        <span
                          style={{
                            fontSize: 7,
                            color: DS.accent,
                            letterSpacing: "0.18em",
                            border: `1px solid ${DS.accent}`,
                            padding: "3px 6px",
                          }}
                        >
                          RECENT
                        </span>
                      ) : option.installed ? (
                        <span
                          style={{ fontSize: 7, color: DS.textDisabled, letterSpacing: "0.18em" }}
                        >
                          INSTALLED
                        </span>
                      ) : null}

                      <span
                        className="cd-connect-chevron"
                        style={{ fontSize: 10, color: DS.textDisabled, transition: "color 150ms" }}
                      >
                        ›
                      </span>
                    </button>
                  );
                })}

                {!WALLETCONNECT_PROJECT_ID && import.meta.env.DEV && (
                  <div
                    style={{
                      padding: "10px 12px",
                      border: `1px dashed ${DS.divider}`,
                      fontSize: 7,
                      color: DS.textDisabled,
                      letterSpacing: "0.16em",
                      lineHeight: 1.9,
                    }}
                  >
                    WALLETCONNECT OFF — SET VITE_WALLETCONNECT_PROJECT_ID IN .env.local
                  </div>
                )}
              </div>

              {/* ── Footer ── */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 16px",
                  borderTop: `1px solid ${DS.divider}`,
                }}
              >
                <span style={{ fontSize: 7, color: DS.textDisabled, letterSpacing: "0.18em" }}>
                  NETWORK: {NETWORK_LABEL.toUpperCase()}
                </span>
                <a
                  href="https://ethereum.org/en/wallets/find-wallet/"
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: 7,
                    color: DS.textMeta,
                    letterSpacing: "0.18em",
                    textDecoration: "none",
                  }}
                >
                  NEW TO WALLETS? →
                </a>
              </div>
            </>
          )}

          {/* ── Connecting to a browser wallet ── */}
          {view === "connecting" && selected && (
            <div style={{ padding: "32px 24px", textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
                <WalletMark kind={selected.kind} name={selected.name} icon={selected.icon} />
              </div>

              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: DS.textPrimary,
                  letterSpacing: "0.2em",
                  marginBottom: 8,
                }}
              >
                {error ? "CONNECTION FAILED" : "REQUESTING CONNECTION"}
              </div>
              <div
                style={{
                  fontSize: 8,
                  color: DS.textMeta,
                  letterSpacing: "0.14em",
                  lineHeight: 1.9,
                }}
              >
                {error ?? `CONFIRM IN ${selected.name.toUpperCase()} TO CONTINUE`}
              </div>

              {!error && (
                <div
                  style={{
                    position: "relative",
                    height: 1,
                    margin: "24px 0 4px",
                    background: DS.divider,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: DS.textPrimary,
                      animation: "cd-scan 1100ms linear infinite",
                    }}
                  />
                </div>
              )}

              {error && (
                <button
                  onClick={() => void select(selected)}
                  style={{
                    marginTop: 24,
                    width: "100%",
                    padding: "12px",
                    background: "transparent",
                    border: `1px solid ${DS.textPrimary}`,
                    color: DS.textPrimary,
                    fontFamily: DS.font,
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.22em",
                    cursor: "pointer",
                  }}
                >
                  TRY AGAIN
                </button>
              )}
            </div>
          )}

          {/* ── WalletConnect QR ── */}
          {view === "qr" && selected && (
            <div style={{ padding: "24px 24px 20px", textAlign: "center" }}>
              <div
                style={{
                  width: 240,
                  height: 240,
                  margin: "0 auto 20px",
                  border: `1px solid ${DS.border}`,
                  background: DS.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {uri ? (
                  <QrCode value={uri} />
                ) : (
                  <span
                    style={{ fontSize: 8, color: DS.textDisabled, letterSpacing: "0.2em" }}
                  >
                    {error ? "PAIRING FAILED" : "GENERATING PAIRING CODE…"}
                  </span>
                )}
              </div>

              <div
                style={{
                  fontSize: 8,
                  color: DS.textMeta,
                  letterSpacing: "0.16em",
                  lineHeight: 1.9,
                  marginBottom: 16,
                }}
              >
                {error ?? "SCAN WITH YOUR MOBILE WALLET"}
              </div>

              <button
                onClick={error ? () => void select(selected) : () => void copyUri()}
                disabled={!error && !uri}
                style={{
                  width: "100%",
                  padding: "12px",
                  background: "transparent",
                  border: `1px solid ${!error && !uri ? DS.border : DS.textPrimary}`,
                  color: !error && !uri ? DS.textDisabled : DS.textPrimary,
                  fontFamily: DS.font,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.22em",
                  cursor: !error && !uri ? "not-allowed" : "pointer",
                }}
              >
                {error ? "TRY AGAIN" : copied ? "LINK COPIED" : "COPY LINK"}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
