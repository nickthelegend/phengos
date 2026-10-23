/**
 * A night of play: three rounds of 5, 8 and 12 lights from the daily seed.
 * Every way of catching is equal: the round only records which one was used.
 */
import { type Vec3, sub, angleBetween, deg } from './vec.js';
import type { Spot } from './hide.js';

export const NIGHT_ROUNDS = [5, 8, 12] as const;

export type CatchMethod = 'point' | 'look' | 'eyes' | 'voice' | 'switch' | 'mouse';

export interface LightState {
  id: string;
  spot: Spot;
  caught: boolean;
  method: CatchMethod | null;
  caughtAt: number;
}

export class Round {
  readonly lights: LightState[];

  constructor(
    spots: Spot[],
    readonly roundIndex: number,
  ) {
    this.lights = spots.map((spot, i) => ({ id: `light-${i}`, spot, caught: false, method: null, caughtAt: 0 }));
  }

  get total(): number {
    return this.lights.length;
  }

  get caught(): number {
    return this.lights.filter((l) => l.caught).length;
  }

  get done(): boolean {
    return this.lights.length > 0 && this.lights.every((l) => l.caught);
  }

  get remaining(): LightState[] {
    return this.lights.filter((l) => !l.caught);
  }

  get(id: string): LightState | undefined {
    return this.lights.find((l) => l.id === id);
  }

  /** Catch a light. Returns false when it is unknown or already caught. */
  catch(id: string, method: CatchMethod, time: number): boolean {
    const l = this.get(id);
    if (!l || l.caught) return false;
    l.caught = true;
    l.method = method;
    l.caughtAt = time;
    return true;
  }

  /** The uncaught light closest to where you aim (smallest angle), for hints and "repeat". */
  nearestToAim(head: Vec3, aim: Vec3): LightState | null {
    let best: LightState | null = null;
    let bestA = Infinity;
    for (const l of this.remaining) {
      const a = angleBetween(aim, sub(l.spot.position, head));
      if (a < bestA) {
        bestA = a;
        best = l;
      }
    }
    return best;
  }

  /** Angle in degrees from the aim ray to a light. */
  aimAngle(head: Vec3, aim: Vec3, id: string): number {
    const l = this.get(id);
    return l ? deg(angleBetween(aim, sub(l.spot.position, head))) : 180;
  }

  /** Uncaught lights left to right: the order for "next"/"back" and scanning. */
  order(): string[] {
    return [...this.remaining].sort((a, b) => a.spot.yawDeg - b.spot.yawDeg).map((l) => l.id);
  }

  /** Cycle the outlined light for voice "next" / "back". */
  cycle(current: string | null, dir: 1 | -1): string | null {
    const o = this.order();
    if (!o.length) return null;
    const i = current ? o.indexOf(current) : -1;
    if (i < 0) return dir === 1 ? o[0]! : o[o.length - 1]!;
    return o[(i + dir + o.length) % o.length]!;
  }

  /** Which methods caught lights this round, for the end card. */
  methods(): Partial<Record<CatchMethod, number>> {
    const out: Partial<Record<CatchMethod, number>> = {};
    for (const l of this.lights) if (l.method) out[l.method] = (out[l.method] ?? 0) + 1;
    return out;
  }
}

/**
 * Inclusive-by-default onboarding: the first input the player uses picks the
 * mode we teach. A pinch on the hand ray is "point", a held look is "look",
 * a pinch while the scanner highlights is "switch".
 */
export function modeFromFirstInput(method: CatchMethod): 'point' | 'look' | 'switch' {
  if (method === 'look' || method === 'eyes') return 'look';
  if (method === 'switch') return 'switch';
  return 'point';
}
