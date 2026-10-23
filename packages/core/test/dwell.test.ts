import { describe, expect, it } from 'vitest';
import { DwellTimer } from '../src/dwell.js';

const FRAME = 1 / 72;
function hold(t: DwellTimer, target: string | null, seconds: number) {
  const events = [];
  for (let s = 0; s < seconds - 1e-9; s += FRAME) events.push(...t.update(target, FRAME));
  return events;
}

describe('DwellTimer', () => {
  it('fires after the dwell time on one target', () => {
    const t = new DwellTimer(1.0);
    const ev = hold(t, 'a', 1.1);
    expect(ev[0]).toEqual({ type: 'enter', target: 'a' });
    expect(ev.filter((e) => e.type === 'fire')).toEqual([{ type: 'fire', target: 'a' }]);
  });

  it('does not fire at 0.8 s with a 1.0 s dwell (the e2e control run)', () => {
    const t = new DwellTimer(1.0);
    expect(hold(t, 'a', 0.8).some((e) => e.type === 'fire')).toBe(false);
    expect(t.progress).toBeGreaterThan(0.7);
    expect(t.progress).toBeLessThan(0.81);
  });

  it('leaving resets progress; re-entering starts again from zero', () => {
    const t = new DwellTimer(1.0);
    hold(t, 'a', 0.7);
    const leave = hold(t, null, 0.3);
    expect(leave).toEqual([{ type: 'leave', target: 'a' }]);
    expect(t.progress).toBe(0);
    const again = hold(t, 'a', 0.7);
    expect(again[0]).toEqual({ type: 'enter', target: 'a' });
    expect(again.some((e) => e.type === 'fire')).toBe(false);
    expect(hold(t, 'a', 0.35).some((e) => e.type === 'fire')).toBe(true);
  });

  it('a different target resets immediately', () => {
    const t = new DwellTimer(1.0);
    hold(t, 'a', 0.9);
    const ev = t.update('b', FRAME);
    expect(ev).toEqual([
      { type: 'leave', target: 'a' },
      { type: 'enter', target: 'b' },
    ]);
    expect(t.progress).toBe(0);
  });

  it('a dropout shorter than the grace period keeps progress', () => {
    const t = new DwellTimer(1.0, 0.1);
    hold(t, 'a', 0.6);
    const p = t.progress;
    expect(hold(t, null, 0.05)).toEqual([]);
    expect(t.progress).toBeCloseTo(p, 5);
    expect(hold(t, 'a', 0.45).some((e) => e.type === 'fire')).toBe(true);
  });

  it('fires once, then needs a fresh look', () => {
    const t = new DwellTimer(0.5);
    const ev = hold(t, 'a', 2);
    expect(ev.filter((e) => e.type === 'fire')).toHaveLength(1);
    hold(t, null, 0.2);
    expect(hold(t, 'a', 0.6).filter((e) => e.type === 'fire')).toHaveLength(1);
  });

  it('respects the adjustable range', () => {
    for (const d of [0.5, 2.0]) {
      const t = new DwellTimer(d);
      expect(hold(t, 'a', d - 0.05).some((e) => e.type === 'fire')).toBe(false);
      expect(hold(t, 'a', 0.1).some((e) => e.type === 'fire')).toBe(true);
    }
  });
});
