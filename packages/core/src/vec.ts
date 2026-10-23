/** Minimal 3D vector math. Plain objects so the core stays free of three.js. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => vec(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : vec(0, 0, 0);
};
export const flat = (a: Vec3): Vec3 => vec(a.x, 0, a.z);
export const UP: Vec3 = Object.freeze(vec(0, 1, 0)) as Vec3;

/** Rotate a vector about +Y by `yaw` radians (right-handed, counter-clockwise seen from above). */
export const rotateY = (a: Vec3, yaw: number): Vec3 => {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return vec(c * a.x + s * a.z, a.y, -s * a.x + c * a.z);
};

/**
 * Signed horizontal angle (radians) from `forward` to `dir`, positive to the
 * right. Both are projected onto the floor plane first.
 */
export function signedYaw(forward: Vec3, dir: Vec3): number {
  const f = normalize(flat(forward));
  const d = normalize(flat(dir));
  const right = cross(f, UP);
  return Math.atan2(dot(d, right), dot(d, f));
}

/** Unsigned angle in radians between two directions. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const la = length(a);
  const lb = length(b);
  if (la < 1e-9 || lb < 1e-9) return Math.PI;
  return Math.acos(Math.min(1, Math.max(-1, dot(a, b) / (la * lb))));
}

export const deg = (rad: number): number => (rad * 180) / Math.PI;
export const rad = (degrees: number): number => (degrees * Math.PI) / 180;
