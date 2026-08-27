# Wallet connect — market-standard modal with WalletConnect

Connecting was a single button that silently picked the first injected
connector: no way to choose a wallet, no mobile wallets at all, and a failed
attempt bounced an error onto the login screen. This replaces it with the
picker players already know from other dapps.

## Done

- [x] `config/wagmi.ts` — added the `walletConnect` connector, gated on
      `VITE_WALLETCONNECT_PROJECT_ID`, with `showQrModal: false` so the QR is
      ours; EIP-6963 discovery already came free with wagmi
- [x] `hooks/useWalletOptions.ts` — turns wagmi's flat connector array into one
      row per wallet: 6963 wallets first, generic injected only when nothing
      announced itself, Coinbase SDK dropped when the extension is present,
      last-used wallet floated to the top
- [x] `components/wallet/ConnectModal.tsx` — list / connecting / QR views, per
      wallet connecting state, RECENT and INSTALLED badges, retry on failure,
      Escape and backdrop close, body scroll lock
- [x] `components/wallet/QrCode.tsx` — pairing URI drawn as hard squares from
      the raw QR matrix, dark-on-light so scanners accept it
- [x] `components/wallet/WalletMark.tsx` — 6963 icons as announced, monochrome
      marks for the SDK connectors
- [x] `context/WalletContext.tsx` — `connectWallet()` now opens the modal; the
      connector-picking heuristic and its error plumbing are gone
- [x] `shared/types/wallet.ts` — dropped the `"error"` wallet state, connect
      errors belong to the modal; `connectWallet` is no longer a promise
- [x] `LoginPage.tsx` / `App.tsx` — login shows the wordmark and one button;
      the connecting band now only narrates session restore
- [x] `.env.example`, README, ARCHITECTURE — WalletConnect project ID documented
- [x] Verified: `tsc -b`, `eslint .`, `vite build`, and the modal driven in the
      browser — list, QR view, relay-timeout failure, retry

## Review

**Why a modal at all.** The old `connectWallet()` guessed: first injected
connector, else whatever was at index 0. With two extensions installed the
player had no say, and Coinbase Smart Wallet was unreachable unless nothing else
was installed. A list is the only honest answer once more than one wallet exists.

**EIP-6963 does the work.** wagmi already discovers announced wallets and each
arrives with its own name and icon, so the list needs no hardcoded registry —
it deduplicates instead: the generic `injected` shim only appears when nothing
announced itself, and the Coinbase SDK row disappears when the extension is
there, because both would open the same wallet.

**The QR is drawn here.** `showQrModal: false` keeps WalletConnect's own overlay
out; the pairing URI is encoded with `qrcode` and rendered as `<rect>`-sized
path segments, which keeps the modules pixel-aligned and the panel on-brand.
Module orientation was checked against `qrcode`'s own SVG renderer — identical
coordinate sets — because a transposed matrix still *looks* like a valid QR.

**Failure states are local.** Rejection, a request already open, and an
unreachable relay each resolve inside the panel with a retry, so a failed
attempt never navigates the player anywhere. The relay case needs its own 15s
timeout: an invalid project ID or a firewalled websocket makes the provider
retry silently forever rather than reject.

**Bundle.** wagmi imports `@walletconnect/ethereum-provider` dynamically, so it
lands in its own chunk and is only fetched when a player actually picks
WalletConnect.

**Without a project ID** the WalletConnect row is simply absent and the app runs
with browser and Coinbase wallets — in dev a dashed hint names the missing
variable instead.
