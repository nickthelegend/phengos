/**
 * In-app frame timing for the M1 gate: CPU time per frame = ECS systems + the
 * render call, from performance.now(), plus renderer.info draw calls and
 * triangles. A relative proxy measured in a desktop browser under IWER, not a
 * headset measurement.
 */
import { createSystem } from '@iwsdk/core';
import { PerfStats } from '../components.js';

const WINDOW = 600;

class PerfState {
  samples = new Float32Array(WINDOW);
  calls = new Int32Array(WINDOW);
  tris = new Int32Array(WINDOW);
  n = 0;
  i = 0;
  frameStart = 0;
  sysEnd = 0;
  reset(): void {
    this.n = 0;
    this.i = 0;
  }
  report() {
    const k = Math.min(this.n, WINDOW);
    const cpu = Array.from(this.samples.slice(0, k)).sort((a, b) => a - b);
    const q = (p: number) => (k ? cpu[Math.min(k - 1, Math.floor(p * k))]! : 0);
    const calls = Array.from(this.calls.slice(0, k));
    const tris = Array.from(this.tris.slice(0, k));
    return {
      frames: this.n,
      window: k,
      cpuP50: +q(0.5).toFixed(3),
      cpuP95: +q(0.95).toFixed(3),
      cpuMax: +(cpu[k - 1] ?? 0).toFixed(3),
      drawCallsMax: Math.max(0, ...calls),
      drawCallsP95: [...calls].sort((a, b) => a - b)[Math.floor(0.95 * k)] ?? 0,
      trianglesMax: Math.max(0, ...tris),
      note: 'relative proxy (desktop Chrome + IWER), unverified on hardware',
    };
  }
}

export const perf = new PerfState();

export class PerfBeginSystem extends createSystem({}) {
  init(): void {
    const r = this.renderer;
    const render = r.render.bind(r);
    r.render = (scene, camera) => {
      const t = performance.now();
      render(scene, camera);
      const end = performance.now();
      const sys = perf.sysEnd > perf.frameStart ? perf.sysEnd - perf.frameStart : 0;
      perf.samples[perf.i] = sys + (end - t);
      perf.calls[perf.i] = r.info.render.calls;
      perf.tris[perf.i] = r.info.render.triangles;
      perf.i = (perf.i + 1) % WINDOW;
      perf.n++;
    };
    (window as unknown as { __phengosPerf: PerfState }).__phengosPerf = perf;
    this.cleanupFuncs.push(() => {
      r.render = render;
    });
  }
  update(): void {
    perf.frameStart = performance.now();
  }
}

export class PerfEndSystem extends createSystem({ stats: { required: [PerfStats] } }) {
  private frame = 0;
  init(): void {
    this.world.createEntity().addComponent(PerfStats, {});
  }
  update(): void {
    perf.sysEnd = performance.now();
    if (++this.frame % 60 !== 0) return;
    const r = perf.report();
    for (const e of this.queries.stats.entities) {
      e.setValue(PerfStats, 'frames', r.frames);
      e.setValue(PerfStats, 'cpuP50', r.cpuP50);
      e.setValue(PerfStats, 'cpuP95', r.cpuP95);
      e.setValue(PerfStats, 'drawCalls', perf.calls[(perf.i + WINDOW - 1) % WINDOW] ?? 0);
      e.setValue(PerfStats, 'drawCallsMax', r.drawCallsMax);
      e.setValue(PerfStats, 'triangles', perf.tris[(perf.i + WINDOW - 1) % WINDOW] ?? 0);
      e.setValue(PerfStats, 'trianglesMax', r.trianglesMax);
    }
  }
}
