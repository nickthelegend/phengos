/**
 * Spatial UI: the HUD (count, captions, transcript, way to play), the Hint and
 * Pause tabs at the bottom of the view, the start / round card and the
 * settings menu. Every control is also a Target, so it can be reached by a
 * Look dwell and by the switch scanner, not only by a hand-ray pinch or poke.
 */
import { createSystem, Follower, FollowBehavior, Object3D, Quaternion, UIKit, UIKitMLAsset, Vector3 } from '@iwsdk/core';
import { type CatchMethod, nextContrast, stepSetting, type PlayMode } from '@phengos/core';
import { globalsOf, STORE_KEY, type Store } from '../game/store.js';
import type { Controller } from './game-system.js';

type El = UIKit.Component & Object3D;

const BORDER = { tab: '#3a3e46', btn: '#2a2d33', primary: '#e6ff4f', focus: '#3d8bff', scan: '#e6ff4f' };

export class UISystem extends createSystem({}) {
  private store!: Store;
  private hud!: UIKitMLAsset;
  private tabs!: UIKitMLAsset;
  private card!: UIKitMLAsset;
  private menu!: UIKitMLAsset;
  private texts = new Map<string, string>();
  private lastMenuOpen = false;
  private lastPhase = '';
  private base = { hud: 0.07, tabs: 0.07, card: 0.1, menu: 0.08 };
  private q = new Quaternion();
  private v = new Vector3();

  init(): void {
    this.store = this.world.globals[STORE_KEY] as Store;
    this.hud = this.world.requireSceneObject<UIKitMLAsset>('hud');
    this.tabs = this.world.requireSceneObject<UIKitMLAsset>('tabs');
    this.card = this.world.requireSceneObject<UIKitMLAsset>('card');
    this.menu = this.world.requireSceneObject<UIKitMLAsset>('menu');
    this.hud.name = 'HUD';
    this.tabs.name = 'Tabs';
    this.card.name = 'Card';
    this.menu.name = 'Menu';

    const follow = (id: string, offset: [number, number, number]) => {
      const e = this.world.requireSceneEntity(id);
      e.addComponent(Follower, {
        target: this.player.head,
        offsetPosition: offset,
        behavior: FollowBehavior.PivotY,
        maxAngle: 25,
        tolerance: 0.25,
        speed: 2,
      });
    };
    follow('hud', [0, -0.17, -0.8]);
    follow('tabs', [0, -0.3, -0.72]);

    const c = (): Controller | undefined => globalsOf(this.world).controller;
    const settings = () => this.store.settings;
    const set = (next: typeof this.store.settings) => this.store.setSettings(next);

    this.control(this.tabs, 'tab-hint', 'tab:hint', 4, 'tab', () => c()?.hint());
    this.control(this.tabs, 'tab-pause', 'tab:pause', 4, 'tab', () => c()?.pause());
    this.control(this.menu, 'menu-resume', 'menu:resume', 3.5, 'primary', () => c()?.resume());
    const mode = (m: PlayMode) => () => {
      this.store.setMode(m);
      this.store.modeChosen = true;
    };
    this.control(this.menu, 'mode-point', 'menu:mode-point', 3, 'btn', mode('point'));
    this.control(this.menu, 'mode-look', 'menu:mode-look', 3, 'btn', mode('look'));
    this.control(this.menu, 'mode-switch', 'menu:mode-switch', 3, 'btn', mode('switch'));
    this.control(this.menu, 'dwell-dec', 'menu:dwell-dec', 2.5, 'btn', () => set(stepSetting(settings(), 'dwellSec', -1)));
    this.control(this.menu, 'dwell-inc', 'menu:dwell-inc', 2.5, 'btn', () => set(stepSetting(settings(), 'dwellSec', 1)));
    this.control(this.menu, 'scan-dec', 'menu:scan-dec', 2.5, 'btn', () => set(stepSetting(settings(), 'scanSec', -1)));
    this.control(this.menu, 'scan-inc', 'menu:scan-inc', 2.5, 'btn', () => set(stepSetting(settings(), 'scanSec', 1)));
    this.control(this.menu, 'text-dec', 'menu:text-dec', 2.5, 'btn', () => set(stepSetting(settings(), 'textScale', -1)));
    this.control(this.menu, 'text-inc', 'menu:text-inc', 2.5, 'btn', () => set(stepSetting(settings(), 'textScale', 1)));
    this.control(this.menu, 'hum-toggle', 'menu:hum', 3, 'btn', () => set({ ...settings(), hum: !settings().hum }));
    this.control(this.menu, 'soundonly-toggle', 'menu:soundonly', 3, 'btn', () => set({ ...settings(), soundOnly: !settings().soundOnly }));
    this.control(this.menu, 'contrast-toggle', 'menu:contrast', 3, 'btn', () => set({ ...settings(), contrast: nextContrast(settings().contrast) }));
    this.control(this.menu, 'voice-toggle', 'menu:voice', 3, 'btn', () => globalsOf(this.world).voice?.toggle());

    this.place(this.menu, false);
    this.place(this.card, false);
  }

