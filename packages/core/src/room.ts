/**
 * The room model Phengos plays in, built from WebXR scene understanding:
 * XRPlane polygons (no labels: classified by orientation and height) and
 * bounded XRMesh volumes (with semanticLabel, e.g. couch, table, shelf).
 * Everything is in world space, metres, +Y up.
 */
import { type Vec3, vec, sub, dot, rotateY, add, scale, normalize, length } from './vec.js';

export interface RoomPlane {
  id: string;
  orientation: 'horizontal' | 'vertical';
  /** World-space polygon corners. */
  corners: Vec3[];
  /** World-space unit normal (the plane's local +Y). */
  normal: Vec3;
}

/** A furniture volume: an oriented box, rotated about +Y only. */
export interface RoomBox {
  id: string;
  label: string;
  center: Vec3;
  half: Vec3;
  yaw: number;
}

export interface Room {
  name: string;
  planes: RoomPlane[];
  boxes: RoomBox[];
}

export type PlaneKind = 'floor' | 'ceiling' | 'wall' | 'surface';

export interface ClassifiedPlane extends RoomPlane {
  kind: PlaneKind;
  center: Vec3;
  area: number;
}

export interface RoomInfo {
  floorY: number;
  ceilingY: number;
  planes: ClassifiedPlane[];
  walls: ClassifiedPlane[];
  boxes: RoomBox[];
  min: Vec3;
  max: Vec3;
  /** True when the room has furniture volumes we can hide lights behind. */
  furnished: boolean;
}

export function planeCenter(p: RoomPlane): Vec3 {
  let c = vec();
  for (const k of p.corners) c = add(c, k);
  return p.corners.length ? scale(c, 1 / p.corners.length) : c;
}

/** Polygon area via the cross-product sum, projected on the plane normal. */
export function planeArea(p: RoomPlane): number {
  const n = p.corners.length;
  if (n < 3) return 0;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 0; i < n; i++) {
    const a = p.corners[i]!;
    const b = p.corners[(i + 1) % n]!;
    sx += a.y * b.z - a.z * b.y;
    sy += a.z * b.x - a.x * b.z;
    sz += a.x * b.y - a.y * b.x;
  }
  return Math.abs(sx * p.normal.x + sy * p.normal.y + sz * p.normal.z) / 2;
}

/**
 * Classify planes without labels. Horizontal planes facing up at the lowest
 * height are the floor; facing down near the top are the ceiling; other
 * horizontal planes are surfaces (table tops, seats). Vertical planes are walls
 * (including doors, windows and wall art, which all sit on walls).
 */
export function analyzeRoom(room: Room): RoomInfo {
  const centers = room.planes.map(planeCenter);
  const up = room.planes
    .map((p, i) => ({ p, c: centers[i]! }))
    .filter(({ p }) => p.orientation === 'horizontal' && p.normal.y > 0.5);
  const down = room.planes
    .map((p, i) => ({ p, c: centers[i]! }))
    .filter(({ p }) => p.orientation === 'horizontal' && p.normal.y < -0.5);

  let floorY = up.length ? Math.min(...up.map((u) => u.c.y)) : 0;
  if (!Number.isFinite(floorY)) floorY = 0;
  let ceilingY = down.length ? Math.max(...down.map((d) => d.c.y)) : Number.NaN;
  if (!Number.isFinite(ceilingY)) {
    const tops = room.planes.flatMap((p) => p.corners.map((c) => c.y));
    const top = tops.length ? Math.max(...tops) : floorY + 2.5;
    ceilingY = top - floorY > 1.9 ? top : floorY + 2.5;
  }

  const planes: ClassifiedPlane[] = room.planes.map((p, i) => {
    const c = centers[i]!;
    let kind: PlaneKind;
    if (p.orientation === 'vertical') kind = 'wall';
    else if (p.normal.y > 0.5 && c.y < floorY + 0.15) kind = 'floor';
    else if (p.normal.y < -0.5 && c.y > ceilingY - 0.3) kind = 'ceiling';
    else kind = 'surface';
    return { ...p, kind, center: c, area: planeArea(p) };
  });

  const pts = [
    ...room.planes.flatMap((p) => p.corners),
    ...room.boxes.flatMap((b) => [sub(b.center, b.half), add(b.center, b.half)]),
  ];
  const min = vec(
    pts.length ? Math.min(...pts.map((p) => p.x)) : -2,
    floorY,
    pts.length ? Math.min(...pts.map((p) => p.z)) : -2,
  );
  const max = vec(
    pts.length ? Math.max(...pts.map((p) => p.x)) : 2,
    ceilingY,
    pts.length ? Math.max(...pts.map((p) => p.z)) : 2,
  );

  return {
    floorY,
    ceilingY,
    planes,
    walls: planes.filter((p) => p.kind === 'wall'),
    boxes: room.boxes,
    min,
    max,
    furnished: room.boxes.length > 0,
  };
}

