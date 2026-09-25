import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { AnimCtx, CharacterFXHooks, CharacterRig } from "../Rig";
import { glowTexture } from "../textures";
import type { ClipBinding, RootYPolicy, SkinnedBinding, SocketDef, StateKey } from "./bindings";
import { STATE_KEYS } from "./bindings";

/**
 * SkinnedRig — the adapter that lets an imported, skinned GLB satisfy the exact same game-facing
 * contract as the procedural rigs (`root`, `play`, `update`, `snap`, `flash`, `tintAmount`,
 * `charge`, `chestWorld`, `strikeWorld`, `grabAnchorWorld`, `tick`, `impulse`).
 *
 * Division of labour, per docs/09:
 *   - `Fighter` owns world X/Y motion, facing, gravity, stun, hit windows and move time.
 *   - an `AnimationMixer` owns imported bone animation (quaternion tracks, imported skeleton,
 *     inverse bind matrices and skin weights left intact).
 *   - this class owns the state->clip binding, root-motion neutralisation, scale/ground
 *     normalisation (once, at import), sockets, per-instance material clones and the authored
 *     procedural overlays (tongue, guard, recoil, charge, props).
 *
 * The mixer is advanced by the *simulation* dt (hit-stop and pause included), never wall clock.
 */

const SRC_FPS = 30;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e1 = new THREE.Euler();

interface ProcessedClip {
  clip: THREE.AnimationClip;
  binding: ClipBinding;
  /** timeScale that makes the (trimmed) clip last exactly the state/move duration */
  baseSpeed: number;
}

type ClipMap = Map<StateKey, ProcessedClip | null>;

/** Processed clips are immutable and shared between instances of the same GLB. */
const clipCache = new WeakMap<THREE.Object3D, ClipMap>();

/* ------------------------------------------------------------------ */
/* Root motion neutralisation                                          */
/* ------------------------------------------------------------------ */

function stripRootMotion(clip: THREE.AnimationClip, b: SkinnedBinding, policy: RootYPolicy): THREE.AnimationClip {
  const trackName = `${b.rootBone}.position`;
  const idx = clip.tracks.findIndex((t) => t.name === trackName);
  if (idx < 0) return clip;
  const src = clip.tracks[idx] as THREE.VectorKeyframeTrack;
  const n = src.times.length;
  if (n === 0) return clip;
  const { lateral, forward, up, upSign } = b.axes;
  const sv = src.values as ArrayLike<number>;
  const lat0 = sv[lateral];
  const fwd0 = sv[forward];
  const up0 = sv[up];
  let mean = 0;
  if (policy === "bob") {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sv[i * 3 + up] * upSign;
    mean = sum / n;
  }
  const values = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = sv[i * 3];
    const y = sv[i * 3 + 1];
    const z = sv[i * 3 + 2];
    values[i * 3] = x;
    values[i * 3 + 1] = y;
    values[i * 3 + 2] = z;
    // lateral + forward travel is always neutralised: Fighter owns travel, lunge and knockback
    values[i * 3 + lateral] = lat0;
    values[i * 3 + forward] = fwd0;
    if (policy === "keep") values[i * 3 + up] = sv[i * 3 + up];
    else if (policy === "bob") values[i * 3 + up] = up0 + (sv[i * 3 + up] * upSign - mean) * upSign;
    else values[i * 3 + up] = up0;
  }
  const track = new THREE.VectorKeyframeTrack(trackName, Float32Array.from(src.times as ArrayLike<number>), values, src.getInterpolation());
  const tracks = clip.tracks.slice();
  tracks[idx] = track;
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function prepareClips(gltf: GLTF, b: SkinnedBinding): ClipMap {
  const cached = clipCache.get(gltf.scene);
  if (cached) return cached;
  const byName = new Map<string, THREE.AnimationClip>();
  for (const c of gltf.animations) byName.set(c.name, c);
  const out: ClipMap = new Map();
  for (const key of STATE_KEYS) {
    const cb = b.states[key];
    if (!cb || !cb.clip) {
      out.set(key, null);
      continue;
    }
    const src = byName.get(cb.clip);
    if (!src) {
      console.warn(`[skinned] ${b.id}: clip "${cb.clip}" for state "${key}" is missing from the GLB`);
      out.set(key, null);
      continue;
    }
    let clip = src;
    if (cb.trim) {
      const f0 = Math.max(0, Math.round(cb.trim[0] * SRC_FPS));
      const f1 = Math.min(Math.round(src.duration * SRC_FPS), Math.round(cb.trim[1] * SRC_FPS));
      if (f1 - f0 >= 2) {
        try {
          clip = THREE.AnimationUtils.subclip(src, src.name, f0, f1, SRC_FPS);
        } catch (err) {
          console.warn(`[skinned] ${b.id}: subclip failed for "${cb.clip}"`, err);
          clip = src;
        }
      }
    }
    clip = stripRootMotion(clip, b, cb.rootY ?? "strip");
    if (clip.duration <= 0.001) {
      out.set(key, null);
      continue;
    }
    const baseSpeed = cb.fit ? THREE.MathUtils.clamp(clip.duration / cb.fit, 0.05, 8) : (cb.speed ?? 1);
    out.set(key, { clip, binding: cb, baseSpeed });
  }
  clipCache.set(gltf.scene, out);
  return out;
}

