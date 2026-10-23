/**
 * Procedural visuals: paper lanterns, their glow halos, outline rings, the
 * dwell ring, the hint chevron and the ceiling stars. Everything is generated
 * here (canvas textures, lathe geometry), so there are no binary assets.
 *
 * Lantern and halo use MeshBasicMaterial on purpose: IWSDK's depth occlusion
 * injects into the standard basic-material shader, so a light really disappears
 * behind your real couch.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  SRGBColorSpace,
  Vector2,
} from '@iwsdk/core';

export const COLORS = {
  night: new Color('#050608'),
  white: new Color('#fafafa'),
  firefly: new Color('#e6ff4f'),
  focus: new Color('#3d8bff'),
  paper: new Color('#ffd9a0'),
  ember: new Color('#ffb347'),
};

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

/** Washi paper with vertical ribs and a warm centre. */
function paperTexture(): CanvasTexture {
  const [c, g] = canvas(256, 128);
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#ffb35a');
  grad.addColorStop(0.5, '#fff1cf');
  grad.addColorStop(1, '#ffa94a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  g.globalAlpha = 0.28;
  g.fillStyle = '#b4641c';
  for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 3, 128);
  g.globalAlpha = 0.08;
  for (let i = 0; i < 400; i++) {
    g.fillStyle = i % 2 ? '#ffffff' : '#c27a2c';
    g.fillRect((i * 97) % 256, (i * 57) % 128, 2, 1);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function radialTexture(stops: Array<[number, string]>): CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

let shared: {
  lanternGeo: LatheGeometry;
  capGeo: LatheGeometry;
  haloGeo: PlaneGeometry;
  ringGeo: RingGeometry;
  paper: CanvasTexture;
  halo: CanvasTexture;
  haloSolid: CanvasTexture;
  star: CanvasTexture;
} | null = null;

function assets() {
  if (shared) return shared;
  // A round paper lantern, 15 cm tall.
  const profile: Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const y = (t - 0.5) * 0.15;
    const r = 0.012 + Math.sin(t * Math.PI) * 0.058;
    profile.push(new Vector2(r, y));
  }
  const capProfile = [new Vector2(0.0, 0.006), new Vector2(0.02, 0.006), new Vector2(0.022, 0), new Vector2(0.0, 0)];
  shared = {
    lanternGeo: new LatheGeometry(profile, 16),
    capGeo: new LatheGeometry(capProfile, 12),
    haloGeo: new PlaneGeometry(1, 1),
    ringGeo: new RingGeometry(0.115, 0.135, 48, 1),
    paper: paperTexture(),
    halo: radialTexture([
      [0, 'rgba(255,236,190,0.95)'],
      [0.18, 'rgba(255,196,110,0.55)'],
      [0.45, 'rgba(255,160,70,0.16)'],
      [1, 'rgba(255,140,50,0)'],
    ]),
    haloSolid: radialTexture([
      [0, 'rgba(230,255,79,1)'],
      [0.55, 'rgba(230,255,79,1)'],
      [0.62, 'rgba(230,255,79,0.6)'],
      [1, 'rgba(230,255,79,0)'],
    ]),
    star: radialTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.2, 'rgba(255,246,200,0.9)'],
      [0.5, 'rgba(255,220,140,0.25)'],
      [1, 'rgba(255,220,140,0)'],
    ]),
  };
  return shared;
}

export interface LightVisual {
  root: Group;
  lantern: Mesh;
  halo: Mesh;
  ring: Mesh;
  lanternMat: MeshBasicMaterial;
  haloMat: MeshBasicMaterial;
  ringMat: MeshBasicMaterial;
}

