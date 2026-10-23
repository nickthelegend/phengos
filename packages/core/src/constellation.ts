/**
 * The ceiling constellation: every caught light becomes a star above the spot
 * where it hid, and the sky grows night after night.
 */
import type { Vec3 } from './vec.js';
import { createRng, hashString } from './rng.js';

export interface Star {
  night: string;
  /** Horizontal position under the ceiling (x, z), metres in room space. */
  x: number;
  z: number;
  /** 0..1 brightness, from how the light was caught (stable per star). */
  magnitude: number;
}

export const MAX_STARS = 400;

/** Stars for the lights caught tonight, nudged so they never stack. */
export function starsFor(night: string, caught: Array<{ id: string; position: Vec3 }>, existing: Star[]): Star[] {
  const out: Star[] = [];
  for (const c of caught) {
    const rng = createRng(hashString(`${night}:${c.id}`));
    let x = c.position.x + (rng() - 0.5) * 0.3;
    let z = c.position.z + (rng() - 0.5) * 0.3;
    for (let tries = 0; tries < 6; tries++) {
      const clash = [...existing, ...out].some((s) => Math.hypot(s.x - x, s.z - z) < 0.12);
      if (!clash) break;
      x += (rng() - 0.5) * 0.3;
      z += (rng() - 0.5) * 0.3;
    }
    out.push({ night, x: round3(x), z: round3(z), magnitude: round3(0.55 + rng() * 0.45) });
  }
  return out;
}

export function mergeSky(existing: Star[], added: Star[]): Star[] {
  const all = [...existing, ...added];
  return all.length > MAX_STARS ? all.slice(all.length - MAX_STARS) : all;
}

export function nightsPlayed(stars: Star[]): number {
  return new Set(stars.map((s) => s.night)).size;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
