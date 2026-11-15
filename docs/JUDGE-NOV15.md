# Phengos: headset-judge pass, Nov 15, 2026

Judged the way a Meta VR Start judge sees it: the production code running in the Meta Immersive Web Emulator (IWER,
Quest 3 profile), looked at from the user's eye, plus the clips a judge would watch. Four equal criteria, scored out
of 10. No score inflation: "before" is commit `4722158` (the Oct 25 build and its clips), "after" is this pass.

## Before (4722158)

| Criterion | Score | Why |
|---|---|---|
| Innovation & Creativity | 7 | Hide-and-seek in your own room, with depth occlusion hiding a light behind the real couch, and four equal ways to play. A strong idea, but the "nightly constellation" that should make it memorable was invisible: stars were 9 cm points (a few pixels) committed only at round end. |
| Experience Design | 5 | Lights were 0.55 m glows with a 17 cm lantern inside, a few pixels wide across a room. A catch had no payoff: the light shrank toward the palm and vanished. HUD body text measured 0.016 m cap height per metre (under the 0.018 m bar) the card's body 0.015 and its eyebrow 0.011. |
| Technical Implementation | 7 | Visibility-checked hiding spots from scene understanding, honest head-gaze on Quest vs eye gaze on Glasses, the real Vosk recogniser on a fixed grammar, M1 gates met (p95 1.4 ms, 86 draw calls). |
| Polish & Presentation | 4 | The clips were 1280x720 with the 800x800 emulator canvas pillarboxed, so HUD text was ~10 px tall and unreadable. No film. The whoa (the catch) was a small glow moving a short way. |
| **Average** | **5.75** | |

### The five biggest problems (before)

1. **Tiny lights.** A light across the room was a dot. Judges would not see what to catch.
2. **No payoff on a catch.** The light faded toward the hand; nothing showed that the catch mattered.
3. **The constellation was invisible.** `PointsMaterial` stars are clamped to a few pixels in WebXR, and new stars only
   appeared at the end of a round, so the "sky grows" loop never showed.
4. **Labels too small.** HUD, tabs, card and menu text under the 0.018 m cap-height bar; unreadable in a film frame.
5. **Film-unready capture.** 800x800 square canvas, 720p, no app audio, no full walkthrough.

## What changed (this pass)

| Fix | Where |
|---|---|
| Lights 1.0 m billboards with a 0.33 x 0.42 m lantern (was 0.55 m / 0.17 m), brighter glow, not tone-mapped. The hand ray hits the lantern (inner 30% of the billboard), not the glow, so neighbours stay separate targets. Lights draw under the panels so they never paint over HUD text. | `packages/app/src/game/visuals.ts` |
| **Catch payoff**: the light pops where it hid (shock ring + flash), flies in an arc to your palm trailing sparks, glows on the palm (a small burst), rises to the ceiling, lands as a star with a flash and a ring, and a glowing line joins it to tonight's constellation (nearest earlier star), drawn over 0.7 s. A rising sparkle sound plays from the ceiling, the caption says "Star N tonight lands on your ceiling", and the HUD star counter pops. | `packages/core/src/payoff.ts`, `packages/app/src/systems/game-system.ts`, `audio-system.ts` |
| Stars are flat 0.34-0.58 m star sprites on the ceiling plane (one draw call), saved the moment they land (not at round end). Lines are flat ribbons (0.045 m), tonight's in firefly, older nights warm. | `visuals.ts`, `game-system.ts` |
| **Legibility rule in code**: `PANELS` (scale, distance, height) in `packages/core/src/legibility.ts` drives the app's panel placement, and a test parses every font size in every UIKitML panel and fails if any cap height is under 0.018 m per metre at 100% text. Panels are 1.2-1.4x bigger; HUD hides while the menu is open; menu buttons never wrap. | `legibility.ts`, `payoff.test.ts`, `public/ui/*.uikitml`, `ui-system.ts` |
| HUD star count chip; count chip pops on every catch. Dwell ring 1.3x, hint chevron 2x, the palm-up menu chip steps aside while a light is on your palm. Start sign scales on big screens. | `hud.uikitml`, `ui-system.ts`, `look-system.ts`, `wrist-system.ts`, `index.html` |
| Film pipeline: the agent-mode emulator page at 1920x1080 (so IWER's XR canvas is 16:9), takes recorded with the CDP screencast plus the app's own audio mix (`?recordAudio` test tap), cut with lower-left Lexend captions. | `packages/app/e2e/film*.{mjs,py}` |

| Landing "Listen" buttons play each panel's text pre-rendered with Chatterbox instead of browser speech synthesis; new hero clip of the payoff. | `packages/landing` |

All four play modes, voice, high contrast, sound-only, captions, text size and the Glasses profile are unchanged in
behaviour and still pass their emulator scenarios: 46/46 checks and 102/102 unit tests on Nov 15 (TESTING.md).

Film: `grokbot/videos/phengos/phengos-film.mp4`, 2:41, shot list in `phengos-film.md`.

## After

| Criterion | Score | Why |
|---|---|---|
| Innovation & Creativity | 7.5 | The constellation now visibly grows on your real ceiling, catch by catch and night by night; that gives the accessibility-first game its own image. |
| Experience Design | 7 | Lights read from the seat, every catch pays off in under 4 s, labels meet the 1° cap-height bar. Still: lights fully behind furniture can be hard to spot by eye (by design: the hum and Hint carry it). |
| Technical Implementation | 7.5 | Same honest core plus tested payoff and legibility logic, persistent stars at landing, perf gates still met with the effects on. |
| Polish & Presentation | 7 | 2:41 1080p full-frame film with the app's own sound, readable captions, every mode shown. Emulator art (IWER's synthetic room) limits how premium it can look; a headset capture would beat it. |
| **Average** | **7.25** | |

Not verifiable without a headset (unchanged): depth-occlusion quality at couch edges, mic + Vosk in an immersive
session, 72 fps on device, head-gaze comfort, real hand-tracking accuracy.
