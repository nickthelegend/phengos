/**
 * Hiding spots for the lights.
 *
 * Candidates come from the real room: the far side of furniture volumes
 * (peeking over the back of the couch), beside them, under tables, the
 * ceiling corners, and along the walls. Each candidate must be
 *   - partially visible from the seated head pose (rays from the head to a
 *     disc of sample points on the light, tested against the furniture boxes),
 *   - inside the comfort cone (no turning further than `comfortHalfDeg`),
 *   - within reach of sight (0.8 to 5.5 m), inside the room, not inside furniture.
 * Selection is deterministic for a seed: same room + same seed = same spots.
 */
import { type Vec3, vec, add, sub, scale, cross, normalize, distance, signedYaw, angleBetween, UP, deg, rad, rotateY } from './vec.js';
import {
  type Room,
  type RoomBox,
  type RoomInfo,
  analyzeRoom,
  boxFaceToward,
  boxTop,
  fromBoxLocal,
  insideBox,
  occluderFor,
  segmentHitsBox,
} from './room.js';
import { createRng } from './rng.js';

export type SpotKind = 'behind' | 'beside' | 'under' | 'ceiling-corner' | 'wall';

export interface Spot {
  id: string;
  kind: SpotKind;
  position: Vec3;
  /** Furniture label the light hides at, or 'wall' / 'ceiling'. */
  host: string;
  /** Fraction of the light's silhouette visible from the head, 0..1. */
  visible: number;
  /** Signed horizontal angle from the forward direction, degrees, + is right. */
  yawDeg: number;
  /** 0 at the floor, 1 at the ceiling. */
  heightNorm: number;
}

export interface HideOptions {
  count: number;
  seed: number;
  head: Vec3;
  /** Horizontal forward direction of the seated player. */
  forward: Vec3;
  /** Half-angle of the comfort cone in degrees. 60 = a 120° cone. */
  comfortHalfDeg?: number;
  /** Minimum visible silhouette fraction. */
  minVisible?: number;
  lightRadius?: number;
  minSpacing?: number;
  minAngularSeparationDeg?: number;
}

export const LIGHT_RADIUS = 0.075;
export const DEFAULT_COMFORT_HALF_DEG = 60;
export const DEFAULT_MIN_VISIBLE = 0.3;

/** Furniture we hide lights behind. Other labels still occlude. */
const HOSTS = new Set([
  'couch',
  'sofa',
  'table',
  'desk',
  'shelf',
  'bed',
  'storage',
  'cabinet',
  'screen',
  'other',
  'plant',
  'lamp',
]);

interface Candidate {
  kind: SpotKind;
  position: Vec3;
  host: string;
  hostId: string;
  key: string;
}

/**
 * Sample points across the light's silhouette: a disc facing the viewer
 * (centre, a ring at half radius and a ring at full radius).
 */
export function silhouetteSamples(center: Vec3, viewer: Vec3, radius: number): Vec3[] {
  const toViewer = normalize(sub(viewer, center));
  let right = cross(toViewer, UP);
  if (right.x * right.x + right.y * right.y + right.z * right.z < 1e-6) right = vec(1, 0, 0);
  right = normalize(right);
  const up = normalize(cross(right, toViewer));
  const pts: Vec3[] = [center];
  for (const r of [0.5, 0.95]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + (r < 0.9 ? Math.PI / 8 : 0);
      pts.push(add(center, add(scale(right, Math.cos(a) * radius * r), scale(up, Math.sin(a) * radius * r))));
    }
  }
  return pts;
}

