import { describe, expect, it } from 'vitest';
import { analyzeRoom, planeArea, boxFaceToward, insideBox } from '../src/room.js';
import type { Room } from '../src/room.js';
import { vec } from '../src/vec.js';
import { shell, studio } from './rooms.js';

describe('analyzeRoom (planes have no labels: orientation + height)', () => {
  it('finds floor, ceiling and four walls', () => {
    const info = analyzeRoom(studio);
    expect(info.floorY).toBe(0);
    expect(info.ceilingY).toBe(2.6);
    expect(info.walls).toHaveLength(4);
    expect(info.planes.filter((p) => p.kind === 'floor')).toHaveLength(1);
    expect(info.planes.filter((p) => p.kind === 'ceiling')).toHaveLength(1);
    expect(info.furnished).toBe(true);
  });

  it('a table top or seat is a surface, not the floor', () => {
    const room: Room = {
      name: 'with table top',
      planes: [
        ...shell('r', 4, 4, 2.5, -2),
        { id: 'top', orientation: 'horizontal', normal: vec(0, 1, 0), corners: [vec(0, 0.72, -1), vec(1, 0.72, -1), vec(1, 0.72, -0.4), vec(0, 0.72, -0.4)] },
      ],
      boxes: [],
    };
    const info = analyzeRoom(room);
    expect(info.planes.find((p) => p.id === 'top')!.kind).toBe('surface');
  });

  it('without a ceiling plane, assumes the top of the walls', () => {
    const room: Room = { name: 'no ceiling', planes: shell('r', 4, 4, 2.4, -2).filter((p) => !p.id.endsWith('ceiling')), boxes: [] };
    expect(analyzeRoom(room).ceilingY).toBeCloseTo(2.4);
  });

  it('with nothing detected, falls back to a 2.5 m room', () => {
    const info = analyzeRoom({ name: 'empty', planes: [], boxes: [] });
    expect(info.floorY).toBe(0);
    expect(info.ceilingY).toBe(2.5);
    expect(info.furnished).toBe(false);
  });

  it('plane area', () => {
    expect(planeArea(shell('r', 4, 5, 2.5, -2)[0]!)).toBeCloseTo(20);
  });

  it('box helpers respect yaw', () => {
    const b = { id: 'b', label: 'couch', center: vec(0, 0.4, -2), half: vec(1, 0.4, 0.45), yaw: Math.PI / 2 };
    expect(insideBox(b, vec(0, 0.4, -2.9))).toBe(true); // the long axis now runs along z
    expect(insideBox(b, vec(0.9, 0.4, -2))).toBe(false);
    const face = boxFaceToward(b, vec(0, 0, -1));
    expect(Math.abs(face.normal.z)).toBeCloseTo(1);
  });
});
