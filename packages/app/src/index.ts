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

    if (enter) {
      enter.disabled = false;
      enter.addEventListener('click', () => {
        globalsOf(world).audio?.unlock();
        world.launchXR();
      });
    }
    world.renderer.xr.addEventListener('sessionstart', () => overlay?.setAttribute('hidden', ''));
    world.renderer.xr.addEventListener('sessionend', () => overlay?.removeAttribute('hidden'));
    if (!navigator.xr && status) status.textContent = 'This browser has no WebXR. Open Phengos in the Meta Quest Browser.';
  })
  .catch((err: unknown) => {
    console.error('[phengos] failed to start', err);
    if (status) status.textContent = `Phengos could not start: ${String(err)}`;
  });
