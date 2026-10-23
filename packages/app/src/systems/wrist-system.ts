/**
 * Palm-up wrist menu: turn either palm up and a small Menu chip appears above
 * it. Poke it with the other hand, or pinch it on the hand ray. Computed from
 * WebXR hand joints (wrist, index and pinky metacarpals).
 */
import { CanvasTexture, CircleGeometry, createSystem, Mesh, MeshBasicMaterial, Pressed, PokeInteractable, RayInteractable, SRGBColorSpace, Vector3, Entity } from '@iwsdk/core';
import { WristChip } from '../components.js';
import { globalsOf, STORE_KEY, type Store } from '../game/store.js';
import type { Controller } from './game-system.js';

export class WristSystem extends createSystem({ pressed: { required: [WristChip, Pressed] } }) {
  private store!: Store;
  private chip!: Mesh;
  private entity!: Entity;
  private upFor = 0;
  private w = new Vector3();
  private a = new Vector3();
  private b = new Vector3();
  private n = new Vector3();

  init(): void {
    this.store = this.world.globals[STORE_KEY] as Store;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#050608';
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#e6ff4f';
    g.lineWidth = 6;
    g.stroke();
    g.fillStyle = '#fafafa';
    g.font = '600 30px sans-serif';
    g.textAlign = 'center';
    g.fillText('Menu', 64, 75);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    this.chip = new Mesh(new CircleGeometry(0.035, 32), new MeshBasicMaterial({ map: tex, transparent: true }));
    this.chip.name = 'wrist-menu';
    this.chip.visible = false;
    this.entity = this.world.createTransformEntity(this.chip, { persistent: true });
    this.entity.addComponent(WristChip);
    this.entity.addComponent(RayInteractable);
    this.entity.addComponent(PokeInteractable);
    this.queries.pressed.subscribe('qualify', () => {
      if (!this.chip.visible) return;
      this.store.pinchConsumedAt = this.store.time;
      (globalsOf(this.world).controller)?.pause();
    });
  }

  update(delta: number): void {
    const frame = this.xrFrame;
    const ref = this.xrManager.getReferenceSpace();
    const session = this.xrManager.getSession();
    let shown = false;
    if (frame && ref && session && !this.store.menuOpen && this.store.inXR) {
      for (const src of session.inputSources) {
        const hand = src.hand;
        if (!hand || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
        const pw = frame.getJointPose?.(hand.get('wrist')!, ref);
        const pi = frame.getJointPose?.(hand.get('index-finger-metacarpal')!, ref);
        const pp = frame.getJointPose?.(hand.get('pinky-finger-metacarpal')!, ref);
        if (!pw || !pi || !pp) continue;
        this.w.set(pw.transform.position.x, pw.transform.position.y, pw.transform.position.z);
        this.a.set(pi.transform.position.x, pi.transform.position.y, pi.transform.position.z).sub(this.w);
        this.b.set(pp.transform.position.x, pp.transform.position.y, pp.transform.position.z).sub(this.w);
        this.n.crossVectors(this.a, this.b).normalize();
        if (src.handedness === 'left') this.n.negate();
        if (this.n.y > 0.75) {
          shown = true;
          this.upFor += delta;
          if (this.upFor > 0.35) {
            this.chip.visible = true;
            this.chip.position.copy(this.w).addScaledVector(this.a, 0.6).addScaledVector(this.b, 0.4);
            this.chip.position.y += 0.07;
            this.chip.position.applyMatrix4(this.player.matrixWorld);
            this.player.head.getWorldQuaternion(this.chip.quaternion);
          }
          break;
        }
      }
    }
    if (!shown) {
      this.upFor = 0;
      this.chip.visible = false;
      this.chip.position.set(0, -50, 0);
    }
  }
}
