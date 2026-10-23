import { describe, expect, it } from 'vitest';
import { Scanner } from '../src/scan.js';

describe('Scanner', () => {
  it('steps through items every interval and wraps', () => {
    const s = new Scanner(1.5);
    s.setItems(['a', 'b', 'c']);
    expect(s.current).toBe('a');
    expect(s.update(1.4)).toBeNull();
    expect(s.update(0.2)).toBe('b');
    s.update(1.5);
    expect(s.current).toBe('c');
    s.update(1.5);
    expect(s.current).toBe('a');
  });

  it('keeps the highlight when the list changes but the item survives', () => {
    const s = new Scanner(1);
    s.setItems(['a', 'b', 'c', 'hint']);
    s.update(1);
    expect(s.current).toBe('b');
    s.setItems(['a', 'b', 'hint']);
    expect(s.current).toBe('b');
  });

  it('moves to the next slot when the highlighted light is caught', () => {
    const s = new Scanner(1);
    s.setItems(['a', 'b', 'c', 'hint']);
    s.update(1);
    s.setItems(['a', 'c', 'hint']);
    expect(s.current).toBe('c');
  });

  it('reaches the hint and pause controls', () => {
    const s = new Scanner(1);
    s.setItems(['a', 'hint', 'pause']);
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      seen.add(s.current!);
      s.update(1);
    }
    expect(seen).toEqual(new Set(['a', 'hint', 'pause']));
  });

  it('adjustable speed, and hold restarts the wait', () => {
    const s = new Scanner(0.75);
    s.setItems(['a', 'b']);
    s.update(0.7);
    s.hold();
    expect(s.update(0.7)).toBeNull();
    expect(s.update(0.1)).toBe('b');
  });

  it('empty list is safe', () => {
    const s = new Scanner();
    s.setItems([]);
    expect(s.current).toBeNull();
    expect(s.update(5)).toBeNull();
    expect(s.step(1)).toBeNull();
  });
});
