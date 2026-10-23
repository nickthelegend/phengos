/** Player settings. All of them are on the first screen. */
import { DWELL_DEFAULT, DWELL_MAX, DWELL_MIN } from './dwell.js';
import { SCAN_DEFAULT, SCAN_MAX, SCAN_MIN } from './scan.js';

export type PlayMode = 'point' | 'look' | 'switch';
export type Contrast = 'off' | 'white' | 'yellow';

export interface Settings {
  mode: PlayMode;
  dwellSec: number;
  scanSec: number;
  textScale: number;
  hum: boolean;
  humVolume: number;
  contrast: Contrast;
  /** Blind-friendly: visuals off, play by sound and captions. */
  soundOnly: boolean;
  voice: boolean;
  comfortHalfDeg: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  mode: 'point',
  dwellSec: DWELL_DEFAULT,
  scanSec: SCAN_DEFAULT,
  textScale: 1,
  hum: true,
  humVolume: 0.6,
  contrast: 'off',
  soundOnly: false,
  voice: false,
  comfortHalfDeg: 60,
});

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

export function sanitizeSettings(input: Partial<Settings> | null | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(input ?? {}) };
  return {
    mode: s.mode === 'look' || s.mode === 'switch' ? s.mode : 'point',
    dwellSec: round2(clamp(Number(s.dwellSec) || DWELL_DEFAULT, DWELL_MIN, DWELL_MAX)),
    scanSec: round2(clamp(Number(s.scanSec) || SCAN_DEFAULT, SCAN_MIN, SCAN_MAX)),
    textScale: round2(clamp(Number(s.textScale) || 1, 1, 2)),
    hum: s.hum !== false,
    humVolume: round2(clamp(Number(s.humVolume) || 0.6, 0.1, 1)),
    contrast: s.contrast === 'white' || s.contrast === 'yellow' ? s.contrast : 'off',
    soundOnly: s.soundOnly === true,
    voice: s.voice === true,
    comfortHalfDeg: clamp(Number(s.comfortHalfDeg) || 60, 30, 120),
  };
}

/** Step a numeric setting by a fixed increment, clamped. */
export function stepSetting(s: Settings, key: 'dwellSec' | 'scanSec' | 'textScale' | 'humVolume', dir: 1 | -1): Settings {
  const inc = { dwellSec: 0.25, scanSec: 0.25, textScale: 0.25, humVolume: 0.2 }[key];
  return sanitizeSettings({ ...s, [key]: s[key] + inc * dir });
}

export function nextContrast(c: Contrast): Contrast {
  return c === 'off' ? 'yellow' : c === 'yellow' ? 'white' : 'off';
}
