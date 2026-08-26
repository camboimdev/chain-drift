/**
 * RaceWaitingRoom — live participant tracker.
 *
 * Polls the Race Escrow contract every 3s to show who has joined.
 * When the grid is full (status = Locked), the first client to see it
 * calls resolveRace, then polls until status = Paid.
 * Once Paid, calls onRaceResolved with the finish order.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { OnChainParticipant } from "../services/raceContract";
import {
  getRaceStatus,
  getParticipants,
  getRace,
  requestResolve,
} from "../services/raceContract";

const DS = {
  bg: "#000000",
  surface: "#0D0D0D",
  border: "#1A1A1A",
  accent: "#00FF88",
  textPrimary: "#FFFFFF",
  textMeta: "#BFBFBF",
  textDisabled: "#3A3A3A",
  font: "'JetBrains Mono', monospace",
} as const;

function shortAddr(addr: string): string {
  return addr.slice(0, 10) + "..." + addr.slice(-6);
}

function formatDrift(microDrift: bigint): string {
  return (Number(microDrift) / 1_000_000).toFixed(2) + " DRIFT";
}

export interface RaceResult {
  /** Car token IDs in finish order (index 0 = winner). */
  positions: number[];
  /** Map from carTokenId to payout in wei. */
  payouts: Record<number, bigint>;
}

interface RaceWaitingRoomProps {
  raceId: bigint;
  entryFee: bigint;
  walletAddress: string;
  /** Called when the race is resolved on-chain — start the 3D animation */
  onRaceResolved: (participants: OnChainParticipant[]) => void;
  onCancel: () => void;
}

type Phase =
  | "waiting"    // polling for more players
  | "resolving"  // VRF requested, waiting for the coordinator's callback
  | "done";      // resolved

