import * as THREE from "three";

export interface JointPose {
  rx?: number;
  ry?: number;
  rz?: number;
  px?: number;
  py?: number;
  pz?: number;
  s?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}
export type Pose = Record<string, JointPose>;

export interface AnimCtx {
  /** velocity (world) */
  vx: number;
  vy: number;
  grounded: boolean;
  /** horizontal speed relative to facing (positive = forward) */
  fwd: number;
  /** +1 facing +X, -1 facing -X */
  facing: number;
  hpRatio: number;
  seed: number;
}

export type AnimFn = (t: number, p: Pose, c: AnimCtx) => void;

interface RestPose {
  p: THREE.Vector3;
  r: THREE.Euler;
  s: THREE.Vector3;
}

const WHITE = new THREE.Color(1, 1, 1);

/* ------------------------------------------------------------------ */
/* Curve helpers for keyframed attacks                                 */
/* ------------------------------------------------------------------ */

export const smooth = (x: number) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};
export const easeOut = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
export const easeIn = (x: number) => Math.pow(Math.max(0, Math.min(1, x)), 3);

/** Piecewise smooth interpolation through [time, value] keys. */
export function kf(t: number, keys: [number, number][], ease: (x: number) => number = smooth): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      const u = (t - t0) / Math.max(1e-6, t1 - t0);
      return v0 + (v1 - v0) * ease(u);
    }
  }
  return keys[keys.length - 1][1];
}

/** Impulse envelope: rises quickly to 1 at `peak`, falls to 0 at `end`. */
export function pulse(t: number, start: number, peak: number, end: number) {
  if (t < start || t > end) return 0;
  if (t < peak) return smooth((t - start) / Math.max(1e-6, peak - start));
  return 1 - smooth((t - peak) / Math.max(1e-6, end - peak));
}

/** Decaying oscillation used for hit shivers and wobbles. */
export function shiver(t: number, freq: number, decay: number) {
  return Math.sin(t * freq) * Math.exp(-t * decay);
}

/* ------------------------------------------------------------------ */
/* Rig                                                                 */
/* ------------------------------------------------------------------ */

export class Rig {
  root = new THREE.Group();
  joints: Record<string, THREE.Object3D> = {};
  rest: Record<string, RestPose> = {};
  anims: Record<string, AnimFn> = {};
  blendSpeed: Record<string, number> = {};
  /** joints that snap to the pose instead of blending (spins etc.) */
  instant = new Set<string>();
  current = "idle";
  time = 0;
  flashMaterials: THREE.MeshStandardMaterial[] = [];
  private baseEmissive: { c: THREE.Color; i: number }[] = [];
  private flashAmount = 0;
  private emissiveDirty = false;
  /** persistent status glow (poison etc.), 0..1 */
  tintAmount = 0;
  tintColor = new THREE.Color(0x7dff5a);
  private defaultBlend = 14;

  /** Register a named joint. */
  joint(name: string, obj: THREE.Object3D, parent: THREE.Object3D): THREE.Object3D {
    parent.add(obj);
    this.joints[name] = obj;
    this.rest[name] = { p: obj.position.clone(), r: obj.rotation.clone(), s: obj.scale.clone() };
    return obj;
  }

  /** Re-capture the rest pose for a joint after adjusting it. */
  captureRest(name: string) {
    const obj = this.joints[name];
    this.rest[name] = { p: obj.position.clone(), r: obj.rotation.clone(), s: obj.scale.clone() };
  }

  registerFlash(mats: THREE.MeshStandardMaterial[]) {
    for (const m of mats) {
      this.flashMaterials.push(m);
      this.baseEmissive.push({ c: m.emissive.clone(), i: m.emissiveIntensity });
    }
  }

  play(name: string, force = false) {
    if (name !== this.current || force) {
      this.current = name;
      this.time = 0;
    }
  }

  flash(amount = 1) {
    this.flashAmount = Math.max(this.flashAmount, amount);
  }

