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
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  SRGBColorSpace,
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

/**
 * One light is ONE billboard: a paper lantern painted into its own warm glow.
 * Twelve lights cost twelve draw calls, and the quad's depth still lets the
 * real couch hide the light (hard depth occlusion per fragment).
 */
function lanternGlowTexture(): CanvasTexture {
  const [c, g] = canvas(256, 256);
  const glow = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  glow.addColorStop(0, 'rgba(255,240,200,1)');
  glow.addColorStop(0.28, 'rgba(255,200,110,0.8)');
  glow.addColorStop(0.55, 'rgba(255,165,70,0.3)');
  glow.addColorStop(1, 'rgba(255,140,50,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 256, 256);
  // The lantern: a round paper body with ribs and dark caps, lit from inside.
  g.save();
  g.beginPath();
  g.ellipse(128, 128, 40, 52, 0, 0, Math.PI * 2);
  g.clip();
  const body = g.createRadialGradient(124, 122, 4, 128, 128, 48);
  body.addColorStop(0, '#fffaf0');
  body.addColorStop(0.45, '#ffe2a8');
  body.addColorStop(1, '#ff9a3c');
  g.fillStyle = body;
  g.fillRect(70, 70, 116, 116);
  g.strokeStyle = 'rgba(170,90,30,0.35)';
  g.lineWidth = 2;
  for (let y = 84; y < 178; y += 10) {
    g.beginPath();
    g.ellipse(128, y, 42, 3, 0, 0, Math.PI);
    g.stroke();
  }
  g.restore();
  g.fillStyle = '#2a1a10';
  g.fillRect(114, 72, 28, 8);
  g.fillRect(114, 176, 28, 8);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

let shared: {
  quad: PlaneGeometry;
  ringGeo: RingGeometry;
  glow: CanvasTexture;
  solid: CanvasTexture;
  star: CanvasTexture;
} | null = null;

function assets() {
  if (shared) return shared;
  shared = {
    quad: new PlaneGeometry(1, 1),
    ringGeo: new RingGeometry(0.115, 0.135, 48, 1),
    glow: lanternGlowTexture(),
    solid: radialTexture([
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
  /** The billboard (lantern painted into its glow). */
  halo: Mesh;
  ring: Mesh;
  haloMat: MeshBasicMaterial;
  ringMat: MeshBasicMaterial;
}

/** One paper light: a billboarded lantern glow, plus an outline ring for highlights. */
export function createLightVisual(name: string): LightVisual {
  const a = assets();
  const root = new Group();
  root.name = name;
  const haloMat = new MeshBasicMaterial({
    map: a.glow,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const halo = new Mesh(a.quad, haloMat);
  halo.name = `${name}-glow`;
  halo.scale.setScalar(0.55);
  halo.renderOrder = 2;
  const ringMat = new MeshBasicMaterial({ color: COLORS.focus, transparent: true, depthTest: false, side: DoubleSide });
  const ring = new Mesh(a.ringGeo, ringMat);
  ring.name = `${name}-ring`;
  ring.visible = false;
  ring.renderOrder = 10;
  root.add(halo);
  return { root, halo, ring, haloMat, ringMat };
}

export function setHighContrast(v: LightVisual, on: boolean): void {
  const a = assets();
  v.haloMat.map = on ? a.solid : a.glow;
  v.haloMat.needsUpdate = true;
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
