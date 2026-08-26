import { useEffect, useRef, useState } from "react";
import { useWallet } from "../context/WalletContext";
import { mintCar, fetchMintFeeDrift, type CarArchetype } from "../services/carNft";

const DS = {
  bg:          "#000000",
  surface:     "#111111",
  border:      "#2A2A2A",
  divider:     "#1A1A1A",
  textPrimary: "#FFFFFF",
  textMeta:    "#BFBFBF",
  textDisabled:"#3A3A3A",
  accent:      "#00FF88",
  danger:      "#FF4040",
  font:        "'JetBrains Mono', monospace",
};

const ARCHETYPES: { id: CarArchetype; label: string }[] = [
  { id: "sport",    label: "SPORT"    },
  { id: "muscle",   label: "MUSCLE"   },
  { id: "stealth",  label: "STEALTH"  },
  { id: "electric", label: "ELECTRIC" },
  { id: "street",   label: "STREET"   },
];

type MintState = "idle" | "minting" | "success" | "error";

interface WalletHUDProps {
  fleetCount?: number;
  onMintSuccess?: () => void;
}

function fmtBalance(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
}

function WalletIcon() {
  return (
    <svg width="14" height="11" viewBox="0 0 14 11" fill="none" style={{ flexShrink: 0 }}>
      <rect x="0.5" y="0.5" width="13" height="10" stroke={DS.textMeta} strokeWidth="1" />
      <line x1="0.5" y1="3.5" x2="13.5" y2="3.5" stroke={DS.textMeta} strokeWidth="1" />
      <rect x="8.5" y="5" width="3.5" height="2.5" stroke={DS.textMeta} strokeWidth="0.75" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="8"
      height="5"
      viewBox="0 0 8 5"
      fill="none"
      style={{
        flexShrink: 0,
        transform: open ? "rotate(180deg)" : "none",
        transition: "transform 200ms",
      }}
    >
      <path d="M1 1L4 4L7 1" stroke={DS.textDisabled} strokeWidth="1.2" />
    </svg>
  );
}

function MintingLabel() {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const id = setInterval(
      () => setDots((d) => (d.length >= 3 ? "" : d + ".")),
      400
    );
    return () => clearInterval(id);
  }, []);
  return <span>BROADCASTING{dots}</span>;
}

