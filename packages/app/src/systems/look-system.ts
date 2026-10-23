/**
 * "Look": dwell to catch, without hands.
 *
 * Quest 3/3S have no eye tracking, and IWSDK's gaze needs an input source with
 * targetRayMode "gaze" that Quest 3 does not provide. So on Quest this is our
 * own HEAD-gaze: a ray from the viewer pose, a 2.5 degree cone, a reticle and a
 * dwell ring. It is labelled "Look (head)" everywhere.
 *
 * Where the runtime does provide a gaze source (Meta VR Glasses, which have eye
 * tracking), the same control follows that eye-gaze ray and is labelled
 * "Look (eyes)". IWSDK's GazeSystem still handles gaze + pinch selection; the
 * dwell timer here is ours, because IWSDK's dwellWindowSeconds is consensus
 * filtering, not dwell-to-click.
 */
import { createSystem, Group, Matrix4, Quaternion, Vector3 } from '@iwsdk/core';
import { DwellTimer } from '@phengos/core';
import { createDwellRing } from '../game/visuals.js';
import { STORE_KEY, type Store, type Target } from '../game/store.js';

const CONE_DEG = 2.5;

export class LookSystem extends createSystem({}) {
  private store!: Store;
  private dwell = new DwellTimer();
  private reticle = new Group();
  private ring = createDwellRing();
  private origin = new Vector3();
  private dir = new Vector3();
  private tmp = new Vector3();
  private q = new Quaternion();
  private m = new Matrix4();
  private gazeSource: XRInputSource | null = null;

  init(): void {
    this.store = this.world.globals[STORE_KEY] as Store;
    this.reticle.name = 'look-reticle';
    this.reticle.add(this.ring.base, this.ring.mesh);
    this.reticle.visible = false;
    this.world.createTransformEntity(this.reticle, { persistent: true });
    const onSources = () => this.findGaze();
    const onStart = () => {
      const session = this.xrManager.getSession();
      session?.addEventListener('inputsourceschange', onSources);
      this.findGaze();
    };
    this.xrManager.addEventListener('sessionstart', onStart);
    this.cleanupFuncs.push(() => this.xrManager.removeEventListener('sessionstart', onStart));
  }

  private findGaze(): void {
    const session = this.xrManager.getSession();
    this.gazeSource = null;
    if (session) for (const s of session.inputSources) if (s.targetRayMode === 'gaze') this.gazeSource = s;
    this.store.gazeAvailable = this.gazeSource !== null;
  }

  /** Aim ray: the eye-gaze ray where the runtime has one, else the head. */
  private computeAim(): 'eyes' | 'head' {
    this.player.head.getWorldPosition(this.origin);
    this.player.head.getWorldQuaternion(this.q);
    this.dir.set(0, 0, -1).applyQuaternion(this.q);
    const s = this.store;
    s.head.x = this.origin.x;
    s.head.y = this.origin.y;
    s.head.z = this.origin.z;
    this.tmp.copy(this.dir).setY(0);
    if (this.tmp.lengthSq() > 1e-6) {
      this.tmp.normalize();
      s.forward.x = this.tmp.x;
      s.forward.y = 0;
      s.forward.z = this.tmp.z;
    }
    const frame = this.xrFrame;
    const ref = this.xrManager.getReferenceSpace();
    if (this.gazeSource && frame && ref) {
      const pose = frame.getPose(this.gazeSource.targetRaySpace, ref);
      if (pose) {
        this.m.fromArray(pose.transform.matrix);
        // Reference space to world: the player rig transform.
        this.m.premultiply(this.player.matrixWorld);
        this.origin.setFromMatrixPosition(this.m);
        this.dir.set(0, 0, -1).transformDirection(this.m);
        this.setAim();
        return 'eyes';
      }
    }
    this.setAim();
    return 'head';
  }

  private setAim(): void {
    this.store.aim.x = this.dir.x;
    this.store.aim.y = this.dir.y;
    this.store.aim.z = this.dir.z;
  }

  private pick(targets: Target[]): { target: Target; dist: number } | null {
    let best: Target | null = null;
    let bestScore = Infinity;
    let bestDist = 1.5;
    for (const t of targets) {
      t.object.getWorldPosition(this.tmp);
      const d = this.tmp.distanceTo(this.origin);
      if (d < 0.05) continue;
      this.tmp.sub(this.origin).normalize();
      const angle = (Math.acos(Math.min(1, Math.max(-1, this.tmp.dot(this.dir)))) * 180) / Math.PI;
      // Lights: the 2.5 degree cone plus the light's own angular radius.
      const limit = t.kind === 'light' ? CONE_DEG + (Math.atan2(0.075, d) * 180) / Math.PI : Math.max(CONE_DEG, t.radiusDeg);
      if (angle <= limit && angle < bestScore) {
        bestScore = angle;
        best = t;
        bestDist = d;
      }
    }
    return best ? { target: best, dist: bestDist } : null;
  }

  update(delta: number): void {
    const s = this.store;
    const source = this.computeAim();
    this.dwell.dwellSec = s.settings.dwellSec;
    const onboarding = s.phase === 'onboarding';
    const active = s.inXR && (onboarding || (s.modeChosen && s.settings.mode === 'look') || (s.menuOpen && s.settings.mode === 'look'));
    if (!active) {
      if (this.dwell.target) this.dwell.reset();
      s.dwellTarget = null;
      s.dwellProgress = 0;
      this.reticle.visible = false;
      return;
    }
    const hit = this.pick(s.activeTargets());
    const events = this.dwell.update(hit ? hit.target.id : null, delta);
    s.dwellTarget = this.dwell.target;
    s.dwellProgress = this.dwell.progress;
    for (const ev of events) {
      if (ev.type !== 'fire') continue;
      const t = s.lightTargets.get(ev.target) ?? s.controlTargets.get(ev.target);
      t?.activate(source === 'eyes' ? 'eyes' : 'look');
    }
    // The reticle sits on the target (or 1.5 m out), facing you.
    const d = hit ? hit.dist : 1.5;
    this.reticle.position.copy(this.origin).addScaledVector(this.dir, Math.max(0.4, d - 0.12));
    this.player.head.getWorldQuaternion(this.reticle.quaternion);
    const sc = Math.max(0.6, d / 1.2);
    this.reticle.scale.setScalar(sc);
    this.ring.setProgress(this.dwell.progress);
    // Onboarding shows the reticle only once you start looking at the light.
    this.reticle.visible = !onboarding || this.dwell.target !== null;
  }
}