  update(dt: number, ctx: AnimCtx) {
    this.time += dt;
    const pose: Pose = {};
    const fn = this.anims[this.current] ?? this.anims.idle;
    fn?.(this.time, pose, ctx);
    const speed = this.blendSpeed[this.current] ?? this.defaultBlend;
    const k = 1 - Math.exp(-speed * dt);
    for (const name in this.joints) {
      const j = this.joints[name];
      const r = this.rest[name];
      const o = pose[name];
      const kk = this.instant.has(name) ? 1 : k;
      const trx = r.r.x + (o?.rx ?? 0);
      const tryy = r.r.y + (o?.ry ?? 0);
      const trz = r.r.z + (o?.rz ?? 0);
      j.rotation.x += (trx - j.rotation.x) * kk;
      j.rotation.y += (tryy - j.rotation.y) * kk;
      j.rotation.z += (trz - j.rotation.z) * kk;
      const tpx = r.p.x + (o?.px ?? 0);
      const tpy = r.p.y + (o?.py ?? 0);
      const tpz = r.p.z + (o?.pz ?? 0);
      j.position.x += (tpx - j.position.x) * kk;
      j.position.y += (tpy - j.position.y) * kk;
      j.position.z += (tpz - j.position.z) * kk;
      const s = o?.s ?? 1;
      const tsx = r.s.x * s * (o?.sx ?? 1);
      const tsy = r.s.y * s * (o?.sy ?? 1);
      const tsz = r.s.z * s * (o?.sz ?? 1);
      j.scale.x += (tsx - j.scale.x) * kk;
      j.scale.y += (tsy - j.scale.y) * kk;
      j.scale.z += (tsz - j.scale.z) * kk;
    }
    // damage flash + status tint
    const f = this.flashAmount;
    const tint = this.tintAmount;
    if (f > 0.001 || tint > 0.001) {
      this.flashAmount = f > 0.001 ? f * Math.exp(-dt * 12) : 0;
      for (let i = 0; i < this.flashMaterials.length; i++) {
        const m = this.flashMaterials[i];
        const b = this.baseEmissive[i];
        m.emissive.copy(b.c);
        if (tint > 0.001) m.emissive.lerp(this.tintColor, tint * 0.55);
        if (f > 0.001) m.emissive.lerp(WHITE, f * 0.9);
        m.emissiveIntensity = b.i * (1 - f) + f * 1.6 + tint * 0.45;
      }
      this.emissiveDirty = true;
    } else if (this.emissiveDirty) {
      this.emissiveDirty = false;
      this.flashAmount = 0;
      for (let i = 0; i < this.flashMaterials.length; i++) {
        const m = this.flashMaterials[i];
        const b = this.baseEmissive[i];
        m.emissive.copy(b.c);
        m.emissiveIntensity = b.i;
      }
    }
  }

  /** Apply the current animation instantly (used on reset). */
  snap(ctx: AnimCtx) {
    const saved = new Set(this.instant);
    for (const n in this.joints) this.instant.add(n);
    this.update(0.0001, ctx);
    this.instant = saved;
  }
}

/* ------------------------------------------------------------------ */
/* Character rig contract shared by both fighters                       */
/* ------------------------------------------------------------------ */

export interface CharacterFXHooks {
  steam(p: THREE.Vector3, count?: number, color?: number, size?: number): void;
  embers(p: THREE.Vector3, count: number, color?: number): void;
  dustPuff(p: THREE.Vector3, count?: number, size?: number, color?: number, spread?: number, up?: number): void;
}

export abstract class CharacterRig extends Rig {
  abstract readonly accent: number;
  abstract readonly sparkColor: number;
  /** World position of the chest / center of mass. */
  abstract chestWorld(out: THREE.Vector3): THREE.Vector3;
  /** World position of the striking part for a given move id. */
  abstract strikeWorld(move: string, out: THREE.Vector3): THREE.Vector3;
  /** Per-frame secondary animation (eye glow, fur jiggle, vents). */
  abstract tick(dt: number, time: number, fx: CharacterFXHooks | null, state: string): void;
  /** Called when a special is charging (0..1) so eyes can flare etc. */
  charge = 0;
  /** Physical impulse (landing, swinging) for secondary motion such as fur jiggle. */
  impulse(_amount: number): void {}
  /** World position where a grabbed opponent is held (grapplers override this). */
  grabAnchorWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.chestWorld(out);
  }
}
