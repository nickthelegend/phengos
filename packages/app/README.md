# Phengos app (IWSDK)

The WebXR app. `iwsdk.config.json` holds the scene, assets, components, XR features (hand tracking, plane and mesh
detection, anchors, depth sensing, optional gaze tracking) and the emulator device/room. Systems are registered in
`src/index.ts`; game logic lives in `../core`.

```sh
npm install
npm run dev        # dev server + emulator in a managed browser
npm run build      # static site in dist/
```

| Path | What |
|---|---|
| `src/systems/room-system.ts` | XRPlane/XRMesh → room model; paper-room fallback |
| `src/systems/game-system.ts` | rounds, spawning, catching, flights, constellation, ECS mirror |
| `src/systems/look-system.ts` | head-gaze (Quest) / eye-gaze (Glasses) dwell and reticle |
| `src/systems/input-system.ts` | pinches, single-switch scanning, long pinch |
| `src/systems/voice-system.ts` | optional Vosk voice |
| `src/systems/audio-system.ts` | HRTF hums, chimes, captions |
| `src/systems/contrast-system.ts` | high-contrast outlines |
| `src/systems/ui-system.ts`, `public/ui/*.uikitml` | HUD, tabs, card, menu |
| `e2e/` | emulator scenarios and clip recording (see ../../TESTING.md) |
