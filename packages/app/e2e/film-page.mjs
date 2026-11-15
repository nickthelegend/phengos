// `iwsdk browser run e2e/film-page.mjs`: records ONE film take of the managed page
// (1920x1080: dev up --screenshot-width 1920 --screenshot-height 1080) with the CDP screencast: real rendered
// frames, nothing composited, plus the app's own audio mix when the page was opened
// with ?recordAudio. A browser-run lease lasts at most 110 s, so takes are short.
//
// Control files in PHENGOS_FILM_DIR:
//   started      written by this script when frames start flowing
//   stop         written by the driver: stop the take (frames + times.json + audio.webm)
//   done         written by this script when everything is saved
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function run({ page: maybeFrame }) {
  const page = maybeFrame.page ? maybeFrame.page() : maybeFrame;
  const out = process.env.PHENGOS_FILM_DIR;
  if (!out) throw new Error('PHENGOS_FILM_DIR is not set');
  const maxMs = Math.min(100, Number(process.env.PHENGOS_FILM_MAX_SECONDS || 100)) * 1000;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  // The dev workspace switcher is harness chrome, not the app: hide it while filming.
  await page
    .evaluate(() => {
      if (document.getElementById('phengos-film-style')) return;
      const st = document.createElement('style');
      st.id = 'phengos-film-style';
      st.textContent = '.workspace-view-switcher{display:none!important}';
      document.head.appendChild(st);
    })
    .catch(() => undefined);
  let n = 0;
  const times = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const i = n++;
    writeFileSync(`${out}/f${String(i).padStart(5, '0')}.jpg`, Buffer.from(f.data, 'base64'));
    times.push(f.metadata.timestamp);
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
    } catch {
      /* page navigated */
    }
  });
  const appFrame = () => page.frames().find((fr) => fr !== page.mainFrame()) ?? page.mainFrame();
  // The app's audio tap exists once its AudioContext does (on entering the room),
  // so it may start after the frames: its offset is saved for the cut.
  let audio = null;
  const tryAudio = async () => {
    audio = await appFrame()
      .evaluate(() => (window.__phengosAudio ? window.__phengosAudio.start() : null))
      .catch(() => null);
    if (audio) audio.offsetMs = Date.now() - startedAt;
  };
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  const startedAt = Date.now();
  await tryAudio();
  writeFileSync(`${out}/started`, JSON.stringify({ at: startedAt }));
  let lastTry = Date.now();
  while (!existsSync(`${out}/stop`) && Date.now() - startedAt < maxMs) {
    await sleep(40);
    if (!audio && Date.now() - lastTry > 250) {
      lastTry = Date.now();
      await tryAudio();
    }
  }
  await Promise.race([cdp.send('Page.stopScreencast').catch(() => undefined), sleep(3000)]);
  // Never let a stuck page hold the lease: the audio is optional, the frames are not.
  const b64 = await Promise.race([
    appFrame()
      .evaluate(() => (window.__phengosAudio ? window.__phengosAudio.stop() : ''))
      .catch(() => ''),
    sleep(6000).then(() => ''),
  ]);
  if (b64) writeFileSync(`${out}/audio.webm`, Buffer.from(b64, 'base64'));
  writeFileSync(`${out}/times.json`, JSON.stringify(times));
  await cdp.detach().catch(() => undefined);
  const done = { frames: n, seconds: (Date.now() - startedAt) / 1000, audioBytes: b64 ? b64.length : 0, audio, firstFrameTs: times[0] ?? null, startedAt };
  writeFileSync(`${out}/done`, JSON.stringify(done));
  return done;
}
