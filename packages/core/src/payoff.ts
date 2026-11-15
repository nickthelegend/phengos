/**
 * The catch payoff, as pure functions the app animates:
 *
 * 1. the light pops where it hid (a flash and a shock ring),
 * 2. flies in an arc to your palm, trailing sparks,
 * 3. glows on your palm for a moment,
 * 4. rises to the ceiling and lands as a star with a flash,
 * 5. a line joins it to tonight's constellation, so the sky visibly grows.
 *
 * Timings live here so the app, the tests and the film script agree.
 */
import type { Star } from './constellation.js';
import type { Vec3 } from './vec.js';
import { vec } from './vec.js';

export const PAYOFF = {
  /** The pop where the light hid. */
  popSec: 0.35,
  /** The arc to your palm. */
  toPalmSec: 1.0,
  /** Glowing on your palm. */
  restSec: 0.9,
  /** The rise to the ceiling. */
  riseSec: 1.6,
  /** The star's landing flash, after which it settles to its constellation size. */
  flashSec: 0.9,
  /** How long a new constellation line takes to draw. */
  lineSec: 0.7,
} as const;

/** Total time from the catch until the star has settled and its line is drawn. */
export const PAYOFF_TOTAL_SEC = PAYOFF.toPalmSec + PAYOFF.restSec + PAYOFF.riseSec + Math.max(PAYOFF.flashSec, PAYOFF.lineSec);

export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInOutSine = (x: number): number => -(Math.cos(Math.PI * clamp01(x)) - 1) / 2;
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * A point on the flight arc from `from` to `to` at progress k (0..1, already eased):
 * a straight line lifted by a sine bump of `lift` metres. k=0 is `from`, k=1 is `to`.
 */
export function arcPoint(from: Vec3, to: Vec3, k: number, lift: number): Vec3 {
  const t = clamp01(k);
  const bump = Math.sin(t * Math.PI) * lift;
  return vec(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t + bump, from.z + (to.z - from.z) * t);
}

/**
 * Size of the light (metres, billboard width) along the payoff. It pops bigger
 * where it hid, shrinks to a palm-sized lantern in flight, pulses on the palm,
 * and stretches out as it rises.
 */
export function flightScale(stage: 'pop' | 'toPalm' | 'rest' | 'rise', k: number, base: number, palm: number): number {
  const t = clamp01(k);
  switch (stage) {
    case 'pop':
      return base * (1 + 0.45 * Math.sin(t * Math.PI));
    case 'toPalm':
      return base + (palm - base) * easeOutCubic(t);
    case 'rest':
      return palm * (1 + 0.12 * Math.sin(t * Math.PI * 4));
    case 'rise':
      return palm * (1 - 0.35 * t);
  }
}

/**
 * The star's landing flash: starts at `peak` times its resting size and settles
 * to 1 with a small overshoot. Returns 1 after the flash.
 */
export function starFlash(t: number, peak = 5): number {
  if (t <= 0) return peak;
  if (t >= PAYOFF.flashSec) return 1;
  const k = t / PAYOFF.flashSec;
  const decay = Math.pow(1 - k, 2);
  return 1 + (peak - 1) * decay + Math.sin(k * Math.PI) * 0.15;
}

/**
 * Constellation lines. Every star links to the nearest star caught BEFORE it on
 * the same night, so each new catch adds exactly one line and the shape grows
 * outward like a real constellation drawing (a tree: no crossings back to
 * itself, no loops). Returns index pairs into `stars` (earlier, later).
 * Stars from different nights never link: each night is its own figure.
 */
export function constellationEdges(stars: readonly Star[], maxLen = 2.6): Array<[number, number]> {
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i]!;
    let best = -1;
    let bestD = maxLen;
    for (let j = 0; j < i; j++) {
      const o = stars[j]!;
      if (o.night !== s.night) continue;
      const d = Math.hypot(o.x - s.x, o.z - s.z);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best >= 0) edges.push([best, i]);
  }
  return edges;
}

/**
 * Quad corners for a line of `width` metres on a horizontal plane at height y:
 * the line from a to b (x, z), widened sideways. Order: a-left, a-right, b-right, b-left.
 * `k` (0..1) draws the line partway, from a toward b.
 */
export function lineQuad(a: { x: number; z: number }, b: { x: number; z: number }, y: number, width: number, k = 1): Vec3[] {
  const t = clamp01(k);
  const bx = a.x + (b.x - a.x) * t;
  const bz = a.z + (b.z - a.z) * t;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = (-dz / len) * (width / 2);
  const nz = (dx / len) * (width / 2);
  return [vec(a.x + nx, y, a.z + nz), vec(a.x - nx, y, a.z - nz), vec(bx - nx, y, bz - nz), vec(bx + nx, y, bz + nz)];
}