/** Labels whose volume is open underneath: only the top slab blocks sight. */
const OPEN_UNDER = new Set(['table', 'desk']);
/** Labels whose volume is a loose envelope around something thin. */
const SPARSE = new Set(['lamp', 'plant']);

/**
 * The part of a furniture volume that blocks line of sight. Room scans report
 * a table as one solid box, but you can see under a real table.
 */
export function occluderFor(box: RoomBox): RoomBox {
  if (OPEN_UNDER.has(box.label)) {
    const top = box.center.y + box.half.y;
    const t = Math.min(0.03, box.half.y);
    return { ...box, center: vec(box.center.x, top - t, box.center.z), half: vec(box.half.x, t, box.half.z) };
  }
  if (SPARSE.has(box.label)) {
    return { ...box, half: vec(box.half.x * 0.45, box.half.y, box.half.z * 0.45) };
  }
  return box;
}

/** World point to the box's local frame (centre at origin, axis-aligned). */
export function toBoxLocal(box: RoomBox, p: Vec3): Vec3 {
  return rotateY(sub(p, box.center), -box.yaw);
}

export function fromBoxLocal(box: RoomBox, p: Vec3): Vec3 {
  return add(rotateY(p, box.yaw), box.center);
}

export function insideBox(box: RoomBox, p: Vec3, margin = 0): boolean {
  const l = toBoxLocal(box, p);
  return (
    Math.abs(l.x) <= box.half.x + margin &&
    Math.abs(l.y) <= box.half.y + margin &&
    Math.abs(l.z) <= box.half.z + margin
  );
}

/**
 * Slab test of the segment from `origin` toward `target` against an oriented
 * box. Returns true when the box blocks the segment before it reaches the target.
 */
export function segmentHitsBox(origin: Vec3, target: Vec3, box: RoomBox): boolean {
  const o = toBoxLocal(box, origin);
  const t = toBoxLocal(box, target);
  const d = sub(t, o);
  let tmin = 0;
  let tmax = 1;
  const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
  for (const a of axes) {
    const h = box.half[a];
    if (Math.abs(d[a]) < 1e-9) {
      if (Math.abs(o[a]) > h) return false;
      continue;
    }
    let t1 = (-h - o[a]) / d[a];
    let t2 = (h - o[a]) / d[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  // Ignore a hit that only grazes the very end (the target itself on a face).
  return tmin < 0.999;
}

/** The unit direction from the box centre toward the face nearest a world direction. */
export function boxFaceToward(box: RoomBox, worldDir: Vec3): { normal: Vec3; axis: 'x' | 'z'; sign: number } {
  const l = normalize(rotateY(worldDir, -box.yaw));
  const useX = Math.abs(l.x) * box.half.z >= Math.abs(l.z) * box.half.x;
  const axis: 'x' | 'z' = useX ? 'x' : 'z';
  const sign = Math.sign(useX ? l.x : l.z) || 1;
  const localNormal = useX ? vec(sign, 0, 0) : vec(0, 0, sign);
  return { normal: rotateY(localNormal, box.yaw), axis, sign };
}

export function boxTop(box: RoomBox): number {
  return box.center.y + box.half.y;
}

export function horizontalDistance(a: Vec3, b: Vec3): number {
  return length(vec(a.x - b.x, 0, a.z - b.z));
}

export { dot };
