# Testing Phengos

Two layers, both run against real code: pure-logic unit tests (Vitest), and end-to-end runs of the real app in the
Meta Immersive Web Emulator (IWER) driven through the IWSDK CLI (the same surface as the IWSDK MCP tools) with emulated
hands, gaze and synthetic rooms. No app logic is mocked. The counts below were measured fresh on **Oct 25, 2026**.

## Fresh emulator run: 46 checks passed, 0 failed (Oct 25, 2026, 14:54 UTC)

The complete end-to-end suite ran successfully in the Meta Immersive Web Emulator (IWER) using the IWSDK CLI in agent
mode (headless Chromium). All 10 scenarios completed with 46 passing checks and zero failures. Performance gates were
met across the 600-frame benchmark.

| Metric | Result | Gate | Status |
|---|---|---|---|
| CPU per frame, p95 | **1.4 ms** (p50 1.2 ms, max 2.1 ms) | ≤ 4 ms | Met ✓ |
| Draw calls per stereo frame | **86** | ≤ 100 (shared M1 gate) | Met ✓ |
| Draw calls per eye view | **43** (IWER renders two views as separate passes) | ≤ 70 (spec gate) | Met ✓ |
| Triangles | **21,092** max | ≤ 120k | Met ✓ |

Setup used Node **26.5.0**. Both `npm ci --prefix packages/core` and `npm ci --prefix packages/app` succeeded.
`npm --prefix packages/app run typecheck` and `npm --prefix packages/app run build` passed cleanly (with standard font
resolution and vendor bundle-size warnings). The local Vosk archive in `packages/app/public/models/` was verified and
loaded by the browser runtime Worker.

The heavy-session shell acquired the slot and installed an EXIT trap before startup:

```bash
ROOT="$PWD"
SLOT='/Volumes/Extreme SSD/Projects/grokbot/tools/heavy-slot.sh'
"$SLOT" acquire phengos
cleanup() {
  (cd "$ROOT/packages/app" && npx iwsdk dev down)
  "$SLOT" release phengos
}
trap cleanup EXIT
cd packages/app
npx iwsdk dev up --ai-mode agent --headless --allow-browser-automation
node e2e/scenarios.mjs hands look switch contrast voice paper perf
# set dev.emulator.device to "metaVRGlasses" in iwsdk.config.json:
node e2e/scenarios.mjs glasses glassesdwell
# restore dev.emulator.device to "metaQuest3" in iwsdk.config.json
node e2e/voice-missing.mjs   # with public/models/ temporarily moved
```

Cleanup returned `ok: true, stopped: true` from `dev down` and released the heavy slot. The configuration diff is clean:
`metaQuest3` and `sunlit_living_room` remain selected. Fresh results and artifacts are recorded in `e2e/results/`.

| Scenario | Checks | What it does (real inputs only) |
|---|---|---|
| `hands` (Quest 3) | 7/7 | Cold load → room from scene understanding (15 planes, 13 furniture) → the first light caught by hand ray + pinch picks **Point** → 5 lights hidden behind couch, lamp, table, lamp, shelf → all 5 caught with `xr look-at` (aim the hand ray) + `xr select` (pinch), **5 pinches for 5 lights** → ECS `GameState.caught == 5` → 0 console errors |
| `look` (Quest 3) | 5/5 | No hand input at all. Head-gaze with the ECS paused and stepped at exactly 1/72 s: a **0.8 s look does not catch**; 1.1 s on each light catches the whole round; mode label "Look (head)" |
| `switch` (Quest 3) | 6/6 | Hands resting, rays on the floor. The scanner starts by itself after 4 quiet seconds; a pinch picks **One switch**; the round of 5 completes with **5 pinches**; a 1.3 s pinch opens the menu |
| `contrast` (Quest 3) | 5/5 | Pause tab and the contrast toggle pinched on the hand ray → ECS `GameState.contrast == "yellow"`; screenshot `e2e/results/contrast-yellow.png` |
| `voice` (Quest 3) | 4/4 | Voice turned on from the menu; the recorded WAV (`public/fixtures/voice-catch-next.wav`) is fed through the **real Vosk recogniser** with the nine-word grammar: transcript `"catch next"`; "catch" caught a light (method voice); "next" outlined another |
| `voice-missing` | 2/2 | Model file removed: the chip reads **"Voice unavailable on this device"** and the round continues by hand |
| `paper` (Quest 3) | 3/3 | `?room=paper` forces the no-scan fallback: three paper screens, 5 lights hidden behind them, round completes |
| `glasses` (Meta VR Glasses) | 7/7 | Profile "Meta VR Glasses", `gaze-tracking` granted, label "Look (eyes)"; **eye gaze (`xr look-at gaze`) + pinch** catches the first light and the round of 5 (method eyes); HUD (−17°) and tabs (−27°) inside the Glasses FoV (37° L/R, 25° up, 43° down) with margin; screenshot `e2e/results/glasses-fov.png` |
| `glassesdwell` (Glasses) | 1/1 | **Look (eyes)**: 5 lights caught by eye-gaze dwell alone, no pinch |
| `perf` (Quest 3) | 6/6 | 600-frame run on the 12-light round; M1 gate metrics below |

The four ways to play each finish a round **on their own**: hands (`hands`), head-gaze (`look`), one switch (`switch`),
eye gaze on the Glasses (`glasses`, `glassesdwell`). Voice is optional by design and is shown catching and outlining.

