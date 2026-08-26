import { useState } from "react";
import { useWallet } from "../context/WalletContext";

const DS = {
  bg: "#000000",
  surface: "#111111",
  border: "#2A2A2A",
  divider: "#1A1A1A",
  textPrimary: "#FFFFFF",
  textMeta: "#BFBFBF",
  textDisabled: "#3A3A3A",
  font: "'JetBrains Mono', monospace",
};

interface OnboardingFlowProps {
  onComplete: () => void;
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const { wallet, completeOnboarding } = useWallet();
  const [currentStep, setCurrentStep] = useState(0);
  const [username, setUsername] = useState("");

  const steps = [
    {
      title: "WALLET CONNECTED",
      content: (
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 11,
              color: DS.textMeta,
              letterSpacing: "0.08em",
              lineHeight: 1.7,
              marginBottom: 24,
            }}
          >
            Your wallet has been authenticated.
            <br />
            You are now entering Chain Drift.
          </div>
          <div
            style={{
              padding: "16px",
              border: `1px solid ${DS.border}`,
              background: DS.surface,
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
              ADDRESS
            </div>
            <div
              style={{
                fontSize: 11,
                color: DS.textPrimary,
                wordBreak: "break-all",
              }}
            >
              {wallet?.address}
            </div>
            <div
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: `1px solid ${DS.divider}`,
                fontSize: 10,
                color: DS.textMeta,
              }}
            >
              BALANCE: {wallet?.balance?.toFixed(2) ?? "—"} CDT
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "CHOOSE CALLSIGN",
      content: (
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 11,
              color: DS.textMeta,
              letterSpacing: "0.08em",
              marginBottom: 24,
              lineHeight: 1.7,
            }}
          >
            Set your driver callsign.
            <br />
            This will identify you on the leaderboard.
          </div>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="ENTER CALLSIGN"
            maxLength={20}
            style={{
              width: "100%",
              maxWidth: 360,
              padding: "14px 16px",
              background: DS.surface,
              border: `1px solid ${DS.border}`,
              color: DS.textPrimary,
              fontFamily: DS.font,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.15em",
              textAlign: "center",
              outline: "none",
            }}
            onFocus={(e) => {
              (e.currentTarget as HTMLInputElement).style.borderColor = DS.textPrimary;
            }}
            onBlur={(e) => {
              (e.currentTarget as HTMLInputElement).style.borderColor = DS.border;
            }}
          />
          <div
            style={{
              marginTop: 8,
              fontSize: 9,
              color: DS.textDisabled,
              letterSpacing: "0.15em",
            }}
          >
            {username.length}/20
          </div>
        </div>
      ),
    },
    {
      title: "STARTER FLEET",
      content: (
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 11,
              color: DS.textMeta,
              letterSpacing: "0.08em",
              lineHeight: 1.7,
              marginBottom: 24,
            }}
          >
            5 starter vehicles have been assigned to your garage.
            <br />
            Each has unique on-chain attributes.
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: 8,
              marginBottom: 20,
            }}
          >
            {["01", "02", "03", "04", "05"].map((id) => (
              <div
                key={id}
                style={{
                  padding: "20px 0",
                  border: `1px solid ${DS.border}`,
                  background: DS.surface,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    width: 20,
                    height: 10,
                    background: DS.textDisabled,
                  }}
                />
                <div
                  style={{
                    fontSize: 8,
                    color: DS.textDisabled,
                    letterSpacing: "0.15em",
                  }}
                >
                  CAR {id}
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              fontSize: 10,
              color: DS.textDisabled,
              letterSpacing: "0.08em",
              lineHeight: 1.6,
            }}
          >
            Customize and race your vehicles from the garage.
          </div>
        </div>
      ),
    },
    {
      title: "READY",
      content: (
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 11,
              color: DS.textMeta,
              letterSpacing: "0.08em",
              lineHeight: 1.7,
              marginBottom: 24,
            }}
          >
            Your garage is initialized and ready.
          </div>
          <div
            style={{
              border: `1px solid ${DS.border}`,
              padding: "20px",
              textAlign: "left",
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: DS.textDisabled,
                letterSpacing: "0.2em",
                marginBottom: 12,
              }}
            >
              NEXT STEPS
            </div>
            {[
              "Select a vehicle from your garage",
              "Customize parts and configuration",
              "Enter a race — outcomes settled on-chain",
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  marginBottom: 10,
                  alignItems: "flex-start",
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    color: DS.textDisabled,
                    letterSpacing: "0.1em",
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: DS.textMeta,
                    lineHeight: 1.5,
                    letterSpacing: "0.05em",
                  }}
                >
                  {item}
                </span>
              </div>
            ))}
          </div>
        </div>
      ),
    },
  ];

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      completeOnboarding();
      onComplete();
    }
  };

  const canProceed = currentStep !== 1 || username.trim().length > 0;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: DS.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        fontFamily: DS.font,
      }}
    >
      <div style={{ width: "100%", maxWidth: 560 }}>
        {/* Progress bar */}
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontSize: 9,
                color: DS.textDisabled,
                letterSpacing: "0.2em",
              }}
            >
              SETUP
            </span>
            <span
              style={{
                fontSize: 9,
                color: DS.textDisabled,
                letterSpacing: "0.1em",
              }}
            >
              {currentStep + 1}/{steps.length}
            </span>
          </div>
          <div
            style={{
              width: "100%",
              height: 2,
              background: DS.divider,
            }}
          >
            <div
              style={{
                width: `${((currentStep + 1) / steps.length) * 100}%`,
                height: "100%",
                background: DS.textPrimary,
                transition: "width 200ms ease-out",
              }}
            />
          </div>
        </div>

        {/* Step card */}
        <div
          style={{
            background: DS.surface,
            border: `1px solid ${DS.border}`,
            padding: "40px",
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: DS.textPrimary,
              letterSpacing: "0.15em",
              marginBottom: 32,
              textAlign: "center",
            }}
          >
            {steps[currentStep].title}
          </div>

          <div style={{ marginBottom: 40 }}>{steps[currentStep].content}</div>

          {/* Navigation */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <button
              onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
              disabled={currentStep === 0}
              style={{
                padding: "10px 20px",
                background: "transparent",
                border: `1px solid ${currentStep === 0 ? DS.textDisabled : DS.border}`,
                color: currentStep === 0 ? DS.textDisabled : DS.textMeta,
                fontFamily: DS.font,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.2em",
                cursor: currentStep === 0 ? "not-allowed" : "pointer",
                transition: "border-color 150ms, color 150ms",
              }}
            >
              BACK
            </button>

            {/* Step dots */}
            <div style={{ display: "flex", gap: 8 }}>
              {steps.map((_, index) => (
                <div
                  key={index}
                  style={{
                    width: 6,
                    height: 6,
                    background: index <= currentStep ? DS.textPrimary : DS.textDisabled,
                    transition: "background 200ms",
                  }}
                />
              ))}
            </div>

            <button
              onClick={nextStep}
              disabled={!canProceed}
              style={{
                padding: "10px 24px",
                background: canProceed ? "transparent" : "transparent",
                border: `1px solid ${canProceed ? DS.textPrimary : DS.textDisabled}`,
                color: canProceed ? DS.textPrimary : DS.textDisabled,
                fontFamily: DS.font,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.2em",
                cursor: canProceed ? "pointer" : "not-allowed",
                transition: "background 150ms, color 150ms",
              }}
              onMouseEnter={(e) => {
                if (canProceed) {
                  (e.currentTarget as HTMLButtonElement).style.background = DS.textPrimary;
                  (e.currentTarget as HTMLButtonElement).style.color = DS.bg;
                }
              }}
              onMouseLeave={(e) => {
                if (canProceed) {
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  (e.currentTarget as HTMLButtonElement).style.color = DS.textPrimary;
                }
              }}
            >
              {currentStep === steps.length - 1 ? "ENTER GARAGE" : "NEXT"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