export function WalletHUD({ fleetCount, onMintSuccess }: WalletHUDProps) {
  const { wallet, disconnectWallet } = useWallet();
  const [isOpen, setIsOpen]         = useState(false);
  const [driftBal, setDriftBal]     = useState<number | null>(null);
  const [mintFee, setMintFee]       = useState<number>(0);
  const drawerRef                   = useRef<HTMLDivElement>(null);

  // Mint panel state
  const [mintOpen, setMintOpen]     = useState(false);
  const [archetype, setArchetype]   = useState<CarArchetype>("sport");
  const [mintState, setMintState]   = useState<MintState>("idle");
  const [txHash, setTxHash]         = useState("");
  const [errorMsg, setErrorMsg]     = useState("");

  // The fee is an owner-settable value on the contract, not a constant.
  useEffect(() => {
    fetchMintFeeDrift().then(setMintFee).catch(() => setMintFee(0));
  }, []);

  useEffect(() => {
    if (!wallet?.address) { setDriftBal(null); return; }
    setDriftBal(wallet.driftBalance ?? 0);
  }, [wallet?.address, wallet?.driftBalance]);

  // Refresh balance after successful mint
  useEffect(() => {
    if (mintState === "success" && wallet?.address) {
      setDriftBal(wallet.driftBalance ?? 0);
    }
  }, [mintState, wallet?.address, wallet?.driftBalance]);

  // Close drawer on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  if (!wallet) return null;

  const gasBal              = wallet.balance ?? 0;
  const driftDisp           = driftBal ?? 0;
  const hasSufficientBalance = driftBal !== null && mintFee > 0 && driftBal >= mintFee;

  const handleMint = async () => {
    if (mintState === "minting") return;
    setMintState("minting");
    setErrorMsg("");
    try {
      if (!wallet?.address) throw new Error("Wallet not connected");
      const result = await mintCar(wallet.address, archetype);
      setTxHash(result.txHash);
      setMintState("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Transaction failed");
      setMintState("error");
    }
  };

  const handleMintSuccess = () => {
    setMintOpen(false);
    setMintState("idle");
    setTxHash("");
    setIsOpen(false);
    onMintSuccess?.();
  };

  const handleToggleMint = () => {
    if (mintState === "success") {
      handleMintSuccess();
      return;
    }
    setMintOpen((v) => !v);
    if (mintState === "error") {
      setMintState("idle");
      setErrorMsg("");
    }
  };

  return (
    <>
      <style>{`
        @keyframes cd-drawer-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .cd-drawer { animation: cd-drawer-in 150ms ease forwards; }
        @keyframes cd-mint-in {
          from { opacity: 0; max-height: 0; }
          to   { opacity: 1; max-height: 400px; }
        }
        .cd-mint-panel { animation: cd-mint-in 200ms ease forwards; overflow: hidden; }
      `}</style>

      <div
        ref={drawerRef}
        style={{
          position:   "absolute",
          top:        20,
          right:      20,
          zIndex:     100,
          fontFamily: DS.font,
          userSelect: "none",
        }}
      >
        {/* ── Pill (always visible) ── */}
        <button
          onClick={() => setIsOpen((v) => !v)}
          style={{
            display:     "flex",
            alignItems:  "center",
            gap:         10,
            background:  DS.surface,
            border:      `1px solid ${isOpen ? DS.textDisabled : DS.border}`,
            padding:     "9px 14px",
            cursor:      "pointer",
            transition:  "border-color 150ms",
            whiteSpace:  "nowrap",
          }}
          onMouseEnter={(e) => {
            if (!isOpen)
              (e.currentTarget as HTMLButtonElement).style.borderColor = DS.textDisabled;
          }}
          onMouseLeave={(e) => {
            if (!isOpen)
              (e.currentTarget as HTMLButtonElement).style.borderColor = DS.border;
          }}
        >
          <WalletIcon />

          {/* Native gas token */}
          <span style={{ fontSize: 8, color: DS.textDisabled, letterSpacing: "0.14em" }}>ETH</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: DS.textPrimary }}>
            {fmtBalance(gasBal)}
          </span>

          {/* Separator */}
          <span style={{ color: DS.divider, fontSize: 10 }}>·</span>

          {/* DRIFT */}
          <span style={{ fontSize: 8, color: DS.textDisabled, letterSpacing: "0.14em" }}>DRIFT</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: DS.textPrimary }}>
            {driftBal === null ? "—" : fmtBalance(driftDisp)}
          </span>

          <Chevron open={isOpen} />
        </button>

        {/* ── Drawer ── */}
        {isOpen && (
          <div
            className="cd-drawer"
            style={{
              position:   "absolute",
              top:        "calc(100% + 4px)",
              right:      0,
              minWidth:   260,
              background: DS.surface,
              border:     `1px solid ${DS.border}`,
            }}
          >
            {/* Header */}
            <div
              style={{
                display:        "flex",
                justifyContent: "space-between",
                alignItems:     "center",
                padding:        "12px 16px",
                borderBottom:   `1px solid ${DS.divider}`,
              }}
            >
              <span style={{ fontSize: 8, fontWeight: 700, color: DS.textPrimary, letterSpacing: "0.22em" }}>
                WALLET
              </span>
              <span style={{ width: 6, height: 6, background: DS.accent, display: "inline-block" }} />
            </div>

            {/* Address */}
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${DS.divider}` }}>
              <div style={{ fontSize: 7, color: DS.textDisabled, letterSpacing: "0.18em", marginBottom: 5 }}>
                ADDRESS
              </div>
              <div style={{ fontSize: 9, color: DS.textMeta, letterSpacing: "0.04em" }}>
                {shortenAddress(wallet.address)}
              </div>
            </div>

            {/* Balances */}
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${DS.divider}` }}>
              {[
                { label: "ETH",        value: fmtBalance(gasBal)    },
                { label: "DRIFT", value: driftBal === null ? "—" : fmtBalance(driftDisp) },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  style={{
                    display:        "flex",
                    justifyContent: "space-between",
                    alignItems:     "center",
                    marginBottom:   8,
                  }}
                >
                  <span style={{ fontSize: 8, color: DS.textDisabled, letterSpacing: "0.16em" }}>
                    {label}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: DS.textPrimary }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>

            {/* Meta */}
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${DS.divider}` }}>
              {[
                { label: "NETWORK", value: wallet.network ?? "—" },
                ...(fleetCount !== undefined
                  ? [{ label: "FLEET", value: `${fleetCount} VEHICLE${fleetCount !== 1 ? "S" : ""}` }]
                  : []),
              ].map(({ label, value }) => (
                <div
                  key={label}
                  style={{
                    display:        "flex",
                    justifyContent: "space-between",
                    alignItems:     "center",
                    marginBottom:   7,
                  }}
                >
                  <span style={{ fontSize: 8, color: DS.textDisabled, letterSpacing: "0.16em" }}>
                    {label}
                  </span>
                  <span style={{ fontSize: 8, color: DS.textMeta, letterSpacing: "0.06em" }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>

            {/* ── Mint Vehicle button ── */}
            {onMintSuccess && (
              <div style={{ padding: "10px 12px", borderBottom: `1px solid ${DS.divider}` }}>
                <button
                  onClick={handleToggleMint}
                  style={{
                    width:         "100%",
                    padding:       "8px",
                    background:    mintOpen || mintState === "success" ? DS.accent : "transparent",
                    border:        `1px solid ${mintOpen || mintState === "success" ? DS.accent : DS.accent}`,
                    color:         mintOpen || mintState === "success" ? DS.bg : DS.accent,
                    fontFamily:    DS.font,
                    fontSize:      8,
                    fontWeight:    700,
                    letterSpacing: "0.2em",
                    cursor:        "pointer",
                    transition:    "background 150ms, color 150ms",
                  }}
                  onMouseEnter={(e) => {
                    if (!mintOpen && mintState !== "success") {
                      (e.currentTarget as HTMLButtonElement).style.background = DS.accent;
                      (e.currentTarget as HTMLButtonElement).style.color = DS.bg;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!mintOpen && mintState !== "success") {
                      (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                      (e.currentTarget as HTMLButtonElement).style.color = DS.accent;
                    }
                  }}
                >
                  {mintState === "success" ? "OPEN GARAGE" : mintOpen ? "CANCEL" : "+ MINT VEHICLE"}
                </button>
              </div>
            )}

            {/* ── Inline mint panel ── */}
            {mintOpen && mintState !== "success" && (
              <div className="cd-mint-panel" style={{ borderBottom: `1px solid ${DS.divider}` }}>
                {/* Archetype selector */}
                <div style={{ padding: "12px 12px 0" }}>
                  <div style={{ fontSize: 7, color: DS.textDisabled, letterSpacing: "0.22em", marginBottom: 8 }}>
                    SELECT ARCHETYPE
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {ARCHETYPES.map(({ id, label }) => {
                      const active   = archetype === id;
                      const disabled = mintState === "minting";
                      return (
                        <button
                          key={id}
                          onClick={() => !disabled && setArchetype(id)}
                          style={{
                            flex:          1,
                            padding:       "7px 0",
                            background:    active ? DS.textPrimary : "transparent",
                            border:        `1px solid ${active ? DS.textPrimary : DS.border}`,
                            color:         active ? DS.bg : DS.textDisabled,
                            fontFamily:    DS.font,
                            fontSize:      7,
                            fontWeight:    700,
                            letterSpacing: "0.1em",
                            cursor:        disabled ? "not-allowed" : "pointer",
                            transition:    "background 150ms, color 150ms, border-color 150ms",
                          }}
                          onMouseEnter={(e) => {
                            if (!active && !disabled)
                              (e.currentTarget as HTMLButtonElement).style.borderColor = DS.textMeta;
                          }}
                          onMouseLeave={(e) => {
                            if (!active && !disabled)
                              (e.currentTarget as HTMLButtonElement).style.borderColor = DS.border;
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Cost row */}
                <div
                  style={{
                    display:        "flex",
                    justifyContent: "space-between",
                    alignItems:     "center",
                    margin:         "10px 12px",
                    padding:        "10px 12px",
                    background:     DS.bg,
                    border:         `1px solid ${DS.divider}`,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 7, color: DS.textDisabled, letterSpacing: "0.2em", marginBottom: 3 }}>
                      COST
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: DS.textPrimary }}>
                      {mintFee} DRIFT
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 7, color: DS.textDisabled, letterSpacing: "0.2em", marginBottom: 3 }}>
                      BALANCE
                    </div>
                    <div
                      style={{
                        fontSize:   12,
                        fontWeight: 700,
                        color:      driftBal === null
                          ? DS.textDisabled
                          : hasSufficientBalance
                          ? DS.textPrimary
                          : DS.danger,
                      }}
                    >
                      {driftBal === null ? "—" : `${driftBal.toFixed(2)}`}
                    </div>
                  </div>
                </div>

                {/* Error */}
                {mintState === "error" && (
                  <div
                    style={{
                      margin:       "0 12px 10px",
                      padding:      "8px 10px",
                      border:       `1px solid ${DS.danger}`,
                      fontSize:     7,
                      color:        DS.danger,
                      letterSpacing:"0.1em",
                      lineHeight:   1.6,
                      wordBreak:    "break-all",
                    }}
                  >
                    ERROR: {errorMsg}
                  </div>
                )}

                {/* Mint action */}
                <div style={{ padding: "0 12px 12px" }}>
                  {mintState === "minting" ? (
                    <div
                      style={{
                        padding:       "10px",
                        border:        `1px solid ${DS.border}`,
                        color:         DS.textDisabled,
                        fontFamily:    DS.font,
                        fontSize:      8,
                        fontWeight:    700,
                        letterSpacing: "0.2em",
                        textAlign:     "center",
                      }}
                    >
                      <MintingLabel />
                    </div>
                  ) : (
                    <button
                      onClick={hasSufficientBalance ? handleMint : undefined}
                      disabled={!hasSufficientBalance}
                      style={{
                        width:         "100%",
                        padding:       "10px",
                        background:    "transparent",
                        border:        `1px solid ${hasSufficientBalance ? DS.textPrimary : DS.border}`,
                        color:         hasSufficientBalance ? DS.textPrimary : DS.textDisabled,
                        fontFamily:    DS.font,
                        fontSize:      8,
                        fontWeight:    700,
                        letterSpacing: "0.2em",
                        cursor:        hasSufficientBalance ? "pointer" : "not-allowed",
                        transition:    "background 150ms, color 150ms",
                      }}
                      onMouseEnter={(e) => {
                        if (hasSufficientBalance) {
                          (e.currentTarget as HTMLButtonElement).style.background = DS.textPrimary;
                          (e.currentTarget as HTMLButtonElement).style.color = DS.bg;
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (hasSufficientBalance) {
                          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                          (e.currentTarget as HTMLButtonElement).style.color = DS.textPrimary;
                        }
                      }}
                    >
                      {hasSufficientBalance ? "CONFIRM MINT" : "INSUFFICIENT DRIFT"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Success state inside drawer */}
            {mintState === "success" && (
              <div
                className="cd-mint-panel"
                style={{ padding: "12px 16px", borderBottom: `1px solid ${DS.divider}` }}
              >
                <div style={{ fontSize: 7, color: DS.accent, letterSpacing: "0.22em", marginBottom: 8 }}>
                  ● VEHICLE MINTED
                </div>
                <div
                  style={{
                    padding:       "8px 10px",
                    background:    DS.bg,
                    border:        `1px solid ${DS.divider}`,
                    fontSize:      7,
                    color:         DS.textMeta,
                    letterSpacing: "0.04em",
                    wordBreak:     "break-all",
                  }}
                >
                  <span style={{ color: DS.textDisabled, letterSpacing: "0.16em" }}>TX: </span>
                  {txHash}
                </div>
              </div>
            )}

            {/* Disconnect */}
            <div style={{ padding: "10px 12px" }}>
              <button
                onClick={() => { setIsOpen(false); disconnectWallet(); }}
                style={{
                  width:       "100%",
                  padding:     "8px",
                  background:  "transparent",
                  border:      `1px solid ${DS.border}`,
                  color:       DS.textDisabled,
                  fontFamily:  DS.font,
                  fontSize:    8,
                  fontWeight:  700,
                  letterSpacing: "0.2em",
                  cursor:      "pointer",
                  transition:  "border-color 150ms, color 150ms",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = DS.danger;
                  (e.currentTarget as HTMLButtonElement).style.color = DS.danger;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = DS.border;
                  (e.currentTarget as HTMLButtonElement).style.color = DS.textDisabled;
                }}
              >
                DISCONNECT
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
