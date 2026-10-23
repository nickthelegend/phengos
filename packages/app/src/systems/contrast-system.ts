/**
 * High-contrast room. Apps cannot read or recolour passthrough pixels, so this
 * mode is geometry only: the real room's detected planes and furniture volumes
 * are redrawn as thick white or yellow outlines over a dimming layer, and the
 * lights become large solid yellow glows. One draw call for all outlines.
 */
import { BackSide, BufferAttribute, BufferGeometry, createSystem, Mesh, MeshBasicMaterial, SphereGeometry } from '@iwsdk/core';
import { type RoomBox, type Vec3, fromBoxLocal, vec } from '@phengos/core';
import { globalsOf, STORE_KEY, type Store } from '../game/store.js';
import { setHighContrast } from '../game/visuals.js';
import type { Room } from '@phengos/core';

const THICK = 0.018;

export class ContrastSystem extends createSystem({}) {
  private store!: Store;
  private dim!: Mesh;
  private outlines: Mesh | null = null;
  private outlineMat = new MeshBasicMaterial({ color: '#e6ff4f', transparent: true, depthTest: false });
  private builtFor: Room | null = null;
  private applied = 'off';
  private appliedLights = new Set<string>();

  init(): void {
    this.store = this.world.globals[STORE_KEY] as Store;
    this.dim = new Mesh(
      new SphereGeometry(9, 24, 12),
      new MeshBasicMaterial({ color: '#050608', side: BackSide, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false }),
    );
    this.dim.name = 'contrast-dim';
    this.dim.renderOrder = -10;
    this.dim.visible = false;
    this.world.createTransformEntity(this.dim, { persistent: true });
  }

  private build(room: Room): void {
    const segs: Array<[Vec3, Vec3]> = [];
    for (const p of room.planes) {
      for (let i = 0; i < p.corners.length; i++) segs.push([p.corners[i]!, p.corners[(i + 1) % p.corners.length]!]);
    }
    for (const b of room.boxes) segs.push(...boxEdges(b));
    const geo = prisms(segs, THICK);
    if (this.outlines) {
      this.outlines.geometry.dispose();
      this.outlines.geometry = geo;
    } else {
      this.outlines = new Mesh(geo, this.outlineMat);
      this.outlines.name = 'contrast-outlines';
      this.outlines.renderOrder = -5;
      this.outlines.frustumCulled = false;
      this.world.createTransformEntity(this.outlines, { persistent: true });
    }
    this.builtFor = room;
  }

  update(): void {
    const s = this.store;
    const mode = s.settings.contrast;
    if (s.room && s.room !== this.builtFor) this.build(s.room);
    const on = mode !== 'off' && s.inXR;
    this.dim.visible = on;
    if (this.outlines) this.outlines.visible = on;
    if (on) {
      this.player.head.getWorldPosition(this.dim.position);
      this.outlineMat.color.set(mode === 'white' ? '#fafafa' : '#e6ff4f');
    }
    // Lights: switch materials when the mode changes or new lights spawn.
    const want = mode !== 'off' ? 'on' : 'off';
    const lights = globalsOf(this.world).lightVisuals;
    if (!lights) return;
    if (want !== this.applied) {
      this.applied = want;
      this.appliedLights.clear();
    }
    for (const [id, v] of lights) {
      if (this.appliedLights.has(id)) continue;
      setHighContrast(v, want === 'on');
      this.appliedLights.add(id);
    }
  }
}

function boxEdges(b: RoomBox): Array<[Vec3, Vec3]> {
  const c = (x: number, y: number, z: number) => fromBoxLocal(b, vec(x * b.half.x, y * b.half.y, z * b.half.z));
  const pts = [c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1), c(-1, 1, -1), c(1, 1, -1), c(1, 1, 1), c(-1, 1, 1)];
  const idx: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  return idx.map(([a, b2]) => [pts[a]!, pts[b2]!]);
}

/** Each segment becomes a square prism (8 vertices, 12 triangles). */
function prisms(segs: Array<[Vec3, Vec3]>, t: number): BufferGeometry {
  const pos = new Float32Array(segs.length * 8 * 3);
  const index: number[] = [];
  const faces = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  segs.forEach(([a, b], k) => {
    const d = vec(b.x - a.x, b.y - a.y, b.z - a.z);
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    const dir = vec(d.x / len, d.y / len, d.z / len);
    const ref = Math.abs(dir.y) < 0.9 ? vec(0, 1, 0) : vec(1, 0, 0);
    let u = vec(dir.y * ref.z - dir.z * ref.y, dir.z * ref.x - dir.x * ref.z, dir.x * ref.y - dir.y * ref.x);
    const ul = Math.hypot(u.x, u.y, u.z) || 1;
    u = vec((u.x / ul) * t, (u.y / ul) * t, (u.z / ul) * t);
    let w = vec(dir.y * u.z - dir.z * u.y, dir.z * u.x - dir.x * u.z, dir.x * u.y - dir.y * u.x);
    const wl = Math.hypot(w.x, w.y, w.z) || 1;
    w = vec((w.x / wl) * t, (w.y / wl) * t, (w.z / wl) * t);
    const corners = [
      [-1, -1], [1, -1], [1, 1], [-1, 1],
    ] as const;
    let o = k * 24;
    for (const end of [a, b]) {
      for (const [cu, cw] of corners) {
        pos[o++] = end.x + u.x * cu + w.x * cw;
        pos[o++] = end.y + u.y * cu + w.y * cw;
        pos[o++] = end.z + u.z * cu + w.z * cw;
      }
    }
    for (const f of faces) index.push(k * 8 + f);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

