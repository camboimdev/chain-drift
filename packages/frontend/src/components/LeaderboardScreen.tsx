/**
 * LeaderboardScreen — all-time standings, read from the Leaderboard contract.
 *
 * The escrow cannot write these itself: the payout runs inside a VRF callback
 * under a fixed gas limit. An off-chain recorder watches `RaceFinished` and
 * calls `recordResult`, so a race shows up here a few seconds after it settles
 * — or not at all, if nobody is running the recorder.
 */

import { useCallback, useEffect, useState } from "react";
import { formatDrift } from "@chain-drift/shared";
import { fetchRanking, type PlayerStats } from "../services/leaderboard";

const DS = {
  bg: "#000000",
  surface: "#0D0D0D",
  border: "#1A1A1A",
  divider: "#141414",
  accent: "#00FF88",
  textPrimary: "#FFFFFF",
  textMeta: "#BFBFBF",
  textDisabled: "#3A3A3A",
  font: "'JetBrains Mono', monospace",
} as const;

interface LeaderboardScreenProps {
  walletAddress: string;
  onClose: () => void;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

function winRate(p: PlayerStats): string {
  if (p.races === 0) return "—";
  return `${Math.round((p.wins / p.races) * 100)}%`;
}

const COLUMNS: { label: string; width: number; align: "left" | "right" }[] = [
  { label: "#",       width: 36,  align: "left"  },
  { label: "PLAYER",  width: 0,   align: "left"  },
  { label: "RACES",   width: 60,  align: "right" },
  { label: "WINS",    width: 60,  align: "right" },
  { label: "RATE",    width: 60,  align: "right" },
  { label: "EARNED",  width: 110, align: "right" },
];

export function LeaderboardScreen({ walletAddress, onClose }: LeaderboardScreenProps) {
  const [players, setPlayers] = useState<PlayerStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPlayers(await fetchRanking());
    } catch (e) {
      setPlayers([]);
      setError(e instanceof Error ? e.message : "Failed to read the leaderboard");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const me = walletAddress.toLowerCase();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: DS.bg,
        fontFamily: DS.font,
        color: DS.textPrimary,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "48px 24px",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{ fontSize: 9, letterSpacing: "0.4em", color: DS.accent, marginBottom: 8 }}>
          CHAIN DRIFT
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "0.1em" }}>LEADERBOARD</div>
        <div
          style={{
            fontSize: 8,
            color: DS.textDisabled,
            letterSpacing: "0.2em",
            marginTop: 6,
          }}
        >
          ALL-TIME · RANKED BY WINS, THEN DRIFT EARNED
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: 720 }}>
        {/* Column headers */}
        <div
          style={{
            display: "flex",
            gap: 12,
            padding: "0 16px 10px",
            fontSize: 7,
            color: DS.textDisabled,
            letterSpacing: "0.22em",
          }}
        >
          {COLUMNS.map((c) => (
            <span
              key={c.label}
              style={{
                width: c.width || undefined,
                flex: c.width ? undefined : 1,
                textAlign: c.align,
                flexShrink: 0,
              }}
            >
              {c.label}
            </span>
          ))}
        </div>

        {players === null ? (
          <div
            style={{
              textAlign: "center",
              padding: 40,
              fontSize: 9,
              color: DS.textDisabled,
              letterSpacing: "0.2em",
            }}
          >
            SCANNING CHAIN...
          </div>
        ) : players.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              border: `1px solid ${DS.border}`,
              padding: 40,
              fontSize: 9,
              color: DS.textDisabled,
              letterSpacing: "0.2em",
              lineHeight: 2,
            }}
          >
            NO RESULTS RECORDED YET
            <br />
            <span style={{ fontSize: 7, letterSpacing: "0.15em" }}>
              RACES APPEAR ONCE THE RECORDER HAS WRITTEN THEM
            </span>
          </div>
        ) : (
          <div style={{ border: `1px solid ${DS.border}` }}>
            {players.map((p, i) => {
              const isMe = p.address.toLowerCase() === me;
              return (
                <div
                  key={p.address}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    padding: "12px 16px",
                    borderBottom:
                      i === players.length - 1 ? "none" : `1px solid ${DS.divider}`,
                    background: isMe ? DS.surface : "transparent",
                    borderLeft: isMe ? `2px solid ${DS.accent}` : "2px solid transparent",
                  }}
                >
                  <span
                    style={{
                      width: 36,
                      flexShrink: 0,
                      fontSize: 10,
                      fontWeight: 700,
                      color: i < 3 ? DS.textPrimary : DS.textDisabled,
                      letterSpacing: "0.08em",
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 9,
                      color: isMe ? DS.accent : DS.textMeta,
                      letterSpacing: "0.06em",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {shortAddr(p.address)}
                    {isMe && <span style={{ marginLeft: 8, fontSize: 7 }}>YOU</span>}
                  </span>
                  <span style={{ width: 60, flexShrink: 0, textAlign: "right", fontSize: 9, color: DS.textMeta }}>
                    {p.races}
                  </span>
                  <span style={{ width: 60, flexShrink: 0, textAlign: "right", fontSize: 9, fontWeight: 700 }}>
                    {p.wins}
                  </span>
                  <span style={{ width: 60, flexShrink: 0, textAlign: "right", fontSize: 9, color: DS.textMeta }}>
                    {winRate(p)}
                  </span>
                  <span
                    style={{
                      width: 110,
                      flexShrink: 0,
                      textAlign: "right",
                      fontSize: 9,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatDrift(p.totalEarned)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {error && (
          <div
            style={{
              marginTop: 16,
              border: "1px solid #FF4444",
              padding: "10px 14px",
              fontSize: 8,
              color: "#FF4444",
              letterSpacing: "0.1em",
              wordBreak: "break-all",
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "14px",
              background: "transparent",
              border: `1px solid ${DS.textPrimary}`,
              color: DS.textPrimary,
              fontFamily: DS.font,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.2em",
              cursor: "pointer",
            }}
          >
            BACK TO GARAGE
          </button>
          <button
            onClick={load}
            style={{
              padding: "14px 24px",
              background: "transparent",
              border: `1px solid ${DS.border}`,
              color: DS.textDisabled,
              fontFamily: DS.font,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.2em",
              cursor: "pointer",
            }}
          >
            REFRESH
          </button>
        </div>
      </div>
    </div>
  );
}
