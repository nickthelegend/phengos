// Records the takes of the Phengos film from the real app in the Meta Immersive
// Web Emulator (IWER, Quest 3 profile; the Glasses take uses the Meta VR Glasses
// profile). Every frame is the app's rendered output (CDP screencast) and the
// sound is the app's own synthesised mix (?recordAudio tap). Nothing is edited;
// captions are added in the cut (e2e/film-cut.py).
//
// Needs the dev server at 1920x1080:
//   npx iwsdk dev up --ai-mode agent --headless --allow-browser-automation \
//     --screenshot-width 1920 --screenshot-height 1080
// Usage: node e2e/film.mjs <take> [...]   (takes: launch point look switch voice access glasses again)
// Output: e2e/out/film/<take>/ (frames, times.json, audio.webm, events.json)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli, ecsState, enterXR, feedVoiceFixture, goto, inPage, sleep, state, targetPos, waitFor, clickUI } from './lib.mjs';
import { startTake } from './film-lib.mjs';

const OUT = join(import.meta.dirname, '..', '..', '..', 'e2e', 'out', 'film');
mkdirSync(OUT, { recursive: true });
const HEAD = { x: 0, y: 1.15, z: 0.2 };
const SEED = 7;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// ---------- poses ----------

/** Quaternion that points -Z from `from` toward `to` (yaw, then pitch; no roll). */
function lookQ(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sp = Math.sin(pitch / 2), cp = Math.cos(pitch / 2);
  return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
}

/** Turn the head smoothly (minimum-jerk, like a person) to look at a point. */
async function headTo(p, dur = 0.9) {
  cli('xr animate-to', { device: 'headset', position: HEAD, orientation: lookQ(HEAD, p), duration: dur, easing: 'minimum-jerk' });
  await sleep(dur * 1000 + 80);
}

/** A point `deg` degrees to the side of p around the head (to frame a light off-centre). */
function beside(p, deg, head = HEAD) {
  const dx = p.x - head.x, dz = p.z - head.z, a = (deg * Math.PI) / 180;
  return { x: head.x + dx * Math.cos(a) - dz * Math.sin(a), y: p.y, z: head.z + dx * Math.sin(a) + dz * Math.cos(a) };
}

/** Where the right palm rests in view when you look toward p: 0.42 m out, low and right. */
function palmSpot(p) {
  const dx = p.x - HEAD.x, dz = p.z - HEAD.z, l = Math.hypot(dx, dz) || 1;
  const fx = dx / l, fz = dz / l;
  return { x: HEAD.x + fx * 0.42 - fz * 0.15, y: HEAD.y - 0.21, z: HEAD.z + fz * 0.42 + fx * 0.15 };
}

async function palmUp(p, dur = 0.5) {
  cli('xr animate-to', { device: 'hand-right', position: palmSpot(p), orientation: { fingers: 'forward', palm: 'up' }, duration: dur, easing: 'minimum-jerk' });
  await sleep(dur * 1000 + 50);
}

/** Point the right hand ray at p from a relaxed spot by the hip, smoothly. */
async function aim(p, dur = 0.6) {
  const from = { x: HEAD.x + 0.18, y: HEAD.y - 0.35, z: HEAD.z - 0.3 };
  cli('xr animate-to', { device: 'hand-right', position: from, orientation: lookQ(from, p), duration: dur, easing: 'minimum-jerk' });
  await sleep(dur * 1000 + 350);
}

function restLeft() {
  cli('xr set-transform', { device: 'hand-left', position: { x: -0.24, y: 0.78, z: 0.05 }, orientation: { fingers: 'forward', palm: 'down' } });
  cli('xr look-at', { device: 'hand-left', target: { x: -0.4, y: 0, z: 0.7 } });
}
function restRight() {
  cli('xr set-transform', { device: 'hand-right', position: { x: 0.24, y: 0.78, z: 0.05 }, orientation: { fingers: 'forward', palm: 'down' } });
  cli('xr look-at', { device: 'hand-right', target: { x: 0.4, y: 0, z: 0.7 } });
}

/** The ceiling point straight above a light (where its star lands, give or take). */
const above = (p, y = 2.55) => ({ x: p.x, y, z: p.z });

// ---------- setup ----------

function settings(json) {
  inPage(`async (page) => page.evaluate((s) => { if (s) localStorage.setItem('phengos.settings.v1', s); else localStorage.removeItem('phengos.settings.v1'); }, ${JSON.stringify(json ? JSON.stringify(json) : null)})`);
}

async function open(query, prefs, { enter = true } = {}) {
  try {
    cli('xr exit', {});
  } catch {
    /* no session */
  }
  goto('');
  settings(prefs);
  goto(query);
  if (!enter) return null;
  enterXR();
  seat();
  return waitFor((s) => s.phase === 'onboarding' || s.phase === 'playing', { timeout: 40_000, label: 'room ready' });
}

