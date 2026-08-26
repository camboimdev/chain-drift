---
name: chain-drift-design
description: >
  Chain Drift visual design system — UI, HUD, branding, and marketing.
  Use when generating frontend UI, HUD overlays, marketplace screens,
  NFT presentations, marketing assets, or any visual component for Chain Drift.
triggers:
  - "design *"
  - "create UI"
  - "create screen"
  - "create HUD"
  - "create marketplace"
  - "create NFT card"
  - "create landing page"
  - "create dashboard"
  - "style *"
  - "brand *"
  - "UI for *"
---

# CHAIN DRIFT DESIGN SYSTEM

Chain Drift is a serious, technical, futuristic racing protocol built on blockchain.
Every visual decision must reflect: **precision, ownership, speed, and digital authority.**

---

## 1. CORE PRINCIPLES

**Tone:** Serious · Technical · Minimal · Aggressive · High-contrast
**Must feel like:** A racing telemetry system · A blockchain terminal · A high-performance machine dashboard

**Never:**
- Playful or cartoon elements
- Rounded corners (0px border-radius always)
- Soft gradients or glassmorphism or neumorphism
- Pastel colors · Rainbow gradients · Mobile-game style visuals
- Multiple accent colors mixed together

---

## 2. COLOR SYSTEM

```
Background Primary:   #000000
Background Secondary: #0A0A0A
Surface / Panels:     #111111
Dividers:             #1A1A1A
Borders:              #2A2A2A

Primary Text:         #FFFFFF
Secondary Text:       #E5E5E5
Technical / Metadata: #BFBFBF
Disabled:             #3A3A3A
```

**Accent policy — default mode is pure monochrome.**
When an accent is required, pick exactly ONE:
- White glow
- Electric green: `#00FF88`
- Electric blue: `#00D1FF`

Never mix accents.

---

## 3. TYPOGRAPHY

**Primary typeface: JetBrains Mono** (SIL OFL — free for commercial use)
Fallback: `'JetBrains Mono', monospace`

This font is mandatory for: UI · HUD · Technical data · Branding · Website · Marketplace

**Headings:** ALL CAPS · letter-spacing +2–4% · Bold or SemiBold
**Body:** Regular or Medium weight · Compact vertical rhythm
**Technical data (monospaced emphasis):**
```
CAR_ID: #4291
BLOCK:  18723491
TX:     0x8F3A...92C1
```

---

## 4. LAYOUT

- Strict grid alignment · Hard edges · No rounded corners · Thin borders (1px)
- Large negative space · Clean section separation · No clutter
- Flat surfaces with slight contrast from background
- No drop shadows unless extremely subtle

---

## 5. BUTTON SYSTEM

| State    | Background  | Border              | Text    | Transition |
|----------|-------------|---------------------|---------|------------|
| Default  | transparent | 1px solid #FFFFFF   | #FFFFFF | —          |
| Hover    | #FFFFFF     | —                   | #000000 | 150ms max  |
| Disabled | transparent | 1px solid #3A3A3A   | #3A3A3A | —          |

No rounded edges. Fast transition (≤150ms).

---

## 6. HUD RULES

HUD = race telemetry overlay. Thin lines, numeric emphasis, minimal labels.

```
SPEED: 248 KM/H
CAR_ID: #4291
RARITY: EPIC
SYNC: CONFIRMED
```

No large UI blocks. No decorative elements. No cartoon indicators.

---

## 7. ANIMATION

- Transitions: 100–200ms
- Preferred motion: horizontal slide · subtle fade
- No bounce · No elastic · No playful effects
- Motion must feel mechanical, not playful

---

## 8. NFT / CAR PRESENTATION

- Dark backgrounds · Strong directional lighting · High contrast
- Slight grain optional
- No colorful frames · No gradient rarity borders
- Rarity expressed through brightness intensity:
  - Common → standard white
  - Rare → slightly brighter white
  - Epic → subtle white glow
  - Legendary → animated subtle white glow

---

## 9. MARKETPLACE CARDS

- Flat · No rounded edges · Thin borders · Strong alignment
- Technical metadata rendered in monospace
- Rarity via brightness, not color

---

## 10. BRAND STATEMENT

**Chain Drift is: Precision. Speed. Ownership.**

Every design decision must reinforce:
- Authority
- Scarcity
- Performance
- On-chain legitimacy
