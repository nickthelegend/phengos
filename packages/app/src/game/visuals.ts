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
  type Intersection,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  type Raycaster,
  RingGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';

/** Billboard width of a hidden light, metres. Big enough to read from the seat across a room. */
export const LIGHT_SIZE = 1.0;
/** The lantern on your palm. */
export const PALM_SIZE = 0.34;
/** Fraction of the billboard (radius, in UV) that a hand ray can hit: the lantern, not the outer glow. */
const HIT_RADIUS_UV = 0.3;

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
  glow.addColorStop(0, 'rgba(255,248,220,1)');
  glow.addColorStop(0.3, 'rgba(255,214,120,0.95)');
  glow.addColorStop(0.55, 'rgba(255,170,70,0.45)');
  glow.addColorStop(0.8, 'rgba(255,150,60,0.12)');
  glow.addColorStop(1, 'rgba(255,140,50,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 256, 256);
  // The lantern: a round paper body with ribs and dark caps, lit from inside.
  g.save();
  g.beginPath();
  g.ellipse(128, 128, 50, 64, 0, 0, Math.PI * 2);
  g.clip();
  const body = g.createRadialGradient(124, 120, 4, 128, 128, 62);
  body.addColorStop(0, '#fffaf0');
  body.addColorStop(0.45, '#ffe2a8');
  body.addColorStop(1, '#ff9a3c');
  g.fillStyle = body;
  g.fillRect(70, 56, 116, 144);
  g.strokeStyle = 'rgba(170,90,30,0.4)';
  g.lineWidth = 3;
  for (let y = 74; y < 190; y += 12) {
    g.beginPath();
    g.ellipse(128, y, 52, 4, 0, 0, Math.PI);
    g.stroke();
  }
  g.restore();
  g.fillStyle = '#2a1a10';
  g.fillRect(110, 58, 36, 10);
  g.fillRect(110, 188, 36, 10);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

let shared: {
  quad: PlaneGeometry;
  burstGeo: RingGeometry;
  ringGeo: RingGeometry;
  glow: CanvasTexture;
  solid: CanvasTexture;
  star: CanvasTexture;
} | null = null;

function assets() {
  if (shared) return shared;
  shared = {
    quad: new PlaneGeometry(1, 1),
    burstGeo: new RingGeometry(0.42, 0.5, 64, 1),
    ringGeo: new RingGeometry(0.22, 0.255, 64, 1),
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
  haloMat.toneMapped = false;
  const halo = new Mesh(a.quad, haloMat);
  halo.name = `${name}-glow`;
  halo.scale.setScalar(LIGHT_SIZE);
  // A hand ray hits the lantern itself, not the wide glow, so neighbours stay separate targets.
  const meshRaycast = Mesh.prototype.raycast;
  halo.raycast = (raycaster: Raycaster, hits: Intersection[]) => {
    const before = hits.length;
    meshRaycast.call(halo, raycaster, hits);
    for (let i = hits.length - 1; i >= before; i--) {
      const uv = hits[i]!.uv;
      if (uv && Math.hypot(uv.x - 0.5, uv.y - 0.5) > HIT_RADIUS_UV) hits.splice(i, 1);
    }
  };
  // Drawn before the panels, so a light behind the HUD never paints over its text.
  halo.renderOrder = -2;
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
  const geo = new RingGeometry(0.052, 0.07, segs, 1, Math.PI / 2, -Math.PI * 2);
  const mat = new MeshBasicMaterial({ color: COLORS.firefly, transparent: true, depthTest: false, side: DoubleSide });
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = 20;
  const baseMat = new MeshBasicMaterial({ color: COLORS.white, transparent: true, opacity: 0.55, depthTest: false, side: DoubleSide });
  const base = new Mesh(new RingGeometry(0.014, 0.022, 32), baseMat);
  base.renderOrder = 20;
  const ring2 = new Mesh(new RingGeometry(0.068, 0.074, 64), new MeshBasicMaterial({ color: COLORS.night, transparent: true, opacity: 0.6, depthTest: false, side: DoubleSide }));
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
  const v = new Float32Array([0, 0.06, 0, -0.06, -0.04, 0, 0, -0.01, 0, 0, 0.06, 0, 0, -0.01, 0, 0.06, -0.04, 0]);
  geo.setAttribute('position', new BufferAttribute(v, 3));
  const m = new Mesh(geo, new MeshBasicMaterial({ color: COLORS.firefly, transparent: true, depthTest: false, side: DoubleSide }));
  m.renderOrder = 21;
  m.visible = false;
  return m;
}

/** A four-point star painted into a soft glow, for the ceiling constellation. */
function starTexture(): CanvasTexture {
  const [c, g] = canvas(128, 128);
  const glow = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.16, 'rgba(255,252,225,1)');
  glow.addColorStop(0.3, 'rgba(255,235,170,0.6)');
  glow.addColorStop(0.6, 'rgba(255,225,150,0.18)');
  glow.addColorStop(1, 'rgba(255,220,140,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  for (const [w, h] of [
    [8, 62],
    [62, 8],
  ] as const) {
    const ray = g.createRadialGradient(64, 64, 0, 64, 64, 60);
    ray.addColorStop(0, 'rgba(255,255,240,1)');
    ray.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = ray;
    g.beginPath();
    g.ellipse(64, 64, w, h, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export interface StarField {
  mesh: Mesh;
  geometry: BufferGeometry;
  /** Star i lies flat on the ceiling at (x, y, z), `size` metres across, tinted. */
  set(i: number, x: number, y: number, z: number, size: number, r: number, g: number, b: number): void;
  setCount(n: number): void;
}

/**
 * All ceiling stars in one draw call: flat star sprites lying on the ceiling
 * (you look up at them), sized in metres so they read from the seat. A points
 * primitive is capped to a few pixels in WebXR, too small to see.
 */
export function createStarField(max: number): StarField {
  const geometry = new BufferGeometry();
  const pos = new Float32Array(max * 4 * 3);
  const col = new Float32Array(max * 4 * 3);
  const uv = new Float32Array(max * 4 * 2);
  const index = new Uint32Array(max * 6);
  for (let i = 0; i < max; i++) {
    uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('color', new BufferAttribute(col, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.setDrawRange(0, 0);
  const material = new MeshBasicMaterial({
    map: starTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
  material.toneMapped = false;
  const mesh = new Mesh(geometry, material);
  mesh.name = 'ceiling-constellation';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ] as const;
  return {
    mesh,
    geometry,
    set(i, x, y, z, size, r, g, b) {
      corners.forEach(([u, v], j) => {
        const k = (i * 4 + j) * 3;
        pos[k] = x + u * size;
        pos[k + 1] = y;
        pos[k + 2] = z + v * size;
        col[k] = r;
        col[k + 1] = g;
        col[k + 2] = b;
      });
    },
    setCount(n) {
      geometry.setDrawRange(0, n * 6);
      geometry.getAttribute('position').needsUpdate = true;
      geometry.getAttribute('color').needsUpdate = true;
    },
  };
}

// ---------- the catch payoff ----------

/** A flat shock ring that grows and fades where a light was caught (and on your palm when it lands). */
export function createBurst(color: Color = COLORS.firefly): { mesh: Mesh; mat: MeshBasicMaterial } {
  const mat = new MeshBasicMaterial({
    color,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
  mat.toneMapped = false;
  const mesh = new Mesh(assets().burstGeo, mat);
  mesh.renderOrder = 12;
  mesh.name = 'catch-burst';
  return { mesh, mat };
}

/** A bright star sprite (billboard): the light's flash, and the star's landing flash on the ceiling. */
export function createFlash(): { mesh: Mesh; mat: MeshBasicMaterial } {
  const mat = new MeshBasicMaterial({
    map: assets().star,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
  mat.toneMapped = false;
  const mesh = new Mesh(assets().quad, mat);
  mesh.renderOrder = 13;
  mesh.name = 'star-flash';
  return { mesh, mat };
}

/** A spark trail behind a flying light: one draw call, the oldest sparks fade out. */
export function createTrail(n = 28): { points: Points; push: (x: number, y: number, z: number) => void; dispose: () => void } {
  const geometry = new BufferGeometry();
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('color', new BufferAttribute(col, 3));
  geometry.setDrawRange(0, 0);
  const material = new PointsMaterial({
    size: 0.09,
    map: assets().star,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    sizeAttenuation: true,
  });
  material.toneMapped = false;
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 11;
  points.name = 'catch-trail';
  let count = 0;
  const push = (x: number, y: number, z: number) => {
    pos.copyWithin(3, 0, (n - 1) * 3);
    pos[0] = x;
    pos[1] = y;
    pos[2] = z;
    count = Math.min(n, count + 1);
    for (let i = 0; i < count; i++) {
      const f = Math.pow(1 - i / n, 1.6);
      col[i * 3] = 1.0 * f;
      col[i * 3 + 1] = 0.86 * f;
      col[i * 3 + 2] = 0.45 * f;
    }
    geometry.setDrawRange(0, count);
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('color').needsUpdate = true;
  };
  return { points, push, dispose: () => (geometry.dispose(), material.dispose()) };
}

/**
 * Constellation lines on the ceiling: flat glowing ribbons (a line primitive is
 * one pixel wide in WebXR, too thin to see), all in one draw call.
 */
export function createConstellationLines(maxLines: number): { mesh: Mesh; geometry: BufferGeometry } {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(maxLines * 4 * 3), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(maxLines * 4 * 3), 3));
  const index = new Uint32Array(maxLines * 6);
  for (let i = 0; i < maxLines; i++) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.setDrawRange(0, 0);
  const material = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
  material.toneMapped = false;
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'constellation-lines';
  mesh.renderOrder = 3;
  return { mesh, geometry };
}
