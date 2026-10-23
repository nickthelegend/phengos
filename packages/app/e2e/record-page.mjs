// `iwsdk browser run e2e/record-page.mjs`: records the managed page with the CDP
// screencast (real rendered frames, nothing composited) into PHENGOS_REC_DIR for
// PHENGOS_REC_SECONDS seconds. Frames are encoded to MP4 by e2e/encode.sh.
import { mkdirSync, writeFileSync } from 'node:fs';

export default async function run({ page }) {
  const dir = process.env.PHENGOS_REC_DIR;
  const seconds = Number(process.env.PHENGOS_REC_SECONDS || 25);
  if (!dir) throw new Error('PHENGOS_REC_DIR is not set');
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  let n = 0;
  const times = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const i = n++;
    writeFileSync(`${dir}/f${String(i).padStart(5, '0')}.jpg`, Buffer.from(f.data, 'base64'));
    times.push(f.metadata.timestamp);
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
    } catch {
      /* page navigated */
    }
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  writeFileSync(`${dir}/started`, String(Date.now()));
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await cdp.send('Page.stopScreencast');
  await cdp.detach().catch(() => undefined);
  writeFileSync(`${dir}/times.json`, JSON.stringify(times));
  return { frames: n, seconds };
}
