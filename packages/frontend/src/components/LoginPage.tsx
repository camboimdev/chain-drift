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

export function LoginPage() {
  const { connectWallet, state, error } = useWallet();
  const isConnecting = state === "connecting";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: DS.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
        fontFamily: DS.font,
      }}
    >
      {/* Subtle grid overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.04,
          backgroundImage: `linear-gradient(${DS.textPrimary} 1px, transparent 1px),
            linear-gradient(90deg, ${DS.textPrimary} 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 10,
          width: "100%",
          maxWidth: 480,
          padding: "0 32px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Wordmark */}
        <div style={{ marginBottom: 72, textAlign: "center" }}>
          <div
            style={{
              fontSize: 52,
              fontWeight: 700,
              color: DS.textPrimary,
              letterSpacing: "0.18em",
              lineHeight: 1,
              marginBottom: 12,
            }}
          >
            CHAIN DRIFT
          </div>
          <div
            style={{
              fontSize: 10,
              color: DS.textMeta,
              letterSpacing: "0.35em",
            }}
          >
            PRECISION · SPEED · OWNERSHIP
          </div>
        </div>

        {/* Connecting state */}
        {isConnecting && (
          <div
            style={{
              marginBottom: 32,
              textAlign: "center",
              width: "100%",
              padding: "16px",
              border: `1px solid ${DS.border}`,
              background: DS.surface,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: DS.textPrimary,
                letterSpacing: "0.2em",
                marginBottom: 6,
              }}
            >
              CONNECTING TO BLOCKCHAIN
            </div>
            <div style={{ fontSize: 10, color: DS.textMeta, letterSpacing: "0.1em" }}>
              CONFIRM IN YOUR WALLET
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              marginBottom: 24,
              width: "100%",
              padding: "12px 16px",
              border: `1px solid ${DS.border}`,
              fontSize: 11,
              color: DS.textPrimary,
              letterSpacing: "0.08em",
            }}
          >
            ERROR: {error}
          </div>
        )}

        {/* Connect button */}
        {!isConnecting && (
          <button
            onClick={connectWallet}
            disabled={isConnecting}
            style={{
              width: "100%",
              padding: "16px",
              background: "transparent",
              border: `1px solid ${DS.textPrimary}`,
              color: DS.textPrimary,
              fontFamily: DS.font,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.25em",
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
            CONNECT WALLET
          </button>
        )}

        {/* Feature grid */}
        <div
          style={{
            marginTop: 64,
            width: "100%",
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
          }}
        >
          {[
            {
              label: "NFT CARS",
              desc: "Unique on-chain assets with provable ownership",
            },
            {
              label: "CUSTOMIZE",
              desc: "Modular parts system. Infinite configurations",
            },
            {
              label: "RACE",
              desc: "Deterministic outcomes settled on-chain",
            },
          ].map((f) => (
            <div
              key={f.label}
              style={{
                padding: "24px 16px",
                border: `1px solid ${DS.divider}`,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: DS.textPrimary,
                  letterSpacing: "0.2em",
                  marginBottom: 10,
                }}
              >
                {f.label}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: DS.textMeta,
                  lineHeight: 1.6,
                }}
              >
                {f.desc}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: 48,
            fontSize: 9,
            color: DS.textDisabled,
            letterSpacing: "0.25em",
          }}
        >
          BUILT ON BASE
        </div>
      </div>
    </div>
  );
}