/* ------------------------------------------------------------------ */
/* Rig                                                                 */
/* ------------------------------------------------------------------ */

export class SkinnedRig extends CharacterRig {
  readonly accent: number;
  readonly sparkColor: number;

  private binding: SkinnedBinding;
  private model: THREE.Object3D;
  private holder = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private clips: ClipMap;
  private actions = new Map<StateKey, THREE.AnimationAction>();
  private currentAction: THREE.AnimationAction | null = null;
  private active: ProcessedClip | null = null;
  private stateName: StateKey = "idle";
  private bones = new Map<string, THREE.Object3D>();
  private overlayBones: THREE.Object3D[] = [];
  private overlayBase: THREE.Quaternion[] = [];
  private normScale = 1;
  private baseY = 0;
  private refWalkSpeed = 3.4;
  private recoilAmt = 0;
  private jiggle = 0;
  private jiggleV = 0;
  private instanceMats: THREE.Material[] = [];
  private chargeGlow: THREE.Sprite;
  private tongue: {
    group: THREE.Group;
    tipMesh: THREE.Mesh;
    bone: THREE.Object3D | null;
    offset: THREE.Vector3;
    len: number;
  } | null = null;
  private props: THREE.Group | null = null;
  private propAnchors: { bone: THREE.Object3D | null; offset: THREE.Vector3; rot: THREE.Euler; mirror: number }[] = [];
  private feet: (THREE.Object3D | null)[] = [];
  private stepPhase = 0;
  private lastStepBucket = -1;
  private disposed = false;

