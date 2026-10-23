/**
 * Builds the core Room from WebXR scene understanding.
 *
 * - XRPlane: polygon + orientation only. IWSDK documents no plane label, so the
 *   core classifies planes by orientation and height.
 * - XRMesh: bounded meshes carry a semanticLabel (couch, table, shelf...) and a
 *   local bounding box, turned into a world-space box rotated about +Y.
 *
 * The room is ready once the detected set has been stable for one second. If
 * nothing is detected within five seconds (no Space Setup, or a desktop
 * browser), Phengos builds a virtual paper room: three folding screens around
 * you, with a floor and a ceiling, and the game still completes.
 */
import {
  createSystem,
  CanvasTexture,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  XRMesh,
  XRPlane,
  VisibilityState,
} from '@iwsdk/core';
import { type Room, type RoomBox, type RoomPlane, analyzeRoom, vec } from '@phengos/core';
import { STORE_KEY, type Store } from '../game/store.js';

const STABLE_SECONDS = 1.0;
const FALLBACK_SECONDS = 5.0;

export interface CeilingFrame {
  origin: Vector3;
  xAxis: Vector3;
  zAxis: Vector3;
}

export class RoomSystem extends createSystem({
  planes: { required: [XRPlane] },
  meshes: { required: [XRMesh] },
}) {
  private store!: Store;
  private elapsed = 0;
  private stableFor = 0;
  private lastSignature = '';
  private ready = false;
  private forcePaper = false;
  private dump = false;
  private paper: Group | null = null;
  private tmp = new Vector3();
  private tmpQ = new Quaternion();
  private tmpM = new Matrix4();
  ceiling: CeilingFrame | null = null;

  init(): void {
    this.store = this.world.globals[STORE_KEY] as Store;
    const params = new URLSearchParams(location.search);
    this.forcePaper = params.get('room') === 'paper';
    this.dump = params.has('dumpRoom');
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        if (state === VisibilityState.NonImmersive) return;
        if (!this.ready) {
          this.elapsed = 0;
          this.stableFor = 0;
        }
      }),
    );
    const onEnd = () => this.reset();
    this.xrManager.addEventListener('sessionend', onEnd);
    this.cleanupFuncs.push(() => this.xrManager.removeEventListener('sessionend', onEnd));
  }

  private reset(): void {
    this.ready = false;
    this.elapsed = 0;
    this.stableFor = 0;
    this.lastSignature = '';
    this.paper?.removeFromParent();
    this.paper = null;
    this.ceiling = null;
  }

  update(delta: number): void {
    if (this.ready) return;
    const inXR = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (!inXR && this.store.phase === 'boot') return;
    this.elapsed += delta;
    const nPlanes = this.queries.planes.entities.size;
    const nMeshes = this.queries.meshes.entities.size;
    const signature = `${nPlanes}:${nMeshes}`;
    if (signature === this.lastSignature) this.stableFor += delta;
    else {
      this.lastSignature = signature;
      this.stableFor = 0;
    }
    const detected = nPlanes + nMeshes > 0;
    if (!this.forcePaper && detected && this.stableFor >= STABLE_SECONDS && this.elapsed >= 1.5) {
      this.finish(this.readScene(), 'scene');
    } else if (this.forcePaper || (!detected && this.elapsed >= FALLBACK_SECONDS)) {
      this.finish(this.buildPaperRoom(), 'paper');
    }
  }

  private finish(room: Room, source: 'scene' | 'paper'): void {
    this.ready = true;
    this.store.room = room;
    this.store.roomInfo = analyzeRoom(room);
    this.store.roomSource = source;
    this.store.ceiling = this.ceiling;
    if (this.dump) console.info(`PHENGOS_ROOM ${JSON.stringify(room)}`);
    const labels = room.boxes.map((b) => b.label);
    console.info(
      `[phengos] room from ${source}: ${room.planes.length} planes, ${room.boxes.length} furniture (${[...new Set(labels)].join(', ') || 'none'})`,
    );
  }

  private readScene(): Room {
    const planes: RoomPlane[] = [];
    let ceilingPlane: { obj: Mesh; c: Vector3 } | null = null;
    let i = 0;
    for (const e of this.queries.planes.entities) {
      const plane = e.getValue(XRPlane, '_plane') as XRPlane | undefined;
      const obj = e.object3D;
      if (!plane || !obj) continue;
      obj.updateWorldMatrix(true, false);
      const corners = plane.polygon.map((p) => {
        this.tmp.set(p.x, p.y, p.z).applyMatrix4(obj.matrixWorld);
        return vec(this.tmp.x, this.tmp.y, this.tmp.z);
      });
      const n = new Vector3(0, 1, 0).transformDirection(obj.matrixWorld);
      planes.push({
        id: `plane-${i++}`,
        orientation: plane.orientation === 'vertical' ? 'vertical' : 'horizontal',
        normal: vec(n.x, n.y, n.z),
        corners,
      });
      if (plane.orientation !== 'vertical' && n.y < -0.5) {
        const c = new Vector3().setFromMatrixPosition(obj.matrixWorld);
        if (!ceilingPlane || c.y > ceilingPlane.c.y) ceilingPlane = { obj: obj as Mesh, c };
      }
    }
    const boxes: RoomBox[] = [];
    let j = 0;
    for (const e of this.queries.meshes.entities) {
      if (!e.getValue(XRMesh, 'isBounded3D')) continue;
      const obj = e.object3D;
      if (!obj) continue;
      obj.updateWorldMatrix(true, false);
      const min = e.getVectorView(XRMesh, 'min');
      const max = e.getVectorView(XRMesh, 'max');
      const label = String(e.getValue(XRMesh, 'semanticLabel') || 'other').toLowerCase();
      this.tmp.set((min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2).applyMatrix4(obj.matrixWorld);
      obj.getWorldQuaternion(this.tmpQ);
      const xAxis = new Vector3(1, 0, 0).applyQuaternion(this.tmpQ);
      boxes.push({
        id: `mesh-${j++}-${label}`,
        label,
        center: vec(this.tmp.x, this.tmp.y, this.tmp.z),
        half: vec((max[0]! - min[0]!) / 2, (max[1]! - min[1]!) / 2, (max[2]! - min[2]!) / 2),
        yaw: Math.atan2(-xAxis.z, xAxis.x),
      });
    }
    if (ceilingPlane) {
      const q = ceilingPlane.obj.getWorldQuaternion(new Quaternion());
      const x = new Vector3(1, 0, 0).applyQuaternion(q).setY(0).normalize();
      this.ceiling = { origin: ceilingPlane.c, xAxis: x, zAxis: new Vector3().crossVectors(x, new Vector3(0, 1, 0)) };
    }
    return { name: 'detected', planes, boxes };
  }

  /** Three paper screens around the player, plus a virtual floor and ceiling. */
  private buildPaperRoom(): Room {
    const head = new Vector3();
    this.player.head.getWorldPosition(head);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(this.player.head.getWorldQuaternion(this.tmpQ)).setY(0);
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const baseYaw = Math.atan2(-fwd.x, -fwd.z);
    const floorY = 0;
    const ceilingY = 2.5;
    const group = new Group();
    group.name = 'paper-room';
    const tex = paperScreenTexture();
    const mat = new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.92, side: DoubleSide });
    const boxes: RoomBox[] = [];
    const W = 1.5;
    const H = 1.7;
    [-55, 0, 55].forEach((deg, k) => {
      const yaw = baseYaw + (deg * Math.PI) / 180;
      const d = 2.1;
      const cx = head.x - Math.sin(yaw) * d;
      const cz = head.z - Math.cos(yaw) * d;
      const screen = new Mesh(new PlaneGeometry(W, H), mat);
      screen.position.set(cx, floorY + H / 2, cz);
      screen.rotation.y = yaw;
      group.add(screen);
      boxes.push({ id: `paper-screen-${k}`, label: 'screen', center: vec(cx, floorY + H / 2, cz), half: vec(W / 2, H / 2, 0.03), yaw });
    });
    this.world.createTransformEntity(group);
    this.paper = group;
    const R = 3.4;
    const sq = (y: number) => [vec(head.x - R, y, head.z - R), vec(head.x + R, y, head.z - R), vec(head.x + R, y, head.z + R), vec(head.x - R, y, head.z + R)];
    this.ceiling = { origin: new Vector3(head.x, ceilingY, head.z), xAxis: new Vector3(1, 0, 0), zAxis: new Vector3(0, 0, 1) };
    this.tmpM.identity();
    return {
      name: 'paper room (fallback)',
      planes: [
        { id: 'paper-floor', orientation: 'horizontal', normal: vec(0, 1, 0), corners: sq(floorY) },
        { id: 'paper-ceiling', orientation: 'horizontal', normal: vec(0, -1, 0), corners: sq(ceilingY) },
      ],
      boxes,
    };
  }
}

function paperScreenTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 288;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f3ead8';
  g.fillRect(0, 0, 256, 288);
  g.strokeStyle = '#3b2a1c';
  g.lineWidth = 10;
  g.strokeRect(5, 5, 246, 278);
  g.lineWidth = 4;
  for (let x = 64; x < 256; x += 64) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 288);
    g.stroke();
  }
  for (let y = 72; y < 288; y += 72) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
