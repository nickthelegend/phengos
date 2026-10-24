// Capture the room the running app builds from IWER's built-in GLTS rooms into
// packages/core/test/rooms/<env>.json (the unit tests run hideLights on them).
// Usage: node e2e/capture-rooms.mjs bedroom kitchen ...
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, cli, enterXR, goto, inPage, sleep, waitFor } from './lib.mjs';

const CONFIG = join(APP, 'iwsdk.config.json');
const original = readFileSync(CONFIG, 'utf8');
try {
  for (const env of process.argv.slice(2)) {
    const cfg = JSON.parse(original);
    cfg.dev.emulator.environment = env;
    writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
    await sleep(6000);
    cli('runtime wait', {}, { timeout: 120_000 });
    try { cli('xr exit', {}); } catch {}
    goto('?fresh');
    enterXR();
    cli('xr set-transform', { device: 'headset', position: { x: 0, y: 1.15, z: 0.2 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
    await waitFor((s) => s.phase === 'onboarding', { timeout: 40_000, label: `room ${env}` });
    const room = JSON.parse(inPage(`async (page) => page.evaluate(() => JSON.stringify(window.__phengos.store.room))`));
    room.name = `${env} (IWER built-in, captured from the running app)`;
    writeFileSync(join(APP, '..', 'core', 'test', 'rooms', `${env}.json`), JSON.stringify(room, null, 1));
    console.log(env, room.planes.length, 'planes', room.boxes.map((b) => b.label).join(','));
  }
} finally {
  writeFileSync(CONFIG, original);
}
