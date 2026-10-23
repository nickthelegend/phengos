/**
 * Captions for every sound, with a direction: "hum, left, low".
 */
import { type Vec3, sub, signedYaw, deg } from './vec.js';

export type Side = 'ahead' | 'right' | 'left' | 'behind right' | 'behind left' | 'behind';
export type Level = 'low' | 'middle' | 'high';

export interface Direction {
  side: Side;
  level: Level;
  /** Signed horizontal angle, degrees, + is right. Drives the caption arrow. */
  yawDeg: number;
}

export function directionTo(listener: Vec3, forward: Vec3, source: Vec3, floorY: number, ceilingY: number): Direction {
  const yaw = deg(signedYaw(forward, sub(source, listener)));
  const a = Math.abs(yaw);
  let side: Side;
  if (a <= 15) side = 'ahead';
  else if (a <= 110) side = yaw > 0 ? 'right' : 'left';
  else if (a <= 165) side = yaw > 0 ? 'behind right' : 'behind left';
  else side = 'behind';
  const h = (source.y - floorY) / Math.max(0.5, ceilingY - floorY);
  const level: Level = h < 0.34 ? 'low' : h > 0.66 ? 'high' : 'middle';
  return { side, level, yawDeg: yaw };
}

export function captionFor(sound: string, dir: Direction): string {
  return `${sound}, ${dir.side}, ${dir.level}`;
}

/** Arrow glyph for the caption chip, nearest of eight directions. */
export function arrowFor(dir: Direction): string {
  const y = dir.yawDeg;
  if (Math.abs(y) <= 15) return dir.level === 'high' ? '^' : dir.level === 'low' ? 'v' : 'o';
  if (Math.abs(y) > 150) return 'v';
  return y > 0 ? '>' : '<';
}
