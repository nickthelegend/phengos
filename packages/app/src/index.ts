/**
 * Phengos: lights hide behind your real furniture. Catch them by hand, by
 * looking, by voice or with one switch, or follow their hum.
 */
import { DepthSensingSystem, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { globalsOf, Store, STORE_KEY } from './game/store.js';
import { AudioSystem } from './systems/audio-system.js';
import { ContrastSystem } from './systems/contrast-system.js';
import { GameSystem } from './systems/game-system.js';
import { InputSystem } from './systems/input-system.js';
import { LookSystem } from './systems/look-system.js';
import { PerfBeginSystem, PerfEndSystem } from './systems/perf-system.js';
import { RoomSystem } from './systems/room-system.js';
import { UISystem } from './systems/ui-system.js';
import { VoiceSystem } from './systems/voice-system.js';
import { WristSystem } from './systems/wrist-system.js';

const overlay = document.getElementById('start');
const enter = document.getElementById('enter') as HTMLButtonElement | null;
const status = document.getElementById('status');

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions)
  .then((world) => {
    const store = new Store();
    world.globals[STORE_KEY] = store;
    // Read-only inspection handle for the e2e scripts (room capture, perf report).
    (window as unknown as { __phengos: object }).__phengos = { store, world };
    world.registerSystem(PerfBeginSystem, { priority: -1_000_000 });
    world.registerSystem(DepthSensingSystem, {
      configData: { enableDepthTexture: true, enableOcclusion: true, useFloat32: true, blurRadius: 20 },
    });
    world.registerSystem(RoomSystem);
    world.registerSystem(GameSystem);
    world.registerSystem(LookSystem);
    world.registerSystem(InputSystem);
    world.registerSystem(UISystem);
    world.registerSystem(AudioSystem);
    world.registerSystem(VoiceSystem);
    world.registerSystem(ContrastSystem);
    world.registerSystem(WristSystem);
    world.registerSystem(PerfEndSystem, { priority: 1_000_000 });

    let enterWatch = 0;
    const armEnter = (ready: boolean, message: string) => {
      if (enter) {
        enter.disabled = !ready;
        enter.setAttribute('aria-busy', 'false');
      }
      if (status) status.textContent = message;
    };
    const stopEnterWatch = () => window.clearInterval(enterWatch);
    if (enter) {
      enter.addEventListener('click', () => {
        if (enter.disabled || world.session || world.sessionRequestPending) return;
        globalsOf(world).audio?.unlock();
        if (status) status.textContent = 'Opening your room.';
        try {
          world.launchXR();
        } catch (err) {
          console.error('[phengos] could not enter', err);
          armEnter(true, 'Could not enter the room. Reload and try again.');
          return;
        }
        stopEnterWatch();
        enterWatch = window.setInterval(() => {
          if (world.session) {
            stopEnterWatch();
            return;
          }
          if (world.sessionRequestPending) return;
          stopEnterWatch();
          if (status && !overlay?.hasAttribute('hidden')) {
            status.textContent = 'Could not enter the room. Allow the headset prompt, then try again.';
          }
        }, 300);
      });
    }
    world.renderer.xr.addEventListener('sessionstart', () => {
      stopEnterWatch();
      overlay?.setAttribute('hidden', '');
    });
    world.renderer.xr.addEventListener('sessionend', () => {
      overlay?.removeAttribute('hidden');
      if (enter && !enter.disabled && status) status.textContent = 'You left the room. Enter again when you are seated.';
    });
    // A stuck support check must not leave the door locked. A finished check wins.
    let supportSettled = false;
    const supportGaveUp = window.setTimeout(() => {
      if (!supportSettled) armEnter(true, 'Seated is fine. Nothing to reach for.');
    }, 4000);
    void immersiveArSupported().then((supported) => {
      supportSettled = true;
      window.clearTimeout(supportGaveUp);
      if (supported) armEnter(true, 'Seated is fine. Nothing to reach for.');
      else if (!navigator.xr) armEnter(false, 'This browser has no WebXR. Open Phengos in the Meta Quest Browser.');
      else armEnter(false, 'This browser cannot open an AR room. Open Phengos in the Meta Quest Browser.');
    });
  })
  .catch((err: unknown) => {
    console.error('[phengos] failed to start', err);
    if (enter) {
      enter.disabled = true;
      enter.setAttribute('aria-busy', 'false');
    }
    if (status) status.textContent = startFailure(err);
  });

/** Quest Browser can open an AR session. A desktop tab usually cannot. */
function immersiveArSupported(): Promise<boolean> {
  if (!navigator.xr?.isSessionSupported) return Promise.resolve(false);
  return navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
}

function startFailure(err: unknown): string {
  const raw = err instanceof Error ? err.message : '';
  const clean = raw.replace(/\s+/g, ' ').trim().slice(0, 140);
  return clean ? `Phengos could not start. ${clean}` : 'Phengos could not start. Reload this page.';
}
