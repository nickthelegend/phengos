// Shared helpers for the Phengos e2e scripts. Everything goes through the IWSDK
// CLI (the same surface as the MCP tools): real app code, emulated devices
// (IWER), no mocked app logic.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(APP, 'node_modules', '.bin', 'iwsdk');
export const OUT = join(APP, '..', '..', 'e2e', 'out');
mkdirSync(OUT, { recursive: true });

export function cli(command, input, { timeout = 90_000, raw = false } = {}) {
  const args = command.split(' ');
  if (input !== undefined) args.push('--input-json', JSON.stringify(input));
  let out;
  try {
    out = execFileSync(BIN, args, { cwd: APP, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024 });
  } catch (err) {
    out = String(err.stdout ?? '');
    if (!out.trim().startsWith('{')) throw new Error(`iwsdk ${command} failed: ${err.message}\n${err.stderr ?? ''}`);
  }
  const json = JSON.parse(out);
  if (raw) return json;
  if (!json.ok) throw new Error(`iwsdk ${command}: ${JSON.stringify(json.error ?? json).slice(0, 600)}`);
  return json.data;
}

/** Run Playwright code in the managed page (needs dev up --allow-browser-automation). */
export function inPage(fnSource, { timeout = 60_000 } = {}) {
  const dir = join(APP, '.tmp');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `run-${process.pid}-${Date.now()}.mjs`);
  writeFileSync(file, `export default async function run({ page }) { return await (${fnSource})(page); }\n`);
  try {
    const out = execFileSync(BIN, ['browser', 'run', file, '--timeout', String(timeout)], {
      cwd: APP,
      encoding: 'utf8',
      timeout: timeout + 30_000,
      maxBuffer: 256 * 1024 * 1024,
    });
    const json = JSON.parse(out);
    if (!json.ok) throw new Error(JSON.stringify(json.error).slice(0, 600));
    return json.data?.result ?? json.data;
  } finally {
    rmSync(file, { force: true });
  }
}

/** Read the store through the page's inspection handle. */
export function state() {
  return inPage(`async (page) => page.evaluate(() => {
    const s = window.__phengos.store;
    return {
      phase: s.phase, mode: s.settings.mode, modeChosen: s.modeChosen, roundIndex: s.roundIndex,
      caught: s.round ? s.round.caught : 0, total: s.round ? s.round.total : 0,
      lights: s.round ? s.round.lights.map((l) => ({ id: l.id, caught: l.caught, method: l.method, kind: l.spot.kind, host: l.spot.host, visible: l.spot.visible, p: l.spot.position })) : [],
      menuOpen: s.menuOpen, paused: s.paused, contrast: s.settings.contrast, scanItem: s.scanItem,
      dwellTarget: s.dwellTarget, dwellProgress: s.dwellProgress, voiceStatus: s.voiceStatus,
      transcript: s.transcript, lastVoiceCommands: s.lastVoiceCommands, lastCatchMethod: s.lastCatchMethod,
      gazeAvailable: s.gazeAvailable, lookLabel: s.lookLabel, roomSource: s.roomSource,
      head: s.head, stars: s.stars.length, caption: s.caption.text, outlined: s.outlined,
      controls: Object.fromEntries([...s.controlTargets].map(([id, t]) => {
        const v = t.object.getWorldPosition(new t.object.position.constructor());
        return [id, { x: v.x, y: v.y, z: v.z, visible: t.object.visible }];
      })),
      tabsVisible: !!(window.__phengos.world.getSceneObject('tabs') || {}).visible,
      menuVisible: !!(window.__phengos.world.getSceneObject('menu') || {}).visible,
    };
  })`);
}

export function goto(query = '') {
  return inPage(`async (page) => {
    const u = new URL(page.url());
    u.search = ${JSON.stringify(query)};
    await page.goto(u.href, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__phengos, null, { timeout: 30000 });
    return page.url();
  }`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(pred, { timeout = 30_000, every = 500, label = 'condition' } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = state();
    if (pred(last)) return last;
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${label}; last state: ${JSON.stringify(last).slice(0, 800)}`);
}

export function enterXR() {
  const st = cli('xr status');
  if (!st.sessionActive) cli('xr enter', {});
  const after = cli('xr status');
  if (!after.sessionActive) throw new Error(`XR session did not start: ${JSON.stringify(after).slice(0, 400)}`);
  return after;
}

/** Console errors since load (no level filter, then filter here so nothing hides). */
export function consoleErrors() {
  const logs = cli('browser logs', { count: 200 });
  const list = logs.logs ?? logs.entries ?? logs;
  return (Array.isArray(list) ? list : []).filter((l) => (l.level ?? l.type) === 'error');
}

export function check(results, name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
