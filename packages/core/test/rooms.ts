/**
 * Synthetic rooms for the tests. Two are hand-authored here (a furnished studio
 * flat and a bare room with no furniture at all); the others are captured from
 * IWER's built-in GLTS rooms by the running app (see rooms/*.json and
 * TESTING.md for how they were captured).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Room, RoomBox, RoomPlane } from '../src/room.js';
import { vec } from '../src/vec.js';

/** Floor, ceiling and four walls of a W x D x H room centred on x = 0, from z = z0 to z0 + D. */
export function shell(name: string, w: number, d: number, h: number, z0: number): RoomPlane[] {
  const x0 = -w / 2;
  const x1 = w / 2;
  const z1 = z0 + d;
  return [
    { id: `${name}-floor`, orientation: 'horizontal', normal: vec(0, 1, 0), corners: [vec(x0, 0, z0), vec(x1, 0, z0), vec(x1, 0, z1), vec(x0, 0, z1)] },
    { id: `${name}-ceiling`, orientation: 'horizontal', normal: vec(0, -1, 0), corners: [vec(x0, h, z0), vec(x1, h, z0), vec(x1, h, z1), vec(x0, h, z1)] },
    { id: `${name}-wall-front`, orientation: 'vertical', normal: vec(0, 0, 1), corners: [vec(x0, 0, z0), vec(x1, 0, z0), vec(x1, h, z0), vec(x0, h, z0)] },
    { id: `${name}-wall-back`, orientation: 'vertical', normal: vec(0, 0, -1), corners: [vec(x0, 0, z1), vec(x1, 0, z1), vec(x1, h, z1), vec(x0, h, z1)] },
    { id: `${name}-wall-left`, orientation: 'vertical', normal: vec(1, 0, 0), corners: [vec(x0, 0, z0), vec(x0, 0, z1), vec(x0, h, z1), vec(x0, h, z0)] },
    { id: `${name}-wall-right`, orientation: 'vertical', normal: vec(-1, 0, 0), corners: [vec(x1, 0, z0), vec(x1, 0, z1), vec(x1, h, z1), vec(x1, h, z0)] },
  ];
}

const box = (id: string, label: string, [w, h, d]: [number, number, number], [x, z]: [number, number], yaw = 0): RoomBox => ({
  id,
  label,
  center: vec(x, h / 2, z),
  half: vec(w / 2, h / 2, d / 2),
  yaw,
});

/** A studio flat: couch ahead with a gap behind it, a low table, a shelf and a desk at an angle. */
export const studio: Room = {
  name: 'studio (hand-authored, labelled furniture)',
  planes: shell('studio', 4.6, 5, 2.6, -3.2),
  boxes: [
    box('couch', 'couch', [2.0, 0.85, 0.9], [0, -1.9]),
    box('table', 'table', [1.0, 0.42, 0.55], [0.1, -0.95]),
    box('shelf', 'shelf', [0.4, 1.8, 1.2], [2.05, -1.2]),
    box('desk', 'desk', [1.2, 0.75, 0.6], [-1.6, -2.3], 0.5),
    box('plant', 'plant', [0.5, 1.4, 0.5], [-1.9, -0.6]),
  ],
};

/** No furniture at all: lights must hide along walls and ceiling. */
export const bare: Room = {
  name: 'bare (hand-authored, no furniture)',
  planes: shell('bare', 4, 4.5, 2.5, -3),
  boxes: [],
};

const here = fileURLToPath(new URL('.', import.meta.url));

/** Rooms captured from IWER's built-in GLTS environments by the running app. */
export function capturedRooms(): Room[] {
  const dir = join(here, 'rooms');
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files.sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Room);
}
