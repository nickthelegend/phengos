// Voice with the model missing: the chip must say "Voice unavailable on this device" and play continues.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, check, clickUI, cli, enterXR, goto, sleep, state, waitFor, aimPinch } from './lib.mjs';
const r = [];
try { cli('xr exit', {}); } catch {}
goto('?fresh');
enterXR();
cli('xr set-input-mode', { mode: 'hand' });
cli('xr set-transform', { device: 'headset', position: { x: 0, y: 1.15, z: 0.2 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
let s = await waitFor((x) => x.phase === 'onboarding', { timeout: 40000 });
aimPinch('right', s.lights[0].p);
s = await waitFor((x) => x.phase === 'playing' && x.tabsVisible);
await sleep(2000);
await clickUI('tab:pause', (x) => x.menuOpen && x.menuVisible, 'menu');
await sleep(400);
await clickUI('menu:voice', (x) => x.voiceStatus !== 'off', 'voice');
s = await waitFor((x) => x.voiceStatus === 'Voice unavailable on this device', { timeout: 75000, every: 1000, label: 'unavailable' });
check(r, 'missing model -> "Voice unavailable on this device"', true, s.voiceStatus);
await clickUI('menu:resume', (x) => !x.menuOpen, 'resume');
s = state();
aimPinch('right', s.lights.find((l) => !l.caught).p);
s = await waitFor((x) => x.caught >= 1, { timeout: 8000, label: 'play continues' });
check(r, 'play continues by hand after voice failed', s.caught >= 1);
writeFileSync(join(OUT, 'voice-missing.json'), JSON.stringify({ scenario: 'voice-missing', passed: r.filter((x) => x.ok).length, failed: r.filter((x) => !x.ok).length, results: r }, null, 2));