  /** Wire one element: click (ray pinch, poke, mouse), and register it as a Target. */
  private control(panel: UIKitMLAsset, elementId: string, targetId: string, radiusDeg: number, style: keyof typeof BORDER, action: () => void): void {
    const el = panel.requireElementById(elementId) as El;
    el.name = elementId;
    const onClick = () => {
      this.store.pinchConsumedAt = this.store.time;
      action();
    };
    el.addEventListener('click', onClick);
    this.cleanupFuncs.push(() => el.removeEventListener('click', onClick));
    const isMenu = targetId.startsWith('menu:');
    this.store.controlTargets.set(targetId, {
      id: targetId,
      kind: 'control',
      object: el,
      radiusDeg,
      activate: (_method: CatchMethod) => {
        const panelVisible = isMenu ? this.store.menuOpen : !this.store.menuOpen;
        if (panelVisible) action();
      },
      highlight: (on) => {
        el.setProperties({ borderColor: on ? BORDER.scan : BORDER[style], borderWidth: on ? 6 : 3 });
      },
    });
  }

  /** Show a world-locked panel in front of the head, or park it out of reach. */
  private place(panel: UIKitMLAsset, show: boolean, height = -0.02, dist = 0.95): void {
    panel.visible = show;
    if (!show) {
      panel.position.set(0, -50, 0);
      return;
    }
    this.player.head.getWorldPosition(this.v);
    this.player.head.getWorldQuaternion(this.q);
    const f = new Vector3(0, 0, -1).applyQuaternion(this.q).setY(0).normalize();
    panel.position.set(this.v.x + f.x * dist, this.v.y + height, this.v.z + f.z * dist);
    panel.rotation.set(0, Math.atan2(-f.x, -f.z), 0);
  }

  private text(panel: UIKitMLAsset, id: string, value: string): void {
    const key = `${panel.name}:${id}`;
    if (this.texts.get(key) === value) return;
    this.texts.set(key, value);
    (panel.getElementById(id) as UIKit.Text | undefined)?.setProperties({ text: value });
  }

  private display(panel: UIKitMLAsset, id: string, show: boolean): void {
    const key = `${panel.name}:${id}:display`;
    const v = show ? 'flex' : 'none';
    if (this.texts.get(key) === v) return;
    this.texts.set(key, v);
    panel.getElementById(id)?.setProperties({ display: v });
  }

