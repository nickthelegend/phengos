/**
 * Synthesised spatial sound, no audio files.
 *
 * Every hidden light hums from where it is: a sine with a little FM shimmer
 * through an HRTF PannerNode. Pitch encodes height (low = floor, high = ceiling,
 * pentatonic), and the hum pulses faster as you aim closer. The four lights
 * nearest your aim are audible at a time so the room stays calm. A catch rings a
 * bell from the light's position. Every sound gets a caption with a direction.
 *
 * IWSDK's AudioSource plays files; for synthesised, per-frame-modulated hums we
 * use Web Audio directly (PannerNode, panningModel "HRTF").
 */
import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { arrowFor, captionFor, directionTo, humPitch, humPulseHz, type Round } from '@phengos/core';
import { globalsOf, STORE_KEY, type Store } from '../game/store.js';

interface Voice {
  osc: OscillatorNode;
  mod: OscillatorNode;
  amp: GainNode;
  pan: PannerNode;
  phase: number;
  boostUntil: number;
}

const AUDIBLE = 4;
const CAPTION_EVERY = 6;

export class AudioSystem extends createSystem({}) {
  private store!: Store;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<string, Voice>();
  private round: Round | null = null;
  private nextCaption = 0;
  private head = new Vector3();
  private q = new Quaternion();
  private f = new Vector3();
  private u = new Vector3();
  private order: Array<{ id: string; a: number }> = [];

  init(): void {
    this.store = this.world.globals[STORE_KEY] as Store;
    globalsOf(this.world).audio = {
      unlock: () => this.unlock(),
      ping: (id: string, strong = false) => this.ping(id, strong),
      chime: (p: { x: number; y: number; z: number }) => this.chime(p),
      state: () => this.ctx?.state ?? 'not started',
    };
    const onStart = () => this.unlock();
    this.xrManager.addEventListener('sessionstart', onStart);
    this.cleanupFuncs.push(() => {
      this.xrManager.removeEventListener('sessionstart', onStart);
      this.stopAll();
      void this.ctx?.close();
    });
  }

  private unlock(): void {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    } catch (err) {
      console.warn('[phengos] audio unavailable:', err);
    }
  }

  private makeVoice(id: string): Voice | null {
    const ctx = this.ctx;
    const l = this.round?.get(id);
    if (!ctx || !this.master || !l) return null;
    const pitch = humPitch(l.spot.heightNorm);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = pitch;
    const mod = ctx.createOscillator();
    mod.frequency.value = pitch * 2.005;
    const modGain = ctx.createGain();
    modGain.gain.value = pitch * 0.12;
    mod.connect(modGain).connect(osc.frequency);
    const amp = ctx.createGain();
    amp.gain.value = 0;
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse';
    pan.refDistance = 0.8;
    pan.rolloffFactor = 0.8;
    pan.positionX.value = l.spot.position.x;
    pan.positionY.value = l.spot.position.y;
    pan.positionZ.value = l.spot.position.z;
    osc.connect(amp).connect(pan).connect(this.master);
    osc.start();
    mod.start();
    const v: Voice = { osc, mod, amp, pan, phase: Math.random(), boostUntil: 0 };
    this.voices.set(id, v);
    return v;
  }

  private stopVoice(id: string): void {
    const v = this.voices.get(id);
    if (!v || !this.ctx) return;
    const t = this.ctx.currentTime;
    v.amp.gain.setTargetAtTime(0, t, 0.05);
    v.osc.stop(t + 0.3);
    v.mod.stop(t + 0.3);
    this.voices.delete(id);
  }

  private stopAll(): void {
    for (const id of [...this.voices.keys()]) this.stopVoice(id);
  }

  private ping(id: string, strong: boolean): void {
    this.unlock();
    const v = this.voices.get(id) ?? this.makeVoice(id);
    if (v) v.boostUntil = this.store.time + (strong ? 2.5 : 1.5);
  }

  private chime(p: { x: number; y: number; z: number }): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF';
    pan.positionX.value = p.x;
    pan.positionY.value = p.y;
    pan.positionZ.value = p.z;
    pan.connect(this.master);
    for (const [freq, level, decay] of [
      [1046.5, 0.35, 1.6],
      [1568, 0.18, 1.1],
      [2637, 0.08, 0.6],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  }

  update(delta: number): void {
    const s = this.store;
    if (s.round !== this.round) {
      this.stopAll();
      this.round = s.round;
    }
    const ctx = this.ctx;
    if (!ctx || !this.round) return;
    this.player.head.getWorldPosition(this.head);
    this.player.head.getWorldQuaternion(this.q);
    this.f.set(0, 0, -1).applyQuaternion(this.q);
    this.u.set(0, 1, 0).applyQuaternion(this.q);
    const L = ctx.listener;
    if (L.positionX) {
      L.positionX.value = this.head.x;
      L.positionY.value = this.head.y;
      L.positionZ.value = this.head.z;
      L.forwardX.value = this.f.x;
      L.forwardY.value = this.f.y;
      L.forwardZ.value = this.f.z;
      L.upX.value = this.u.x;
      L.upY.value = this.u.y;
      L.upZ.value = this.u.z;
    }

    const live = (s.phase === 'playing' || s.phase === 'onboarding') && !s.paused;
    const humOn = s.settings.hum && live;
    // Rank uncaught lights by angle to the aim ray.
    this.order.length = 0;
    for (const l of this.round.remaining) this.order.push({ id: l.id, a: this.round.aimAngle(s.head, s.aim, l.id) });
    this.order.sort((a, b) => a.a - b.a);
    const audible = new Set(this.order.slice(0, AUDIBLE).map((o) => o.id));
    for (const id of [...this.voices.keys()]) if (!this.round.get(id) || this.round.get(id)!.caught) this.stopVoice(id);

    const t = ctx.currentTime;
    for (const { id, a } of this.order) {
      const boosted = (this.voices.get(id)?.boostUntil ?? 0) > s.time;
      if (!humOn && !boosted) {
        const v = this.voices.get(id);
        if (v) v.amp.gain.setTargetAtTime(0, t, 0.08);
        continue;
      }
      if (!audible.has(id) && !boosted) {
        const v = this.voices.get(id);
        if (v) v.amp.gain.setTargetAtTime(0, t, 0.2);
        continue;
      }
      const v = this.voices.get(id) ?? this.makeVoice(id);
      if (!v) continue;
      v.phase += humPulseHz(a) * delta;
      const env = Math.pow(0.5 + 0.5 * Math.sin(v.phase * Math.PI * 2), 3);
      const focus = id === this.order[0]?.id ? 1 : 0.4;
      const level = s.settings.humVolume * 0.22 * (0.2 + 0.8 * env) * focus * (boosted ? 2 : 1) * (s.settings.soundOnly ? 1.3 : 1);
      v.amp.gain.setTargetAtTime(level, t, 0.03);
    }

    // Caption the hum you are closest to, every few seconds.
    if (humOn && s.time >= this.nextCaption && s.time >= s.caption.until && this.order[0]) {
      this.nextCaption = s.time + CAPTION_EVERY;
      const l = this.round.get(this.order[0].id);
      const info = s.roomInfo;
      if (l) {
        const d = directionTo(s.head, s.forward, l.spot.position, info?.floorY ?? 0, info?.ceilingY ?? 2.5);
        s.say(captionFor('hum', d), arrowFor(d), 3);
      }
    }
  }
}
