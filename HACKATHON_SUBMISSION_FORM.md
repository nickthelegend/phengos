# Devpost submission draft: Phengos

Event: Meta VR Start Developer Competition 2026 (https://start-developer-competition-26.devpost.com/).
Deadline: **Nov 18, 2026, 12:00 PM PST (Nov 18 20:00 UTC)**. Submitted by the team's Representative (team 4).

| Field | Value |
|---|---|
| Project name | Phengos |
| Tagline (≤140) | Lights hide behind your real furniture. Catch them by pointing, by looking, by voice or with one switch, or follow their hum. |
| Track | Gaming |
| Division | New Experience (fresh repo, built from Oct 24, 2026) |
| Platform | Immersive Web SDK (WebXR), submitted as a public URL |
| Public URL | _(Representative: GitHub Pages URL of `packages/app/dist`)_ |
| Video | _(Representative: public YouTube/Vimeo, under 3 min, built from the emulator clips with captions)_ |
| Target launch date | _(Representative)_ |
| Team | Representative (owner of repo, Pages, video, submission); Nick (non-Representative member, engineering) |

## Description (about 480 words)

**Inspiration.** Most mixed-reality games ask you to reach, aim and see well. We wanted a game where every way of playing
is a whole way of playing, not a fallback. Hide-and-seek is the oldest game there is, and a room you already know is the
best level there could be.

**What it is.** Twelve small paper lights hide around your real room: peeking over the back of your couch, under your
table, in a ceiling corner. Phengos reads the room your Quest has already scanned. Furniture comes with labels (couch,
table, shelf), walls and ceiling come as planes, and every hiding spot is checked so that part of the light is visible
from your seat and inside a comfortable turn. Depth occlusion makes a light really vanish behind your couch.

You catch a light in whichever way works for you:
- **Point**: aim your hand ray and pinch.
- **Look**: hold your view on it for a second. On Quest 3 that is head-gaze we built ourselves and label honestly; on
  Meta VR Glasses it follows your eyes.
- **One switch**: the outline steps from light to light; any pinch catches it.
- **Voice**: "catch", "next", "hint" and six more words, recognised on the device by Vosk. Nothing is sent anywhere.

There's no mode picker. The first light floats in plain view, and whatever you do first becomes your mode. If you do
nothing, the scanner starts by itself.

Every light hums from where it hides: higher means nearer the ceiling, and the hum quickens as you aim closer, so you can
play by sound alone. Every sound is captioned with a direction ("hum, left, low"). High contrast redraws your real walls
and furniture as bold yellow outlines on black. Caught lights land on your palm, then rise to your ceiling as stars, and
the constellation grows every night you play.

**How we built it.** IWSDK 1.1 (WebXR `immersive-ar`) with scene understanding (`XRPlane`, `XRMesh` semantic labels),
`DepthOccludable` in hard mode on the lights only, IWSDK eye gaze on the Glasses profile, our own head-gaze and dwell
timer, Web Audio HRTF panners for the hums, UIKitML panels, and Vosk WASM in a Worker with a fixed nine-word grammar. The
game logic (`packages/core`) is pure TypeScript with unit tests. We tested every mode end to end in the Meta Immersive Web
Emulator with emulated hands, gaze and synthetic rooms.

**What's next.** A headset pass (mic and Vosk inside immersive mode, occlusion at couch edges, 72 fps), shared
constellations between two rooms, and more voice languages.

## How hand interactions are implemented (optional field)

Hand ray + pinch through IWSDK `RayInteractable` (`Pressed` on the light); poke on every UI control
(`PokeInteractable`); palm-up wrist menu from WebXR hand joints; any pinch from either hand is a switch press
(`selectstart`/`selectend` on the XR session), with a 1 s long pinch for the menu. No controller code ships.

## Judging criteria map

| Criterion (25% each) | Phengos |
|---|---|
| Innovation & Creativity | Hide-and-seek inside your own room through depth occlusion; four equal input modes chosen by what you do first; a ceiling constellation that grows nightly (repeat use) |
| Experience Design | Seated, within 2 ft; first catch in under 10 s with no text wall; purposeful passthrough (your furniture hides the lights); FoV-aware HUD checked against the Glasses' view |
| Technical Implementation | Scene understanding → visibility-checked hiding spots; depth occlusion; IWSDK eye gaze on the Glasses; own head-gaze on Quest; Vosk grammar voice; frame budget gate (see TESTING.md) |
| Polish & Presentation | Paper-lantern glow, synthesised hums and chimes, captions everywhere, an honest emulator video showing all four modes |

## Special award it aims at: Best Accessibility Forward Experience

The award names three things; Phengos does all three, and each finishes the game alone:
- **Voice alternatives for hand interactions:** catch, next, back, hint, repeat, pause, resume, menu, louder.
- **Eyes-only navigation for limited mobility:** Look mode reaches every light and every menu control by dwell (head-gaze
  on Quest, eye gaze on the Glasses).
- **High-contrast modes:** yellow-on-black or white-on-black outlines of the real room, solid yellow lights.
- **Inclusive by default:** onboarding adopts your first input; single-switch scanning starts on its own; sound-only play
  with directional captions; text to 200%.
