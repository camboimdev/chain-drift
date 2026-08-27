import { useEffect, useState } from "react";
import { useRaceStore } from "../stores/raceStore";
import type { RaceParticipant, RaceResult } from "@chain-drift/shared";
import { formatDrift } from "@chain-drift/shared";
import { useWinnings } from "../hooks/useWinnings";

const DS = {
  bg: "#000000",
  surface: "#111111",
  border: "#2A2A2A",
  divider: "#1A1A1A",
  textPrimary: "#FFFFFF",
  textSecondary: "#E5E5E5",
  textMeta: "#BFBFBF",
  textDisabled: "#3A3A3A",
  accent: "#00FF88",
  font: "'JetBrains Mono', monospace",
};

// Rarity expressed via brightness only — no color
const RARITY_BRIGHTNESS: Record<string, string> = {
  Legendary: DS.textPrimary,
  Epic: DS.textSecondary,
  Rare: DS.textMeta,
  Common: DS.textDisabled,
};

function Leaderboard({
  participants,
  userCarId,
}: {
  participants: RaceParticipant[];
  userCarId: string | null;
}) {
  const sorted = [...participants].sort((a, b) => b.progress - a.progress);

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        background: DS.surface,
        border: `1px solid ${DS.border}`,
        padding: "16px",
        minWidth: 220,
        fontFamily: DS.font,
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: DS.textDisabled,
          letterSpacing: "0.2em",
          marginBottom: 12,
          paddingBottom: 8,
          borderBottom: `1px solid ${DS.divider}`,
        }}
      >
        LIVE STANDINGS
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {sorted.map((participant, index) => {
          const isUser = participant.car.id === userCarId;
          const brightnessColor = RARITY_BRIGHTNESS[participant.car.rarity] ?? DS.textDisabled;
          const posLabel = String(index + 1).padStart(2, "0");

          return (
            <div
              key={participant.car.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                background: isUser ? DS.divider : "transparent",
                borderLeft: isUser ? `2px solid ${DS.textPrimary}` : "2px solid transparent",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: index === 0 ? DS.textPrimary : DS.textDisabled,
                  width: 20,
                  flexShrink: 0,
                }}
              >
                {posLabel}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 10,
                    color: DS.textPrimary,
                    fontWeight: isUser ? 700 : 400,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginBottom: 2,
                  }}
                >
                  {participant.car.name.toUpperCase()}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span
                    style={{
                      fontSize: 8,
                      color: brightnessColor,
                      letterSpacing: "0.12em",
                    }}
                  >
                    {participant.car.rarity.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 8, color: DS.textDisabled }}>
                    {Math.round(participant.currentSpeed)} KM/H
                  </span>
                </div>
              </div>

              {isUser && (
                <span
                  style={{
                    fontSize: 7,
                    fontWeight: 700,
                    color: DS.textPrimary,
                    letterSpacing: "0.15em",
                  }}
                >
                  YOU
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RaceProgress({
  participants,
  userCarId,
}: {
  participants: RaceParticipant[];
  userCarId: string | null;
}) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 96,
        left: "50%",
        transform: "translateX(-50%)",
        width: "80%",
        maxWidth: 640,
        fontFamily: DS.font,
      }}
    >
      {/* Track bar */}
      <div
        style={{
          position: "relative",
          height: 24,
          background: DS.surface,
          border: `1px solid ${DS.border}`,
          overflow: "hidden",
        }}
      >
        {/* Quarter markers */}
        {[0.25, 0.5, 0.75].map((marker) => (
          <div
            key={marker}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${marker * 100}%`,
              width: 1,
              background: DS.divider,
            }}
          />
        ))}

        {/* Car markers */}
        {participants.map((participant) => {
          const isUser = participant.car.id === userCarId;
          return (
            <div
              key={participant.car.id}
              style={{
                position: "absolute",
                top: 4,
                bottom: 4,
                width: 16,
                left: `${Math.min(participant.progress * 100, 96)}%`,
                transform: "translateX(-50%)",
                background: isUser ? DS.textPrimary : DS.textDisabled,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: isUser ? 10 : 1,
                transition: "left 100ms linear",
              }}
            >
              <span
                style={{
                  fontSize: 7,
                  fontWeight: 700,
                  color: isUser ? DS.bg : DS.surface,
                  fontFamily: DS.font,
                }}
              >
                {participant.position}
              </span>
            </div>
          );
        })}

        {/* Finish marker */}
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: 20,
            background: DS.surface,
            borderLeft: `1px solid ${DS.textDisabled}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: 7, color: DS.textDisabled, fontFamily: DS.font }}>
            FIN
          </span>
        </div>
      </div>

      {/* Labels */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 4,
          fontSize: 8,
          color: DS.textDisabled,
          letterSpacing: "0.15em",
        }}
      >
        <span>START</span>
        <span>25%</span>
        <span>50%</span>
        <span>75%</span>
        <span>FINISH</span>
      </div>
    </div>
  );
}