function seat() {
  cli('xr set-device-state', { state: { fov: 64 } });
  cli('xr set-input-mode', { mode: 'hand' });
  cli('xr set-transform', { device: 'headset', position: HEAD, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  restLeft();
  restRight();
}

/** A take: records while `body` runs, logs timed events for the cut. */
async function take(name, body) {
  const dir = join(OUT, name);
  const rec = await startTake(dir);
  const events = [];
  const mark = (label) => {
    events.push({ t: rec.elapsed() / 1000, label });
    console.log(`  ${(rec.elapsed() / 1000).toFixed(1)}s ${label}`);
  };
  try {
    await body(rec, mark);
  } finally {
    const done = await rec.stop();
    writeFileSync(join(dir, 'events.json'), JSON.stringify({ events, done }, null, 2));
    console.log(`take ${name}: ${done.frames} frames, ${done.seconds.toFixed(1)} s, audio ${done.audioBytes ? 'yes' : 'no'}`);
  }
}

/** Wait on the ECS mirror (usable while a take records; `state()` is not). */
async function ecsUntil(pred, label, ms = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred(ecsState())) return;
    await sleep(250);
  }
  throw new Error(`timed out: ${label}`);
}

const score = (l) => (l.host === 'couch' ? 4 : 0) + (l.kind === 'behind' ? 2 : 0) + (l.visible < 0.9 ? 1 : 0);

async function waitCaught(id, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = ecsState();
    if (s.lastCatchMethod && Number(s.caught) >= 0) {
      const t = (cli('xr list-targets', {}).targets ?? []).find((x) => x.name === id);
      if (!t) return true; // a caught light is no longer a target
    }
    await sleep(150);
  }
  return false;
}

// ---------- takes ----------

