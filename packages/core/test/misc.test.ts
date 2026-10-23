import { describe, expect, it } from 'vitest';
import { humPitch, humPulseHz, HUM_SCALE_HZ } from '../src/hum.js';
import { directionTo, captionFor, arrowFor } from '../src/caption.js';
import { sanitizeSettings, stepSetting, nextContrast, DEFAULT_SETTINGS } from '../src/settings.js';
import { Round, modeFromFirstInput, NIGHT_ROUNDS } from '../src/round.js';
import { starsFor, mergeSky, nightsPlayed } from '../src/constellation.js';
import { createRng, dailySeed, nightKey, hashString } from '../src/rng.js';
import { vec } from '../src/vec.js';
import type { Spot } from '../src/hide.js';

describe('hum', () => {
  it('pitch rises with height, floor lowest, ceiling highest', () => {
    expect(humPitch(0)).toBe(HUM_SCALE_HZ[0]);
    expect(humPitch(1)).toBe(HUM_SCALE_HZ[HUM_SCALE_HZ.length - 1]);
    expect(humPitch(0.5)).toBeGreaterThan(humPitch(0.2));
  });
  it('pulse speeds up as you aim closer', () => {
    expect(humPulseHz(90)).toBeCloseTo(0.8);
    expect(humPulseHz(1)).toBeCloseTo(6);
    expect(humPulseHz(10)).toBeGreaterThan(humPulseHz(30));
  });
});

describe('captions', () => {
  const head = vec(0, 1.2, 0);
  const fwd = vec(0, 0, -1);
  it('says where the sound is: hum, left, low', () => {
    const d = directionTo(head, fwd, vec(-2, 0.3, -1), 0, 2.6);
    expect(captionFor('hum', d)).toBe('hum, left, low');
    expect(arrowFor(d)).toBe('<');
  });
  it('ahead and high', () => {
    const d = directionTo(head, fwd, vec(0.1, 2.4, -3), 0, 2.6);
    expect(captionFor('chime', d)).toBe('chime, ahead, high');
  });
  it('behind right', () => {
    expect(directionTo(head, fwd, vec(1, 1.3, 1.5), 0, 2.6).side).toBe('behind right');
  });
});

describe('settings', () => {
  it('clamps dwell to 0.5..2.0 and scan to 0.75..4', () => {
    expect(sanitizeSettings({ dwellSec: 0.1 }).dwellSec).toBe(0.5);
    expect(sanitizeSettings({ dwellSec: 9 }).dwellSec).toBe(2);
    expect(sanitizeSettings({ scanSec: 0 }).scanSec).toBe(1.5);
    expect(sanitizeSettings({ scanSec: 0.2 }).scanSec).toBe(0.75);
  });
  it('steps and cycles', () => {
    expect(stepSetting(DEFAULT_SETTINGS, 'dwellSec', 1).dwellSec).toBe(1.25);
    expect(stepSetting(sanitizeSettings({ textScale: 2 }), 'textScale', 1).textScale).toBe(2);
    expect(nextContrast('off')).toBe('yellow');
    expect(nextContrast('yellow')).toBe('white');
    expect(nextContrast('white')).toBe('off');
  });
  it('rejects junk from storage', () => {
    expect(sanitizeSettings({ mode: 'fly' as never, contrast: 'pink' as never })).toMatchObject({ mode: 'point', contrast: 'off' });
  });
});

const spot = (id: string, x: number, yawDeg: number): Spot => ({
  id,
  kind: 'wall',
  position: vec(x, 1, -2),
  host: 'wall',
  visible: 1,
  yawDeg,
  heightNorm: 0.4,
});

describe('round', () => {
  it('nights are rounds of 5, 8 and 12', () => {
    expect([...NIGHT_ROUNDS]).toEqual([5, 8, 12]);
  });
  it('catches each light once, any method, and completes', () => {
    const r = new Round([spot('a', -1, -20), spot('b', 0, 0), spot('c', 1, 20)], 0);
    expect(r.catch('light-0', 'point', 1)).toBe(true);
    expect(r.catch('light-0', 'look', 2)).toBe(false);
    r.catch('light-1', 'voice', 3);
    expect(r.done).toBe(false);
    r.catch('light-2', 'switch', 4);
    expect(r.done).toBe(true);
    expect(r.methods()).toEqual({ point: 1, voice: 1, switch: 1 });
  });
  it('next/back cycle uncaught lights left to right', () => {
    const r = new Round([spot('a', -1, -20), spot('b', 0, 0), spot('c', 1, 20)], 0);
    expect(r.cycle(null, 1)).toBe('light-0');
    expect(r.cycle('light-0', 1)).toBe('light-1');
    expect(r.cycle('light-0', -1)).toBe('light-2');
    r.catch('light-1', 'point', 0);
    expect(r.cycle('light-0', 1)).toBe('light-2');
  });
  it('nearest to aim', () => {
    const r = new Round([spot('a', -1, -20), spot('b', 0, 0), spot('c', 1, 20)], 0);
    expect(r.nearestToAim(vec(0, 1, 0), vec(0.5, 0, -1))?.id).toBe('light-2');
  });
  it('the first input used picks the mode we teach', () => {
    expect(modeFromFirstInput('point')).toBe('point');
    expect(modeFromFirstInput('mouse')).toBe('point');
    expect(modeFromFirstInput('look')).toBe('look');
    expect(modeFromFirstInput('eyes')).toBe('look');
    expect(modeFromFirstInput('switch')).toBe('switch');
  });
});

describe('constellation', () => {
  it('adds one star per caught light, deterministically, without stacking', () => {
    const caught = [
      { id: 'light-0', position: vec(0, 1, -2) },
      { id: 'light-1', position: vec(0.01, 1, -2) },
    ];
    const a = starsFor('2026-10-24', caught, []);
    expect(a).toHaveLength(2);
    expect(starsFor('2026-10-24', caught, [])).toEqual(a);
    expect(Math.hypot(a[0]!.x - a[1]!.x, a[0]!.z - a[1]!.z)).toBeGreaterThanOrEqual(0.12);
    const sky = mergeSky(a, starsFor('2026-10-25', caught, a));
    expect(nightsPlayed(sky)).toBe(2);
  });
});

describe('daily seed', () => {
  it('is stable per date and differs between dates', () => {
    const d1 = new Date(2026, 9, 24, 21, 0);
    const d2 = new Date(2026, 9, 24, 8, 0);
    const d3 = new Date(2026, 9, 25, 21, 0);
    expect(nightKey(d1)).toBe('2026-10-24');
    expect(dailySeed(d1)).toBe(dailySeed(d2));
    expect(dailySeed(d1)).not.toBe(dailySeed(d3));
    expect(hashString('a')).not.toBe(hashString('b'));
    const r1 = createRng(5);
    const r2 = createRng(5);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });
});