/** Visible fraction of a light at `center` seen from `viewer`, given the furniture. */
export function visibleFraction(center: Vec3, viewer: Vec3, boxes: RoomBox[], radius = LIGHT_RADIUS): number {
  const occluders = boxes.map(occluderFor);
  const samples = silhouetteSamples(center, viewer, radius);
  let clear = 0;
  for (const s of samples) {
    let blocked = false;
    for (const b of occluders) {
      if (segmentHitsBox(viewer, s, b)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) clear++;
  }
  return clear / samples.length;
}

function furnitureCandidates(info: RoomInfo, head: Vec3, r: number): Candidate[] {
  const out: Candidate[] = [];
  const walls = innerWalls(info, head);
  for (const box of info.boxes) {
    if (!HOSTS.has(box.label)) continue;
    const top = boxTop(box);
    const toBox = sub(box.center, head);
    const far = boxFaceToward(box, toBox);
    const halfAlong = far.axis === 'x' ? box.half.x : box.half.z;
    const halfAcross = far.axis === 'x' ? box.half.z : box.half.x;
    const local = (along: number, y: number, across: number): Vec3 =>
      far.axis === 'x'
        ? fromBoxLocal(box, vec(far.sign * along, y - box.center.y, across))
        : fromBoxLocal(box, vec(across, y - box.center.y, far.sign * along));

    if (box.label === 'table' || box.label === 'desk') {
      // Under the table: low, between the legs.
      for (const u of [-0.4, 0, 0.4]) {
        out.push({
          kind: 'under',
          position: local(0, info.floorY + r + 0.03, u * halfAcross),
          host: box.label,
          hostId: box.id,
          key: `${box.id}:under:${u}`,
        });
      }
    }
    // Behind: just past the far face, peeking over the top edge. When the
    // furniture stands against a wall there is no gap, so the light perches on
    // the back edge instead and the furniture still hides its lower half.
    if (top < info.ceilingY - 0.4) {
      const room = roomDepthAlong(info, box.center, far.normal, walls);
      const gap = room - halfAlong;
      const perched = gap < r * 2 + 0.08;
      for (const u of [-0.55, -0.2, 0.2, 0.55]) {
        const heights = perched ? [0.2, 0.45] : [-0.2, 0.25, 0.6];
        for (const dy of heights) {
          out.push({
            kind: 'behind',
            position: perched
              ? local(halfAlong - r * 1.3, top + dy * r * 2, u * halfAcross)
              : local(halfAlong + r + 0.05, top + dy * r * 2, u * halfAcross),
            host: box.label,
            hostId: box.id,
            key: `${box.id}:behind:${u}:${dy}`,
          });
        }
      }
    }
    // Beside: past a side face, toward the back, half hidden by the side.
    for (const side of [-1, 1]) {
      for (const yf of [0.35, 0.7]) {
        out.push({
          kind: 'beside',
          position: local(halfAlong * 0.55, Math.max(info.floorY + r + 0.05, info.floorY + (top - info.floorY) * yf), side * (halfAcross + r * 0.55)),
          host: box.label,
          hostId: box.id,
          key: `${box.id}:beside:${side}:${yf}`,
        });
      }
    }
  }
  return out;
}

/** Large walls with their normals turned to face the player. */
function innerWalls(info: RoomInfo, head: Vec3): Array<{ c: Vec3; n: Vec3 }> {
  return info.walls
    .filter((w) => w.area >= 2)
    .map((w) => ({ c: w.center, n: signedDistance(head, w.center, w.normal) < 0 ? scale(w.normal, -1) : w.normal }));
}

/** Horizontal distance from `from` to the nearest wall (or the room bounds) along `dir`. */
function roomDepthAlong(info: RoomInfo, from: Vec3, dir: Vec3, walls: Array<{ c: Vec3; n: Vec3 }>): number {
  let t = Infinity;
  if (dir.x > 1e-6) t = Math.min(t, (info.max.x - from.x) / dir.x);
  if (dir.x < -1e-6) t = Math.min(t, (info.min.x - from.x) / dir.x);
  if (dir.z > 1e-6) t = Math.min(t, (info.max.z - from.z) / dir.z);
  if (dir.z < -1e-6) t = Math.min(t, (info.min.z - from.z) / dir.z);
  for (const w of walls) {
    const denom = dir.x * w.n.x + dir.z * w.n.z;
    if (denom >= -1e-6) continue; // moving away from this wall
    const d = signedDistance(from, w.c, w.n);
    if (d > 0) t = Math.min(t, d / -denom);
  }
  return t;
}

function ceilingCandidates(info: RoomInfo): Candidate[] {
  const inset = 0.35;
  const y = info.ceilingY - 0.14;
  const xs = [info.min.x + inset, (info.min.x + info.max.x) / 2, info.max.x - inset];
  const zs = [info.min.z + inset, (info.min.z + info.max.z) / 2, info.max.z - inset];
  const out: Candidate[] = [];
  for (const x of xs) {
    for (const z of zs) {
      const edge = x !== xs[1] || z !== zs[1];
      if (!edge) continue;
      out.push({
        kind: 'ceiling-corner',
        position: vec(x, y, z),
        host: 'ceiling',
        hostId: 'ceiling',
        key: `ceiling:${x.toFixed(2)}:${z.toFixed(2)}`,
      });
    }
  }
  return out;
}

function wallCandidates(info: RoomInfo, head: Vec3, r: number): Candidate[] {
  const out: Candidate[] = [];
  for (const wall of info.walls) {
    if (wall.area < 1.2 || wall.corners.length < 3) continue;
    let n = wall.normal;
    if (signedDistance(head, wall.center, n) < 0) n = scale(n, -1);
    // Span the wall: horizontal axis along the wall, then a grid of heights.
    const along = normalize(cross(UP, n));
    const offsets = wall.corners.map((c) => (c.x - wall.center.x) * along.x + (c.z - wall.center.z) * along.z);
    const lo = Math.min(...offsets);
    const hi = Math.max(...offsets);
    for (const u of [0.15, 0.35, 0.5, 0.65, 0.85]) {
      for (const h of [0.35, 1.05, 1.75]) {
        const y = info.floorY + h;
        if (y > info.ceilingY - 0.3) continue;
        const s = lo + (hi - lo) * u;
        const p = add(vec(wall.center.x, y, wall.center.z), add(scale(along, s), scale(n, r + 0.08)));
        out.push({ kind: 'wall', position: p, host: 'wall', hostId: wall.id, key: `${wall.id}:${u}:${h}` });
      }
    }
  }
  return out;
}

function signedDistance(p: Vec3, planePoint: Vec3, normal: Vec3): number {
  return (p.x - planePoint.x) * normal.x + (p.y - planePoint.y) * normal.y + (p.z - planePoint.z) * normal.z;
}

const KIND_SCORE: Record<SpotKind, number> = {
  behind: 3,
  under: 2.6,
  beside: 2.4,
  'ceiling-corner': 1.8,
  wall: 1,
};

export interface HideResult {
  spots: Spot[];
  info: RoomInfo;
  candidates: number;
  accepted: number;
}

/** Compute hiding spots for one round. */
export function hideLights(room: Room, opts: HideOptions): HideResult {
  const info = analyzeRoom(room);
  const r = opts.lightRadius ?? LIGHT_RADIUS;
  const comfort = opts.comfortHalfDeg ?? DEFAULT_COMFORT_HALF_DEG;
  const minVisible = opts.minVisible ?? DEFAULT_MIN_VISIBLE;
  const minSpacing = opts.minSpacing ?? 0.45;
  const minSep = rad(opts.minAngularSeparationDeg ?? 8);
  const rng = createRng(opts.seed);

  const walls = innerWalls(info, opts.head);
  const raw = [
    ...furnitureCandidates(info, opts.head, r),
    ...ceilingCandidates(info),
    ...wallCandidates(info, opts.head, r),
  ];

  const scored: Array<{ c: Candidate; spot: Spot; score: number }> = [];
  for (const c of raw) {
    const p = c.position;
    const d = distance(p, opts.head);
    if (d < 0.8 || d > 5.5) continue;
    if (p.x < info.min.x - 0.01 || p.x > info.max.x + 0.01) continue;
    if (p.z < info.min.z - 0.01 || p.z > info.max.z + 0.01) continue;
    if (p.y < info.floorY + r || p.y > info.ceilingY - r) continue;
    if (info.boxes.some((b) => insideBox(occluderFor(b), p, 0))) continue;
    // On the room side of every large wall (a light behind a wall is never visible in reality).
    if (walls.some((w) => signedDistance(p, w.c, w.n) < r + 0.02)) continue;
    const yaw = deg(signedYaw(opts.forward, sub(p, opts.head)));
    if (Math.abs(yaw) > comfort) continue;
    const vis = visibleFraction(p, opts.head, info.boxes, r);
    if (vis < minVisible) continue;
    const heightNorm = Math.min(1, Math.max(0, (p.y - info.floorY) / Math.max(0.5, info.ceilingY - info.floorY)));
    const partial = vis < 0.9 ? 1.2 : 0;
    const score = KIND_SCORE[c.kind] + partial + rng() * 0.9;
    scored.push({
      c,
      score,
      spot: {
        id: c.key,
        kind: c.kind,
        position: p,
        host: c.host,
        visible: Math.round(vis * 1000) / 1000,
        yawDeg: Math.round(yaw * 10) / 10,
        heightNorm: Math.round(heightNorm * 1000) / 1000,
      },
    });
  }
  scored.sort((a, b) => b.score - a.score || (a.c.key < b.c.key ? -1 : 1));

  const chosen: Spot[] = [];
  const perHost = new Map<string, number>();
  const maxPerHost = Math.max(2, Math.ceil(opts.count / Math.max(1, info.boxes.length + 2)));
  const pass = (enforceHostCap: boolean) => {
    for (const s of scored) {
      if (chosen.length >= opts.count) return;
      if (chosen.some((c) => c.id === s.spot.id)) continue;
      if (enforceHostCap && (perHost.get(s.c.hostId) ?? 0) >= maxPerHost) continue;
      const p = s.spot.position;
      const tooClose = chosen.some(
        (c) =>
          distance(c.position, p) < minSpacing ||
          angleBetween(sub(c.position, opts.head), sub(p, opts.head)) < minSep,
      );
      if (tooClose) continue;
      chosen.push(s.spot);
      perHost.set(s.c.hostId, (perHost.get(s.c.hostId) ?? 0) + 1);
    }
  };
  pass(true);
  pass(false);
  // Present the lights left to right so "next" and scanning move predictably.
  chosen.sort((a, b) => a.yawDeg - b.yawDeg);
  return { spots: chosen, info, candidates: raw.length, accepted: scored.length };
}

/** Forward direction from a yaw in radians (three.js convention: yaw 0 looks down -Z). */
export function forwardFromYaw(yaw: number): Vec3 {
  return rotateY(vec(0, 0, -1), yaw);
}