const takes = {
  /** First launch: the start page, entering the room, onboarding, the first catch by Look (head). */
  async launch() {
    // Two takes: the 2D start page, then (right after Enter) the room. A take never
    // spans entering XR: the screencast stalls when IWER swaps in its XR canvas.
    await open(`?fresh&seed=${SEED}&recordAudio`, null, { enter: false });
    await sleep(2000);
    // A real click on "Ways to play", so the sign shows every way in.
    inPage(`async (page) => { await page.click('summary'); return true; }`);
    await sleep(800);
    await take('start', async (rec, mark) => {
      mark('start page');
      await rec.at(4500);
    });
    enterXR();
    seat();
    await waitFor((x) => x.phase === 'onboarding', { timeout: 30_000, label: 'onboarding' });
    const hello = targetPos('light-hello');
    await take('launch', async (rec, mark) => {
      mark('onboarding');
      await sleep(3500);
      mark('look at the light');
      await palmUp(hello, 0.4);
      await headTo(hello, 1.0);
      await sleep(1300); // 1.0 s dwell, then the pop
      mark('caught by look');
      await sleep(1500); // flies to the palm
      mark('on the palm');
      await sleep(900);
      restRight(); // the light has left the palm: lower it (palm up would open the wrist menu chip)
      await headTo({ x: hello.x * 0.6, y: 0.9, z: hello.z * 0.6 + 0.1 }, 0.7);
      await sleep(700);
      mark('rises');
      await headTo(above(hello, 2.6), 1.4);
      await sleep(1300);
      mark('star lands');
      await sleep(1200);
      await headTo({ x: 0, y: 1.05, z: -2 }, 1.2);
      restRight();
      await sleep(2500);
      mark('round 1 starts');
    });
  },

  /** Point (hands): a light behind the real couch, the pop, the palm, the star, the constellation growing. */
  async point() {
    let s = await open(`?seed=${SEED}&recordAudio`, { mode: 'point' });
    s = await waitFor((x) => x.phase === 'playing' && x.tabsVisible, { timeout: 40_000, label: 'playing' });
    const lights = [...s.lights].sort((a, b) => score(b) - score(a));
    const first = lights[0];
    const rest = lights.slice(1).sort((a, b) => Math.atan2(-(a.p.x - HEAD.x), -(a.p.z - HEAD.z)) - Math.atan2(-(b.p.x - HEAD.x), -(b.p.z - HEAD.z)));
    cli('xr set-transform', { device: 'headset', position: HEAD, orientation: lookQ(HEAD, beside(first.p, 14)) });
    await sleep(1500);
    await take('point', async (rec, mark) => {
      mark(`peeks out from behind the ${first.host}`);
      await sleep(2600);
      await headTo(beside(first.p, 4), 0.8);
      await aim(first.p);
      mark('ray hovers');
      await sleep(700);
      cli('xr select', { device: 'hand-right', duration: 0.15 });
      mark('pinch');
      await palmUp(first.p, 0.45);
      await sleep(1300);
      mark('on the palm');
      await sleep(600);
      await headTo(above(first.p, 2.65), 1.5);
      mark('rises');
      await sleep(900);
      mark('star lands, line drawn');
      await sleep(2000);
      for (const [i, l] of rest.entries()) {
        await headTo(beside(l.p, i % 2 ? -5 : 5), 0.8);
        await aim(l.p, 0.5);
        cli('xr select', { device: 'hand-right', duration: 0.15 });
        mark(`pinch ${l.id} (${l.host})`);
        await palmUp(l.p, 0.4);
        await sleep(1400);
      }
      await sleep(1200);
      restRight();
      mark('look up');
      await headTo({ x: 0.2, y: 2.7, z: -1.0 }, 1.6);
      await sleep(4200);
      mark('look down');
      await headTo({ x: 0, y: 1.25, z: -2 }, 1.4);
      await sleep(3500);
      mark('round card');
      await sleep(1500);
    });
  },

  /** Look (head): the reticle, the dwell ring, a 1 s hold catches. */
  async look() {
    let s = await open(`?seed=${SEED + 1}&recordAudio`, { mode: 'look' });
    s = await waitFor((x) => x.phase === 'playing' && x.tabsVisible, { timeout: 40_000, label: 'playing' });
    const ls = [...s.lights].sort((a, b) => score(b) - score(a)).slice(0, 3);
    cli('xr set-transform', { device: 'headset', position: HEAD, orientation: lookQ(HEAD, beside(ls[0].p, 12)) });
    await sleep(1200);
    await take('look', async (rec, mark) => {
      await sleep(1500);
      for (const l of ls) {
        mark(`look at ${l.id} (${l.host})`);
        await headTo(l.p, 0.9);
        await sleep(2600);
        mark('caught by look');
        await headTo(beside(l.p, 10), 0.6);
      }
      await sleep(1500);
    });
  },

  /** One switch: the outline steps through the lights; any pinch catches the outlined one. */
  async switch() {
    let s = await open(`?seed=${SEED + 2}&recordAudio`, { mode: 'switch', scanSec: 1.25 });
    s = await waitFor((x) => x.phase === 'playing' && x.tabsVisible, { timeout: 40_000, label: 'playing' });
    const ls = s.lights;
    const mid = ls.reduce((a, l) => ({ x: a.x + l.p.x / ls.length, y: a.y + l.p.y / ls.length, z: a.z + l.p.z / ls.length }), { x: 0, y: 0, z: 0 });
    cli('xr set-transform', { device: 'headset', position: HEAD, orientation: lookQ(HEAD, { x: mid.x, y: Math.max(1.0, mid.y), z: mid.z }) });
    await sleep(800);
    await take('switch', async (rec, mark) => {
      mark('scanning');
      let caught = 0;
      const t0 = Date.now();
      let lastPinch = 0;
      while (caught < 3 && Date.now() - t0 < 26_000) {
        const g = ecsState();
        const target = ls[caught === 0 ? 1 : caught === 1 ? 3 : 0];
        if (g.scanItem === target?.id && Date.now() - lastPinch > 1500) {
          await sleep(350);
          cli('xr select', { device: 'hand-left', duration: 0.15 });
          lastPinch = Date.now();
          mark(`pinch (left hand) on ${g.scanItem}`);
          caught++;
        } else await sleep(120);
      }
      await sleep(3000);
    });
  },

  /** Voice: "catch" and "next" through the real Vosk recogniser (a recorded test clip). */
  async voice() {
    let s = await open(`?seed=${SEED + 3}&voiceFixture=fixtures/voice-catch-next.wav&voiceFixtureGate=1&recordAudio`, { mode: 'point' });
    s = await waitFor((x) => x.phase === 'playing' && x.tabsVisible, { timeout: 40_000, label: 'playing' });
    await sleep(1000);
    await clickUI('tab:pause', (x) => x.menuOpen && x.menuVisible, 'menu');
    await sleep(400);
    await clickUI('menu:voice', (x) => x.voiceStatus !== 'off', 'voice');
    s = await waitFor((x) => x.voiceStatus.includes('ready') && !x.menuOpen, { timeout: 60_000, every: 1000, label: 'voice ready' });
    restRight();
    const head = s.head;
    const target = [...s.lights].sort((a, b) => Math.abs(Math.atan2(a.p.x - head.x, -(a.p.z - head.z))) - Math.abs(Math.atan2(b.p.x - head.x, -(b.p.z - head.z))))[0];
    cli('xr set-transform', { device: 'headset', position: HEAD, orientation: lookQ(HEAD, beside(target.p, 6)) });
    await sleep(1500);
    await take('voice', async (rec, mark) => {
      mark('voice on, listening');
      await sleep(2500);
      feedVoiceFixture();
      mark('test clip: "catch next"');
      await sleep(9000);
      mark('done');
    });
  },

  /** Accessibility from the menu: text size, high contrast, sound only with captions, hint. */
  async access() {
    let s = await open(`?seed=${SEED + 4}&recordAudio`, { mode: 'point' });
    s = await waitFor((x) => x.phase === 'playing' && x.tabsVisible, { timeout: 40_000, label: 'playing' });
    const ls = s.lights;
    cli('xr set-transform', { device: 'headset', position: HEAD, orientation: lookQ(HEAD, { x: 0, y: 1.05, z: -2 }) });
    await sleep(1200);
    const press = async (name, until, label) => {
      for (let k = 0; k < 3; k++) {
        await aim(targetPos(name), 0.45);
        cli('xr select', { device: 'hand-right', duration: 0.15 });
        const t0 = Date.now();
        while (Date.now() - t0 < 2000) {
          if (until(ecsState())) return;
          await sleep(150);
        }
      }
      throw new Error(`press ${name}: ${label} never happened`);
    };
    await take('access', async (rec, mark) => {
      await sleep(1000);
      mark('pause menu');
      await press('tab-pause', (x) => x.menuOpen, 'menu');
      await sleep(1400);
      mark('high contrast');
      await press('contrast-toggle', (x) => x.contrast === 'yellow', 'contrast');
      await sleep(800);
      mark('text size up');
      await press('text-inc', (x) => Number(x.textScale) > 1.2, 'text 125%');
      await press('text-inc', (x) => Number(x.textScale) > 1.4, 'text 150%');
      await sleep(700);
      await press('menu-resume', (x) => !x.menuOpen, 'resume');
      restRight();
      mark('yellow outlines, bigger text');
      await headTo(beside(ls[0].p, 18), 1.4);
      await sleep(2600);
      mark('sound only');
      await headTo({ x: 0, y: 1.05, z: -2 }, 0.8);
      await press('tab-pause', (x) => x.menuOpen, 'menu');
      await sleep(400);
      await press('contrast-toggle', (x) => x.contrast === 'white', 'white');
      await press('contrast-toggle', (x) => x.contrast === 'off', 'off');
      await press('soundonly-toggle', (x) => x.soundOnly === true || x.soundOnly === 'true', 'sound only');
      await sleep(500);
      await press('menu-resume', (x) => !x.menuOpen, 'resume');
      restRight();
      mark('hum captions');
      await headTo(beside(ls[1].p, -25), 1.2);
      await sleep(3500);
      mark('hint');
      await press('tab-hint', () => true, 'hint');
      restRight();
      await sleep(3500);
    });
  },

  /** Meta VR Glasses profile (set dev.emulator.device to metaVRGlasses first): eye gaze + pinch. */
  async glasses() {
    let s = await open(`?seed=${SEED}&recordAudio`, { mode: 'look' });
    s = await waitFor((x) => x.phase === 'playing' && x.gazeAvailable, { timeout: 40_000, label: 'playing + gaze' });
    const ls = [...s.lights].sort((a, b) => a.p.x - b.p.x).slice(0, 3);
    cli('xr set-transform', { device: 'headset', position: HEAD, orientation: lookQ(HEAD, { x: 0, y: 1.0, z: -2 }) });
    await sleep(1000);
    await take('glasses', async (rec, mark) => {
      await sleep(1500);
      for (const l of ls) {
        await headTo(beside(l.p, 3), 0.8);
        cli('xr look-at', { device: 'gaze', target: l.p });
        mark(`eye gaze on ${l.id}`);
        await sleep(700);
        cli('xr select', { device: 'hand-right', duration: 0.15 });
        mark('pinch');
        await sleep(2000);
      }
      await sleep(1000);
    });
  },

  /** Coming back: a new session, the constellation is still on the ceiling. */
  async again() {
    await open(`?seed=${SEED + 5}&recordAudio`, { mode: 'point' });
    await waitFor((x) => x.phase === 'playing', { timeout: 30_000, label: 'playing' });
    await sleep(800);
    await take('again', async (rec, mark) => {
      mark('back in the room');
      await sleep(1500);
      mark('look up');
      await headTo({ x: 0.3, y: 2.8, z: -0.9 }, 2.2);
      await sleep(3000);
      await headTo({ x: -0.6, y: 2.8, z: -1.0 }, 2.2);
      await sleep(2500);
      mark('end');
    });
  },
};

for (const name of process.argv.slice(2)) {
  if (!takes[name]) throw new Error(`unknown take ${name}`);
  console.log(`== ${name}`);
  await takes[name]();
}
console.log(JSON.stringify(state()).slice(0, 300));
