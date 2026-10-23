# Phengos (φέγγος, "glow")

Twelve small paper lights hide around your real room: behind the couch, under the table, in a ceiling corner. Find them
by pointing, by looking, by saying "catch", or with one switch. If you can't see well, follow their hum. Every way to play
is a first-class way: each one finishes the game on its own.

Meta VR Start 2026 entry: **Gaming** track, **New Experience** division, aiming at **Best Accessibility Forward
Experience**. Built with the Meta Immersive Web SDK (WebXR, `immersive-ar`), hands first, no controller code.

## What it does

| | |
|---|---|
| **Your room is the level** | Reads the room the headset already scanned: `XRMesh` furniture volumes with their semantic labels (couch, table, shelf, bed...) and `XRPlane` walls, floor and ceiling (planes have no labels, so they are classified by orientation and height). `packages/core/src/hide.ts` picks spots behind, beside and under furniture, in ceiling corners and along walls. Every spot is **partly visible from your seat** (rays from your head to 17 points on the light's silhouette, tested against the furniture) and **inside a 120° comfort cone** (adjustable). Tables are open underneath; lamps and plants are thin. |
| **Real occlusion** | Lights carry IWSDK `DepthOccludable` in hard mode (one depth sample per fragment), so a light really disappears behind your real couch. Nothing else is occluded. |
| **Four equal ways to play** | **Point:** hand ray + pinch. **Look:** hold your view on a light for 1.0 s (0.5–2.0 s) with a reticle and a filling ring. On Quest 3 this is our own **head-gaze** from the viewer pose, labelled "Look (head)": Quest 3 has no eye tracking. Where the runtime provides a gaze source (Meta VR Glasses), the same control follows the **eye-gaze** ray and says "Look (eyes)"; IWSDK's gaze + pinch also works there. **One switch:** the outline steps through the lights, then Hint and Pause, every 1.5 s (0.75–4 s); any pinch from either hand selects what was outlined when the pinch began; a long pinch (1 s) opens the menu. **Voice (optional):** nine words. |
| **Inclusive by default** | No mode picker up front. The first light floats in plain sight; whichever way you catch it (pinch, look, switch, voice) becomes your mode. If you do nothing for 4 s, the scanner starts by itself, so someone who can only pinch is never stuck. |
| **Sound first** | Each light hums from where it hides (Web Audio `PannerNode`, HRTF). Pitch encodes height on a pentatonic scale (floor low, ceiling high); the hum pulses faster as you aim closer. "repeat" replays the nearest hum; Hint pulses it and draws an edge arrow. **Sound only** turns the lights' visuals off entirely. |
| **Captions for every sound** | "hum, left, low", "chime, ahead, middle - caught by look", with a direction arrow. |
| **High contrast** | Your real planes and furniture are redrawn as thick yellow (or white) outlines over a dimming layer, and the lights become large solid yellow glows. Geometry only: apps cannot read or recolour passthrough pixels. |
| **Voice** | On "Turn on voice" (a user gesture), mic → **Vosk** (WASM in a Worker, `@lichess-org/vosk-browser`, Apache-2.0) with the small English model served from our own host and a fixed grammar: catch, next, back, hint, repeat, pause, resume, menu, louder (+ `[unk]`). A live transcript chip shows what was heard. No audio is stored or sent. Cloud `SpeechRecognition` is detected and logged but not used (it would send audio away). If the model or mic is missing, the chip says "Voice unavailable on this device" and play continues. |
| **Seated, within 2 ft** | Nothing to reach for: lights are caught at a distance. Pause and Hint tabs stay at the bottom of your view; a palm-up wrist chip opens the menu too. |
| **A reason to come back** | Nights of three rounds (5, 8, 12 lights) from a daily seed. Each caught light lands on your palm, then rises to your ceiling and becomes a star. The constellation is saved on the device (IndexedDB) in ceiling-plane coordinates, so it returns above the same spots, and grows night after night. |
| **Fallback** | No room scan within 5 s → a virtual paper room of three folding screens around you, and the game still completes. |

Settings (all on the first screen of the menu): way to play, dwell time, scan speed, text size (100–200%), hum on/off,
sound only, contrast (off / yellow / white), voice.

## Repository

```
packages/core     pure TypeScript game logic + Vitest (room model, hiding spots, dwell, scanner, voice grammar, hum, captions)
packages/app      the IWSDK app (systems in src/systems, UIKitML panels in public/ui, e2e in e2e/)
packages/landing  one-page site in the brand (wayfinding signage), plays the real emulator clip with captions
scripts/          fetch-vosk-model.sh (downloads + checks + repacks the Vosk model)
TESTING.md        real test counts and emulator gates
ASSETS.md         every asset and licence
HACKATHON_SUBMISSION_FORM.md
```

## Run it

Requirements: Node 20.19+ / 22.12+ / 24+.

```bash
npm --prefix packages/core install && npm --prefix packages/app install
./scripts/fetch-vosk-model.sh          # optional: voice. 40 MB, Apache-2.0, checksum-pinned
npm test                                # core unit tests
cd packages/app && npm run dev          # IWSDK dev server + emulator (IWER) in a managed browser
```

`npm run build` in `packages/app` produces a static site in `dist/` (the Vosk model is copied from `public/models/`).

### On a Quest 3 / 3S (for Nick or the team)

1. Do the headset's **Space Setup** (room scan) first, so Phengos can see your furniture.
2. Local HTTPS over USB: `cd packages/app && npm run dev`, then `adb reverse tcp:8081 tcp:8081` and open
   `https://localhost:8081/` in the Meta Quest Browser (accept the local certificate warning). Over Wi-Fi, open the
   `data.runtimeUrls.network` URL from `npx iwsdk dev status`.
   Alternatively serve `dist/` over HTTP through `adb reverse` (`http://localhost` is a secure context).
3. Tap **Enter your room**, allow hand tracking (and the microphone only if you turn voice on).
4. Things only a headset can show (not verified yet): mic + Vosk inside an immersive session and its CPU load, depth
   occlusion quality at couch edges, 72 fps, head-gaze dwell comfort, persistent placement of the constellation.

No hosting or deploys are set up in this repo; the team Representative publishes the public URL (e.g. GitHub Pages).

## Accessibility statement

To be written by the team Representative after their accessibility review (ideally with at least one tester who uses
the relevant access need, credited by first name or anonymously, never shown in the video). The build already provides:
voice alternatives for every hand interaction, eyes-only (head- or eye-) navigation of the whole game and menu,
single-switch scanning, high-contrast mode, sound-only play with directional captions, text up to 200%, seated play
within 2 ft, and no timed failure states.

## Honesty notes

- "Look" on Quest 3 is **head-gaze**, never called eye tracking. Eye gaze exists only where the runtime has a gaze source.
- Emulator results do not prove real hand-tracking accuracy, headset frame rate or depth quality. See TESTING.md.
- The voice test clip in `packages/app/public/fixtures/` is **synthetic speech** (espeak-ng). The Representative should
  replace it with their own recordings.

## Licence

MIT, Copyright (c) 2026 Nivesh Gajengi. Fonts under the SIL Open Font License; see ASSETS.md.
