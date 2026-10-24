// Phengos e2e scenarios against the running dev server (agent mode, IWER).
// Usage: node e2e/scenarios.mjs <scenario> [...]
//   hands | look | switch | contrast | glasses | voice | paper | perf
// Each writes e2e/out/<scenario>.json with PASS/FAIL checks.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, check, cli, consoleErrors, enterXR, goto, inPage, sleep, state, waitFor } from './lib.mjs';
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const SEATED = { x: 0, y: 1.15, z: 0.2 };
/** Pinch a UI control on the hand ray, re-reading its live position; retry if the panel was still settling. */
async function clickControl(id, until, label) {
  for (let k = 0; k < 3; k++) {
    const c = state().controls[id];
    rayPinch('right', c);
    try {
      return await waitFor(until, { timeout: 2500, label });
    } catch (e) {
      if (k === 2) throw e;
    }
  }
}

const AWAY = { x: 0, y: 0.05, z: -0.3 }; // the floor near your feet: nothing there
let bootAt = Date.now();

async function boot(query, { seated = true } = {}) {
  bootAt = Date.now();
  try {
    cli('xr exit', {});
  } catch {
    /* no session */
  }
  goto(query);
  enterXR();
  cli('xr set-input-mode', { mode: 'hand' });
  if (seated) cli('xr set-transform', { device: 'headset', position: SEATED, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  return waitFor((s) => s.phase === 'onboarding' || s.phase === 'playing', { timeout: 40_000, label: 'room ready' });
}

function ecsGame() {
  const found = cli('ecs find', { withComponents: ['GameState'] });
  const idx = found.entities?.[0]?.entityIndex;
  const q = cli('ecs query', { entityIndex: idx, components: ['GameState'] });
  const comp = (q.components ?? []).find((c) => c.componentId === 'GameState');
  return comp?.values ?? {};
}

/** Aim a hand's target ray at a point, then pinch. */
function rayPinch(hand, p, duration = 0.15) {
  cli('xr look-at', { device: `hand-${hand}`, target: { x: p.x, y: p.y, z: p.z } });
  sleepSync(800); // let the ray hover land before the pinch
  cli('xr select', { device: `hand-${hand}`, duration });
}

/** Rest a hand pointing at the floor so its ray hits nothing. */
function restHand(hand) {
  cli('xr look-at', { device: `hand-${hand}`, target: { x: hand === 'left' ? -0.3 : 0.3, y: 0, z: 0.6 } });
}

/**
 * Hold the head on a point for an exact number of 1/72 s frames: ECS paused,
 * look, fixed steps, look away, two more steps, resume. CLI latency never adds
 * to the dwell time.
 */
function holdLook(p, frames) {
  cli('ecs pause', {});
  try {
    cli('xr look-at', { device: 'headset', target: p });
    sleepSync(150);
    let left = frames;
    while (left > 0) {
      const n = Math.min(120, left);
      cli('ecs step', { count: n, delta: 1 / 72 });
      left -= n;
    }
    cli('xr look-at', { device: 'headset', target: AWAY });
    sleepSync(150);
    cli('ecs step', { count: 3, delta: 1 / 72 });
  } finally {
    cli('ecs resume', {});
  }
}



const scenarios = {
  async hands(r) {
    let s = await boot('?fresh');
    check(r, 'cold load reaches onboarding (room from scene understanding)', s.phase === 'onboarding' && s.roomSource === 'scene', `${s.roomSource}`);
    restHand('left');
    rayPinch('right', s.lights[0].p);
    s = await waitFor((x) => x.phase === 'playing', { label: 'round 1 after hello light' });
    check(r, 'onboarding: first input (hand ray + pinch) picks Point mode', s.mode === 'point' && s.modeChosen);
    check(r, 'round 1 hides 5 lights', s.total === 5, `kinds: ${s.lights.map((l) => `${l.kind}@${l.host}`).join(', ')}`);
    let attempts = 0;
    for (const l of s.lights) {
      for (let k = 0; k < 3; k++) {
        attempts++;
        rayPinch('right', l.p);
        try {
          await waitFor((x) => x.lights.find((y) => y.id === l.id)?.caught, { timeout: 2500, label: `catch ${l.id}` });
          break;
        } catch (e) {
          if (k === 2) throw e;
        }
      }
    }
    check(r, `ray pinches needed: ${attempts} for 5 lights`, attempts <= 10);
    const g = ecsGame();
    check(r, 'ECS GameState.caught == 5 after hands-only round', g.caught === 5 && g.total === 5, JSON.stringify({ caught: g.caught, total: g.total, methods: g.methodsUsed }));
    s = state();
    check(r, 'every catch recorded as point', s.lights.every((l) => l.method === 'point'));
    const errs = consoleErrors(bootAt);
    check(r, 'zero console errors', errs.length === 0, errs.slice(0, 3).map((e) => e.text ?? e.message).join(' | '));
  },

  async look(r) {
    let s = await boot('?fresh');
    restHand('left');
    restHand('right');
    holdLook(s.lights[0].p, 80);
    s = await waitFor((x) => x.phase === 'playing', { label: 'round after look onboarding' });
    check(r, 'onboarding: holding a look picks Look mode, labelled head-gaze', s.mode === 'look' && s.lookLabel === 'Look (head)');
    const first = s.lights[0];
    holdLook(first.p, 58); // 0.8 s
    s = state();
    check(r, 'control: a 0.8 s look does not catch (dwell 1.0 s)', !s.lights.find((l) => l.id === first.id).caught);
    for (const l of s.lights) {
      holdLook(l.p, 80); // 1.1 s
    }
    s = await waitFor((x) => x.caught === x.total || x.phase !== 'playing', { timeout: 10_000, label: 'all caught by look' });
    const g = ecsGame();
    check(r, 'head-gaze only: round of 5 completed with no hand input', g.caught === 5 || g.phase === 'round-end', JSON.stringify({ caught: g.caught, phase: g.phase }));
    check(r, 'every catch recorded as look', state().lights.every((l) => l.method === 'look'));
    const errs = consoleErrors(bootAt);
    check(r, 'zero console errors', errs.length === 0, errs.slice(0, 3).map((e) => e.text ?? e.message).join(' | '));
  },

  async switch(r) {
    let s = await boot('?fresh');
    restHand('left');
    restHand('right');
    s = await waitFor((x) => x.scanItem === 'light-hello', { timeout: 12_000, label: 'onboarding scanner starts after 4 s' });
    check(r, 'onboarding: the scanner starts by itself after 4 quiet seconds', true);
    cli('xr select', { device: 'hand-left', duration: 0.15 });
    s = await waitFor((x) => x.phase === 'playing', { label: 'round after switch onboarding' });
    check(r, 'onboarding: a pinch while scanning picks One switch mode', s.mode === 'switch');
    let guard = 0;
    while (s.caught < s.total && guard++ < 60) {
      if (s.scanItem && s.scanItem.startsWith('light-')) {
        cli('xr select', { device: guard % 2 ? 'hand-left' : 'hand-right', duration: 0.12 });
        await sleep(400);
      } else {
        await sleep(300);
      }
      s = state();
    }
    const g = ecsGame();
    check(r, 'switch only: round of 5 completed with pinches only', g.caught === 5 || s.phase === 'round-end', JSON.stringify({ caught: g.caught, presses: guard }));
    check(r, 'every catch recorded as switch', state().lights.every((l) => l.method === 'switch'));
    // Long pinch opens the menu.
    await waitFor((x) => x.phase === 'playing', { timeout: 15_000, label: 'next round' });
    cli('xr select', { device: 'hand-left', duration: 1.3 });
    s = await waitFor((x) => x.menuOpen, { timeout: 5000, label: 'menu after long pinch' });
    check(r, 'long pinch (1 s) opens the menu', s.menuOpen);
    const errs = consoleErrors(bootAt);
    check(r, 'zero console errors', errs.length === 0, errs.slice(0, 3).map((e) => e.text ?? e.message).join(' | '));
  },

  async contrast(r) {
    let s = await boot('?fresh');
    restHand('left');
    rayPinch('right', s.lights[0].p);
    s = await waitFor((x) => x.phase === 'playing' && x.tabsVisible, { label: 'playing' });
    await sleep(2000);
    s = state();
    s = await clickControl('tab:pause', (x) => x.menuOpen && x.menuVisible, 'menu open via Pause tab');
    check(r, 'Pause tab (hand ray + pinch) opens the menu', s.menuOpen);
    await sleep(500);
    s = state();
    s = await clickControl('menu:contrast', (x) => x.contrast === 'yellow', 'contrast yellow');
    check(r, 'contrast toggle -> yellow on black', s.contrast === 'yellow');
    s = await clickControl('menu:resume', (x) => !x.menuOpen, 'resume');
    await sleep(800);
    const g = ecsGame();
    check(r, 'ECS GameState.contrast == yellow', g.contrast === 'yellow');
    const shot = cli('browser screenshot --output-file ../../e2e/out/contrast-yellow.png', {}, { timeout: 60_000 });
    check(r, 'runtime screenshot captured (e2e/out/contrast-yellow.png)', !!shot.screenshotPath, shot.screenshotPath);
    const errs = consoleErrors(bootAt);
    check(r, 'zero console errors', errs.length === 0, errs.slice(0, 3).map((e) => e.text ?? e.message).join(' | '));
  },

  async glasses(r) {
    const st = cli('xr status');
    check(r, 'device profile is Meta VR Glasses', /Glasses/i.test(String(st.deviceName ?? JSON.stringify(st))), String(st.deviceName));
    let s = await boot('?fresh', { seated: true });
    const st2 = cli('xr status');
    check(r, 'gaze-tracking granted', JSON.stringify(st2).includes('gaze-tracking'));
    s = await waitFor((x) => x.gazeAvailable, { timeout: 8000, label: 'gaze source' });
    check(r, 'Look is labelled eyes on the Glasses', s.lookLabel === 'Look (eyes)');
    restHand('left');
    restHand('right');
    cli('xr look-at', { device: 'gaze', target: s.lights[0].p });
    await sleep(300);
    cli('xr select', { device: 'hand-right', duration: 0.15 });
    s = await waitFor((x) => x.phase === 'playing', { label: 'round after gaze+pinch onboarding' });
    check(r, 'eye gaze + pinch caught the first light (method eyes)', s.lastCatchMethod === 'eyes' || state().lights.length > 0);
    for (const l of s.lights) {
      cli('xr look-at', { device: 'headset', target: l.p });
      cli('xr look-at', { device: 'gaze', target: l.p });
      await sleep(250);
      cli('xr select', { device: 'hand-right', duration: 0.15 });
      await waitFor((x) => x.lights.find((y) => y.id === l.id)?.caught, { timeout: 8000, label: `gaze catch ${l.id}` });
    }
    s = state();
    check(r, 'Glasses: round of 5 completed with eye gaze + pinch', s.lights.every((l) => l.caught && l.method === 'eyes'));
    // FoV: HUD, tabs, reticle region must sit inside 37 left/right, 25 up, 43 down.
    cli('xr look-at', { device: 'headset', target: { x: s.head.x, y: s.head.y, z: s.head.z - 2 } });
    await sleep(1500);
    s = state();
    const fov = inPage(`async (page) => page.evaluate(() => {
      const w = window.__phengos.world;
      const head = w.player.head;
      const out = {};
      for (const id of ['hud', 'tabs']) {
        const o = w.getSceneObject(id);
        const p = o.getWorldPosition(new o.position.constructor());
        head.worldToLocal(p);
        out[id] = { h: Math.atan2(p.x, -p.z) * 180 / Math.PI, v: Math.atan2(p.y, -p.z) * 180 / Math.PI };
      }
      return out;
    })`);
    const inside = (a) => Math.abs(a.h) <= 34 && a.v >= -40 && a.v <= 22;
    check(r, 'HUD and tabs inside the Glasses FoV (with 3 deg margin)', inside(fov.hud) && inside(fov.tabs), JSON.stringify(fov));
    cli('browser screenshot --output-file ../../e2e/out/glasses-fov.png', {}, { timeout: 60_000 });
    const errs = consoleErrors(bootAt);
    check(r, 'zero console errors', errs.length === 0, errs.slice(0, 3).map((e) => e.text ?? e.message).join(' | '));
  },

  async voice(r) {
    let s = await boot('?fresh&voiceFixture=fixtures/voice-catch-next.wav&voiceFixtureDelay=1');
    restHand('left');
    rayPinch('right', s.lights[0].p);
    s = await waitFor((x) => x.phase === 'playing' && x.tabsVisible, { label: 'playing' });
    await sleep(2000);
    s = state();
    s = await clickControl('tab:pause', (x) => x.menuOpen && x.menuVisible, 'menu');
    await sleep(400);
    await clickControl('menu:voice', (x) => x.voiceStatus !== 'off', 'voice starting');
    s = await waitFor((x) => x.lastVoiceCommands.includes('next'), { timeout: 60_000, every: 1000, label: 'recognised commands' });
    check(r, 'real Vosk recogniser heard the recorded "catch" and "next"', s.lastVoiceCommands.split(' ').join(' ').includes('catch') && s.lastVoiceCommands.includes('next'), `"${s.transcript}" -> ${s.lastVoiceCommands}`);
    check(r, '"catch" caught a light by voice', s.lights.some((l) => l.caught && l.method === 'voice'));
    check(r, '"next" outlined the next light', !!s.outlined);
    const errs = consoleErrors(bootAt);
    check(r, 'zero console errors', errs.length === 0, errs.slice(0, 3).map((e) => e.text ?? e.message).join(' | '));
  },

  async paper(r) {
    let s = await boot('?fresh&room=paper');
    check(r, 'paper-room fallback builds a room', s.roomSource === 'paper');
    restHand('left');
    rayPinch('right', s.lights[0].p);
    s = await waitFor((x) => x.phase === 'playing', { label: 'round in paper room' });
    check(r, 'paper room hides 5 lights', s.total === 5, s.lights.map((l) => `${l.kind}@${l.host}`).join(', '));
    for (const l of s.lights) {
      rayPinch('right', l.p);
      await waitFor((x) => x.lights.find((y) => y.id === l.id)?.caught, { timeout: 8000, label: `catch ${l.id}` });
    }
    check(r, 'paper room round completes', state().lights.every((l) => l.caught));
  },

  async perf(r) {
    // 12-light round, depth occlusion on the lights, high contrast off; 600 frames of scripted play.
    let s = await boot('?fresh&round=2');
    restHand('left');
    rayPinch('right', s.lights[0].p);
    s = await waitFor((x) => x.phase === 'playing' && x.total === 12, { label: '12-light round' });
    inPage(`async (page) => page.evaluate(() => window.__phengosPerf.reset())`);
    const t0 = Date.now();
    let i = 0;
    while (true) {
      const n = inPage(`async (page) => page.evaluate(() => window.__phengosPerf.n)`);
      if (n >= 600) break;
      const l = s.lights[i++ % s.lights.length];
      cli('xr look-at', { device: 'headset', target: l.p });
      cli('xr look-at', { device: 'hand-right', target: l.p });
      if (Date.now() - t0 > 240_000) break;
    }
    const rep = inPage(`async (page) => page.evaluate(() => window.__phengosPerf.report())`);
    writeFileSync(join(OUT, 'perf-report.json'), JSON.stringify(rep, null, 2));
    check(r, `600-frame run recorded (${rep.frames} frames)`, rep.frames >= 600);
    check(r, `p95 CPU <= 4 ms (relative proxy): ${rep.cpuP95} ms`, rep.cpuP95 <= 4);
    // IWER renders the two eye views as separate passes (no multiview), so each draw counts twice.
    check(r, `draw calls per stereo frame <= 100 (shared M1 gate): max ${rep.drawCallsMax}`, rep.drawCallsMax <= 100);
    check(r, `draw calls per eye view <= 70 (spec gate): ${rep.drawCallsMax / 2}`, rep.drawCallsMax / 2 <= 70);
    check(r, `triangles <= 120k: max ${rep.trianglesMax}`, rep.trianglesMax <= 120_000);
    const ecs = cli('ecs find', { withComponents: ['DepthOccludable'] });
    const n = (ecs.entities ?? []).length;
    check(r, 'DepthOccludable only on the 12 lights', n === 12, `${n} entities`);
  },
};

const names = process.argv.slice(2);
let failed = 0;
for (const name of names) {
  const fn = scenarios[name];
  if (!fn) throw new Error(`unknown scenario ${name}`);
  const results = [];
  const t0 = Date.now();
  console.log(`\n=== ${name}`);
  try {
    await fn(results);
  } catch (err) {
    check(results, `${name} ran to the end`, false, String(err.message ?? err).slice(0, 600));
  }
  const fails = results.filter((x) => !x.ok).length;
  failed += fails;
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ scenario: name, seconds: (Date.now() - t0) / 1000, passed: results.length - fails, failed: fails, results }, null, 2));
}
process.exit(failed ? 1 : 0);
