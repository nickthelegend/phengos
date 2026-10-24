/**
 * Pinches and the single switch.
 *
 * Any pinch from either hand is a switch press. In "One switch" mode the
 * highlight steps through the lights (left to right), then Hint and Pause, every
 * `scanSec` seconds; a short pinch selects the highlighted item and a long pinch
 * (1 s) opens the pause menu. With the menu open, the scan steps through the
 * menu's controls instead.
 *
 * A pinch that already caught a light on the hand ray, or clicked a control, is
 * not counted twice. During onboarding the scanner starts by itself after four
 * quiet seconds, so a player who can only pinch is never stuck.
 */
import { createSystem } from '@iwsdk/core';
import { Scanner } from '@phengos/core';
import { globalsOf, STORE_KEY, type Store, type Target } from '../game/store.js';
import type { Controller } from './game-system.js';

const LONG_PINCH = 1.0;
const ONBOARD_SCAN_AFTER = 4.0;

interface Held {
  start: number;
  hand: 'left' | 'right' | null;
  /** The item highlighted when the pinch began: slow pinches still select what you saw. */
  item: string | null;
}

export class InputSystem extends createSystem({}) {
  private store!: Store;
  private scanner = new Scanner();
  private held = new Map<XRInputSource, Held>();
  private pending: Array<{ at: number; start: number; long: boolean; hand: 'left' | 'right' | null; item: string | null }> = [];
  private highlighted: Target | null = null;
  private onboardingSince = -1;
  private longFired = new Set<XRInputSource>();

  init(): void {
    this.store = this.world.globals[STORE_KEY] as Store;
    let session: XRSession | null = null;
    const onSelectStart = (e: Event) => {
      const ev = e as XRInputSourceEvent;
      this.held.set(ev.inputSource, { start: this.store.time, hand: handOf(ev.inputSource), item: this.scanner.current });
      this.store.lastHand = handOf(ev.inputSource);
      // Hand rays drift while a pinch closes: catch what the ray was on.
      if (!this.scanning()) this.controller?.catchHovered(handOf(ev.inputSource));
      globalsOf(this.world).audio?.unlock();
    };
    const onSelectEnd = (e: Event) => {
      const ev = e as XRInputSourceEvent;
      const h = this.held.get(ev.inputSource);
      this.held.delete(ev.inputSource);
      if (!h) return;
      if (this.longFired.delete(ev.inputSource)) return;
      const long = this.store.time - h.start >= LONG_PINCH;
      // Decide two frames later, after ray presses and UI clicks have landed.
      this.pending.push({ at: this.store.time + 0.05, start: h.start, long, hand: h.hand, item: h.item });
    };
    const onStart = () => {
      session = this.xrManager.getSession();
      session?.addEventListener('selectstart', onSelectStart);
      session?.addEventListener('selectend', onSelectEnd);
    };
    const onEnd = () => {
      session?.removeEventListener('selectstart', onSelectStart);
      session?.removeEventListener('selectend', onSelectEnd);
      session = null;
      this.held.clear();
    };
    this.xrManager.addEventListener('sessionstart', onStart);
    this.xrManager.addEventListener('sessionend', onEnd);
    this.cleanupFuncs.push(() => {
      onEnd();
      this.xrManager.removeEventListener('sessionstart', onStart);
      this.xrManager.removeEventListener('sessionend', onEnd);
    });
  }

  private get controller(): Controller | undefined {
    return globalsOf(this.world).controller;
  }

  private scanning(): boolean {
    const s = this.store;
    if (!s.inXR) return false;
    if (s.modeChosen && s.settings.mode === 'switch') return s.phase === 'playing' || s.menuOpen;
    return s.phase === 'onboarding' && this.onboardingSince >= 0 && s.time - this.onboardingSince >= ONBOARD_SCAN_AFTER;
  }

  update(delta: number): void {
    const s = this.store;
    if (s.phase === 'onboarding' && this.onboardingSince < 0) this.onboardingSince = s.time;
    if (s.phase !== 'onboarding') this.onboardingSince = -1;
    this.scanner.intervalSec = s.settings.scanSec;

    const scanning = this.scanning();
    if (scanning) {
      const items = s.activeTargets();
      this.scanner.setItems(items.map((t) => t.id));
      this.scanner.update(delta);
    } else {
      this.scanner.setItems([]);
    }
    const currentId = scanning ? this.scanner.current : null;
    s.scanItem = currentId;
    const current = currentId ? (s.lightTargets.get(currentId) ?? s.controlTargets.get(currentId) ?? null) : null;
    if (current !== this.highlighted) {
      this.highlighted?.highlight(false);
      current?.highlight(true);
      this.highlighted = current;
    }

    // A long pinch in switch mode opens the menu while still held.
    if (s.modeChosen && s.settings.mode === 'switch') {
      for (const [src, h] of this.held) {
        if (!this.longFired.has(src) && s.time - h.start >= LONG_PINCH) {
          this.longFired.add(src);
          this.controller?.toggleMenu();
        }
      }
    }

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]!;
      if (s.time < p.at) continue;
      this.pending.splice(i, 1);
      if (s.pinchConsumedAt >= p.start) continue; // a ray press or click already used this pinch
      if (!scanning || p.long) continue;
      const id = p.item ?? this.scanner.current;
      const target = id ? (s.lightTargets.get(id) ?? s.controlTargets.get(id)) : null;
      if (target) {
        target.activate('switch');
        this.scanner.hold();
      }
    }
  }
}

function handOf(src: XRInputSource): 'left' | 'right' | null {
  return src.handedness === 'left' || src.handedness === 'right' ? src.handedness : null;
}