  constructor(binding: SkinnedBinding, gltf: GLTF, refWalkSpeed = 3.4) {
    super();
    this.binding = binding;
    this.accent = binding.accent;
    this.sparkColor = binding.sparkColor;
    this.refWalkSpeed = refWalkSpeed;
    this.clips = prepareClips(gltf, binding);

    // per-instance skeleton clone: two fighters from one GLB must never share a mutable pose
    this.model = SkeletonUtils.clone(gltf.scene);
    this.model.traverse((o) => {
      if (o.name) this.bones.set(o.name, o);
    });

    /* ---- normalise ONCE at import: scale to game height, ground the feet, centre on X/Z ----
       Per docs/09 this must never be repeated per animation. */
    this.model.updateMatrixWorld(true);
    const top = this.bones.get(binding.measureBones.top);
    const bottoms = binding.measureBones.bottom.map((n) => this.bones.get(n)).filter(Boolean) as THREE.Object3D[];
    const box = new THREE.Box3().setFromObject(this.model);
    let topY = box.max.y;
    let minY = box.min.y;
    if (top && bottoms.length) {
      topY = top.getWorldPosition(_v1).y;
      minY = Math.min(...bottoms.map((o) => o.getWorldPosition(_v1).y));
    }
    const span = Math.max(0.2, topY - minY);
    // bones sit inside the head/feet, so add a little to reach the visual silhouette height
    this.normScale = (binding.height * 1.06) / span;
    // ground on the lowest of (foot bone, bind-pose mesh) so soles never sink through Y=0
    const floorY = Math.min(minY, box.min.y);
    this.baseY = -floorY * this.normScale;
    this.holder.scale.setScalar(this.normScale);
    this.holder.position.y = this.baseY;
    const hips = this.bones.get(binding.rootBone);
    if (hips) {
      hips.getWorldPosition(_v1);
      this.holder.position.x = -_v1.x * this.normScale;
      this.holder.position.z = -_v1.z * this.normScale;
    }
    this.holder.add(this.model);
    this.root.add(this.holder);

    /* ---- per-instance materials so flash/tint never mutates shared state ---- */
    const seen = new Set<THREE.Material>();
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
      const src = mesh.material as THREE.Material | THREE.Material[];
      const list = Array.isArray(src) ? src : [src];
      const cloned: THREE.Material[] = [];
      for (const m of list) {
        if (!m) continue;
        const c = m.clone();
        c.needsUpdate = true;
        cloned.push(c);
        this.instanceMats.push(c);
        if (!seen.has(m) && "emissive" in c) seen.add(m);
      }
      mesh.material = Array.isArray(src) ? cloned : cloned[0];
      // skinned meshes are culled from their bind-pose bounds, which is wrong once animated
      mesh.frustumCulled = false;
    });
    this.registerFlash(this.instanceMats.filter((m) => "emissive" in m) as THREE.MeshStandardMaterial[]);

    /* ---- mixer + one action per state ---- */
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const key of STATE_KEYS) {
      const pc = this.clips.get(key);
      if (!pc) continue;
      const a = this.mixer.clipAction(pc.clip, this.model);
      a.setLoop(pc.binding.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = pc.binding.holdLast !== false;
      a.enabled = true;
      a.setEffectiveWeight(1);
      this.actions.set(key, a);
    }

    /* ---- overlay bone set (snapshot/restore so overlays can never accumulate) ---- */
    const names = new Set<string>();
    if (binding.spineBones) binding.spineBones.forEach((n) => names.add(n));
    if (binding.guardBones) [...binding.guardBones.arm, ...binding.guardBones.forearm].forEach((n) => names.add(n));
    for (const n of names) {
      const o = this.bones.get(n);
      if (o) {
        this.overlayBones.push(o);
        this.overlayBase.push(new THREE.Quaternion());
      }
    }

    /* ---- charge glow (additive, no shared texture mutation) ---- */
    this.chargeGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: binding.accent, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }),
    );
    this.chargeGlow.scale.setScalar(1.6);
    this.chargeGlow.position.set(0, binding.height * 0.55, 0);
    this.root.add(this.chargeGlow);

    /* ---- authored tongue (King Croak: the punch clips are body-motion references only) ---- */
    if (binding.tongue) {
      const t = binding.tongue;
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: t.color, roughness: 0.35, metalness: 0, emissive: 0x2a0710, emissiveIntensity: 0.6 });
      this.instanceMats.push(mat);
      const shaft = new THREE.CylinderGeometry(t.radius * 0.8, t.radius, 1, 10);
      shaft.rotateX(Math.PI / 2);
      shaft.translate(0, 0, 0.5);
      group.add(new THREE.Mesh(shaft, mat));
      const tipMesh = new THREE.Mesh(new THREE.SphereGeometry(t.radius * 1.6, 12, 9), mat);
      tipMesh.position.z = 1;
      group.add(tipMesh);
      group.scale.z = t.rest;
      group.visible = false;
      this.root.add(group);
      this.tongue = { group, tipMesh, bone: this.bones.get(t.bone) ?? null, offset: new THREE.Vector3(...t.offset), len: 0 };
    }

    /* ---- optional props: the dog's axes are equipped for the special only ---- */
    if (binding.props) {
      const g = new THREE.Group();
      g.visible = false;
      const wood = new THREE.MeshStandardMaterial({ color: 0x5b3a21, roughness: 0.85 });
      const steel = new THREE.MeshStandardMaterial({ color: 0xdfe7ee, roughness: 0.28, metalness: 0.95, emissive: 0x1a2a33, emissiveIntensity: 0.5 });
      this.instanceMats.push(wood, steel);
      const handle = new THREE.CylinderGeometry(0.035, 0.042, 0.72, 8);
      const bladeGeo = new THREE.BoxGeometry(0.05, 0.3, 0.22);
      bladeGeo.translate(0, 0.16, 0.06);
      const build = () => {
        const axe = new THREE.Group();
        axe.add(new THREE.Mesh(handle, wood));
        const blade = new THREE.Mesh(bladeGeo, steel);
        blade.position.y = 0.3;
        axe.add(blade);
        return axe;
      };
      for (const side of [binding.props.left, binding.props.right]) {
        if (!side) continue;
        const axe = build();
        axe.scale.setScalar(side.scale * 0.9);
        g.add(axe);
        this.propAnchors.push({
          bone: this.bones.get(side.bone) ?? null,
          offset: new THREE.Vector3(...side.offset),
          rot: new THREE.Euler(...side.rotation),
          mirror: side.mirrored ? -1 : 1,
        });
      }
      this.props = g;
      this.root.add(g);
    }

    /* ---- foot sockets for cosmetic footfall kick-up ---- */
    this.feet = binding.measureBones.bottom.map((n) => this.bones.get(n) ?? null);

    this.play("idle", true);
  }

  /* ------------------------------------------------------------------ */
  /* State switching                                                     */
  /* ------------------------------------------------------------------ */

  override play(name: string, force = false) {
    super.play(name, force);
    const key = (STATE_KEYS as string[]).includes(name) ? (name as StateKey) : "idle";
    if (!force && key === this.stateName) return;
    this.stateName = key;
    const pc = this.clips.get(key) ?? this.clips.get("idle") ?? null;
    this.active = pc;
    const action = pc ? (this.actions.get(key) ?? this.actions.get("idle") ?? null) : null;
    if (!action) return;
    const fade = pc?.binding.fade ?? 0.12;
    if (this.currentAction && this.currentAction !== action) this.currentAction.fadeOut(fade);
    action.reset();
    action.setEffectiveTimeScale(Math.abs(pc?.baseSpeed ?? 1));
    action.setEffectiveWeight(1);
    if (pc?.binding.reverse) action.time = pc.clip.duration;
    action.fadeIn(fade);
    action.play();
    this.currentAction = action;
    if (this.props) this.props.visible = pc?.binding.overlay === "axes";
    if (this.tongue && !pc?.binding.overlay?.startsWith("tongue")) {
      this.tongue.len = 0;
      this.tongue.group.scale.z = this.binding.tongue!.rest;
      this.tongue.group.visible = false;
    }
    this.charge = 0;
  }

  override flash(amount = 1) {
    super.flash(amount);
    this.recoilAmt = Math.max(this.recoilAmt, Math.min(1, amount));
  }

  override impulse(amount: number) {
    this.jiggleV += amount * 5.5;
    if (this.tongue) this.tongue.len = Math.max(this.tongue.len, 0);
  }

  override update(dt: number, ctx: AnimCtx) {
    // advances this.time (state time) and runs the shared flash/tint emissive path
    super.update(dt, ctx);
    if (this.disposed) return;
    const t = this.time;
    const b = this.active?.binding;

    /* playback rate: gait cadence follows real travel speed, air phases follow real vy */
    let rate = 1;
    if ((this.stateName === "walkF" || this.stateName === "walkB") && this.currentAction) {
      rate = THREE.MathUtils.clamp(Math.abs(ctx.fwd) / this.refWalkSpeed, 0.5, 1.6);
    } else if (this.stateName === "jump" && this.currentAction) {
      rate = THREE.MathUtils.clamp(0.55 + Math.abs(ctx.vy) / 9, 0.45, 1.4);
    } else if (this.stateName === "launched" && this.currentAction) {
      rate = THREE.MathUtils.clamp(0.7 + Math.abs(ctx.vy) / 14, 0.55, 1.2);
    }
    if (this.currentAction && this.active) {
      const sign = b?.reverse ? -1 : 1;
      this.currentAction.setEffectiveTimeScale(Math.abs(this.active.baseSpeed) * rate * sign);
    }
    this.mixer.update(dt);

    /* secondary motion spring (landing / swing impulses) */
    this.jiggleV += -this.jiggle * 90 * dt - this.jiggleV * 9 * dt;
    this.jiggle += this.jiggleV * dt;
    this.jiggle = THREE.MathUtils.clamp(this.jiggle, -0.25, 0.25);
    this.holder.rotation.x = this.jiggle * 0.12;
    this.holder.position.y = this.baseY + this.jiggle * 0.05;

    this.recoilAmt *= Math.exp(-dt * 9);

    /* snapshot mixer output for the overlay bones, then apply authored overlays */
    for (let i = 0; i < this.overlayBones.length; i++) this.overlayBase[i].copy(this.overlayBones[i].quaternion);
    this.applyOverlay(t, dt, ctx);

    this.root.updateMatrixWorld(true);
    this.updateTongue(t, dt);
    this.updateProps();
    this.updateChargeGlow(dt);
  }

  /* ------------------------------------------------------------------ */
  /* Authored procedural overlays                                        */
  /* ------------------------------------------------------------------ */

  private overlayBone(i: number): THREE.Object3D | null {
    return this.overlayBones[i] ?? null;
  }

  /** rotate an overlay bone relative to the mixer's pose for this frame */
  private rot(bone: THREE.Object3D | null, x: number, y: number, z: number) {
    if (!bone) return;
    _e1.set(x, y, z);
    _q1.setFromEuler(_e1);
    bone.quaternion.multiply(_q1);
  }

  private spine(i: number) {
    return this.binding.spineBones ? this.bones.get(this.binding.spineBones[i]) ?? null : null;
  }

  private arms(): [THREE.Object3D | null, THREE.Object3D | null] {
    const g = this.binding.guardBones;
    if (!g) return [null, null];
    return [this.bones.get(g.arm[0]) ?? null, this.bones.get(g.arm[1]) ?? null];
  }

  private forearms(): [THREE.Object3D | null, THREE.Object3D | null] {
    const g = this.binding.guardBones;
    if (!g) return [null, null];
    return [this.bones.get(g.forearm[0]) ?? null, this.bones.get(g.forearm[1]) ?? null];
  }

  private applyOverlay(t: number, dt: number, ctx: AnimCtx) {
    const id = this.active?.binding.overlay;
    const [armL, armR] = this.arms();
    const [faL, faR] = this.forearms();
    const spineMid = this.spine(1);
    const head = this.spine(2);

    switch (id) {
      case "breathe": {
        const br = Math.sin(t * 2.4);
        this.rot(spineMid, br * 0.018, 0, br * 0.012);
        this.rot(head, -br * 0.02, Math.sin(t * 0.6) * 0.05, 0);
        break;
      }
      case "backLean": {
        const lean = THREE.MathUtils.clamp(-ctx.fwd / Math.max(0.5, this.refWalkSpeed), 0, 1);
        this.rot(spineMid, -0.16 * lean, 0, 0);
        this.rot(head, 0.12 * lean, 0, 0);
        break;
      }
      case "guard": {
        const k = 1 - Math.exp(-dt * 18);
        const g = 0.85 + Math.sin(t * 9) * 0.03;
        this.rot(armL, -1.05 * g * k, 0, 0.55 * g * k);
        this.rot(armR, -1.05 * g * k, 0, -0.55 * g * k);
        this.rot(faL, -1.5 * g * k, 0, 0);
        this.rot(faR, -1.5 * g * k, 0, 0);
        this.rot(spineMid, 0.1 * k, 0, 0);
        break;
      }
      case "bellyFlop": {
        // belly-led downward action: pitch the body forward and tuck the limbs
        const k = THREE.MathUtils.smoothstep(t, 0.05, 0.28);
        this.rot(spineMid, 0.55 * k, 0, 0);
        this.rot(head, -0.4 * k, 0, 0);
        this.rot(armL, -0.9 * k, 0, 1.1 * k);
        this.rot(armR, -0.9 * k, 0, -1.1 * k);
        this.rot(faL, -1.4 * k, 0, 0);
        this.rot(faR, -1.4 * k, 0, 0);
        break;
      }
      case "throatCharge": {
        // Toxic Croak: throat/charge response, release exactly at moves.ts fireAt (0.55s)
        const c = THREE.MathUtils.clamp(this.charge, 0, 1);
        const release = THREE.MathUtils.clamp(1 - (t - 0.55) / 0.28, 0, 1) * (t > 0.5 ? 1 : 0);
        const puff = c * 0.9 + release * 0.6;
        this.rot(spineMid, -0.22 * puff, 0, 0);
        this.rot(head, 0.42 * puff + Math.sin(t * 34) * 0.05 * release, 0, 0);
        this.rot(armL, -0.25 * puff, 0, 0.35 * puff);
        this.rot(armR, -0.25 * puff, 0, -0.35 * puff);
        break;
      }
      case "bow": {
        // authored intro: bow, then rise into the guard by the 2.5s fight start
        const bow = t < 1.05 ? THREE.MathUtils.smoothstep(t, 0.15, 0.75) : 1 - THREE.MathUtils.smoothstep(t, 1.05, 1.9);
        this.rot(spineMid, 0.5 * bow, 0, 0);
        this.rot(head, 0.28 * bow, 0, 0);
        const g = THREE.MathUtils.smoothstep(t, 1.2, 2.2);
        this.rot(armL, -0.9 * g, 0, 0.5 * g);
        this.rot(armR, -0.9 * g, 0, -0.5 * g);
        this.rot(faL, -1.35 * g, 0, 0);
        this.rot(faR, -1.35 * g, 0, 0);
        break;
      }
      case "airPhase": {
        // rising leans back, falling tucks; the clip never owns Y
        const vy = THREE.MathUtils.clamp(ctx.vy / 12, -1, 1);
        this.rot(spineMid, -vy * 0.16, 0, 0);
        this.rot(head, vy * 0.1, 0, 0);
        break;
      }
      case "tongueLight":
      case "tongueGrab":
      case "axes": {
        // small stabilising guard while the authored appendage does the work
        this.rot(armL, -0.25, 0, 0.2);
        this.rot(armR, -0.25, 0, -0.2);
        break;
      }
      default:
        break;
    }

    /* recoil is global: a hit can land during any state and must always read */
    if (this.recoilAmt > 0.002) {
      const r = this.recoilAmt;
      const sh = Math.sin(t * 46) * Math.exp(-t * 7);
      this.rot(spineMid, -0.34 * r, sh * 0.14 * r, 0);
      this.rot(head, -0.4 * r, sh * 0.2 * r, sh * 0.1 * r);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Tongue / props / charge glow                                        */
  /* ------------------------------------------------------------------ */

  private updateTongue(t: number, _dt: number) {
    const tg = this.tongue;
    if (!tg) return;
    const def = this.binding.tongue!;
    const overlay = this.active?.binding.overlay;
    let target = 0;
    if (overlay === "tongueLight") {
      // Tongue Lash: moves.ts duration 0.42, hit window 0.12-0.22
      target = this.window(t, [
        [0, 0],
        [0.09, 0.3],
        [0.13, 1],
        [0.22, 1],
        [0.32, 0.12],
        [0.42, 0],
      ]);
    } else if (overlay === "tongueGrab") {
      // Gullet Toss: duration 1.15, grab window 0.30-0.42 then a 0.50 hold
      target = this.window(t, [
        [0, 0],
        [0.22, 0.12],
        [0.3, 1],
        [0.42, 1],
        [0.92, 1],
        [1.02, 0.3],
        [1.15, 0],
      ]);
    }
    tg.len += (target - tg.len) * (target > tg.len ? 0.55 : 0.3);
    const len = Math.max(def.rest, tg.len * def.maxLen);
    tg.group.visible = tg.len > 0.02;
    tg.group.scale.z = len;
    tg.tipMesh.scale.set(1, 1, 1 / Math.max(0.01, len));
    if (tg.bone) {
      tg.bone.getWorldPosition(_v1);
      this.root.worldToLocal(_v1);
      // mouth offset is defined in model space; rotate it by the root yaw and scale to game units
      _v2.copy(tg.offset).applyQuaternion(this.root.quaternion).multiplyScalar(this.normScale);
      tg.group.position.copy(_v1).add(_v2);
      tg.bone.getWorldQuaternion(_q1);
      this.root.getWorldQuaternion(_q2);
      tg.group.quaternion.copy(_q1.invert().multiply(_q2));
    }
  }

  /** piecewise-linear envelope through [time, value] keys */
  private window(t: number, keys: [number, number][]): number {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const [t0, v0] = keys[i - 1];
        const [t1, v1] = keys[i];
        const u = (t - t0) / Math.max(1e-6, t1 - t0);
        return v0 + (v1 - v0) * u * u * (3 - 2 * u);
      }
    }
    return keys[keys.length - 1][1];
  }

  private updateProps() {
    if (!this.props) return;
    const kids = this.props.children;
    for (let i = 0; i < this.propAnchors.length; i++) {
      const a = this.propAnchors[i];
      const axe = kids[i];
      if (!axe) continue;
      if (!a.bone) continue;
      a.bone.getWorldPosition(_v1);
      this.root.worldToLocal(_v1);
      _v2.copy(a.offset).applyQuaternion(this.root.quaternion).multiplyScalar(this.normScale);
      axe.position.copy(_v1).add(_v2);
      a.bone.getWorldQuaternion(_q1);
      this.root.getWorldQuaternion(_q2);
      axe.quaternion.copy(_q1.invert().multiply(_q2)).multiply(_q2.identity().setFromEuler(a.rot));
      axe.scale.x = Math.abs(axe.scale.x) * a.mirror;
    }
  }

  private updateChargeGlow(dt: number) {
    const mat = this.chargeGlow.material as THREE.SpriteMaterial;
    const target = THREE.MathUtils.clamp(this.charge, 0, 1) * 0.85;
    mat.opacity += (target - mat.opacity) * (1 - Math.exp(-dt * 10));
    const s = 1.2 + this.charge * 1.6 + Math.sin(performance.now() * 0.012) * 0.06 * this.charge;
    this.chargeGlow.scale.setScalar(s);
    this.chargeGlow.visible = mat.opacity > 0.01;
  }

  /* ------------------------------------------------------------------ */
  /* Sockets                                                             */
  /* ------------------------------------------------------------------ */

  private socketWorld(def: SocketDef | undefined, out: THREE.Vector3, fallbackY: number): THREE.Vector3 {
    if (!def) return out.set(this.root.position.x, this.root.position.y + fallbackY, this.root.position.z);
    const bone = this.bones.get(def.bone);
    if (!bone) return out.set(this.root.position.x, this.root.position.y + fallbackY, this.root.position.z);
    this.root.updateMatrixWorld(true);
    bone.getWorldPosition(out);
    _v1.set(def.offset[0], def.offset[1], def.offset[2]).applyQuaternion(this.root.quaternion).multiplyScalar(this.normScale);
    return out.add(_v1);
  }

  override chestWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.socketWorld(this.binding.sockets.chest, out, this.binding.height * 0.55);
  }

  override strikeWorld(move: string, out: THREE.Vector3): THREE.Vector3 {
    // the tongue tip is the real contact point for King Croak's lash and grab
    if (this.tongue && (move === "light" || move === "heavy") && this.tongue.len > 0.15) {
      return out.copy(this.tongue.group.position).add(
        _v1.set(0, 0, this.tongue.group.scale.z).applyQuaternion(this.root.quaternion),
      );
    }
    const def = this.binding.sockets.strike[move] ?? this.binding.sockets.chest;
    return this.socketWorld(def, out, this.binding.height * 0.6);
  }

  override grabAnchorWorld(out: THREE.Vector3): THREE.Vector3 {
    if (this.tongue && this.tongue.len > 0.15) {
      return out.copy(this.tongue.group.position).add(
        _v1.set(0, 0, this.tongue.group.scale.z).applyQuaternion(this.root.quaternion),
      );
    }
    return this.socketWorld(this.binding.sockets.grab ?? this.binding.sockets.chest, out, this.binding.height * 0.5);
  }

  override snap(ctx: AnimCtx) {
    const a = this.currentAction;
    if (a) {
      a.reset();
      if (this.active?.binding.reverse) a.time = this.active.clip.duration;
      a.setEffectiveWeight(1);
      a.play();
      this.mixer.update(0);
    }
    super.snap(ctx);
    this.root.updateMatrixWorld(true);
  }

  /* ------------------------------------------------------------------ */
  /* Per-frame secondary animation                                       */
  /* ------------------------------------------------------------------ */

  override tick(dt: number, time: number, fx: CharacterFXHooks | null, state: string) {
    if (this.disposed) return;
    // footfall kick-up: cadence locked to the gait clip so feet do not skate silently
    if (fx && (this.stateName === "walkF" || this.stateName === "walkB")) {
      const rate = this.currentAction ? Math.abs(this.currentAction.getEffectiveTimeScale()) : 1;
      this.stepPhase += dt * rate * 2.4;
      const bucket = Math.floor(this.stepPhase);
      if (bucket !== this.lastStepBucket) {
        this.lastStepBucket = bucket;
        const foot = this.feet[bucket % Math.max(1, this.feet.length)];
        if (foot) {
          foot.getWorldPosition(_v1);
          _v1.y = Math.max(0, _v1.y * 0.2);
          fx.dustPuff(_v1, 2, 0.35, undefined, 0.7, 0.5);
        }
      }
    }
    if (!fx) return;
    if (this.charge > 0.3 && Math.random() < dt * 26) {
      this.chestWorld(_v1);
      fx.steam(_v1, 1, this.binding.accent, 0.28);
    }
    if (state === "ko" && Math.random() < dt * 1.4) {
      this.chestWorld(_v1);
      fx.steam(_v1, 1, 0xb9c6d0, 0.4);
    }
    void time;
  }

  /** diagnostics for the in-game animation review panel */
  describe(): { state: StateKey; clip: string | null; note: string | undefined; ok: boolean }[] {
    return STATE_KEYS.map((k) => {
      const pc = this.clips.get(k);
      return {
        state: k,
        clip: pc ? this.binding.states[k].clip : null,
        note: this.binding.states[k]?.note,
        ok: !!pc,
      };
    });
  }

  disposeRig() {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.actions.clear();
    for (const m of this.instanceMats) m.dispose();
    this.instanceMats = [];
    (this.chargeGlow.material as THREE.SpriteMaterial).dispose();
    this.bones.clear();
  }
}

/** Convenience type guard for Game.dispose. */
export function isSkinnedRig(r: unknown): r is SkinnedRig {
  return r instanceof SkinnedRig;
}
