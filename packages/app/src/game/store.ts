/**
 * The shared game store. Systems read and write it; GameSystem mirrors the
 * important fields into the GameState ECS component every frame so the CLI and
 * the e2e tests can assert on them.
 */
import type { Object3D, Vector3 } from '@iwsdk/core';
import {
  type CatchMethod,
  type PlayMode,
  type RoomInfo,
  type Room,
  type Settings,
  type Star,
  Round,
  sanitizeSettings,
} from '@phengos/core';

export type Phase = 'boot' | 'room' | 'onboarding' | 'playing' | 'round-end' | 'night-end';

/** Something you can aim at: a light or a UI control. */
export interface Target {
  id: string;
  kind: 'light' | 'control';
  object: Object3D;
  /** Angular radius in degrees used by head-gaze targeting. */
  radiusDeg: number;
  activate: (method: CatchMethod) => void;
  /** Visual highlight for scanning / voice outline. */
  highlight: (on: boolean) => void;
}

export interface CaptionEvent {
  text: string;
  arrow: string;
  until: number;
}

const SETTINGS_KEY = 'phengos.settings.v1';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeSettings(null);
  }
}

export class Store {
  phase: Phase = 'boot';
  settings: Settings = loadSettings();
  /** True once the first input picked the mode (onboarding done). */
  modeChosen = false;
  room: Room | null = null;
  roomInfo: RoomInfo | null = null;
  roomSource: 'scene' | 'paper' | '' = '';
  roundIndex = 0;
  round: Round | null = null;
  caughtTotal = 0;
  paused = false;
  menuOpen = false;
  /** Light outlined by voice next/back. */
  outlined: string | null = null;
  scanItem: string | null = null;
  dwellTarget: string | null = null;
  dwellProgress = 0;
  lastCatchMethod: CatchMethod | '' = '';
  methodsUsed = new Set<CatchMethod>();
  voiceStatus = 'off';
  transcript = '';
  lastVoiceCommands = '';
  caption: CaptionEvent = { text: 'Finding your room', arrow: 'o', until: Infinity };
  gazeAvailable = false;
  inXR = false;
  /** Where stars are placed: relative to the ceiling plane, so they return to the same spot. */
  ceiling: { origin: Vector3; xAxis: Vector3; zAxis: Vector3 } | null = null;
  /** Seated head pose and current aim ray (head or eyes), updated every frame by LookSystem. */
  head = { x: 0, y: 1.2, z: 0 };
  aim = { x: 0, y: 0, z: -1 };
  forward = { x: 0, y: 0, z: -1 };
  stars: Star[] = [];
  nights = 0;
  /** Lights caught this frame by a pinch, so the switch pinch is not double-counted. */
  pinchConsumedAt = -1;
  /** The hand of the latest pinch, so a caught light lands on that palm. */
  lastHand: 'left' | 'right' | null = null;
  time = 0;
  /** Targets that can currently be aimed at, rebuilt by the UI and game systems. */
  lightTargets = new Map<string, Target>();
  controlTargets = new Map<string, Target>();

  /** The look label is honest: head-gaze on Quest, eye gaze only where the runtime has it. */
  get lookLabel(): string {
    return this.gazeAvailable ? 'Look (eyes)' : 'Look (head)';
  }

  setSettings(next: Settings): void {
    this.settings = sanitizeSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* private mode: settings still apply for this session */
    }
  }

  setMode(mode: PlayMode): void {
    this.setSettings({ ...this.settings, mode });
  }

  say(text: string, arrow = 'o', seconds = 3.5): void {
    this.caption = { text, arrow, until: this.time + seconds };
  }

  /** Every target that is aimable right now, in scan order. */
  activeTargets(): Target[] {
    if (this.menuOpen) return [...this.controlTargets.values()].filter((t) => t.id.startsWith('menu:'));
    const lights: Target[] = [];
    const live = (this.phase === 'playing' || this.phase === 'onboarding') && !this.paused;
    if (!live) return lights;
    if (this.round) {
      for (const id of this.round.order()) {
        const t = this.lightTargets.get(id);
        if (t) lights.push(t);
      }
    }
    const tabs = [...this.controlTargets.values()].filter((t) => t.id.startsWith('tab:') || t.id.startsWith('card:'));
    return [...lights, ...tabs];
  }
}

export const STORE_KEY = 'phengos';

export interface AudioApi {
  unlock(): void;
  ping(id: string, strong?: boolean): void;
  chime(p: { x: number; y: number; z: number }): void;
  state(): string;
}

export interface VoiceApi {
  toggle(): void;
  status(): string;
}

/** Typed view of world.globals. */
export function globalsOf(world: { globals: object }): {
  audio?: AudioApi;
  voice?: VoiceApi;
  controller?: import('../systems/game-system.js').Controller;
  lightVisuals?: Map<string, import('./visuals.js').LightVisual>;
  [key: string]: unknown;
} {
  return world.globals as never;
}
