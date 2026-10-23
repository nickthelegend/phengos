/**
 * Single-switch scanning: the highlight steps through the targets on a timer,
 * and any pinch selects the highlighted one. The list can include controls
 * such as "hint" and "pause", so one switch reaches everything.
 */
export const SCAN_MIN = 0.75;
export const SCAN_MAX = 4;
export const SCAN_DEFAULT = 1.5;

export class Scanner {
  private items: string[] = [];
  private index = 0;
  private elapsed = 0;

  constructor(public intervalSec = SCAN_DEFAULT) {}

  get current(): string | null {
    return this.items.length ? this.items[this.index % this.items.length]! : null;
  }

  get list(): readonly string[] {
    return this.items;
  }

  /** Replace the list; keep the highlight on the same item when it survives. */
  setItems(items: string[]): void {
    const keep = this.current;
    this.items = [...items];
    const i = keep === null ? -1 : this.items.indexOf(keep);
    if (i >= 0) {
      this.index = i;
    } else {
      // The highlighted item went away (a light was caught): stay at the same slot.
      this.index = this.items.length ? Math.min(this.index, this.items.length - 1) : 0;
      this.elapsed = 0;
    }
  }

  /** Advance the timer. Returns the newly highlighted item when it changes. */
  update(dt: number): string | null {
    if (!this.items.length) return null;
    this.elapsed += dt;
    if (this.elapsed < this.intervalSec) return null;
    this.elapsed -= this.intervalSec;
    if (this.elapsed > this.intervalSec) this.elapsed = 0;
    this.index = (this.index + 1) % this.items.length;
    return this.current;
  }

  /** Restart the dwell on the current item (after a selection). */
  hold(): void {
    this.elapsed = 0;
  }

  step(delta: 1 | -1): string | null {
    if (!this.items.length) return null;
    this.index = (this.index + delta + this.items.length) % this.items.length;
    this.elapsed = 0;
    return this.current;
  }
}
