# Mobile strategy — decision memo

_Status: recommended · 13 July 2026_

## Where mobile stands today

Apex Appraise ships as an installable **PWA** with a genuinely native-feeling
mobile experience:

- **Field app** (`/field`): full-bleed phone UI, offline-capable inspection
  capture (rooms, conditions, photos, reconciliation) that hands off to the
  desk workbench.
- Every core screen is phone-tight at 390px (no horizontal scroll — enforced
  by the permanent mobile e2e suite), and all charts swap to a
  phone-proportioned layout below 640px.
- Standalone manifest with shortcuts and maskable icon; service worker keeps
  the shell fast and never caches API traffic; add-to-home-screen works on
  iOS and Android today.

## The options

| | What it is | Gets us | Costs |
|---|---|---|---|
| **A — PWA only** (today) | Installable web app | Everything above, zero extra surface to maintain | No app-store listing, no reliable push on iOS |
| **B — Expo shell** | Thin React-Native wrapper around the existing app + native modules where it counts | App Store/Play presence, real push notifications (capital calls, milestone alerts), camera/file APIs, biometric unlock | ~1–2 weeks build, store review cycles, a second artefact to release; needs Apple Developer ($99/yr) + Google Play ($25 one-off) accounts |
| **C — Full native rewrite** | Separate native codebase | Marginal UX gain over B | Duplicates the entire product; permanent double maintenance. Not justified — the engine/UI investment lives in the web codebase |

## Recommendation

**Stay on A until the product is hosted publicly and has first users, then
ship B.** Reasoning:

1. A native shell wrapping `localhost` is meaningless — public hosting is a
   hard prerequisite, and it's also the top unlock for everything else.
2. The paying-user feature that genuinely needs native is **push
   notifications** (investor capital calls, sales-milestone and cost-overrun
   alerts). That's a Expo-shell feature, not a rewrite feature.
3. Option B preserves the single-codebase economics that let this product
   move at its current pace. Option C should never happen.

## What B needs when triggered

- Public HTTPS deployment of web + api (Fly.io recommended; `infra/` compose
  is the reference stack).
- Apple Developer Program + Google Play Console accounts (owner-held).
- ~1–2 weeks: Expo app with auth/session bridge, push token registration
  (new `devices` table + notification fan-out on ActivityEvent), deep links
  into deals, store assets (the brand kit and screenshots already exist).

## Related scoped project: dark mode

Audited 13 Jul 2026: ~250 hardcoded hex occurrences across 29 files sit
outside the token system (charts, button chrome, report print styles —
reports must stay light for print). Proper dark mode = CSS-variable token
remap + full sweep + dual-mode verification of every screen: a 2–3 session
project, deliberately not started mid-loop. Tracked in the loop roadmap.