  update(): void {
    const s = this.store;
    const st = s.settings;
    const scale = st.textScale;
    this.hud.scale.setScalar(this.base.hud * scale);
    this.tabs.scale.setScalar(this.base.tabs * scale);
    this.card.scale.setScalar(this.base.card * Math.min(scale, 1.5));
    this.menu.scale.setScalar(this.base.menu * Math.min(scale, 1.4));

    const inGame = s.inXR && s.phase !== 'boot';
    this.hud.visible = inGame;
    this.tabs.visible = inGame && (s.phase === 'playing' || s.phase === 'onboarding') && !s.menuOpen;

    // HUD text.
    const round = s.round;
    const count = round && s.phase !== 'onboarding' ? `${round.caught} / ${round.total}` : s.phase === 'onboarding' ? 'hello' : '...';
    this.text(this.hud, 'hud-count', count);
    const modeLabel = !s.modeChosen ? 'Any way works' : st.mode === 'point' ? 'Point (hands)' : st.mode === 'look' ? s.lookLabel : 'One switch';
    this.text(this.hud, 'hud-mode', st.soundOnly ? `${modeLabel} - sound only` : modeLabel);
    const showCaption = s.time < s.caption.until;
    this.display(this.hud, 'hud-caption-chip', showCaption);
    if (showCaption) {
      this.text(this.hud, 'hud-caption', s.caption.text);
      this.text(this.hud, 'hud-arrow', s.caption.arrow);
    }
    this.display(this.hud, 'hud-voice-chip', st.voice || s.voiceStatus !== 'off');
    this.text(this.hud, 'hud-heard', s.transcript ? `heard: "${s.transcript}"` : `voice: ${s.voiceStatus}`);

    // Card: onboarding and between rounds.
    const cardPhase = s.phase === 'onboarding' || s.phase === 'round-end' || s.phase === 'night-end';
    if (s.phase !== this.lastPhase) {
      this.lastPhase = s.phase;
      if (cardPhase && !s.menuOpen) this.place(this.card, true, 0.06, 1.25);
      else this.place(this.card, false);
      if (s.phase === 'onboarding') {
        this.text(this.card, 'card-eyebrow', 'PHENGOS');
        this.text(this.card, 'card-title', 'Catch the light');
        this.text(this.card, 'card-body', 'Any way works. The first one you use, we keep.');
        this.display(this.card, 'card-tiles', true);
      } else if (s.phase === 'round-end') {
        this.text(this.card, 'card-eyebrow', `ROUND ${s.roundIndex + 1} OF 3`);
        this.text(this.card, 'card-title', `${round?.caught ?? 0} of ${round?.total ?? 0} caught`);
        this.text(this.card, 'card-body', `Next: ${[5, 8, 12][s.roundIndex + 1] ?? 12} lights. They are hiding now.`);
        this.display(this.card, 'card-tiles', false);
      } else if (s.phase === 'night-end') {
        this.text(this.card, 'card-eyebrow', 'NIGHT COMPLETE');
        this.text(this.card, 'card-title', 'Look up');
        this.text(this.card, 'card-body', `${s.stars.length} stars on your ceiling, ${s.nights} night${s.nights === 1 ? '' : 's'} so far.`);
        this.display(this.card, 'card-tiles', false);
      }
    }
    this.text(this.card, 'tile-look-label', s.gazeAvailable ? 'Look (eyes)' : 'Look (head)');

    // Menu.
    if (s.menuOpen !== this.lastMenuOpen) {
      this.lastMenuOpen = s.menuOpen;
      this.place(this.menu, s.menuOpen, -0.08, 0.85);
      if (s.menuOpen) this.place(this.card, false);
      else if (cardPhase) this.place(this.card, true, 0.06, 1.25);
    }
    if (s.menuOpen) {
      this.text(this.menu, 'dwell-val', `${st.dwellSec.toFixed(2).replace(/0$/, '')} s`);
      this.text(this.menu, 'scan-val', `${st.scanSec.toFixed(2).replace(/0$/, '')} s`);
      this.text(this.menu, 'text-val', `${Math.round(st.textScale * 100)}%`);
      this.text(this.menu, 'hum-label', st.hum ? 'Hum on' : 'Hum off');
      this.text(this.menu, 'soundonly-label', st.soundOnly ? 'Sound only: on' : 'Sound only: off');
      this.text(this.menu, 'contrast-label', st.contrast === 'off' ? 'High contrast: off' : `High contrast: ${st.contrast}`);
      this.text(this.menu, 'mode-look-label', s.lookLabel);
      this.text(this.menu, 'voice-label', st.voice ? 'Turn off voice' : 'Turn on voice');
      this.text(this.menu, 'voice-status', s.voiceStatus === 'off' ? 'Voice is optional. Nothing is recorded or sent.' : `Voice: ${s.voiceStatus}`);
      for (const m of ['point', 'look', 'switch'] as const) {
        const el = this.menu.getElementById(`mode-${m}`);
        const active = st.mode === m;
        const key = `menu:mode-${m}:active`;
        const val = String(active);
        if (this.texts.get(key) !== val) {
          this.texts.set(key, val);
          el?.setProperties({ backgroundColor: active ? '#1d2a10' : '#0e1116' });
        }
      }
    }
  }
}
