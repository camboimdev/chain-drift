/**
 * RaceWaitingRoom — live participant tracker.
 *
 * Polls the Race Escrow contract every 3s to show who has joined.
 * When the grid is full (status = Locked), the first client to see it
 * calls resolveRace, then polls until status = Paid.
 * Once Paid, calls onRaceResolved with the finish order.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  calculateRacePayouts,
  formatDrift,
  PLATFORM_FEE_BPS,
  BPS_DENOMINATOR,
} from "@chain-drift/shared";
import type { OnChainParticipant, RaceFinish } from "../services/raceContract";
import {
  getRaceStatus,
  getParticipants,
  getRace,
  getRaceFinish,
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

const POSITION_LABELS = ["1ST", "2ND", "3RD", "4TH"] as const;

/**
 * A position's share of the pool, as a percentage.
 *
 * Derived from the amount rather than read off the split constants: a room for
 * fewer than four renormalises the weights, so a 1st place there takes a larger
 * slice than the 50% the constant names.
 */
function shareOfPool(amount: bigint, pool: bigint): string {
  if (pool === 0n) return "0%";
  return `${Math.round(Number((amount * 1000n) / pool) / 10)}%`;
}

interface RaceWaitingRoomProps {
  raceId: bigint;
  entryFee: bigint;
  walletAddress: string;
  /** Called when the race is resolved on-chain — start the 3D animation */
  onRaceResolved: (finish: RaceFinish) => void;
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
  const [error, setError] = useState<string | null>(null);
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

      if (status === "Cancelled") {
        setError("This race was cancelled — your entry fee is claimable from the wallet panel.");
      }

      // The VRF callback lands a few blocks after the request, so the race sits
      // in Resolving until the coordinator answers.
      if (status === "Resolving") {
        resolveAttempted.current = true;
        setPhase("resolving");
      }

      if (status === "Paid") {
        // The finish order and the payouts both come from the escrow's own
        // `RaceFinished` log, so the animation and the results screen show what
        // the contract actually credited.
        const finish = await getRaceFinish(raceId);
        if (!finish) return; // log not indexed yet — the next poll will catch it

        setPhase("done");
        onRaceResolved(finish);
      }
    } catch (e) {
      console.error("[WaitingRoom] Poll error:", e);
      setError(e instanceof Error ? e.message : "Lost contact with the escrow contract");
    }
  }, [raceId, onRaceResolved]);

  useEffect(() => {
    if (phase === "done") return;
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [poll, phase]);

  const slots = participants.length;
  const { prizePool, platformFee, payouts } = calculateRacePayouts(entryFee, maxParticipants);
  const feePercent = Number((PLATFORM_FEE_BPS * 100n) / BPS_DENOMINATOR);

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
            const isMe = p?.owner.toLowerCase() === walletAddress.toLowerCase();

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
        {payouts.map((amount, i) => (
          <div
            key={POSITION_LABELS[i]}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "4px 0",
              fontSize: 8,
              borderBottom: `1px solid ${DS.border}`,
            }}
          >
            <span style={{ color: DS.textDisabled, letterSpacing: "0.15em" }}>
              {POSITION_LABELS[i]}
            </span>
            <span style={{ color: DS.textMeta }}>{shareOfPool(amount, prizePool)}</span>
            <span style={{ fontWeight: 700 }}>{formatDrift(amount)} DRIFT</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, fontSize: 7, color: DS.textDisabled }}>
          <span>POOL {formatDrift(prizePool)} · PLATFORM FEE {feePercent}%</span>
          <span>{formatDrift(platformFee)} DRIFT</span>
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
        <div
          style={{
            marginTop: 20,
            maxWidth: 480,
            textAlign: "center",
            fontSize: 7,
            color: DS.textDisabled,
            letterSpacing: "0.14em",
            lineHeight: 1.8,
          }}
        >
          YOUR ENTRY STAYS IN THE ESCROW EITHER WAY. IF THE GRID NEVER FILLS,
          THE RACE BECOMES REFUNDABLE ONE HOUR AFTER IT OPENED.
        </div>
      )}

      {phase === "waiting" && (
        <button
          onClick={onCancel}
          style={{
            marginTop: 16,
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
          LEAVE THIS SCREEN
        </button>
      )}
    </div>
  );
}
