/**
 * Optional voice, never required.
 *
 * On "Turn on voice" (a user gesture) Phengos loads Vosk (vosk-browser, WASM in
 * a Worker) with the small English model from our own host and a fixed grammar
 * of nine words, then listens to the microphone. Audio stays on the device:
 * nothing is stored or sent. Browsers that offer on-device SpeechRecognition
 * (processLocally) are detected first and logged; cloud recognisers are not used,
 * because they send audio away.
 *
 * If the model or the mic is unavailable, the chip says so and play continues.
 * `?voiceFixture=<wav>` swaps the mic for a recorded WAV fed through the same
 * real recogniser (used by the voice test).
 */
import { createSystem } from '@iwsdk/core';
import { type VoiceCommand, parseVoice, VOSK_GRAMMAR } from '@phengos/core';
import workerUrl from '@lichess-org/vosk-browser/dist/vosk.worker.js?url';
import wasmUrl from '@lichess-org/vosk-browser/dist/vosk.wasm?url';
import { globalsOf, STORE_KEY, type Store } from '../game/store.js';
import type { Controller } from './game-system.js';

const MODEL_URL = `${import.meta.env.BASE_URL}models/vosk-model-small-en-us-0.15.tar.gz`;

type Recognizer = {
  on(event: 'result' | 'partialresult' | 'error', cb: (m: any) => void): void;
  acceptWaveform(b: AudioBuffer): void;
  acceptWaveformFloat(b: Float32Array, rate: number): void;
  retrieveFinalResult(): void;
  remove(): void;
};

export class VoiceSystem extends createSystem({}) {
  private store!: Store;
  private client: { terminate(): void; KaldiRecognizer: new (rate: number, grammar?: string) => Recognizer } | null = null;
  private recognizer: Recognizer | null = null;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private busy = false;
  private fixture: string | null = null;

  init(): void {
    this.store = this.world.globals[STORE_KEY] as Store;
    this.fixture = new URLSearchParams(location.search).get('voiceFixture');
    const SR = (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    const local = !!SR && 'processLocally' in ((SR as { prototype?: object }).prototype ?? {});
    console.info(`[phengos] voice: SpeechRecognition ${SR ? (local ? 'present (on-device capable)' : 'present (cloud only, not used)') : 'absent'}; using Vosk`);
    this.world.globals.voice = { toggle: () => void this.toggle(), status: () => this.store.voiceStatus };
    this.cleanupFuncs.push(() => this.shutdown());
  }

  private async toggle(): Promise<void> {
    if (this.busy) return;
    if (this.store.settings.voice) {
      this.shutdown();
      this.store.setSettings({ ...this.store.settings, voice: false });
      this.store.voiceStatus = 'off';
      this.store.transcript = '';
      return;
    }
    this.busy = true;
    this.store.setSettings({ ...this.store.settings, voice: true });
    try {
      await this.start();
    } catch (err) {
      console.warn('[phengos] voice unavailable:', err);
      this.store.voiceStatus = 'Voice unavailable on this device';
      this.store.setSettings({ ...this.store.settings, voice: false });
      this.shutdown();
    } finally {
      this.busy = false;
    }
  }

  private async start(): Promise<void> {
    this.store.voiceStatus = 'loading model';
    // Ask for the mic first, inside the user gesture.
    if (!this.fixture) {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('no getUserMedia');
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
    }
    const head = await fetch(MODEL_URL, { method: 'HEAD' });
    if (!head.ok) throw new Error(`model missing (${head.status}) at ${MODEL_URL}`);
    const { createVoskClient } = await import('@lichess-org/vosk-browser');
    const t0 = performance.now();
    const client = (await createVoskClient({ modelUrl: new URL(MODEL_URL, location.href).href, workerUrl, wasmUrl, logLevel: -1 })) as unknown as NonNullable<typeof this.client>;
    this.client = client;
    console.info(`[phengos] vosk model ready in ${Math.round(performance.now() - t0)} ms`);
    const rec = new client.KaldiRecognizer(16000, VOSK_GRAMMAR);
    this.recognizer = rec;
    rec.on('result', (m) => {
      const text = String(m?.result?.text ?? '').trim();
      if (!text) return;
      this.store.transcript = text;
      const cmds = parseVoice(text);
      console.info(`[phengos] voice heard "${text}" -> [${cmds.join(', ')}]`);
      this.store.lastVoiceCommands = [this.store.lastVoiceCommands, ...cmds].filter(Boolean).join(' ').split(' ').slice(-8).join(' ');
      for (const c of cmds) this.dispatch(c);
    });
    rec.on('partialresult', (m) => {
      const p = String(m?.result?.partial ?? '').trim();
      if (p) this.store.transcript = `${p}...`;
    });
    rec.on('error', (m) => console.warn('[phengos] recogniser error', m?.error));
    this.store.voiceStatus = 'listening';
    if (this.fixture) await this.feedFixture(rec, this.fixture);
    else this.listen(rec);
  }

  private listen(rec: Recognizer): void {
    const ctx = new AudioContext({ sampleRate: 16000 });
    this.ctx = ctx;
    const src = ctx.createMediaStreamSource(this.stream!);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => {
      try {
        rec.acceptWaveformFloat(e.inputBuffer.getChannelData(0), e.inputBuffer.sampleRate);
      } catch (err) {
        console.warn('[phengos] acceptWaveform failed', err);
      }
    };
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(node).connect(mute).connect(ctx.destination);
    this.node = node;
  }

  /** Feed a WAV through the real recogniser, in 4096-sample chunks, at real-time pace. */
  private async feedFixture(rec: Recognizer, url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fixture ${url}: ${res.status}`);
    const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await res.arrayBuffer());
    const data = audio.getChannelData(0);
    this.store.voiceStatus = 'listening (test recording)';
    for (let i = 0; i < data.length; i += 4096) {
      rec.acceptWaveformFloat(data.slice(i, i + 4096), 16000);
      await new Promise((r) => setTimeout(r, (4096 / 16000) * 1000));
    }
    rec.retrieveFinalResult();
  }

  private dispatch(cmd: VoiceCommand): void {
    const c = globalsOf(this.world).controller;
    if (!c) return;
    switch (cmd) {
      case 'catch':
        if (c.catchOutlined('voice')) c.firstInput('voice');
        break;
      case 'next':
        c.cycleOutline(1);
        break;
      case 'back':
        c.cycleOutline(-1);
        break;
      case 'hint':
        c.hint();
        break;
      case 'repeat':
        c.repeat();
        break;
      case 'pause':
      case 'menu':
        c.pause();
        break;
      case 'resume':
        c.resume();
        break;
      case 'louder':
        c.louder();
        break;
    }
  }

  private shutdown(): void {
    this.node?.disconnect();
    this.node = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recognizer?.remove();
    this.recognizer = null;
    this.client?.terminate();
    this.client = null;
  }
}
