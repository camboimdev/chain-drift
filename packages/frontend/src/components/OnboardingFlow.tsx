import { useEffect, useState } from "react";
import { formatDrift, RACE_ENTRY_FEE, MAX_PARTICIPANTS } from "@chain-drift/shared";
import { useWallet } from "../context/walletContextValue";
import { fetchMintFeeDrift } from "../services/carNft";

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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 16,
        padding: "9px 0",
        borderBottom: `1px solid ${DS.divider}`,
      }}
    >
      <span style={{ fontSize: 8, color: DS.textDisabled, letterSpacing: "0.2em", flexShrink: 0 }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 10,
          color: DS.textPrimary,
          letterSpacing: "0.04em",
          textAlign: "right",
          wordBreak: "break-all",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Step({
  index,
  title,
  body,
}: {
  index: number;
  title: string;
  body: string;
}) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 16 }}>
      <span
        style={{
          fontSize: 9,
          color: DS.textDisabled,
          letterSpacing: "0.1em",
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        {String(index).padStart(2, "0")}
      </span>
      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: DS.textPrimary,
            letterSpacing: "0.14em",
            marginBottom: 4,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 10, color: DS.textMeta, letterSpacing: "0.04em", lineHeight: 1.6 }}>
          {body}
        </div>
      </div>
    </div>
  );
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const { wallet, completeOnboarding } = useWallet();
  const [currentStep, setCurrentStep] = useState(0);
  const [mintFee, setMintFee] = useState<number | null>(null);

  // Owner-settable on the contract, so the price the player is quoted here has
  // to be the one they will actually be charged.
  useEffect(() => {
    fetchMintFeeDrift()
      .then(setMintFee)
      .catch(() => setMintFee(null));
  }, []);

  const mintFeeLabel = mintFee === null ? "—" : `${mintFee} DRIFT`;
  const entryFeeLabel = `${formatDrift(RACE_ENTRY_FEE)} DRIFT`;

  const steps = [
    {
      title: "WALLET CONNECTED",
      content: (
        <div>
          <div
            style={{
              fontSize: 11,
              color: DS.textMeta,
              letterSpacing: "0.06em",
              lineHeight: 1.7,
              marginBottom: 24,
              textAlign: "center",
            }}
          >
            Your wallet is authenticated on {wallet?.network ?? "the game chain"}.
            <br />
            Everything below happens on-chain from here.
          </div>
          <div
            style={{
              padding: "4px 16px 12px",
              border: `1px solid ${DS.border}`,
              background: DS.surface,
            }}
          >
            <Field label="ADDRESS" value={wallet?.address ?? "—"} />
            <Field
              label="GAS"
              value={wallet ? `${(wallet.balance ?? 0).toFixed(4)} ETH` : "—"}
            />
            <Field
              label="DRIFT"
              value={wallet ? `${(wallet.driftBalance ?? 0).toFixed(2)} DRIFT` : "—"}
            />
          </div>
          <div
            style={{
              marginTop: 12,
              fontSize: 9,
              color: DS.textDisabled,
              letterSpacing: "0.08em",
              lineHeight: 1.6,
              textAlign: "center",
            }}
          >
            DRIFT pays for cars and race entries. ETH pays the gas.
          </div>
        </div>
      ),
    },
    {
      title: "HOW IT WORKS",
      content: (
        <div>
          <Step
            index={1}
            title={`MINT A CAR · ${mintFeeLabel}`}
            body="Your garage starts empty. Minting draws the next car in the Chain Drift collection — its model, rarity and traits come with the token."
          />
          <Step
            index={2}
            title={`ENTER A RACE · ${entryFeeLabel}`}
            body={`Open a room or join one. The grid locks at ${MAX_PARTICIPANTS} cars and the entry fees sit in the escrow contract until it settles.`}
          />
          <Step
            index={3}
            title="CHAINLINK VRF DECIDES"
            body="The finish order is drawn on-chain. Nothing in the browser can influence it — the animation replays a result that is already settled."
          />
          <Step
            index={4}
            title="CLAIM YOUR WINNINGS"
            body="Payouts are credited to your address, not transferred. Claim them from the wallet panel whenever you like."
          />
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
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 9, color: DS.textDisabled, letterSpacing: "0.2em" }}>
              SETUP
            </span>
            <span style={{ fontSize: 9, color: DS.textDisabled, letterSpacing: "0.1em" }}>
              {currentStep + 1}/{steps.length}
            </span>
          </div>
          <div style={{ width: "100%", height: 2, background: DS.divider }}>
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
        <div style={{ background: DS.surface, border: `1px solid ${DS.border}`, padding: "40px" }}>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
              style={{
                padding: "10px 24px",
                background: "transparent",
                border: `1px solid ${DS.textPrimary}`,
                color: DS.textPrimary,
                fontFamily: DS.font,
                fontSize: 9,
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
              {currentStep === steps.length - 1 ? "ENTER GARAGE" : "NEXT"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
