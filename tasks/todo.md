# Race Visual Polish — Agent Distribution

Goal: make the race event presentable. Five agents, disjoint file ownership.

## Shared contracts (all agents must honour)

- **Ground plane:** the drivable track surface top is exactly `y = 0`.
  Floor decals sit at `y <= 0.02`. A car's wheel contact point sits at `y = 0`.
- **Brand:** `.claude/skills/chain-drift-design/SKILL.md` — monochrome base,
  at most ONE accent (`#00D1FF`). No cyan+magenta Tron mix.
- **Car3D API:** `interactive?: boolean` (default `false`) gates hover-scale and
  the idle showroom wobble. Garage/CarPreview pass it; the race never does.
- **Preloader API:** `src/services/carModelPreloader.ts` exports
  `loadCarModel(url)` and
  `preloadCarModels(tokenIds, onProgress?) => Promise<void>`.
- **Exhaust API:** `src/components/effects/CarExhaust.tsx` exports
  `CarExhaustHandle { setState(speedFactor, boosting, boostIntensity) }` and
  `CarExhaust = forwardRef<CarExhaustHandle, { offset?: [number,number,number] }>`.
- **Stable exports:** `RaceTrack.tsx` keeps exporting `RaceTrack`,
  `getTrackPosition`, `getTrackRotation`, `isAtCorner` and the `trackConfig`
  re-exports.

## Agent A — Asset preload gate
Owns: `Car3D.tsx`, `services/carModelPreloader.ts` (new), `RaceScene.tsx`
- [ ] Move the model cache out of Car3D into the preloader service
- [ ] Real progress-driven loading screen; race cannot start until every
      participant model is parsed
- [ ] Add `interactive` prop; stop the showroom wobble leaking into the race
- [ ] Scene atmosphere: drop the chromatic aberration, retune fog/bloom

## Agent B — Track surface
Owns: `RaceTrack.tsx`, `config/trackConfig.ts`
- [ ] Replace the Tron grid with asphalt (procedural canvas + normal map)
- [ ] Lane markings, edge lines, kerbs, barriers, racing line, start grid boxes
- [ ] Surface top exactly at y=0, no z-fighting

## Agent C — Car grounding & vehicle feel
Owns: `RaceDirector.tsx`
- [ ] Remove the 0.5 float; wheels on the ground
- [ ] Contact shadow, weight transfer (squat/dive), roll on lateral load
- [ ] Wire in `CarExhaust`, delete the cone meshes
- [ ] Fix the shadow-casting light to track the cars

## Agent D — Camera
Owns: `RaceCamera.tsx`
- [ ] Framerate-independent damping; kill the stacked sinusoids
- [ ] Broadcast grammar: hold a shot, then cut — never swoop continuously
- [ ] Shake tied to speed, not to `Math.random()` every frame

## Agent E — Thruster / exhaust
Owns: `components/effects/CarExhaust.tsx` (new)
- [ ] Layered additive plume, heat haze, flicker; afterburner on boost

## Review

All five workstreams landed. `tsc -b` and `vite build` both clean; the six lint
errors in RaceTrack.tsx are pre-existing (main had seven).

**Verified in a real browser** (headless SwiftShader cannot create a WebGL2
context, so verification ran headful against the GPU through puppeteer, driving
a throwaway preview harness that mounted RaceScene with mock cars — harness
since removed).

Fixed during integration, on top of the agents' work:
- Tyre dust rendered as glowing white spheres: `size: 0.85` on a 6 m car plus an
  opaque-cored texture under additive blending. Now a 0.4 gaussian puff that
  reads as smoke.
- The barrier accent strip runs the full circuit and passes within metres of the
  low camera rigs; at `emissiveIntensity 2.4` with `toneMapped={false}` it
  bloomed into a neon bar that owned the frame — the exact Tron look the
  one-accent policy exists to prevent. Now 0.55 and tone mapped.
- **The asset gate had no ceiling.** Waiting on the models is correct, but on a
  degraded IPFS day (four gateways timing out in sequence) the player sat on
  `STREAMING CAR ASSETS [0/4]` for minutes — trading "starts too early" for
  "may never start". Added `ASSET_DEADLINE_MS = 20000`: the race starts on the
  models or the deadline, whichever comes first.

Open, not addressed:
- The race clock read a ~15 minute offset in one sample while ticking at the
  correct rate; the fresh sample from the same run read correctly. Most likely
  cross-talk between two overlapping capture runs writing to one directory, but
  unconfirmed. The countdown effect (`RaceDirector.tsx:908`) is pre-existing and
  untouched by this work — it stacks an uncancelled `setTimeout` on re-render,
  which is worth a look regardless.
- IPFS gateway reliability: `dweb.link`/`w3s.link`/`ipfs.io` intermittently
  refuse CORS from localhost and Pinata 404s some CIDs. Pre-existing, and the
  reason the deadline above matters.
