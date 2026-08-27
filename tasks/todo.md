# Copy button on every address the app prints

Every address on screen is truncated to fit its panel, so the only way to use
one is to copy it. One shared control now carries that everywhere, contract
addresses included.

## Done

- [x] `components/CopyAddress.tsx` — address text plus a copy glyph, one button,
      accent tick for 1.2s, full address in `title`, async clipboard with a
      selection fallback for non-secure origins.
- [x] Wallet drawer: connected address.
- [x] Wallet drawer: new CONTRACTS block — DRIFT, CAR NFT, ESCROW, LEADERBOARD,
      read from `config/chain`; an unconfigured address shows a dash.
- [x] Onboarding step 1: the full wallet address.
- [x] Leaderboard rows, waiting-room grid slots.
- [x] Garage header OWNER, spec sheet OWNER, car HUD OWNER.
- [x] `pnpm lint`, `tsc -b`, `pnpm build` clean.

## Review

**One control, each panel's own truncation.** The panels shorten addresses three
different ways (`0x1234…cdef`, 10/6, 8/4). Unifying them would have been a
visual change nobody asked for, so `CopyAddress` takes an optional `label` and
each call site keeps the text it already showed; the default short form is only
used where there was no address on screen before — the contracts block.

**The glyph is the affordance, the row is the target.** A separate icon button
next to the text would double the hit targets in rows that are already 9px tall.
The whole thing is one `<button>`; `stopPropagation` keeps it from firing the
row click behind it.

**Contract addresses had nowhere to live.** They were only in `config/chain`,
never rendered. They sit in the wallet drawer under the balances — it is the one
surface that is already about the chain rather than about the race.

**Clipboard failures stay silent.** A blocked clipboard leaves the address on
screen and selectable; an error banner over a 9px HUD row would cost more than
the failure does.

**`pointerEvents: "auto"`** is set on the button because the garage header
overlay is `pointerEvents: "none"` — without it the copy target there is dead.
