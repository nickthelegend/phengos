/**
 * Dwell-to-catch timer, used by head-gaze on Quest and eye gaze on the Glasses.
 * IWSDK's gaze `dwellWindowSeconds` is consensus filtering, not dwell, so this is
 * our own state machine.
 *
 *   idle --(target appears)--> dwelling --(elapsed >= dwellSec)--> fired
 *   dwelling --(target lost longer than graceSec, or a different target)--> reset
 *   fired --(target lost)--> idle   (no repeat fire while you keep looking)
 */
export type DwellEvent =
  | { type: 'enter'; target: string }
  | { type: 'leave'; target: string }
  | { type: 'fire'; target: string };

export const DWELL_MIN = 0.5;
export const DWELL_MAX = 2.0;
export const DWELL_DEFAULT = 1.0;

export class DwellTimer {
  private current: string | null = null;
  private elapsed = 0;
  private lostFor = 0;
  private fired = false;

  constructor(
    public dwellSec = DWELL_DEFAULT,
    /** Short tracking dropouts shorter than this do not reset progress. */
    public graceSec = 0.1,
  ) {}

  get target(): string | null {
    return this.current;
  }

  /** 0..1 fill of the dwell ring. */
  get progress(): number {
    if (!this.current) return 0;
    if (this.fired) return 1;
    return Math.min(1, this.elapsed / this.dwellSec);
  }

  reset(): void {
    this.current = null;
    this.elapsed = 0;
    this.lostFor = 0;
    this.fired = false;
  }

  /** Advance by `dt` seconds with the currently aimed target (or null). */
  update(target: string | null, dt: number): DwellEvent[] {
    const events: DwellEvent[] = [];
    if (target === null) {
      if (this.current === null) return events;
      this.lostFor += dt;
      if (this.lostFor > this.graceSec || this.fired) {
        events.push({ type: 'leave', target: this.current });
        this.reset();
      }
      return events;
    }
    if (target !== this.current) {
      if (this.current !== null) events.push({ type: 'leave', target: this.current });
      this.reset();
      this.current = target;
      events.push({ type: 'enter', target });
      // The frame that brings the target in does not count toward the dwell.
      return events;
    }
    this.lostFor = 0;
    if (this.fired) return events;
    this.elapsed += dt;
    if (this.elapsed >= this.dwellSec - 1e-9) {
      this.fired = true;
      events.push({ type: 'fire', target });
    }
    return events;
  }
}
