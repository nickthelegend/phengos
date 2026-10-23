import { describe, expect, it } from 'vitest';
import { hideLights, visibleFraction, forwardFromYaw, LIGHT_RADIUS } from '../src/hide.js';
import { analyzeRoom, segmentHitsBox, occluderFor } from '../src/room.js';
import { vec, sub, signedYaw, deg, distance } from '../src/vec.js';
import { studio, bare, capturedRooms } from './rooms.js';

const HEAD = vec(0, 1.15, 0); // seated eye height at the room origin
const FORWARD = forwardFromYaw(0);
const rooms = [studio, bare, ...capturedRooms()];

describe('rooms under test', () => {
  it('has the hand-authored rooms, one of them bare', () => {
    expect(rooms.length).toBeGreaterThanOrEqual(2);
    expect(rooms.some((r) => r.boxes.length === 0)).toBe(true);
  });
});

describe.each(rooms.map((r) => [r.name, r] as const))('hideLights in %s', (_name, room) => {
  const result = hideLights(room, { count: 12, seed: 20261024, head: HEAD, forward: FORWARD });

  it('places all 12 lights', () => {
    expect(result.spots).toHaveLength(12);
  });

  it('every spot is partially visible from the seated head (independent re-check)', () => {
    for (const s of result.spots) {
      const v = visibleFraction(s.position, HEAD, room.boxes, LIGHT_RADIUS);
      expect(v).toBeGreaterThanOrEqual(0.3);
      expect(v).toBeCloseTo(s.visible, 2);
    }
  });

  it('every spot is inside the 120 degree comfort cone', () => {
    for (const s of result.spots) {
      const yaw = deg(signedYaw(FORWARD, sub(s.position, HEAD)));
      expect(Math.abs(yaw)).toBeLessThanOrEqual(60 + 1e-6);
    }
  });

  it('every spot is inside the room, above the floor and below the ceiling', () => {
    const info = analyzeRoom(room);
    for (const s of result.spots) {
      expect(s.position.y).toBeGreaterThan(info.floorY);
      expect(s.position.y).toBeLessThan(info.ceilingY);
      expect(s.position.x).toBeGreaterThanOrEqual(info.min.x - 0.01);
      expect(s.position.x).toBeLessThanOrEqual(info.max.x + 0.01);
      expect(s.position.z).toBeGreaterThanOrEqual(info.min.z - 0.01);
      expect(s.position.z).toBeLessThanOrEqual(info.max.z + 0.01);
    }
  });

  it('spots are spread out (0.45 m apart)', () => {
    for (const a of result.spots) for (const b of result.spots) if (a !== b) expect(distance(a.position, b.position)).toBeGreaterThanOrEqual(0.45);
  });

  it('is deterministic per seed', () => {
    const again = hideLights(room, { count: 12, seed: 20261024, head: HEAD, forward: FORWARD });
    expect(again.spots).toEqual(result.spots);
    const other = hideLights(room, { count: 12, seed: 7, head: HEAD, forward: FORWARD });
    expect(other.spots.map((s) => s.id)).not.toEqual(result.spots.map((s) => s.id));
  });

  it('orders lights left to right', () => {
    const yaws = result.spots.map((s) => s.yawDeg);
    expect([...yaws].sort((a, b) => a - b)).toEqual(yaws);
  });
});

describe('furniture matters', () => {
  for (const room of rooms.filter((r) => r.boxes.length > 0)) {
    it(`${room.name}: hides lights at furniture, some of them partly hidden`, () => {
      const { spots } = hideLights(room, { count: 12, seed: 1, head: HEAD, forward: FORWARD });
      const atFurniture = spots.filter((s) => s.kind === 'behind' || s.kind === 'beside' || s.kind === 'under');
      expect(atFurniture.length).toBeGreaterThanOrEqual(4);
      expect(spots.some((s) => s.visible < 0.9)).toBe(true);
    });
  }

  it('the bare room hides only on walls and ceiling', () => {
    const { spots } = hideLights(bare, { count: 12, seed: 1, head: HEAD, forward: FORWARD });
    expect(new Set(spots.map((s) => s.kind))).toEqual(new Set(['wall', 'ceiling-corner']));
  });

  it('a narrower comfort cone is respected', () => {
    const { spots } = hideLights(studio, { count: 5, seed: 3, head: HEAD, forward: FORWARD, comfortHalfDeg: 30 });
    expect(spots.length).toBe(5);
    for (const s of spots) expect(Math.abs(s.yawDeg)).toBeLessThanOrEqual(30);
  });

  it('turning the chair turns the spots with it', () => {
    const right = forwardFromYaw(-Math.PI / 2); // facing +X
    const { spots } = hideLights(studio, { count: 5, seed: 3, head: HEAD, forward: right });
    for (const s of spots) expect(Math.abs(deg(signedYaw(right, sub(s.position, HEAD))))).toBeLessThanOrEqual(60);
  });
});

describe('occlusion geometry', () => {
  it('a light straight behind the couch back is hidden, one above it is seen', () => {
    const couch = studio.boxes[0]!;
    const behind = vec(0, 0.4, -2.5);
    const above = vec(0, 1.5, -2.5);
    expect(visibleFraction(behind, HEAD, studio.boxes)).toBe(0);
    expect(visibleFraction(above, HEAD, studio.boxes)).toBe(1);
    expect(segmentHitsBox(HEAD, behind, couch)).toBe(true);
  });

  it('you can see under a table, not through its top', () => {
    const table = studio.boxes[1]!;
    const occ = occluderFor(table);
    expect(occ.half.y).toBeLessThanOrEqual(0.03);
    expect(segmentHitsBox(vec(0.1, 0.1, 0), vec(0.1, 0.1, -0.95), occ)).toBe(false);
    expect(segmentHitsBox(vec(0.1, 1.5, -0.95), vec(0.1, 0.1, -0.95), occ)).toBe(true);
  });

  it('rotated boxes block along their rotated extent', () => {
    const desk = studio.boxes[3]!; // yaw 0.5 rad
    expect(segmentHitsBox(vec(-1.6, 2, -2.3), vec(-1.6, 0.1, -2.3), desk)).toBe(true);
  });
});