function CountdownOverlay({ countdown }: { countdown: number }) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    setScale(1.4);
    const t = setTimeout(() => setScale(1), 100);
    return () => clearTimeout(t);
  }, [countdown]);

  if (countdown <= 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.4)",
        fontFamily: DS.font,
      }}
    >
      <div
        style={{
          fontSize: 180,
          fontWeight: 700,
          color: DS.textPrimary,
          transform: `scale(${scale})`,
          transition: "transform 200ms ease-out",
          letterSpacing: "-0.05em",
        }}
      >
        {countdown}
      </div>
    </div>
  );
}

function GoOverlay() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 900);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        fontFamily: DS.font,
      }}
    >
      <div
        style={{
          fontSize: 160,
          fontWeight: 700,
          color: DS.accent,
          letterSpacing: "0.05em",
          textShadow: `0 0 40px ${DS.accent}66`,
        }}
      >
        GO
      </div>
    </div>
  );
}

function RaceTimer({ elapsedTime }: { elapsedTime: number }) {
  const minutes = Math.floor(elapsedTime / 60);
  const seconds = Math.floor(elapsedTime % 60);
  const ms = Math.floor((elapsedTime % 1) * 100);

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        background: DS.surface,
        border: `1px solid ${DS.border}`,
        padding: "10px 24px",
        fontFamily: DS.font,
      }}
    >
      <span
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: DS.textPrimary,
          letterSpacing: "0.05em",
        }}
      >
        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}.
        {String(ms).padStart(2, "0")}
      </span>
    </div>
  );
}

function FinishScreen({
  result,
  userCarId,
  onClose,
  onRaceAgain,
}: {
  result: RaceResult;
  userCarId: string | null;
  onClose: () => void;
  onRaceAgain: () => void;
}) {
  const userPosition = result.positions.findIndex((p) => p.car.id === userCarId) + 1;
  const userPayout = result.payouts.find((p) => p.participantId === userCarId);

  // The payout is already booked against the player's address; `claim()` is
  // what actually moves it. The wallet drawer is hidden behind the race view,
  // so the offer has to be here too.
  const { pending, state: claimState, error: claimError, claim } = useWinnings();
  const hasWinnings = pending !== null && pending > 0n && claimState !== "success";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.85)",
        fontFamily: DS.font,
      }}
    >
      <div
        style={{
          background: DS.surface,
          border: `1px solid ${DS.border}`,
          padding: "40px",
          maxWidth: 480,
          width: "100%",
          margin: "0 16px",
        }}
      >
        {/* Winner */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div
            style={{
              fontSize: 9,
              color: DS.textDisabled,
              letterSpacing: "0.25em",
              marginBottom: 12,
            }}
          >
            RACE COMPLETE
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: DS.textPrimary,
              letterSpacing: "0.1em",
              marginBottom: 4,
            }}
          >
            {result.winner.car.name.toUpperCase()}
          </div>
          <div
            style={{
              fontSize: 9,
              color: DS.textDisabled,
              letterSpacing: "0.2em",
            }}
          >
            WINNER
          </div>
        </div>

        {/* Results table */}
        <div
          style={{
            borderTop: `1px solid ${DS.divider}`,
            marginBottom: 24,
          }}
        >
          {result.positions.map((participant, index) => {
            const isUser = participant.car.id === userCarId;
            const payout = result.payouts[index];
            const brightnessColor =
              RARITY_BRIGHTNESS[participant.car.rarity] ?? DS.textDisabled;
            const posLabel = String(index + 1).padStart(2, "0");

            return (
              <div
                key={participant.car.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "12px 0",
                  borderBottom: `1px solid ${DS.divider}`,
                  background: isUser ? DS.divider : "transparent",
                }}
              >
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: index === 0 ? DS.textPrimary : DS.textDisabled,
                    width: 28,
                    flexShrink: 0,
                    paddingLeft: 8,
                  }}
                >
                  {posLabel}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: DS.textPrimary,
                      fontWeight: isUser ? 700 : 400,
                      marginBottom: 2,
                    }}
                  >
                    {participant.car.name.toUpperCase()}
                  </div>
                  <span
                    style={{
                      fontSize: 8,
                      color: brightnessColor,
                      letterSpacing: "0.15em",
                    }}
                  >
                    {participant.car.rarity.toUpperCase()}
                  </span>
                </div>

                <div style={{ textAlign: "right", paddingRight: 8 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: DS.textPrimary,
                    }}
                  >
                    +{formatDrift(payout?.amount ?? 0n)}
                  </div>
                  <div style={{ fontSize: 8, color: DS.textDisabled }}>DRIFT</div>
                </div>

                {isUser && (
                  <div
                    style={{
                      fontSize: 7,
                      fontWeight: 700,
                      color: DS.textPrimary,
                      letterSpacing: "0.15em",
                      paddingRight: 8,
                    }}
                  >
                    YOU
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Player result */}
        {userPosition > 0 && (
          <div
            style={{
              border: `1px solid ${DS.border}`,
              padding: "16px",
              textAlign: "center",
              marginBottom: 24,
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: DS.textDisabled,
                letterSpacing: "0.2em",
                marginBottom: 8,
              }}
            >
              YOUR RESULT
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: DS.textPrimary,
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              {userPosition === 1
                ? "1ST PLACE"
                : userPosition === 2
                ? "2ND PLACE"
                : userPosition === 3
                ? "3RD PLACE"
                : `${userPosition}TH PLACE`}
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: DS.textPrimary,
              }}
            >
              +{formatDrift(userPayout?.amount ?? 0n)} DRIFT
            </div>
          </div>
        )}

        {/* Claim — the escrow credits, it does not transfer. */}
        {hasWinnings && (
          <div style={{ marginBottom: 20 }}>
            <button
              onClick={claimState === "claiming" ? undefined : claim}
              disabled={claimState === "claiming"}
              style={{
                width: "100%",
                padding: "14px",
                background: claimState === "claiming" ? "transparent" : DS.accent,
                border: `1px solid ${DS.accent}`,
                color: claimState === "claiming" ? DS.accent : DS.bg,
                fontFamily: DS.font,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.2em",
                cursor: claimState === "claiming" ? "wait" : "pointer",
              }}
            >
              {claimState === "claiming"
                ? "CLAIMING..."
                : `CLAIM ${formatDrift(pending ?? 0n)} DRIFT`}
            </button>
            {claimState === "error" && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 8,
                  color: "#FF4444",
                  letterSpacing: "0.08em",
                  lineHeight: 1.6,
                  wordBreak: "break-all",
                }}
              >
                {claimError}
              </div>
            )}
          </div>
        )}

        {claimState === "success" && (
          <div
            style={{
              marginBottom: 20,
              fontSize: 8,
              color: DS.accent,
              letterSpacing: "0.18em",
              textAlign: "center",
            }}
          >
            ● WINNINGS TRANSFERRED
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "14px",
              background: "transparent",
              border: `1px solid ${DS.textPrimary}`,
              color: DS.textPrimary,
              fontFamily: DS.font,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.2em",
              cursor: "pointer",
              transition: "background 150ms, color 150ms",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = DS.textPrimary;
              (e.currentTarget as HTMLButtonElement).style.color = DS.bg;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = DS.textPrimary;
            }}
          >
            RETURN TO GARAGE
          </button>
          <button
            onClick={onRaceAgain}
            style={{
              flex: 1,
              padding: "14px",
              background: "transparent",
              border: `1px solid ${DS.border}`,
              color: DS.textMeta,
              fontFamily: DS.font,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.2em",
              cursor: "pointer",
              transition: "border-color 150ms, color 150ms",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = DS.textPrimary;
              (e.currentTarget as HTMLButtonElement).style.color = DS.textPrimary;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = DS.border;
              (e.currentTarget as HTMLButtonElement).style.color = DS.textMeta;
            }}
          >
            RACE AGAIN
          </button>
        </div>
      </div>
    </div>
  );
}