/** One paper light: lantern, glow halo (billboarded by the game) and an outline ring. */
export function createLightVisual(name: string): LightVisual {
  const a = assets();
  const root = new Group();
  root.name = name;
  const lanternMat = new MeshBasicMaterial({ map: a.paper, color: 0xffffff, transparent: true });
  const lantern = new Mesh(a.lanternGeo, lanternMat);
  lantern.name = `${name}-lantern`;
  const capMat = new MeshBasicMaterial({ color: 0x2a1a10 });
  const capTop = new Mesh(a.capGeo, capMat);
  capTop.position.y = 0.075;
  lantern.add(capTop);
  const haloMat = new MeshBasicMaterial({
    map: a.halo,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const halo = new Mesh(a.haloGeo, haloMat);
  halo.name = `${name}-halo`;
  halo.scale.setScalar(0.5);
  halo.renderOrder = 2;
  const ringMat = new MeshBasicMaterial({ color: COLORS.focus, transparent: true, depthTest: false, side: DoubleSide });
  const ring = new Mesh(a.ringGeo, ringMat);
  ring.name = `${name}-ring`;
  ring.visible = false;
  ring.renderOrder = 10;
  root.add(lantern, halo);
  return { root, lantern, halo, ring, lanternMat, haloMat, ringMat };
}

export function setHighContrast(v: LightVisual, on: boolean): void {
  const a = assets();
  v.haloMat.map = on ? a.haloSolid : a.halo;
  v.haloMat.blending = on ? 1 /* NormalBlending */ : AdditiveBlending;
  v.haloMat.needsUpdate = true;
  v.lanternMat.color.copy(on ? COLORS.firefly : COLORS.white);
  v.lanternMat.map = on ? null : a.paper;
  v.lanternMat.needsUpdate = true;
}

/** Dwell ring that fills clockwise: drawRange over a ring of 64 segments. */
export function createDwellRing(): { mesh: Mesh; setProgress: (p: number) => void; base: Mesh } {
  const segs = 64;
  const geo = new RingGeometry(0.022, 0.03, segs, 1, Math.PI / 2, -Math.PI * 2);
  const mat = new MeshBasicMaterial({ color: COLORS.firefly, transparent: true, depthTest: false, side: DoubleSide });
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = 20;
  const baseMat = new MeshBasicMaterial({ color: COLORS.white, transparent: true, opacity: 0.55, depthTest: false, side: DoubleSide });
  const base = new Mesh(new RingGeometry(0.008, 0.012, 32), baseMat);
  base.renderOrder = 20;
  const ring2 = new Mesh(new RingGeometry(0.0285, 0.031, 64), new MeshBasicMaterial({ color: COLORS.night, transparent: true, opacity: 0.6, depthTest: false, side: DoubleSide }));
  ring2.renderOrder = 19;
  base.add(ring2);
  const setProgress = (p: number) => {
    const n = Math.round(Math.min(1, Math.max(0, p)) * segs);
    geo.setDrawRange(0, n * 6);
    mesh.visible = n > 0;
  };
  setProgress(0);
  return { mesh, setProgress, base };
}

/** A flat chevron for the hint arrow. */
export function createChevron(): Mesh {
  const geo = new BufferGeometry();
  const v = new Float32Array([0, 0.03, 0, -0.03, -0.02, 0, 0, -0.005, 0, 0, 0.03, 0, 0, -0.005, 0, 0.03, -0.02, 0]);
  geo.setAttribute('position', new BufferAttribute(v, 3));
  const m = new Mesh(geo, new MeshBasicMaterial({ color: COLORS.firefly, transparent: true, depthTest: false, side: DoubleSide }));
  m.renderOrder = 21;
  m.visible = false;
  return m;
}

/** All ceiling stars in one draw call. */
export function createStarField(max: number): { points: Points; geometry: BufferGeometry } {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(max * 3), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(max * 3), 3));
  geometry.setDrawRange(0, 0);
  const material = new PointsMaterial({
    size: 0.09,
    map: assets().star,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new Points(geometry, material);
  points.name = 'ceiling-constellation';
  points.frustumCulled = false;
  return { points, geometry };
}
