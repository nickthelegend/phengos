import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PAYOFF,
  PAYOFF_TOTAL_SEC,
  arcPoint,
  constellationEdges,
  easeOutCubic,
  flightScale,
  lineQuad,
  starFlash,
} from '../src/payoff.js';
import { CAP_RATIO, MIN_CAP_PER_METRE, PANELS, angularDeg, capPerMetre, minFontPx, type PanelName } from '../src/legibility.js';
import type { Star } from '../src/constellation.js';
import { vec } from '../src/vec.js';

describe('catch payoff: flight', () => {
  const from = vec(1, 0.8, -2.5);
  const palm = vec(0.1, 0.9, -0.4);
  it('starts where the light hid and ends on the palm', () => {
    expect(arcPoint(from, palm, 0, 0.3)).toEqual(from);
    const end = arcPoint(from, palm, 1, 0.3);
    expect(end.x).toBeCloseTo(palm.x);
    expect(end.y).toBeCloseTo(palm.y);
    expect(end.z).toBeCloseTo(palm.z);
  });
  it('arcs upward in the middle of the flight', () => {
    const mid = arcPoint(from, palm, 0.5, 0.3);
    expect(mid.y).toBeCloseTo((from.y + palm.y) / 2 + 0.3);
  });
  it('clamps progress outside 0..1', () => {
    expect(arcPoint(from, palm, -1, 0.3)).toEqual(from);
    expect(arcPoint(from, palm, 2, 0.3).z).toBeCloseTo(palm.z);
  });
  it('the light pops bigger, shrinks to the palm, pulses there, and thins as it rises', () => {
    expect(flightScale('pop', 0.5, 0.9, 0.3)).toBeGreaterThan(0.9 * 1.4);
    expect(flightScale('pop', 1, 0.9, 0.3)).toBeCloseTo(0.9);
    expect(flightScale('toPalm', 0, 0.9, 0.3)).toBeCloseTo(0.9);
    expect(flightScale('toPalm', 1, 0.9, 0.3)).toBeCloseTo(0.3);
    expect(flightScale('rest', 0.125, 0.9, 0.3)).toBeGreaterThan(0.3);
    expect(flightScale('rise', 1, 0.9, 0.3)).toBeLessThan(0.3);
  });
  it('easing is monotonic and ends at 1', () => {
    let last = -1;
    for (let k = 0; k <= 1.0001; k += 0.05) {
      const e = easeOutCubic(k);
      expect(e).toBeGreaterThanOrEqual(last);
      last = e;
    }
    expect(easeOutCubic(1)).toBe(1);
  });
  it('the whole payoff, catch to settled star, takes under 5 s', () => {
    expect(PAYOFF_TOTAL_SEC).toBeGreaterThan(3);
    expect(PAYOFF_TOTAL_SEC).toBeLessThan(5);
  });
});

describe('catch payoff: the star lands', () => {
  it('flashes big, then settles to its resting size', () => {
    expect(starFlash(0)).toBe(5);
    expect(starFlash(PAYOFF.flashSec * 0.3)).toBeGreaterThan(2);
    expect(starFlash(PAYOFF.flashSec)).toBe(1);
    expect(starFlash(10)).toBe(1);
  });
});

describe('constellation lines', () => {
  const s = (night: string, x: number, z: number): Star => ({ night, x, z, magnitude: 1 });
  it('each new star adds exactly one line to the nearest earlier star of the same night', () => {
    const stars = [s('a', 0, 0), s('a', 1, 0), s('a', 0.2, 0.9), s('a', 1.1, 0.3)];
    const e = constellationEdges(stars);
    expect(e).toEqual([
      [0, 1],
      [0, 2],
      [1, 3],
    ]);
    // Growing: the first k stars give k-1 lines, and the earlier lines never change.
    for (let k = 1; k <= stars.length; k++) {
      const part = constellationEdges(stars.slice(0, k));
      expect(part.length).toBe(k - 1);
      expect(e.slice(0, k - 1)).toEqual(part);
    }
  });
  it('nights stay separate figures', () => {
    const e = constellationEdges([s('a', 0, 0), s('b', 0.1, 0), s('a', 0.5, 0), s('b', 0.4, 0.1)]);
    expect(e).toEqual([
      [0, 2],
      [1, 3],
    ]);
  });
  it('no line longer than the limit', () => {
    expect(constellationEdges([s('a', 0, 0), s('a', 5, 0)], 2.6)).toEqual([]);
  });
  it('a line quad has the given width and draws partway', () => {
    const q = lineQuad({ x: 0, z: 0 }, { x: 2, z: 0 }, 2.4, 0.04);
    expect(q).toHaveLength(4);
    expect(Math.hypot(q[0]!.x - q[1]!.x, q[0]!.z - q[1]!.z)).toBeCloseTo(0.04);
    for (const p of q) expect(p.y).toBe(2.4);
    const half = lineQuad({ x: 0, z: 0 }, { x: 2, z: 0 }, 2.4, 0.04, 0.5);
    expect(half[2]!.x).toBeCloseTo(1);
  });
});

/** Every font-size in a UIKitML panel, with the class it belongs to. */
function fontSizes(file: string): Array<{ cls: string; px: number }> {
  const src = readFileSync(file, 'utf8');
  const out: Array<{ cls: string; px: number }> = [];
  const rule = /\.([\w-]+)(?::\w+)?\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rule.exec(src))) {
    const size = /font-size:\s*(\d+(?:\.\d+)?)/.exec(m[2]!);
    if (size) out.push({ cls: m[1]!, px: Number(size[1]) });
  }
  return out;
}

describe('legibility: every line of text in every panel', () => {
  const UI = join(__dirname, '..', '..', 'app', 'public', 'ui');
  const files: Record<string, PanelName> = {
    'hud.uikitml': 'hud',
    'tabs.uikitml': 'tabs',
    'card.uikitml': 'card',
    'menu.uikitml': 'menu',
  };
  it('covers every panel file', () => {
    const found = readdirSync(UI).filter((f) => f.endsWith('.uikitml')).sort();
    expect(found).toEqual(Object.keys(files).sort());
  });
  for (const [file, panel] of Object.entries(files)) {
    it(`${file}: cap height ≥ ${MIN_CAP_PER_METRE} m per metre at 100% text`, () => {
      const sizes = fontSizes(join(UI, file));
      expect(sizes.length).toBeGreaterThan(0);
      for (const { cls, px } of sizes) {
        const cap = capPerMetre(px, PANELS[panel]);
        expect(cap, `${file} .${cls} ${px}px gives ${cap.toFixed(4)} m/m`).toBeGreaterThanOrEqual(MIN_CAP_PER_METRE);
        expect(px).toBeGreaterThanOrEqual(minFontPx(PANELS[panel]));
      }
    });
  }
  it('inline style font sizes are not used to sneak in small text', () => {
    for (const file of Object.keys(files)) {
      expect(readFileSync(join(UI, file), 'utf8')).not.toMatch(/style="[^"]*font-size/);
    }
  });
  it('the rule is about 1 degree of cap height, and panels stay inside a comfortable view', () => {
    expect(angularDeg(MIN_CAP_PER_METRE, 1)).toBeCloseTo(1.03, 1);
    expect(CAP_RATIO).toBe(0.7);
    for (const p of Object.values(PANELS)) expect(p.dist).toBeGreaterThanOrEqual(0.7);
  });
});
