/**
 * The game: onboarding, rounds of 5, 8 and 12 lights hidden in the real room,
 * catching (every method ends here), the flight to your palm and up to the
 * ceiling constellation, hints, pause, and the ECS mirror used by the tests.
 */
import {
  createSystem,
  DepthOccludable,
  Entity,
  Hovered,
  Pressed,
  Quaternion,
  RayInteractable,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import {
  type CatchMethod,
  type Spot,
  NIGHT_ROUNDS,
  Round,
  captionFor,
  arrowFor,
  dailySeed,
  directionTo,
  forwardFromYaw,
  hideLights,
  mergeSky,
  modeFromFirstInput,
  nightKey,
  nightsPlayed,
  starsFor,
  vec,
} from '@phengos/core';
import { GameState, Light } from '../components.js';
import { type LightVisual, COLORS, createChevron, createLightVisual, createStarField, setHighContrast } from '../game/visuals.js';
import { globalsOf, STORE_KEY, type Store } from '../game/store.js';
import { loadSky, saveSky } from '../game/sky.js';

interface Flight {
  from: Vector3;
  t: number;
  stage: 'toPalm' | 'rest' | 'rise' | 'done';
  star: Vector3;
  hand: 'left' | 'right' | null;
}

interface LightRuntime {
  id: string;
  entity: Entity;
  visual: LightVisual;
  spot: Spot;
  phase: number;
  flight: Flight | null;
}

export interface Controller {
  catchLight(id: string, method: CatchMethod, hand?: 'left' | 'right' | null): boolean;
  catchOutlined(method: CatchMethod): boolean;
  cycleOutline(dir: 1 | -1): void;
  hint(): void;
  repeat(): void;
  pause(): void;
  resume(): void;
  toggleMenu(): void;
  louder(): void;
  firstInput(method: CatchMethod): void;
}

const ONBOARD_ID = 'light-hello';

export class GameSystem extends createSystem({
  lights: { required: [Light] },
  pressedLights: { required: [Light, Pressed] },
  hoveredLights: { required: [Light, Hovered] },
  state: { required: [GameState] },
}) {
  private store!: Store;
  private stateEntity!: Entity;
  private runtimes = new Map<string, LightRuntime>();
  private lightVisuals = new Map<string, LightVisual>();
  private headPos = new Vector3();
  private headQuat = new Quaternion();
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private roundEndAt = 0;
  private chevron = createChevron();
  private chevronUntil = 0;
  private chevronTarget: string | null = null;
  private stars = createStarField(400);
  private night = nightKey(new Date());
  private nightSeed = dailySeed(new Date());
  private nightPlays = 0;
  private pendingStars: Array<{ id: string; u: number; v: number }> = [];
  controller!: Controller;

  init(): void {
    this.store = this.world.globals[STORE_KEY] as Store;
    this.stateEntity = this.world.createEntity();
    this.stateEntity.addComponent(GameState, {});
    const chevronEntity = this.world.createTransformEntity(this.chevron, { persistent: true });
    chevronEntity.object3D!.name = 'hint-chevron';
    const starsEntity = this.world.createTransformEntity(this.stars.points, { persistent: true });
    starsEntity.object3D!.name = 'ceiling-constellation';
    const params = new URLSearchParams(location.search);
    if (params.has('seed')) this.nightSeed = Number(params.get('seed')) >>> 0;
    if (params.has('fresh')) this.store.stars = [];
    else void loadSky().then((s) => {
      this.store.stars = s;
      this.store.nights = nightsPlayed(s);
      this.refreshStars();
    });

    this.controller = {
      catchLight: (id, method, hand) => this.catchLight(id, method, hand ?? null),
      catchOutlined: (method) => {
        const id = this.store.outlined ?? this.nearestToAim();
        return id ? this.catchLight(id, method, null) : false;
      },
      cycleOutline: (dir) => {
        if (!this.store.round) return;
        this.store.outlined = this.store.round.cycle(this.store.outlined, dir);
        const rt = this.store.outlined ? this.runtimes.get(this.store.outlined) : null;
        if (rt) this.store.say(this.describe('light', rt.spot.position), arrowFor(this.dir(rt.spot.position)));
      },
      hint: () => this.hint(),
      repeat: () => {
        const id = this.nearestToAim();
        const rt = id ? this.runtimes.get(id) : null;
        if (rt && id) {
          globalsOf(this.world).audio?.ping(id);
          this.store.say(this.describe('hum', rt.spot.position), arrowFor(this.dir(rt.spot.position)));
        }
      },
      pause: () => {
        this.store.paused = true;
        this.store.menuOpen = true;
        this.store.say('Paused', 'o', 2);
      },
      resume: () => {
        this.store.paused = false;
        this.store.menuOpen = false;
        this.store.say('Resumed', 'o', 1.5);
      },
      toggleMenu: () => (this.store.menuOpen ? this.controller.resume() : this.controller.pause()),
      louder: () => {
        const s = this.store.settings;
        this.store.setSettings({ ...s, hum: true, humVolume: Math.min(1, s.humVolume + 0.2) });
        this.store.say(`Hum volume ${Math.round(this.store.settings.humVolume * 100)}%`, 'o', 2);
      },
      firstInput: (method) => this.firstInput(method),
    };
    this.world.globals.controller = this.controller;
    this.world.globals.lightVisuals = this.lightVisuals;

    // A pinch on the hand ray (or an eye-gaze pinch on the Glasses, or a mouse click) catches.
    this.queries.pressedLights.subscribe('qualify', (entity) => {
      const id = entity.getValue(Light, 'lightId') as string;
      const method: CatchMethod = !this.store.inXR ? 'mouse' : this.store.gazeAvailable ? 'eyes' : 'point';
      this.store.pinchConsumedAt = this.store.time;
      if (this.catchLight(id, method, this.store.lastHand)) this.firstInput(method);
    });

    const onStart = () => {
      this.store.inXR = true;
      if (this.store.phase === 'boot') this.store.phase = 'room';
      this.store.say('Finding your room', 'o', Infinity);
    };
    this.xrManager.addEventListener('sessionstart', onStart);
    this.cleanupFuncs.push(() => this.xrManager.removeEventListener('sessionstart', onStart));
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((v) => {
        this.store.inXR = v !== VisibilityState.NonImmersive;
      }),
    );
  }

  // ---------- rounds ----------

  private startOnboarding(): void {
    this.store.phase = 'onboarding';
    this.player.head.getWorldPosition(this.headPos);
    const fwd = this.headForward();
    // The first light floats 20 degrees left of centre, a little low: in plain
    // sight, but you have to choose to look at it.
    const yaw = Math.atan2(-fwd.x, -fwd.z) + (20 * Math.PI) / 180;
    const dir = forwardFromYaw(yaw);
    const p = vec(this.headPos.x + dir.x * 1.4, this.headPos.y - 0.12, this.headPos.z + dir.z * 1.4);
    const spot: Spot = { id: 'hello', kind: 'wall', position: p, host: 'air', visible: 1, yawDeg: -20, heightNorm: 0.45 };
    this.store.round = new Round([spot], -1);
    this.store.round.lights[0]!.id = ONBOARD_ID;
    this.spawn(this.store.round);
    this.store.say('A light. Catch it any way you like.', '<', 6);
  }

  private startRound(index: number): void {
    this.clearLights();
    const info = this.store.roomInfo;
    const room = this.store.room;
    if (!room || !info) return;
    this.player.head.getWorldPosition(this.headPos);
    const fwd = this.headForward();
    const count = NIGHT_ROUNDS[index] ?? 12;
    const result = hideLights(room, {
      count,
      seed: (this.nightSeed + index * 7919 + this.nightPlays * 104729) >>> 0,
      head: vec(this.headPos.x, this.headPos.y, this.headPos.z),
      forward: vec(fwd.x, 0, fwd.z),
      comfortHalfDeg: this.store.settings.comfortHalfDeg,
    });
    this.store.roundIndex = index;
    this.store.round = new Round(result.spots, index);
    this.store.phase = 'playing';
    this.store.outlined = null;
    this.spawn(this.store.round);
    const kinds = result.spots.map((s) => s.kind);
    console.info(`[phengos] round ${index + 1}: ${result.spots.length} lights (${kinds.join(', ')}); ${result.accepted}/${result.candidates} candidates passed visibility + comfort`);
    this.store.say(`${result.spots.length} lights are hiding. Listen.`, 'o', 4);
  }

  private spawn(round: Round): void {
    const hc = this.store.settings.contrast !== 'off';
    for (const l of round.lights) {
      const visual = createLightVisual(l.id);
      const entity = this.world.createTransformEntity(visual.root);
      visual.root.add(visual.ring);
      visual.root.position.set(l.spot.position.x, l.spot.position.y, l.spot.position.z);
      entity.addComponent(Light, {
        lightId: l.id,
        kind: l.spot.kind,
        host: l.spot.host,
        visible: l.spot.visible,
        px: l.spot.position.x,
        py: l.spot.position.y,
        pz: l.spot.position.z,
      });
      entity.addComponent(RayInteractable);
      // Hard occlusion: one depth sample per fragment, on the lights only.
      entity.addComponent(DepthOccludable, { mode: 'HardOcclusion' });
      if (hc) setHighContrast(visual, true);
      const rt: LightRuntime = { id: l.id, entity, visual, spot: l.spot, phase: (this.runtimes.size * 1.7) % 6.28, flight: null };
      this.runtimes.set(l.id, rt);
      this.lightVisuals.set(l.id, visual);
      this.store.lightTargets.set(l.id, {
        id: l.id,
        kind: 'light',
        object: visual.root,
        radiusDeg: 0,
        activate: (method) => {
          if (this.catchLight(l.id, method, null)) this.firstInput(method);
        },
        highlight: (on) => this.setRing(l.id, on ? 'scan' : null),
      });
    }
  }

  private clearLights(): void {
    for (const rt of this.runtimes.values()) {
      if (rt.entity.active) rt.entity.dispose();
    }
    this.runtimes.clear();
    this.lightVisuals.clear();
    this.store.lightTargets.clear();
  }

  // ---------- catching ----------

  private catchLight(id: string, method: CatchMethod, hand: 'left' | 'right' | null): boolean {
    const round = this.store.round;
    const rt = this.runtimes.get(id);
    if (!round || !rt || this.store.paused) return false;
    if (this.store.phase !== 'playing' && this.store.phase !== 'onboarding') return false;
    if (!round.catch(id, method, this.store.time)) return false;
    this.store.lastCatchMethod = method;
    this.store.methodsUsed.add(method);
    this.store.caughtTotal += id === ONBOARD_ID ? 0 : 1;
    if (this.store.outlined === id) this.store.outlined = null;
    rt.entity.setValue(Light, 'caught', true);
    rt.entity.setValue(Light, 'method', method);
    if (rt.entity.hasComponent(RayInteractable)) rt.entity.removeComponent(RayInteractable);
    if (rt.entity.hasComponent(DepthOccludable)) rt.entity.removeComponent(DepthOccludable);
    this.store.lightTargets.delete(id);
    this.setRing(id, null);
    const star = this.starPositionFor(rt);
    rt.flight = { from: rt.visual.root.position.clone(), t: 0, stage: 'toPalm', star, hand };
    globalsOf(this.world).audio?.chime(rt.spot.position);
    const how: Record<CatchMethod, string> = {
      point: 'pinch',
      look: 'look',
      eyes: 'eye gaze',
      voice: 'voice',
      switch: 'switch',
      mouse: 'click',
    };
    this.store.say(`${this.describe('chime', rt.spot.position)} - caught by ${how[method]}`, arrowFor(this.dir(rt.spot.position)), 2.5);
    if (round.done) this.roundEndAt = this.store.time + 2.6;
    return true;
  }

  private firstInput(method: CatchMethod): void {
    if (this.store.modeChosen) return;
    this.store.modeChosen = true;
    const mode = modeFromFirstInput(method);
    this.store.setMode(mode);
    const label = mode === 'point' ? 'Point (hands)' : mode === 'look' ? this.store.lookLabel : 'One switch';
    this.store.say(`You play by ${label}. Others: pause menu.`, 'o', 4);
  }

  private nearestToAim(): string | null {
    const round = this.store.round;
    if (!round) return null;
    return round.nearestToAim(this.store.head, this.store.aim)?.id ?? null;
  }

  private hint(): void {
    const id = this.nearestToAim();
    const rt = id ? this.runtimes.get(id) : null;
    if (!rt || !id) return;
    globalsOf(this.world).audio?.ping(id, true);
    this.chevronTarget = id;
    this.chevronUntil = this.store.time + 3.5;
    this.store.say(`Hint: ${this.describe('hum', rt.spot.position)}`, arrowFor(this.dir(rt.spot.position)), 3.5);
  }

  private dir(p: { x: number; y: number; z: number }) {
    const info = this.store.roomInfo;
    return directionTo(this.store.head, this.store.forward, p, info?.floorY ?? 0, info?.ceilingY ?? 2.5);
  }

  private describe(sound: string, p: { x: number; y: number; z: number }): string {
    return captionFor(sound, this.dir(p));
  }

  private headForward(): Vector3 {
    this.player.head.getWorldQuaternion(this.headQuat);
    const f = this.tmp2.set(0, 0, -1).applyQuaternion(this.headQuat).setY(0);
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    return f.normalize();
  }

  // ---------- constellation ----------

  private starPositionFor(rt: LightRuntime): Vector3 {
    const c = this.store.ceiling;
    const info = this.store.roomInfo;
    const ceilY = (info?.ceilingY ?? 2.5) - 0.03;
    if (!c) return new Vector3(rt.spot.position.x, ceilY, rt.spot.position.z);
    const p = rt.spot.position;
    const u = (p.x - c.origin.x) * c.xAxis.x + (p.z - c.origin.z) * c.xAxis.z;
    const v = (p.x - c.origin.x) * c.zAxis.x + (p.z - c.origin.z) * c.zAxis.z;
    const [star] = starsFor(this.night, [{ id: `${this.nightPlays}:${this.store.roundIndex}:${rt.id}`, position: vec(u, 0, v) }], [
      ...this.store.stars,
      ...this.pendingStars.map((s) => ({ night: this.night, x: s.u, z: s.v, magnitude: 1 })),
    ]);
    if (rt.id !== ONBOARD_ID) this.pendingStars.push({ id: rt.id, u: star!.x, v: star!.z });
    return this.ceilingToWorld(star!.x, star!.z, ceilY);
  }

  private ceilingToWorld(u: number, v: number, y: number): Vector3 {
    const c = this.store.ceiling;
    if (!c) return new Vector3(u, y, v);
    return new Vector3(c.origin.x + c.xAxis.x * u + c.zAxis.x * v, y, c.origin.z + c.xAxis.z * u + c.zAxis.z * v);
  }

  private commitStars(): void {
    if (!this.pendingStars.length) return;
    const added = this.pendingStars.map((s) => ({ night: this.night, x: s.u, z: s.v, magnitude: 0.6 + ((s.u * 31 + s.v * 17) % 0.4 + 0.4) % 0.4 }));
    this.pendingStars = [];
    this.store.stars = mergeSky(this.store.stars, added);
    this.store.nights = nightsPlayed(this.store.stars);
    void saveSky(this.store.stars);
    this.refreshStars();
  }

  private refreshStars(): void {
    const pos = this.stars.geometry.getAttribute('position');
    const col = this.stars.geometry.getAttribute('color');
    const ceilY = (this.store.roomInfo?.ceilingY ?? 2.5) - 0.03;
    const list = this.store.stars.slice(-400);
    list.forEach((s, i) => {
      const w = this.ceilingToWorld(s.x, s.z, ceilY);
      pos.setXYZ(i, w.x, w.y, w.z);
      const m = s.magnitude;
      if (s.night === this.night) col.setXYZ(i, 0.9 * m, 1.0 * m, 0.31 * m);
      else col.setXYZ(i, m, 0.86 * m, 0.6 * m);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.stars.geometry.setDrawRange(0, list.length);
    this.stars.points.visible = this.store.roomInfo !== null && !this.store.settings.soundOnly;
  }

  // ---------- per frame ----------

  private setRing(id: string, kind: 'scan' | 'hover' | 'outline' | null): void {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    rt.visual.ring.visible = kind !== null && !rt.flight;
    rt.visual.ringMat.color.copy(kind === 'scan' ? COLORS.firefly : COLORS.focus);
    rt.visual.ring.scale.setScalar(kind === 'scan' ? 1.25 : 1);
  }

  update(delta: number, time: number): void {
    this.store.time = time;
    const s = this.store;
    this.player.head.getWorldPosition(this.headPos);
    this.player.head.getWorldQuaternion(this.headQuat);

    // Phase machine.
    if (s.phase === 'room' && s.roomInfo) {
      this.refreshStars();
      const startAt = Math.min(NIGHT_ROUNDS.length - 1, Math.max(0, Number(new URLSearchParams(location.search).get('round') ?? 0) || 0));
      if (s.modeChosen) this.startRound(startAt);
      else this.startOnboarding();
    } else if (s.phase === 'onboarding' && s.round?.done && this.allLanded()) {
      this.clearLights();
      this.startRound(0);
    } else if (s.phase === 'playing' && s.round?.done && time >= this.roundEndAt) {
      this.commitStars();
      if (s.roundIndex + 1 < NIGHT_ROUNDS.length) {
        s.phase = 'round-end';
        this.roundEndAt = time + 3.5;
        s.say(`Round ${s.roundIndex + 1} done. Next: ${NIGHT_ROUNDS[s.roundIndex + 1]} lights.`, 'o', 3.5);
      } else {
        s.phase = 'night-end';
        this.roundEndAt = time + 12;
        s.say(`Night complete. ${s.stars.length} stars on your ceiling.`, '^', 8);
      }
    } else if (s.phase === 'round-end' && time >= this.roundEndAt) {
      this.startRound(s.roundIndex + 1);
    } else if (s.phase === 'night-end' && time >= this.roundEndAt) {
      this.nightPlays++;
      this.startRound(0);
    }

    // Light animation: idle bob and flicker, billboarded halos, catch flights.
    const hc = s.settings.contrast !== 'off';
    const hidden = s.settings.soundOnly;
    for (const rt of this.runtimes.values()) {
      const root = rt.visual.root;
      rt.visual.halo.quaternion.copy(this.headQuat);
      rt.visual.ring.quaternion.copy(this.headQuat);
      if (rt.flight) {
        this.fly(rt, delta);
      } else {
        const t = time + rt.phase;
        root.position.set(rt.spot.position.x, rt.spot.position.y + Math.sin(t * 1.3) * 0.012, rt.spot.position.z);
        rt.visual.lantern.rotation.y = Math.sin(t * 0.4) * 0.3;
        const flicker = 0.85 + Math.sin(t * 7.1) * 0.05 + Math.sin(t * 3.3) * 0.05;
        const pulse = hc ? 0.75 + 0.25 * Math.sin(time * 4) : flicker;
        rt.visual.halo.scale.setScalar((hc ? 0.32 : 0.48) * pulse);
        rt.visual.lantern.scale.setScalar(hc ? 1.5 : 1);
      }
      root.visible = !hidden || rt.flight !== null;
    }

    // Hover feedback for hand rays; voice outline; hint chevron.
    for (const rt of this.runtimes.values()) {
      if (rt.flight) continue;
      const hovered = rt.entity.hasComponent(Hovered);
      const scanned = s.scanItem === rt.id;
      const outlined = s.outlined === rt.id;
      const dwell = s.dwellTarget === rt.id;
      this.setRing(rt.id, scanned ? 'scan' : hovered || outlined || dwell ? 'outline' : null);
    }
    this.updateChevron();
    this.mirror();
  }

  private allLanded(): boolean {
    for (const rt of this.runtimes.values()) if (rt.flight && rt.flight.stage !== 'done') return false;
    return true;
  }

  private palm(hand: 'left' | 'right' | null, out: Vector3): boolean {
    const order: Array<'left' | 'right'> = hand ? [hand] : ['right', 'left'];
    for (const h of order) {
      const grip = this.player.gripSpaces[h];
      if (grip && grip.visible !== false) {
        grip.getWorldPosition(out);
        if (out.lengthSq() > 1e-6 && out.distanceTo(this.headPos) < 1.2) {
          out.y += 0.09;
          return true;
        }
      }
    }
    // No tracked hand: land in front of the chest.
    const f = this.headForward();
    out.copy(this.headPos).addScaledVector(f, 0.4);
    out.y -= 0.28;
    return true;
  }

  private fly(rt: LightRuntime, dt: number): void {
    const f = rt.flight!;
    const root = rt.visual.root;
    f.t += dt;
    const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, x), 3);
    if (f.stage === 'toPalm') {
      this.palm(f.hand, this.tmp);
      const k = ease(f.t / 0.9);
      root.position.lerpVectors(f.from, this.tmp, k);
      root.position.y += Math.sin(k * Math.PI) * 0.25;
      rt.visual.halo.scale.setScalar(0.48 + k * 0.25);
      if (f.t >= 0.9) {
        f.stage = 'rest';
        f.t = 0;
      }
    } else if (f.stage === 'rest') {
      this.palm(f.hand, this.tmp);
      root.position.lerp(this.tmp, 0.3);
      rt.visual.halo.scale.setScalar(0.73 + Math.sin(f.t * 9) * 0.05);
      if (f.t >= 0.7) {
        f.stage = 'rise';
        f.t = 0;
        f.from.copy(root.position);
      }
    } else if (f.stage === 'rise') {
      const k = ease(f.t / 1.8);
      root.position.lerpVectors(f.from, f.star, k);
      root.scale.setScalar(1 - k * 0.75);
      rt.visual.halo.scale.setScalar(0.6 - k * 0.3);
      if (f.t >= 1.8) {
        f.stage = 'done';
        root.visible = false;
      }
    }
    if (f.stage === 'done') root.visible = false;
  }

  private updateChevron(): void {
    const s = this.store;
    const rt = this.chevronTarget ? this.runtimes.get(this.chevronTarget) : null;
    if (!rt || rt.flight || s.time > this.chevronUntil || s.settings.soundOnly) {
      this.chevron.visible = false;
      return;
    }
    // Place the chevron 0.7 m ahead, pushed toward the light and clamped to the
    // edge of a comfortable view, pointing at it.
    const toLight = this.tmp.copy(rt.visual.root.position).sub(this.headPos).normalize();
    const inv = this.headQuat.clone().invert();
    const local = toLight.clone().applyQuaternion(inv);
    let x = local.x;
    let y = local.y;
    const len = Math.hypot(x, y) || 1;
    const r = Math.min(0.2, len * 0.7);
    x = (x / len) * r;
    y = (y / len) * r;
    const pos = new Vector3(x, y, -0.7).applyQuaternion(this.headQuat).add(this.headPos);
    this.chevron.position.copy(pos);
    this.chevron.quaternion.copy(this.headQuat);
    this.chevron.rotateZ(Math.atan2(y, x) - Math.PI / 2);
    this.chevron.visible = Math.floor(s.time * 3) % 2 === 0 || local.z < 0;
  }

  private mirror(): void {
    const s = this.store;
    const e = this.stateEntity;
    e.setValue(GameState, 'phase', s.phase);
    e.setValue(GameState, 'mode', s.modeChosen ? s.settings.mode : 'choosing');
    e.setValue(GameState, 'roundIndex', s.roundIndex);
    e.setValue(GameState, 'caught', s.round?.caught ?? 0);
    e.setValue(GameState, 'total', s.round?.total ?? 0);
    e.setValue(GameState, 'caughtTotal', s.caughtTotal);
    e.setValue(GameState, 'paused', s.paused);
    e.setValue(GameState, 'menuOpen', s.menuOpen);
    e.setValue(GameState, 'contrast', s.settings.contrast);
    e.setValue(GameState, 'soundOnly', s.settings.soundOnly);
    e.setValue(GameState, 'dwellSec', s.settings.dwellSec);
    e.setValue(GameState, 'scanSec', s.settings.scanSec);
    e.setValue(GameState, 'textScale', s.settings.textScale);
    e.setValue(GameState, 'hum', s.settings.hum);
    e.setValue(GameState, 'lookLabel', s.lookLabel);
    e.setValue(GameState, 'dwellTarget', s.dwellTarget ?? '');
    e.setValue(GameState, 'dwellProgress', s.dwellProgress);
    e.setValue(GameState, 'scanItem', s.scanItem ?? '');
    e.setValue(GameState, 'outlined', s.outlined ?? '');
    e.setValue(GameState, 'lastCatchMethod', s.lastCatchMethod);
    e.setValue(GameState, 'methodsUsed', [...s.methodsUsed].sort().join(','));
    e.setValue(GameState, 'voiceStatus', s.voiceStatus);
    e.setValue(GameState, 'transcript', s.transcript);
    e.setValue(GameState, 'lastVoiceCommands', s.lastVoiceCommands);
    e.setValue(GameState, 'caption', s.time < s.caption.until ? s.caption.text : '');
    e.setValue(GameState, 'roomSource', s.roomSource);
    e.setValue(
      GameState,
      'roomSummary',
      s.room ? `${s.room.planes.length} planes, ${s.room.boxes.length} furniture: ${[...new Set(s.room.boxes.map((b) => b.label))].join(' ')}` : '',
    );
    e.setValue(GameState, 'stars', s.stars.length);
    e.setValue(GameState, 'nights', s.nights);
  }
}
