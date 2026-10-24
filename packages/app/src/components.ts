/**
 * Phengos ECS components. System-free: the editor imports this module too.
 *
 * GameState mirrors the game for inspection and the e2e tests
 * (`iwsdk ecs find --input-json '{"withComponents":["GameState"]}'`).
 */
import { createComponent, defineComponents, Types } from '@iwsdk/core';

export const Phases = {
  Boot: 'boot',
  Room: 'room',
  Onboarding: 'onboarding',
  Playing: 'playing',
  RoundEnd: 'round-end',
  NightEnd: 'night-end',
} as const;

export const GameState = createComponent('GameState', {
  phase: { type: Types.Enum, enum: Phases, default: Phases.Boot },
  mode: { type: Types.String, default: 'point' },
  roundIndex: { type: Types.Int8, default: 0 },
  caught: { type: Types.Int16, default: 0 },
  total: { type: Types.Int16, default: 0 },
  caughtTotal: { type: Types.Int16, default: 0 },
  paused: { type: Types.Boolean, default: false },
  menuOpen: { type: Types.Boolean, default: false },
  contrast: { type: Types.String, default: 'off' },
  soundOnly: { type: Types.Boolean, default: false },
  dwellSec: { type: Types.Float32, default: 1 },
  scanSec: { type: Types.Float32, default: 1.5 },
  textScale: { type: Types.Float32, default: 1 },
  hum: { type: Types.Boolean, default: true },
  lookLabel: { type: Types.String, default: 'Look (head)' },
  dwellTarget: { type: Types.String, default: '' },
  dwellProgress: { type: Types.Float32, default: 0 },
  scanItem: { type: Types.String, default: '' },
  outlined: { type: Types.String, default: '' },
  lastCatchMethod: { type: Types.String, default: '' },
  methodsUsed: { type: Types.String, default: '' },
  voiceStatus: { type: Types.String, default: 'off' },
  transcript: { type: Types.String, default: '' },
  lastVoiceCommands: { type: Types.String, default: '' },
  caption: { type: Types.String, default: '' },
  roomSource: { type: Types.String, default: '' },
  roomSummary: { type: Types.String, default: '' },
  stars: { type: Types.Int16, default: 0 },
  nights: { type: Types.Int16, default: 0 },
});

/** One hidden light. Position is duplicated as scalars so CLI queries can read it. */
export const Light = createComponent('Light', {
  lightId: { type: Types.String, default: '' },
  kind: { type: Types.String, default: '' },
  host: { type: Types.String, default: '' },
  visible: { type: Types.Float32, default: 1 },
  caught: { type: Types.Boolean, default: false },
  method: { type: Types.String, default: '' },
  px: { type: Types.Float32, default: 0 },
  py: { type: Types.Float32, default: 0 },
  pz: { type: Types.Float32, default: 0 },
});

/** In-app frame timing (relative proxy; not a headset measurement). */
export const PerfStats = createComponent('PerfStats', {
  frames: { type: Types.Int32, default: 0 },
  cpuP50: { type: Types.Float32, default: 0 },
  cpuP95: { type: Types.Float32, default: 0 },
  drawCalls: { type: Types.Int32, default: 0 },
  drawCallsMax: { type: Types.Int32, default: 0 },
  triangles: { type: Types.Int32, default: 0 },
  trianglesMax: { type: Types.Int32, default: 0 },
});

/**
 * Test-only signal for scripted recordings: setting feedVoiceFixture (via
 * `iwsdk ecs set-component`) starts feeding the recorded voice clip when the
 * page was opened with ?voiceFixture=...&voiceFixtureGate=1.
 */
export const TestSignal = createComponent('TestSignal', {
  feedVoiceFixture: { type: Types.Boolean, default: false },
});

/** Tag for the palm-up wrist menu chip. */
export const WristChip = createComponent('WristChip', {});

export default defineComponents([GameState, Light, PerfStats, WristChip, TestSignal]);
