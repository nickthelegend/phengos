// Records the emulator clips to grokbot/videos/phengos/ (test recordings).
// Usage: node e2e/record.mjs whoa|switch|glasses
// Every frame is the app's real rendered output (CDP screencast); captions are
// added as burned-in subtitles by e2e/encode.sh, never by editing frames.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, at, cli, clickTarget, clickUI, ecsState, enterXR, targetPos, feedVoiceFixture, goto, inPage, sleep, startRecording, state, waitFor } from './lib.mjs';
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const VIDEOS = join(APP, '..', '..', '..', '..', 'videos', 'phengos');
const TMP = join(APP, '..', '..', 'e2e', 'out', 'frames');
mkdirSync(VIDEOS, { recursive: true });
const SEATED = { x: 0, y: 1.15, z: 0.2 };

function srt(cues) {
  const t = (s) => {
    const ms = Math.round(s * 1000);
    const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
    const sec = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
    return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, '0')}`;
  };
  return cues.map(([a, b, text], i) => `${i + 1}\n${t(a)} --> ${t(b)}\n${text}\n`).join('\n');
}

function vtt(cues) {
  return 'WEBVTT\n\n' + srt(cues).replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2').replace(/^\d+\n/gm, '');
}

function offset(p, head, deg) {
  // A point rotated `deg` degrees to the side of p around the head (to aim near, not at, a light).
  const dx = p.x - head.x;
  const dz = p.z - head.z;
  const a = (deg * Math.PI) / 180;
  return { x: head.x + dx * Math.cos(a) - dz * Math.sin(a), y: p.y, z: head.z + dx * Math.sin(a) + dz * Math.cos(a) };
}

async function setup(query, settings) {
  try {
    cli('xr exit', {});
  } catch {}
  goto('');
  inPage(`async (page) => page.evaluate((s) => { if (s) localStorage.setItem('phengos.settings.v1', s); else localStorage.removeItem('phengos.settings.v1'); }, ${JSON.stringify(settings ? JSON.stringify(settings) : null)})`);
  goto(query);
  enterXR();
  cli('xr set-input-mode', { mode: 'hand' });
  cli('xr set-transform', { device: 'headset', position: SEATED, orientation: { x: 0, y: 0, z: 0, w: 1 } });
}

let palmAt = { x: 0.14, y: 0.9, z: -0.22 };
function palmUp() {
  cli('xr set-transform', { device: 'hand-right', position: palmAt, orientation: { fingers: 'forward', palm: 'up' } });
}
/** Hold the right palm up in view, toward a direction (so the caught light lands on camera). */
function palmToward(head, p) {
  const dx = p.x - head.x;
  const dz = p.z - head.z;
  const l = Math.hypot(dx, dz) || 1;
  palmAt = { x: head.x + (dx / l) * 0.38 + 0.04, y: head.y - 0.24, z: head.z + (dz / l) * 0.38 };
  palmUp();
}
function restLeft() {
  cli('xr set-transform', { device: 'hand-left', position: { x: -0.22, y: 0.78, z: -0.12 }, orientation: { fingers: 'forward', palm: 'down' } });
  cli('xr look-at', { device: 'hand-left', target: { x: -0.3, y: 0, z: 0.6 } });
}
function restRight() {
  cli('xr set-transform', { device: 'hand-right', position: { x: 0.22, y: 0.78, z: -0.12 }, orientation: { fingers: 'forward', palm: 'down' } });
  cli('xr look-at', { device: 'hand-right', target: { x: 0.3, y: 0, z: 0.6 } });
}
function rayPinch(p) {
  cli('xr look-at', { device: 'hand-right', target: { x: p.x, y: p.y, z: p.z } });
  sleepSync(800);
  cli('xr select', { device: 'hand-right', duration: 0.15 });
}

async function encode(name, dir, cues) {
  const srtPath = join(TMP, `${name}.srt`);
  writeFileSync(srtPath, srt(cues));
  writeFileSync(join(VIDEOS, `${name}.vtt`), vtt(cues));
  const out = join(VIDEOS, `${name}.mp4`);
  execFileSync(join(APP, 'e2e', 'encode.sh'), [dir, out, srtPath], { stdio: 'inherit' });
  execFileSync(join(APP, 'e2e', 'encode.sh'), [dir, join(VIDEOS, `${name}-nocaptions.mp4`)], { stdio: 'inherit' });
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', '5', '-i', out, '-frames:v', '1', '-q:v', '3', join(VIDEOS, `${name}-poster.jpg`)]);
  return out;
}

const clips = {
  async whoa() {
    await setup('?voiceFixture=fixtures/voice-catch-next.wav&voiceFixtureGate=1', { mode: 'look' });
    let s = await waitFor((x) => x.phase === 'playing' && x.tabsVisible, { timeout: 40_000, label: 'playing' });
    restLeft();
    restRight();
    // Turn voice on through the menu (off camera); it resumes play once the model is ready.
    await sleep(1500);
    await clickUI('tab:pause', (x) => x.menuOpen && x.menuVisible, 'menu');
    await sleep(400);
    await clickUI('menu:voice', (x) => x.voiceStatus !== 'off', 'voice');
    s = await waitFor((x) => x.voiceStatus.includes('ready') && !x.menuOpen, { timeout: 60_000, every: 1000, label: 'voice ready' });
    const head = s.head;
    const byScore = [...s.lights].sort((a, b) => score(b) - score(a));
    function score(l) {
      return (l.host === 'couch' ? 4 : 0) + (l.kind === 'behind' ? 2 : 0) + (l.visible < 0.9 ? 1 : 0);
    }
    const L1 = byScore[0];
    const rest = s.lights.filter((l) => l.id !== L1.id).sort((a, b) => Math.abs(a.p.x) - Math.abs(b.p.x));
    const L2 = rest.find((l) => l.kind === 'under' || l.kind === 'beside') ?? rest[0];
    const L3 = rest.find((l) => l.id !== L2.id);
    palmToward(head, L1.p);
    cli('xr look-at', { device: 'headset', target: offset(L1.p, head, 9) });
    await sleep(1500);
    restLeft();
    const rec = await startRecording(join(TMP, 'whoa'), 31);
    await at(rec, 3800);
    cli('xr look-at', { device: 'headset', target: L1.p }); // dwell 1.0 s -> catch -> palm
    await at(rec, 8200);
    cli('xr look-at', { device: 'headset', target: offset(L2.p, head, 8) });
    palmToward(head, L2.p);
    await at(rec, 9300);
    rayPinch(L2.p);
    await sleep(250);
    palmUp();
    await at(rec, 12000);
    cli('xr look-at', { device: 'headset', target: offset(L3.p, head, 6) });
    palmToward(head, L3.p);
    await at(rec, 12600);
    feedVoiceFixture();
    await at(rec, 15800);
    await clickTarget('tab-pause', (x) => x.menuOpen, 'menu');
    await sleep(300);
    await clickTarget('contrast-toggle', (x) => x.contrast !== 'off', 'contrast');
    await sleep(300);
    await clickTarget('menu-resume', (x) => !x.menuOpen, 'resume');
    palmUp();
    await at(rec, 23500);
    const left = [L1, L2, L3, ...s.lights].filter((l, i, a) => a.findIndex((m) => m.id === l.id) === i).slice(3);
    if (left[0]) cli('xr look-at', { device: 'headset', target: offset(left[0].p, head, 7) });
    await at(rec, 27000);
    if (left[1]) cli('xr look-at', { device: 'headset', target: offset(left[1].p, head, -7) });
    const r = await rec.done;
    const final = state();
    writeFileSync(join(TMP, 'whoa-state.json'), JSON.stringify({ L1, L2, L3, final, recorder: r.out.slice(-400) }, null, 2));
    return encode('phengos-whoa', join(TMP, 'whoa'), [
      [0, 3.8, 'Emulator, Quest 3, synthetic living room. A light peeks over the real couch; depth hides the rest.'],
      [3.8, 8.2, 'Look (head): the reticle settles, the dwell ring fills, and the light floats to your palm.'],
      [8.2, 12, 'Same light, three ways. Two: point the hand ray and pinch.'],
      [12, 15.8, 'Three: say "catch". (A recorded test clip through the real Vosk recogniser.)'],
      [15.8, 22, 'Pause menu: high contrast on.'],
      [22, 31, 'High contrast: the real room as bold outlines. The lights left pulse yellow on black.'],
    ]);
  },

  async switch() {
    await setup('?fresh&seed=7', null);
    let s = await waitFor((x) => x.phase === 'onboarding', { timeout: 40_000, label: 'onboarding' });
    restLeft();
    restRight();
    const rec = await startRecording(join(TMP, 'switch'), 30);
    while (ecsState().scanItem !== 'light-hello') await sleep(250);
    await sleep(500);
    cli('xr select', { device: 'hand-left', duration: 0.15 });
    while (ecsState().phase !== 'playing') await sleep(300);
    let guard = 0;
    while (Date.now() - rec.t0 < 28_000 && guard++ < 80) {
      s = ecsState();
      if (s.caught >= s.total) break;
      if (s.scanItem && s.scanItem.startsWith('light-')) {
        cli('xr select', { device: 'hand-left', duration: 0.12 });
        await sleep(900);
      } else await sleep(250);
    }
    await rec.done;
    return encode('phengos-switch', join(TMP, 'switch'), [
      [0, 5, 'Emulator. No input for 4 seconds: the scanner starts by itself.'],
      [5, 10, 'One switch: any pinch, from either hand, catches the outlined light.'],
      [10, 30, 'The outline steps left to right, then Hint and Pause. Pinches only, a whole round.'],
    ]);
  },

  async glasses() {
    await setup('?fresh', null);
    let s = await waitFor((x) => x.phase === 'onboarding' && x.gazeAvailable, { timeout: 40_000, label: 'onboarding + gaze' });
    restLeft();
    restRight();
    const rec = await startRecording(join(TMP, 'glasses'), 24);
    await at(rec, 2500);
    cli('xr look-at', { device: 'gaze', target: s.lights[0].p });
    await at(rec, 3500);
    cli('xr select', { device: 'hand-right', duration: 0.15 });
    while (ecsState().phase !== 'playing') await sleep(300);
    for (const name of ['light-0', 'light-1', 'light-2', 'light-3']) {
      const p = targetPos(name);
      cli('xr look-at', { device: 'headset', target: p });
      await sleep(700);
      cli('xr look-at', { device: 'gaze', target: p });
      await sleep(600);
      cli('xr select', { device: 'hand-right', duration: 0.15 });
      await sleep(1600);
      if (Date.now() - rec.t0 > 22_000) break;
    }
    await rec.done;
    return encode('phengos-glasses', join(TMP, 'glasses'), [
      [0, 3.5, 'Emulator, Meta VR Glasses profile: the black mask is the Glasses field of view.'],
      [3.5, 24, 'Look (eyes): eye gaze picks the light, a pinch from either hand catches it.'],
    ]);
  },
};

const name = process.argv[2];
const out = await clips[name]();
console.log(`wrote ${out}`);
