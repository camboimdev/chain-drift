# Garage redesign — showroom bay, fleet grid, spec sheet

The garage was the first screen built and still read like it: a three-slot
carousel over a grey pillared room, a plain name list, and no way to see the
whole fleet at once. This replaces it.

## Done

- [x] `garage/design.ts` — shared tokens, rarity-as-brightness scale, trait helpers
- [x] `garage/layout.ts` — one pure placement function for every mode; replaces
      the slot-role table and the exit-slot `setTimeout` pruning
- [x] `garage/GarageBay.tsx` — the room: reflector floor, technical grid,
      Lightformer environment, one shadow-casting directional, ghost token plate
- [x] `garage/CarBay.tsx` — per-car animated bay: turntable yaw, scan pad with
      measurement dial and sweep, rarity ring, grid brackets, bay number
- [x] `garage/GarageCamera.tsx` — camera rig that lerps between modes and hands
      control to the player in inspect
- [x] `garage/StatBars.tsx` — segmented stat readout, shared with `CarHUD`
- [x] `garage/SpecSheet.tsx` — featured-car readout off `calculateCarStats`
- [x] `garage/FleetIndex.tsx` — register with cross-highlight into the 3D
- [x] `garage/GarageFrame.tsx` — corner brackets, header, mode cluster, hints
- [x] `garage/ScrambleText.tsx` — 200ms mechanical value reveal
- [x] `Garage.tsx` — rewritten around GALLERY / FLEET / INSPECT
- [x] `CarHUD.tsx` — inspect HUD gained the same stat readout
- [x] `public/fonts` — JetBrains Mono TTF so 3D text is on-brand
- [x] Verified: `tsc -b`, `eslint src`, `vite build`, and all three modes
      driven in the browser against a nine-car fleet

## Review

**The mechanic.** One selection, three views. `computeLayout(cars, index, mode)`
returns a placement per car and every bay lerps towards its own; changing car
and changing mode are the same motion, so there is no transition state to keep
in sync. The old carousel needed `exit-left` / `exit-right` roles and a 700ms
`setTimeout` to prune them — both are gone.

**Seeing everything.** FLEET parks the whole collection on numbered bays and
hides the side panels, because the grid *is* the register. Selected bay reads
white; clicking it returns to GALLERY on the car you picked.

**Rarity.** Brightness only, per the design system: the scan-pad ring is dim for
Common and full white for Legendary, which is also the only tier that pulses.

**Honesty.** The spec sheet shows `calculateCarStats` — the numbers the race
animation actually drives with — and states underneath that the finish order
settles on Chainlink VRF, so a panel of stat bars cannot be read as odds.

**The token plate.** Filled dark grey it was unreadable against the wall, so it
was rebuilt as a neon sign: near-black glass fill, a thin `#00FF88` stroke on
the glyph edge and a wide soft outline halo. The stroke is the only thing in the
room bright enough to clear the bloom threshold, so the glow is produced by the
lighting rather than painted on, and the polished floor picks the whole thing up
as a reflection. The wall's light seam moved from eye height down to a plinth so
it stops cutting through the digits.

**Things tried and dropped.** Emissive ceiling light bars cropped into frame at
every camera height; `ContactShadows` at room scale smeared into black
rectangles behind the far rows. Both were replaced by the Lightformer
environment plus one wide shadow-casting directional. The `Noise` pass from
`@react-three/postprocessing` rendered the whole canvas black in this scene —
Bloom and Vignette only.
