// Driver side of the film recorder: record takes (e2e/film-page.mjs, one
// browser-run lease each, at most 100 s). Start the dev server with
// `--screenshot-width 1920 --screenshot-height 1080` so the agent-mode page, and
// with it IWER's XR canvas, is 1920x1080.
// Only the runtime bridge (xr / ecs CLI) is used while a take records, because the
// recorder owns the browser-run slot.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, sleep } from './lib.mjs';

const BIN = join(APP, 'node_modules', '.bin', 'iwsdk');

/** Start a take recording into `dir`; returns { t0, at(ms), stop() }. */
export async function startTake(dir, maxSeconds = 100) {
  const child = spawn(BIN, ['browser', 'run', 'e2e/film-page.mjs', '--timeout', String((maxSeconds + 8) * 1000)], {
    cwd: APP,
    env: { ...process.env, PHENGOS_FILM_DIR: dir, PHENGOS_FILM_MAX_SECONDS: String(maxSeconds) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve({ code, out })));
  const t = Date.now();
  while (!existsSync(join(dir, 'started'))) {
    if (Date.now() - t > 30_000) throw new Error(`take did not start: ${out}`);
    await sleep(50);
  }
  const t0 = Date.now();
  return {
    dir,
    t0,
    started: JSON.parse(readFileSync(join(dir, 'started'), 'utf8')),
    async at(ms) {
      const w = t0 + ms - Date.now();
      if (w > 0) await sleep(w);
    },
    elapsed: () => Date.now() - t0,
    async stop() {
      writeFileSync(join(dir, 'stop'), '1');
      const r = await exited;
      if (!existsSync(join(dir, 'done'))) throw new Error(`take failed: ${r.out.slice(-800)}`);
      return JSON.parse(readFileSync(join(dir, 'done'), 'utf8'));
    },
  };
}

/** The newest frame of a running take (for stills). */
export function latestFrame(takeDir) {
  const f = readdirSync(takeDir).filter((x) => x.endsWith('.jpg')).sort();
  return f.length ? join(takeDir, f[f.length - 1]) : null;
}