function CameraModeIndicator({ mode }: { mode: string }) {
  const modeLabels: Record<string, string> = {
    OVERVIEW: "OVERVIEW",
    LEADER: "LEADER CAM",
    USER_CAR: "YOUR CAR",
    FINISH_LINE: "FINISH LINE",
    CINEMATIC: "CINEMATIC",
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: 16,
        background: DS.surface,
        border: `1px solid ${DS.border}`,
        padding: "8px 14px",
        fontFamily: DS.font,
      }}
    >
      <span
        style={{
          fontSize: 9,
          color: DS.textDisabled,
          letterSpacing: "0.2em",
        }}
      >
        CAM: {modeLabels[mode] ?? mode}
      </span>
    </div>
  );
}

interface RaceUIProps {
  onReturnToGarage: () => void;
  onRaceAgain: () => void;
}

export function RaceUI({ onReturnToGarage, onRaceAgain }: RaceUIProps) {
  const {
    raceState,
    participants,
    userCarId,
    countdown,
    elapsedTime,
    result,
    camera,
    resetRace,
  } = useRaceStore();

  const [showGo, setShowGo] = useState(false);

  useEffect(() => {
    if (raceState === "COUNTDOWN" && countdown === 0) {
      setShowGo(true);
      setTimeout(() => setShowGo(false), 1000);
    }
  }, [raceState, countdown]);

  const handleClose = () => {
    resetRace();
    onReturnToGarage();
  };

  const handleRaceAgain = () => {
    resetRace();
    onRaceAgain();
  };

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {raceState === "COUNTDOWN" && countdown > 0 && (
        <div style={{ pointerEvents: "auto" }}>
          <CountdownOverlay countdown={countdown} />
        </div>
      )}

      {showGo && <GoOverlay />}

      {(raceState === "RACING" || raceState === "COUNTDOWN") && (
        <>
          <RaceTimer elapsedTime={elapsedTime} />
          <Leaderboard participants={participants} userCarId={userCarId} />
          <RaceProgress participants={participants} userCarId={userCarId} />
          <CameraModeIndicator mode={camera.mode} />
        </>
      )}

      {raceState === "FINISHED" && result && (
        <div style={{ pointerEvents: "auto" }}>
          <FinishScreen
            result={result}
            userCarId={userCarId}
            onClose={handleClose}
            onRaceAgain={handleRaceAgain}
          />
        </div>
      )}
    </div>
  );
}

export default RaceUI;