## M1 performance gate (relative proxy, unverified on hardware)

600-frame scripted run on the **12-light round** with depth occlusion on the lights (`DepthOccludable`, hard mode, 12
entities and nothing else), head and hand ray sweeping across the lights. CPU time per frame = ECS systems + the render
call, from `performance.now()` inside the app; draw calls and triangles from `renderer.info`. Desktop Chrome on Apple
Silicon under IWER, **not a headset measurement**. `e2e/results/perf-report.json`.

| Metric | Result | Gate | Status |
|---|---|---|---|
| CPU per frame, p95 | **1.4 ms** (p50 1.2 ms, max 2.1 ms) | ≤ 4 ms | Met ✓ |
| Draw calls per stereo frame | **86** | ≤ 100 (shared M1 gate) | Met ✓ |
| Draw calls per eye view | **43** | ≤ 70 (spec). IWER renders the two views as separate passes, so every draw counts twice per frame. | Met ✓ |
| Triangles | **21,092** max | ≤ 120k | Met ✓ |

The 2.1 ms figure is the single highest frame. The gate is the p95 of the 600-frame window (634 frames were recorded).

Each light is one billboard draw call (a paper lantern painted into its own glow), so 12 lights cost 12 calls per view.

## Unit tests (`packages/core`, Vitest): 84 passed, 0 failed

```bash
npm --prefix packages/core test
```

| File | Tests | What it proves |
|---|---|---|
| `hide.test.ts` | 47 | On **5 synthetic rooms** (hand-authored furnished studio; hand-authored **bare room with no furniture**; IWER's `sunlit_living_room`, `bedroom` and `kitchen`, captured from the running app into `test/rooms/*.json`): 12 lights placed; every spot **partially visible** from the seated head (independent re-check, at least 30% of the silhouette); every spot inside the **120° comfort cone**; inside the room and never behind a wall; 0.45 m apart; **deterministic per seed**, different for another seed; ordered left to right; furnished rooms hide at least 4 lights at furniture with some partly hidden; the bare room hides only on walls and ceiling; a narrower cone is respected; turning the chair turns the spots; occlusion geometry (behind the couch is hidden, under a table is visible, rotated boxes) |
| `dwell.test.ts` | 7 | Dwell state machine: fires at 1.0 s, **not at 0.8 s**; leave resets; re-enter starts from zero; a different target resets; a short dropout keeps progress; fires once per look; 0.5 and 2.0 s settings |
| `scan.test.ts` | 6 | Scan cycling and wrap; keeps the highlight when the list changes; moves on when the highlighted light is caught; reaches Hint and Pause; adjustable speed; empty list |
| `voice.test.ts` | 3 | Grammar is exactly the nine commands plus `[unk]`; recogniser output maps to commands in order; `[unk]` and other words are dropped |
| `room.test.ts` | 6 | Planes classified by orientation and height (floor, ceiling, walls, surfaces), no-ceiling and empty fallbacks, plane area, oriented-box helpers |
| `misc.test.ts` | 15 | Hum pitch by height and pulse by aim; direction captions ("hum, left, low"); settings clamping; rounds of 5/8/12; catching once per light by any method; next/back cycling; first input picks the mode; constellation stars; daily seed |

## Emulator clips (test recordings)

Recorded from the real rendered frames with the CDP screencast (`e2e/record.mjs`, `e2e/record-page.mjs`); captions are
separate rendered overlays (`e2e/captions.py`), frames are never edited. 1280×720 (the emulator canvas is square, so
the clip is pillarboxed). Saved to `grokbot/videos/phengos/` with an uncaptioned copy and a `.vtt` for each.

| Clip | Length | Shows |
|---|---|---|
| `phengos-whoa.mp4` | 31 s | A light peeking over the armchair (labelled couch) in the living room; **Look (head)** dwell catches it and it lands on the palm; a second light by **hand ray + pinch**; a third by **voice** ("catch", real recogniser fed the test clip, transcript chip); pause menu → **high contrast**: the real room as yellow outlines, the remaining light glowing |
| `phengos-switch.mp4` | 30 s | Onboarding with no input: the scanner starts by itself; **one switch** pinches catch the outlined lights |
| `phengos-glasses.mp4` | 24 s | **Meta VR Glasses** profile with the FoV mask: **eye gaze + pinch** catches lights; labelled "Look (eyes)" |

## Unverified on hardware

Mic + Vosk inside an immersive session and Vosk's CPU load on Quest (it runs in a Worker), depth-occlusion quality at
couch edges, 72 fps on device, head-gaze dwell comfort, real hand-tracking accuracy (IWER's emulated hand ray drifts
as a pinch closes; Phengos catches what the ray was on in the last 0.3 s), microphone permission UX, and the
constellation returning above the same spots across real sessions.

## Known test-only hooks

`?fresh` (ignore saved settings and sky), `?seed=N`, `?round=N` (start at round N, used by the perf run), `?room=paper`
(force the fallback), `?dumpRoom` (log the room), `?voiceFixture=<wav>` (+ `voiceFixtureDelay` / `voiceFixtureGate`)
swaps the microphone for a recorded clip fed to the same recogniser, and the `TestSignal` ECS component starts that clip
during scripted recordings. `window.__phengos` is a read-only inspection handle for the scripts.