export function RaceWaitingRoom({
  raceId,
  entryFee,
  walletAddress,
  onRaceResolved,
  onCancel,
}: RaceWaitingRoomProps) {
  const [participants, setParticipants] = useState<OnChainParticipant[]>([]);
  const [maxParticipants, setMaxParticipants] = useState(4);
  const [phase, setPhase] = useState<Phase>("waiting");
  const [error, _setError] = useState<string | null>(null);
  const [dots, setDots] = useState(".");
  const resolveAttempted = useRef(false);

  // Animated dots for loading indicator
  useEffect(() => {
    const t = setInterval(() => setDots((d) => (d.length >= 3 ? "." : d + ".")), 500);
    return () => clearInterval(t);
  }, []);

  // Load race config once
  useEffect(() => {
    getRace(raceId)
      .then((race) => setMaxParticipants(race.maxParticipants))
      .catch(() => {});
  }, [raceId]);

  const poll = useCallback(async () => {
    try {
      const [status, currentParticipants] = await Promise.all([
        getRaceStatus(raceId),
        getParticipants(raceId),
      ]);

      setParticipants(currentParticipants);

      if (status === "Locked" && !resolveAttempted.current) {
        resolveAttempted.current = true;
        setPhase("resolving");

        try {
          await requestResolve(raceId);
        } catch (e) {
          // Another client may have got there first — that's fine.
          console.warn("[WaitingRoom] requestResolve:", e);
        }
      }

      // The VRF callback lands a few blocks after the request, so the race sits
      // in Resolving until the coordinator answers.
      if (status === "Resolving") {
        resolveAttempted.current = true;
        setPhase("resolving");
      }

      if (status === "Paid") {
        setPhase("done");
        onRaceResolved(currentParticipants);
      }
    } catch (e) {
      console.error("[WaitingRoom] Poll error:", e);
    }
  }, [raceId, onRaceResolved]);

  useEffect(() => {
    if (phase === "done") return;
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [poll, phase]);

  const slots = participants.length;
  const prizePool = entryFee * BigInt(maxParticipants);
  const distributable = prizePool - (prizePool * 5n / 100n);

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
        justifyContent: "center",
        padding: 24,
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 9, letterSpacing: "0.4em", color: DS.accent, marginBottom: 8 }}>
          CHAIN DRIFT
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "0.1em" }}>
          {phase === "resolving" ? "RACE RESOLVING" : phase === "done" ? "RACE READY" : "WAITING ROOM"}
        </div>
        <div style={{ fontSize: 8, color: DS.textDisabled, letterSpacing: "0.2em", marginTop: 6 }}>
          RACE #{raceId}
        </div>
      </div>

      {/* Participant slots */}
      <div style={{ width: "100%", maxWidth: 480, marginBottom: 32 }}>
        <div style={{ fontSize: 8, letterSpacing: "0.25em", color: DS.textDisabled, marginBottom: 12 }}>
          GRID · {slots}/{maxParticipants}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Array.from({ length: maxParticipants }).map((_, i) => {
            const p = participants[i];
            const isMe = p?.owner.toLowerCase().includes(walletAddress.slice(4, 16).toLowerCase());

            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  border: `1px solid ${p ? DS.accent + "44" : DS.border}`,
                  padding: "12px 16px",
                  transition: "border-color 300ms",
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    background: p ? DS.accent : DS.border,
                    flexShrink: 0,
                    transition: "background 300ms",
                  }}
                />
                {p ? (
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em" }}>
                      {shortAddr(p.owner)}
                      {isMe && (
                        <span style={{ color: DS.accent, marginLeft: 8, fontSize: 7 }}>YOU</span>
                      )}
                    </div>
                    <div style={{ fontSize: 7, color: DS.textDisabled, letterSpacing: "0.1em", marginTop: 2 }}>
                      CAR #{p.carTokenId}
                    </div>
                  </div>
                ) : (
                  <div style={{ flex: 1, fontSize: 8, color: DS.textDisabled, letterSpacing: "0.2em" }}>
                    {i === slots ? `WAITING${dots}` : "WAITING..."}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Prize breakdown */}
      <div style={{ width: "100%", maxWidth: 480, border: `1px solid ${DS.border}`, padding: "16px", marginBottom: 24 }}>
        <div style={{ fontSize: 7, letterSpacing: "0.25em", color: DS.textDisabled, marginBottom: 10 }}>
          PRIZE BREAKDOWN
        </div>
        {[["1ST", "50%", distributable * 50n / 100n],
          ["2ND", "30%", distributable * 30n / 100n],
          ["3RD", "15%", distributable * 15n / 100n],
          ["4TH", "5%",  distributable * 5n / 100n],
        ].map(([pos, pct, amount]) => (
          <div
            key={String(pos)}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "4px 0",
              fontSize: 8,
              borderBottom: `1px solid ${DS.border}`,
            }}
          >
            <span style={{ color: DS.textDisabled, letterSpacing: "0.15em" }}>{String(pos)}</span>
            <span style={{ color: DS.textMeta }}>{String(pct)}</span>
            <span style={{ fontWeight: 700 }}>{formatDrift(amount as bigint)}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, fontSize: 7, color: DS.textDisabled }}>
          <span>PLATFORM FEE 5%</span>
          <span>{formatDrift(prizePool * 5n / 100n)}</span>
        </div>
      </div>

      {/* Status / error */}
      {error && (
        <div style={{ width: "100%", maxWidth: 480, border: "1px solid #FF4444", padding: "10px 14px", marginBottom: 16, fontSize: 8, color: "#FF4444", letterSpacing: "0.15em" }}>
          {error}
        </div>
      )}

      {phase === "waiting" && (
        <div style={{ fontSize: 8, color: DS.textDisabled, letterSpacing: "0.2em" }}>
          WAITING FOR PLAYERS · RACE STARTS WHEN GRID FULL
        </div>
      )}

      {phase === "resolving" && (
        <div style={{ fontSize: 8, color: DS.accent, letterSpacing: "0.2em" }}>
          GRID FULL · ON-CHAIN VRF RESOLVING{dots}
        </div>
      )}

      {phase === "waiting" && (
        <button
          onClick={onCancel}
          style={{
            marginTop: 24,
            background: "none",
            border: `1px solid ${DS.border}`,
            color: DS.textDisabled,
            fontFamily: DS.font,
            fontSize: 8,
            letterSpacing: "0.2em",
            padding: "10px 24px",
            cursor: "pointer",
          }}
        >
          CANCEL (REFUND AFTER 1H TIMEOUT)
        </button>
      )}
    </div>
  );
}
