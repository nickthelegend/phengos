import { cli, state } from './lib.mjs';
const s = state();
console.log(JSON.stringify({ phase: s.phase, roomSource: s.roomSource, lights: s.lights, head: s.head, tabs: s.controls['tab:pause'], caption: s.caption }, null, 0));
const logs = cli('browser logs', { count: 200, pattern: process.argv[2] ?? 'phengos|rror|xception' });
const list = logs.logs ?? logs.entries ?? logs.result ?? [];
for (const l of list.slice(-25)) console.log(`${l.level ?? l.type}: ${String(l.text ?? l.message).slice(0, 400)}`);
