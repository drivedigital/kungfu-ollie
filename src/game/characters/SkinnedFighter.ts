import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { AnimCtx, CharacterFXHooks, CharacterRig } from "../Rig";
import { FIGHTERS } from "../moves";
import { glowTexture } from "../textures";
import type { FighterSource } from "../skinned/assets";
import type { ClipBinding, OverlayId, RootYPolicy, SkinnedBinding, SocketDef, StateKey } from "../skinned/bindings";
import { STATE_KEYS } from "../skinned/bindings";

/**
 * `SkinnedFighter` — the adapter that lets an imported, skinned GLB satisfy the same game-facing
 * contract as the procedural rigs (`root`, `play`, `update`, `snap`, `flash`, `tintAmount`,
 * `charge`, `chestWorld`, `strikeWorld`, `grabAnchorWorld`, `tick`, `impulse`).
 *
 * Division of labour (docs/09):
 *   - `Fighter` owns world X/Y motion, facing, gravity, stun, hit windows and move time,
 *   - an `AnimationMixer` owns imported bone animation (skinning, inverse bind matrices and
 *     weights are used exactly as imported),
 *   - this class owns state→clip binding, root-motion neutralisation, one-time scale/ground
 *     normalisation, sockets, per-instance materials and the authored procedural overlays.
 *
 * The mixer always advances by the *simulation* dt, so hit-stop and pause apply to animation too.
 *
 * Port notes (see handoff/qwen-next/README.md "Defects to fix during porting"):
 *   - state clip objects are unique per state, so two states that share a source clip can never
 *     share an `AnimationAction` (Three caches actions per mixer+clip+root),
 *   - trim endpoints are sampled exactly, never frame-rounded,
 *   - `rootY: "bob"` is a real moving-average high pass plus a clamp, not a mean subtraction,
 *   - overlay bones are restored to the mixer's pose before each mixer step, so a procedural
 *     offset can never accumulate on an unkeyed or clamped bone,
 *   - the tongue and props are placed with explicit local→world transforms and report the same
 *     point that the gameplay hit window uses,
 *   - `disposeRig()` frees instance-owned resources exactly once and never touches the cached
 *     geometry/textures that other matches reuse.
 */

const SRC_FPS = 30;
/** Vertical bob kept by the `bob` policy, in source units, after the high pass. */
const BOB_CLAMP = 0.12;
/** High-pass cutoff for the `bob` policy, in Hz. */
const BOB_CUTOFF = 1.1;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e1 = new THREE.Euler();
const FORWARD = new THREE.Vector3(0, 0, 1);

/** three's GLTFLoader strips whitespace and `.`/`:` from node names. */
const sanitize = (name: string) => name.replace(/[\s.:/]/g, "");

interface ProcessedClip {
  clip: THREE.AnimationClip;
  binding: ClipBinding;
  /** rate that makes the (trimmed) clip last exactly the state duration */
  baseSpeed: number;
}

type ClipMap = Map<StateKey, ProcessedClip | null>;

/** Processed clips are immutable, so they are shared between instances of the same parsed GLB. */
const clipCache = new WeakMap<THREE.Object3D, ClipMap>();
const reportCache = new WeakMap<THREE.Object3D, { missing: StateKey[] }>();

/* ------------------------------------------------------------------ */
/* Root motion neutralisation                                          */
/* ------------------------------------------------------------------ */

/** Moving-average high pass over one component of a track, then a hard clamp. */
function highPass(values: Float32Array, axis: number, dt: number, cutoff: number) {
  const n = values.length / 3;
  const residual = new Float32Array(n);
  if (n === 0) return residual;
  const alpha = 1 - Math.exp(-2 * Math.PI * cutoff * Math.max(dt, 1e-3));
  const trend = new Float32Array(n);
  let acc = values[axis];
  for (let i = 0; i < n; i++) {
    acc += (values[i * 3 + axis] - acc) * alpha;
    trend[i] = acc;
  }
  acc = trend[n - 1];
  for (let i = n - 1; i >= 0; i--) {
    acc += (trend[i] - acc) * alpha;
    trend[i] = acc;
  }
  for (let i = 0; i < n; i++) {
    const r = values[i * 3 + axis] - trend[i];
    residual[i] = THREE.MathUtils.clamp(r, -BOB_CLAMP, BOB_CLAMP);
  }
  return residual;
}

/**
 * Rebuild the root translation track so `Fighter` owns stage travel:
 * lateral and forward offsets are frozen at their first key, and the vertical axis follows the
 * binding's policy. Interpolation (LINEAR / STEP / CUBICSPLINE) is preserved.
 */
function stripRootMotion(clip: THREE.AnimationClip, binding: SkinnedBinding, policy: RootYPolicy): THREE.AnimationClip {
  const trackName = `${binding.rootBone}.position`;
  const idx = clip.tracks.findIndex((t) => t.name === trackName || t.name === `${sanitize(binding.rootBone)}.position`);
  if (idx < 0) return clip;
  const src = clip.tracks[idx] as THREE.VectorKeyframeTrack;
  const n = src.times.length;
  if (n === 0) return clip;

  const { lateral, forward, up, upSign } = binding.axes;
  const sv = src.values;
  const lat0 = sv[lateral];
  const fwd0 = sv[forward];
  const up0 = sv[up] * upSign;
  const dt = n > 1 ? (src.times[n - 1] - src.times[0]) / (n - 1) : 1 / SRC_FPS;
  const residual = policy === "bob" ? highPass(sv, up, dt, BOB_CUTOFF) : null;

  const values = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    values[i * 3] = sv[i * 3];
    values[i * 3 + 1] = sv[i * 3 + 1];
    values[i * 3 + 2] = sv[i * 3 + 2];
    values[i * 3 + lateral] = lat0;
    values[i * 3 + forward] = fwd0;
    if (policy === "keep") values[i * 3 + up] = sv[i * 3 + up];
    else if (residual) values[i * 3 + up] = (up0 + residual[i]) * upSign;
    else values[i * 3 + up] = up0 * upSign;
  }

  const track = new THREE.VectorKeyframeTrack(trackName, Float32Array.from(src.times), values);
  // keep a custom interpolant factory (the GLTFLoader sets one for CUBICSPLINE input)
  const custom = (src as unknown as { createInterpolant?: unknown }).createInterpolant;
  if (typeof custom === "function") (track as unknown as { createInterpolant: unknown }).createInterpolant = custom;
  const tracks = clip.tracks.slice();
  tracks[idx] = track;
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/* ------------------------------------------------------------------ */
/* Clip preparation                                                    */
/* ------------------------------------------------------------------ */

/**
 * Trim a clip to [t0, t1] with both endpoints sampled *exactly* (frame rounding would move the
 * strike pose off the hit window). Returns the source clip when the range is degenerate.
 */
function trimExact(clip: THREE.AnimationClip, t0: number, t1: number): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  let duration = 0;
  for (const track of clip.tracks) {
    const times = track.times as Float32Array;
    const stride = track.getValueSize();
    if (times.length === 0) {
      tracks.push(track.clone());
      continue;
    }
    const interpolant = (track as unknown as { createInterpolant?: () => THREE.Interpolant }).createInterpolant
      ? (track as unknown as { createInterpolant: () => THREE.Interpolant }).createInterpolant()
      : undefined;
    const sample = (t: number) => {
      const out = new Float32Array(stride);
      if (interpolant) {
        const values = interpolant.evaluate(t) as unknown as number[] | Float32Array;
        out.set(values as ArrayLike<number>);
      } else {
        // nearest key fallback
        let lo = 0;
        while (lo < times.length - 1 && times[lo + 1] <= t) lo++;
        const span = times[lo + 1] - times[lo] || 1;
        const u = THREE.MathUtils.clamp((t - times[lo]) / span, 0, 1);
        const next = Math.min(times.length - 1, lo + 1);
        for (let k = 0; k < stride; k++) {
          out[k] = track.values[lo * stride + k] + (track.values[next * stride + k] - track.values[lo * stride + k]) * u;
        }
      }
      return out;
    };
    const newTimes: number[] = [0];
    const newValues: number[] = [...sample(t0)];
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (t <= t0 || t >= t1) continue;
      newTimes.push(t - t0);
      for (let k = 0; k < stride; k++) newValues.push(track.values[i * stride + k]);
    }
    newTimes.push(t1 - t0);
    newValues.push(...sample(t1));
    duration = Math.max(duration, t1 - t0);
    const Cls = track.constructor as new (name: string, times: ArrayLike<number>, values: ArrayLike<number>) => THREE.KeyframeTrack;
    tracks.push(new Cls(track.name, Float32Array.from(newTimes), Float32Array.from(newValues)));
  }
  return new THREE.AnimationClip(clip.name, duration, tracks);
}

const warned = new WeakSet<THREE.AnimationClip>();

function prepareClips(source: FighterSource, binding: SkinnedBinding): ClipMap {
  const cached = clipCache.get(source.scene);
  if (cached) return cached;
  const byName = new Map<string, THREE.AnimationClip>();
  for (const c of source.animations) byName.set(c.name, c);
  const out: ClipMap = new Map();
  const missing: StateKey[] = [];

  for (const key of STATE_KEYS) {
    const cb = binding.states[key];
    if (!cb || !cb.clip) {
      out.set(key, null);
      missing.push(key);
      continue;
    }
    const src = byName.get(cb.clip);
    if (!src) {
      console.warn(`[skinned] ${binding.id}: clip "${cb.clip}" for state "${key}" is missing from the GLB`);
      out.set(key, null);
      missing.push(key);
      continue;
    }
    let clip = src;
    if (cb.trim) {
      const t0 = THREE.MathUtils.clamp(cb.trim[0], 0, src.duration);
      const t1 = THREE.MathUtils.clamp(cb.trim[1], 0, src.duration);
      if (t1 - t0 < 1 / SRC_FPS) {
        console.warn(`[skinned] ${binding.id}: trim ${cb.trim.join("–")} for "${key}" is degenerate in "${cb.clip}" (${src.duration.toFixed(3)} s)`);
      } else {
        if (cb.trim[1] > src.duration + 1e-4 && !warned.has(src)) {
          warned.add(src);
          console.warn(`[skinned] ${binding.id}: trim end ${cb.trim[1]} exceeds "${cb.clip}" duration ${src.duration.toFixed(3)} s — clamped`);
        }
        clip = trimExact(src, t0, t1);
      }
    } else {
      // clone so two states that share a source clip never share an AnimationAction
      clip = clip.clone();
    }
    clip = stripRootMotion(clip, binding, cb.rootY ?? "strip");
    if (clip.duration <= 1e-3) {
      out.set(key, null);
      missing.push(key);
      continue;
    }
    const baseSpeed = cb.fit && cb.fit > 0 ? THREE.MathUtils.clamp(clip.duration / cb.fit, 0.05, 8) : (cb.speed ?? 1);
    out.set(key, { clip, binding: cb, baseSpeed });
  }
  clipCache.set(source.scene, out);
  reportCache.set(source.scene, { missing });
  return out;
}

/* ------------------------------------------------------------------ */
/* Rig                                                                 */
/* ------------------------------------------------------------------ */

export interface RigReport {
  state: StateKey;
  clip: string | null;
  playable: boolean;
  provisional: boolean;
  note: string;
}

/** Cached report data for the in-game review panel and the offline harness. */
export function describeBinding(binding: SkinnedBinding): RigReport[] {
  return STATE_KEYS.map((key) => {
    const cb = binding.states[key];
    return { state: key, clip: cb.clip, playable: !!cb.clip, provisional: !!cb.provisional, note: cb.note };
  });
}

export class SkinnedFighter extends CharacterRig {
  readonly accent: number;
  readonly sparkColor: number;
  readonly binding: SkinnedBinding;
  /** states whose source clip is absent from the GLB — reported, never silently "complete" */
  readonly missingStates: StateKey[];

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
  private recoilAmt = 0;
  private jiggle = 0;
  private jiggleV = 0;
  /** smoothed ground offset; changes over ~0.1 s so a state change settles instead of popping */
  private groundOffset = 0;
  private instanceMats: THREE.Material[] = [];
  private ownedGeometries: THREE.BufferGeometry[] = [];
  private chargeGlow: THREE.Sprite;
  private glowMat: THREE.SpriteMaterial;
  private tongue: {
    group: THREE.Group;
    shaft: THREE.Mesh;
    tip: THREE.Mesh;
    bone: THREE.Object3D | null;
    /** mouth point in bone-local space (computed once from the binding's model-space point) */
    mouthLocal: THREE.Vector3;
    /** mouth-forward direction in bone-local space */
    dirLocal: THREE.Vector3;
    def: NonNullable<SkinnedBinding["tongue"]>;
    len: number;
  } | null = null;
  private props: THREE.Group | null = null;
  private propAnchors: { bone: THREE.Object3D | null; offsetLocal: THREE.Vector3; rot: THREE.Euler; mesh: THREE.Object3D }[] = [];
  private sockets = new Map<string, { bone: THREE.Object3D | null; offsetLocal: THREE.Vector3; fallback: THREE.Vector3 }>();
  private feet: (THREE.Object3D | null)[] = [];
  private stepPhase = 0;
  private lastStepBucket = -1;
  private disposed = false;

  constructor(source: FighterSource, binding: SkinnedBinding) {
    super();
    this.binding = binding;
    this.accent = binding.accent;
    this.sparkColor = binding.sparkColor;
    this.clips = prepareClips(source, binding);
    this.missingStates = reportCache.get(source.scene)?.missing ?? [];

    /* per-instance skeleton clone: two fighters from one GLB must never share a mutable pose */
    this.model = cloneSkinned(source.scene);
    this.model.traverse((o) => {
      if (o.name) {
        this.bones.set(o.name, o);
        this.bones.set(sanitize(o.name), o);
      }
    });

    /* ---- normalise ONCE at import: scale to the game height, ground the feet, centre on X/Z ---- */
    this.model.updateMatrixWorld(true); // detached from the holder here, so a local update is enough
    const box = new THREE.Box3().setFromObject(this.model);
    const bottomBones = binding.measureBones.bottom.map((n) => this.bone(n)).filter(Boolean) as THREE.Object3D[];
    let minY = box.min.y;
    if (bottomBones.length) minY = Math.min(minY, ...bottomBones.map((o) => o.getWorldPosition(_v1).y));
    // Height is the mesh silhouette, not the head *bone*: the dog's head bone sits 0.44 m below
    // the top of its head, which would inflate the whole character by a third. The head bone is
    // only a fallback for a model whose bounding box is unusable.
    const topBone = this.bone(binding.measureBones.top);
    const topY = box.max.y > box.min.y + 0.2 ? box.max.y : (topBone ? topBone.getWorldPosition(_v2).y : box.max.y);
    const span = Math.max(0.2, topY - minY);
    const gameHeight = FIGHTERS[binding.id].height;
    this.normScale = gameHeight / span;
    this.baseY = -Math.min(minY, box.min.y) * this.normScale;
    this.holder.scale.setScalar(this.normScale);
    this.groundOffset = (binding.states[this.stateName].yOffset ?? 0) * this.normScale;
    this.holder.position.y = this.baseY + this.groundOffset;
    const root = this.bone(binding.rootBone);
    if (root) {
      root.getWorldPosition(_v1);
      this.holder.position.x = -_v1.x * this.normScale;
      this.holder.position.z = -_v1.z * this.normScale;
    }
    this.holder.add(this.model);
    this.root.add(this.holder);

    /* ---- per-instance materials so flash/tint never mutates another fighter's look ---- */
    const localMaterials = new Map<THREE.Material, THREE.Material>();
    this.model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
      const src = mesh.material as THREE.Material | THREE.Material[];
      const local = (m: THREE.Material) => {
        let c = localMaterials.get(m);
        if (!c) {
          c = m.clone();
          c.needsUpdate = true;
          localMaterials.set(m, c);
        }
        return c;
      };
      mesh.material = Array.isArray(src) ? src.map(local) : local(src);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // buffers and textures belong to the asset cache
      mesh.userData.sharedGeometry = true;
      mesh.userData.sharedAssets = true;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
    });
    this.instanceMats = [...localMaterials.values()];
    this.registerFlash(this.instanceMats.filter((m) => "emissive" in m) as THREE.MeshStandardMaterial[]);

    /* ---- mixer + one action per state (each state owns a distinct clip object) ---- */
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const key of STATE_KEYS) {
      const pc = this.clips.get(key);
      if (!pc) continue;
      const action = this.mixer.clipAction(pc.clip, this.model);
      action.setLoop(pc.binding.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = pc.binding.holdLast !== false;
      action.enabled = true;
      this.actions.set(key, action);
    }

    /* ---- overlay bones (snapshot/restore so procedural offsets cannot accumulate) ---- */
    const overlayNames = new Set<string>([...binding.spineBones, ...binding.guardBones.arm, ...binding.guardBones.forearm]);
    for (const name of overlayNames) {
      const o = this.bone(name);
      if (!o) {
        console.warn(`[skinned] ${binding.id}: overlay bone "${name}" is missing from the model`);
        continue;
      }
      this.overlayBones.push(o);
      this.overlayBase.push(new THREE.Quaternion());
    }

    /* ---- sockets: convert each model-space point into bone-local space once ---- */
    for (const [name, def] of Object.entries(binding.sockets.strike)) this.addSocket(`strike:${name}`, def);
    this.addSocket("chest", binding.sockets.chest);
    this.addSocket("grab", binding.sockets.grab);

    /* ---- charge glow (its texture is shared; only the sprite material is instance-owned) ---- */
    this.glowMat = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: binding.accent,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    });
    this.chargeGlow = new THREE.Sprite(this.glowMat);
    this.chargeGlow.scale.setScalar(1.6);
    this.chargeGlow.position.set(0, gameHeight * 0.55, 0);
    this.root.add(this.chargeGlow);

    /* ---- authored tongue (King Croak's imported punch clips are body-motion references) ---- */
    if (binding.tongue) this.buildTongue(binding.tongue);

    /* ---- optional props (the dog's axes are equipped for the special only) ---- */
    if (binding.props) this.buildProps();

    /* ---- foot sockets for the cosmetic footfall kick-up ---- */
    this.feet = binding.measureBones.bottom.map((n) => this.bone(n) ?? null);

    this.play("idle", true);
  }

  /* ------------------------------------------------------------------ */
  /* Construction helpers                                                */
  /* ------------------------------------------------------------------ */

  private bone(name: string): THREE.Object3D | null {
    return this.bones.get(name) ?? this.bones.get(sanitize(name)) ?? null;
  }

  private addSocket(key: string, def: SocketDef) {
    const bone = this.bone(def.bone);
    const point = new THREE.Vector3(def.point[0], def.point[1], def.point[2]);
    let offsetLocal = point.clone();
    if (bone) {
      // model space → bone local: this also makes the socket follow the bone's own rotation.
      // updateWorldMatrix(true, …) is required here — the holder carries the import scale, and a
      // stale parent matrix would convert the model-space point into the wrong units.
      this.model.updateWorldMatrix(true, false);
      // The holder scales the model by normScale, so a model-space point must be lifted into the
      // same world space before the inverse: bone.worldToLocal(S · p) = M⁻¹ · p, which is the
      // offset we want (the holder's translation cancels out of the inversion).
      offsetLocal = bone.worldToLocal(point.multiplyScalar(this.normScale));
    } else {
      console.warn(`[skinned] ${this.binding.id}: socket bone "${def.bone}" is missing; using a root-space fallback`);
    }
    this.sockets.set(key, { bone, offsetLocal, fallback: point });
  }

  private buildTongue(def: NonNullable<SkinnedBinding["tongue"]>) {
    const bone = this.bone(def.bone);
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.35, metalness: 0, emissive: 0x2a0710, emissiveIntensity: 0.6 });
    this.instanceMats.push(mat);
    const shaftGeo = new THREE.CylinderGeometry(def.radius * 0.75, def.radius, 1, 10);
    shaftGeo.rotateX(Math.PI / 2);
    shaftGeo.translate(0, 0, 0.5);
    const shaft = new THREE.Mesh(shaftGeo, mat);
    const tipGeo = new THREE.SphereGeometry(def.radius * 1.5, 12, 9);
    const tip = new THREE.Mesh(tipGeo, mat);
    tip.position.z = 1;
    group.add(shaft, tip);
    this.ownedGeometries.push(shaftGeo, tipGeo);
    group.visible = false;
    this.root.add(group);

    const mouth = new THREE.Vector3(def.root[0], def.root[1], def.root[2]);
    let mouthLocal = mouth.clone();
    let dirLocal = new THREE.Vector3(0, 0, 1);
    if (bone) {
      this.model.updateWorldMatrix(true, false);
      mouthLocal = bone.worldToLocal(mouth.clone().multiplyScalar(this.normScale));
      // a direction: convert two nearby points and take the difference (scale cancels on normalize)
      dirLocal = bone
        .worldToLocal(mouth.clone().multiplyScalar(this.normScale).add(new THREE.Vector3(0, 0, 0.5)))
        .sub(mouthLocal)
        .normalize();
    } else {
      console.warn(`[skinned] ${this.binding.id}: tongue bone "${def.bone}" is missing`);
    }
    this.tongue = { group, shaft, tip, bone, mouthLocal, dirLocal, def, len: 0 };
  }

  private buildProps() {
    const def = this.binding.props!;
    const g = new THREE.Group();
    g.visible = false;
    const wood = new THREE.MeshStandardMaterial({ color: 0x5b3a21, roughness: 0.85 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xdfe7ee, roughness: 0.28, metalness: 0.95, emissive: 0x1a2a33, emissiveIntensity: 0.5 });
    this.instanceMats.push(wood, steel);
    const handleGeo = new THREE.CylinderGeometry(0.035, 0.042, 0.72, 8);
    const bladeGeo = new THREE.BoxGeometry(0.05, 0.3, 0.22);
    bladeGeo.translate(0, 0.16, 0.06);
    this.ownedGeometries.push(handleGeo, bladeGeo);
    for (const side of [def.left, def.right]) {
      const axe = new THREE.Group();
      axe.add(new THREE.Mesh(handleGeo, wood));
      const blade = new THREE.Mesh(bladeGeo, steel);
      blade.position.y = 0.3;
      axe.add(blade);
      g.add(axe);
      const bone = this.bone(side.bone);
      const point = new THREE.Vector3(side.point[0], side.point[1], side.point[2]);
      let offsetLocal = point.clone();
      if (bone) {
        this.model.updateWorldMatrix(true, false);
        offsetLocal = bone.worldToLocal(point.multiplyScalar(this.normScale));
      }
      this.propAnchors.push({ bone, offsetLocal, rot: new THREE.Euler(side.rotation[0], side.rotation[1], side.rotation[2]), mesh: axe });
      axe.scale.x = side.mirrored ? -1 : 1;
    }
    this.props = g;
    this.root.add(g);
  }

  /* ------------------------------------------------------------------ */
  /* State switching                                                     */
  /* ------------------------------------------------------------------ */

  /** Plays the clip for a state; `force` restarts even if the state is already active. */
  override play(name: string, force = false) {
    if (this.disposed) return;
    const key = (STATE_KEYS as string[]).includes(name) ? (name as StateKey) : "idle";
    if (!force && key === this.stateName && this.currentAction) return;
    super.play(name, force);

    const pc = this.clips.get(key) ?? null;
    if (!pc) {
      // never silently present a missing clip as complete: report it and hold the previous pose
      // (the old action keeps playing and stays tracked, so the next transition still fades it out)
      console.warn(`[skinned] ${this.binding.id}: state "${key}" has no playable clip; holding "${this.stateName}"`);
      this.stateName = key;
      return;
    }
    this.stateName = key;
    this.active = pc;
    const action = pc ? this.actions.get(key) ?? null : null;

    if (action) {
      const fade = pc!.binding.fade ?? 0.12;
      if (this.currentAction && this.currentAction !== action) this.currentAction.fadeOut(fade);
      action.reset();
      action.enabled = true;
      action.setEffectiveWeight(1);
      action.setLoop(pc!.binding.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = pc!.binding.holdLast !== false;
      const speed = Math.abs(pc!.baseSpeed) * (pc!.binding.reverse ? -1 : 1);
      action.setEffectiveTimeScale(speed);
      if (pc!.binding.reverse) action.time = pc!.clip.duration;
      action.fadeIn(fade);
      action.play();
      this.currentAction = action;
    } else {
      this.currentAction = null;
    }

    if (this.props) this.props.visible = pc?.binding.overlay === "axes";
    if (this.tongue) {
      const overlay = pc?.binding.overlay;
      if (overlay !== "tongueLight" && overlay !== "tongueGrab") {
        this.tongue.len = 0;
        this.tongue.group.visible = false;
      }
    }
    this.charge = 0;
  }

  override flash(amount = 1) {
    super.flash(amount);
    this.recoilAmt = Math.max(this.recoilAmt, Math.min(1, amount));
  }

  override impulse(amount: number) {
    this.jiggleV += amount * 5.5;
  }

  override update(dt: number, ctx: AnimCtx) {
    if (this.disposed) return;
    // undo last frame's procedural offsets before the mixer writes this frame's pose
    for (let i = 0; i < this.overlayBones.length; i++) this.overlayBones[i].quaternion.copy(this.overlayBase[i]);
    // advances this.time (state time) and runs the shared flash/tint emissive path
    super.update(dt, ctx);
    if (this.disposed) return;
    const t = this.time;

    /* playback rate: gait cadence follows real travel speed, air phases follow real vy */
    let rate = 1;
    let reverse = false;
    if (this.active) {
      const b = this.active.binding;
      reverse = !!b.reverse;
      if (this.stateName === "walkF" || this.stateName === "walkB") {
        rate = THREE.MathUtils.clamp(Math.abs(ctx.fwd) / this.binding.clipGroundSpeed, 0.45, 1.9);
      } else if (this.stateName === "jump") {
        rate = THREE.MathUtils.clamp(0.55 + Math.abs(ctx.vy) / 9, 0.45, 1.4);
      } else if (this.stateName === "launched") {
        rate = THREE.MathUtils.clamp(0.7 + Math.abs(ctx.vy) / 14, 0.55, 1.2);
      }
      if (this.currentAction) {
        this.currentAction.setEffectiveTimeScale(Math.abs(this.active.baseSpeed) * rate * (reverse ? -1 : 1));
      }
    }
    this.mixer.update(dt);

    /* secondary motion spring (landing / swing impulses) */
    this.jiggleV += -this.jiggle * 90 * dt - this.jiggleV * 9 * dt;
    this.jiggle += this.jiggleV * dt;
    this.jiggle = THREE.MathUtils.clamp(this.jiggle, -0.25, 0.25);
    this.holder.rotation.x = this.jiggle * 0.12;
    // Ground contact: the binding lifts/drops a state in *source* units when the imported clip's own
    // root height does not match the stage floor. Measured per state in the browser
    // (tools/preview/foot-contact.mjs → docs/11) and eased so nothing pops between states.
    const targetOffset = (this.active?.binding.yOffset ?? 0) * this.normScale;
    this.groundOffset += (targetOffset - this.groundOffset) * (1 - Math.exp(-dt * 10));
    this.holder.position.y = this.baseY + this.groundOffset + this.jiggle * 0.05;

    this.recoilAmt *= Math.exp(-dt * 9);

    /* snapshot the mixer's pose, then apply this frame's authored overlays on top of it */
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

  /** rotate an overlay bone relative to this frame's mixer pose */
  private rot(bone: THREE.Object3D | null, x: number, y: number, z: number) {
    if (!bone) return;
    _e1.set(x, y, z);
    _q1.setFromEuler(_e1);
    bone.quaternion.multiply(_q1);
  }

  private spine(i: 0 | 1 | 2) {
    const name = this.binding.spineBones[i];
    return name ? this.bone(name) : null;
  }

  private arm(side: 0 | 1) {
    return this.bone(this.binding.guardBones.arm[side]);
  }

  private forearm(side: 0 | 1) {
    return this.bone(this.binding.guardBones.forearm[side]);
  }

  private applyOverlay(t: number, dt: number, ctx: AnimCtx) {
    const overlay: OverlayId | undefined = this.active?.binding.overlay;
    const mid = this.spine(1);
    const head = this.spine(2);
    const armL = this.arm(0);
    const armR = this.arm(1);
    const faL = this.forearm(0);
    const faR = this.forearm(1);

    switch (overlay) {
      case "breathe": {
        const br = Math.sin(t * 2.4);
        this.rot(mid, br * 0.018, 0, br * 0.012);
        this.rot(head, -br * 0.02, Math.sin(t * 0.6) * 0.05, 0);
        break;
      }
      case "backLean": {
        const lean = THREE.MathUtils.clamp(-ctx.fwd / Math.max(0.5, this.binding.clipGroundSpeed), 0, 1);
        this.rot(mid, -0.16 * lean, 0, 0);
        this.rot(head, 0.12 * lean, 0, 0);
        break;
      }
      case "guard": {
        const g = 0.85 + Math.sin(t * 9) * 0.03;
        this.rot(armL, -1.05 * g, 0, 0.55 * g);
        this.rot(armR, -1.05 * g, 0, -0.55 * g);
        this.rot(faL, -1.5 * g, 0, 0);
        this.rot(faR, -1.5 * g, 0, 0);
        this.rot(mid, 0.1, 0, 0);
        break;
      }
      case "bellyFlop": {
        const k = THREE.MathUtils.smoothstep(t, 0.05, 0.28);
        this.rot(mid, 0.55 * k, 0, 0);
        this.rot(head, -0.4 * k, 0, 0);
        this.rot(armL, -0.9 * k, 0, 1.1 * k);
        this.rot(armR, -0.9 * k, 0, -1.1 * k);
        this.rot(faL, -1.4 * k, 0, 0);
        this.rot(faR, -1.4 * k, 0, 0);
        break;
      }
      case "throatCharge": {
        // Toxic Croak: throat charge, released exactly at moves.ts fireAt (0.55 s)
        const fireAt = FIGHTERS[this.binding.id].moves.special.fireAt ?? 0.55;
        const c = THREE.MathUtils.clamp(this.charge, 0, 1);
        const release = THREE.MathUtils.clamp(1 - (t - fireAt) / 0.28, 0, 1) * (t > fireAt - 0.05 ? 1 : 0);
        const puff = c * 0.9 + release * 0.6;
        this.rot(mid, -0.22 * puff, 0, 0);
        this.rot(head, 0.42 * puff + Math.sin(t * 34) * 0.05 * release, 0, 0);
        this.rot(armL, -0.25 * puff, 0, 0.35 * puff);
        this.rot(armR, -0.25 * puff, 0, -0.35 * puff);
        break;
      }
      case "bow": {
        const bow = t < 1.05 ? THREE.MathUtils.smoothstep(t, 0.15, 0.75) : 1 - THREE.MathUtils.smoothstep(t, 1.05, 1.9);
        this.rot(mid, 0.5 * bow, 0, 0);
        this.rot(head, 0.28 * bow, 0, 0);
        const g = THREE.MathUtils.smoothstep(t, 1.2, 2.2);
        this.rot(armL, -0.9 * g, 0, 0.5 * g);
        this.rot(armR, -0.9 * g, 0, -0.5 * g);
        this.rot(faL, -1.35 * g, 0, 0);
        this.rot(faR, -1.35 * g, 0, 0);
        break;
      }
      case "airPhase": {
        const vy = THREE.MathUtils.clamp(ctx.vy / 12, -1, 1);
        this.rot(mid, -vy * 0.16, 0, 0);
        this.rot(head, vy * 0.1, 0, 0);
        break;
      }
      case "tongueLight":
      case "tongueGrab":
      case "axes": {
        this.rot(armL, -0.25, 0, 0.2);
        this.rot(armR, -0.25, 0, -0.2);
        break;
      }
      default:
        break;
    }

    /* recoil is global: a hit can land in any state and must always read */
    if (this.recoilAmt > 0.002) {
      const r = this.recoilAmt;
      const sh = Math.sin(t * 46) * Math.exp(-t * 7);
      this.rot(mid, -0.34 * r, sh * 0.14 * r, 0);
      this.rot(head, -0.4 * r, sh * 0.2 * r, sh * 0.1 * r);
    }
    void dt;
  }

  /* ------------------------------------------------------------------ */
  /* Tongue / props / charge glow                                        */
  /* ------------------------------------------------------------------ */

  /** Tongue extension envelope, driven by the gameplay window for the state. */
  private tongueTarget(t: number): number {
    const overlay = this.active?.binding.overlay;
    if (overlay === "tongueLight") {
      // Tongue Lash: duration 0.42 s, hit window 0.12–0.22 s
      const hit = FIGHTERS[this.binding.id].moves.light.hits[0];
      const start = hit?.start ?? 0.12;
      const end = hit?.end ?? 0.22;
      const dur = FIGHTERS[this.binding.id].moves.light.duration;
      return this.envelope(t, [
        [0, 0],
        [Math.max(0, start - 0.05), 0.25],
        [start, 1],
        [end, 1],
        [Math.min(dur, end + 0.1), 0.1],
        [dur, 0],
      ]);
    }
    if (overlay === "tongueGrab") {
      // Gullet Toss: grab 0.30–0.42 s, hold 0.50 s, throw at 0.92 s
      const hit = FIGHTERS[this.binding.id].moves.heavy.hits[0];
      const start = hit?.start ?? 0.3;
      const end = hit?.end ?? 0.42;
      const hold = hit?.grab?.hold ?? 0.5;
      const dur = FIGHTERS[this.binding.id].moves.heavy.duration;
      const release = Math.min(dur, end + hold);
      return this.envelope(t, [
        [0, 0],
        [Math.max(0, start - 0.08), 0.15],
        [start, 1],
        [release, 1],
        [Math.min(dur, release + 0.12), 0.25],
        [dur, 0],
      ]);
    }
    return 0;
  }

  /** piecewise smoothstep through [time, value] keys */
  private envelope(t: number, keys: [number, number][]): number {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const [t0, v0] = keys[i - 1];
        const [t1, v1] = keys[i];
        const u = THREE.MathUtils.smoothstep(t, t0, Math.max(t0 + 1e-6, t1));
        return v0 + (v1 - v0) * u;
      }
    }
    return keys[keys.length - 1][1];
  }

  private updateTongue(t: number, _dt: number) {
    const tg = this.tongue;
    if (!tg) return;
    const target = this.tongueTarget(t);
    tg.len += (target - tg.len) * (target > tg.len ? 0.55 : 0.3);
    const len = Math.max(tg.def.rest, tg.len * tg.def.maxLen);
    tg.group.visible = tg.len > 0.02;
    tg.group.scale.z = len;
    // keep the tip a sphere while the shaft stretches
    tg.tip.scale.set(1, 1, 1 / Math.max(0.01, len));

    if (!tg.bone) return;
    // explicit local → world: mouth point, then the head's facing direction, expressed in root space
    _v1.copy(tg.mouthLocal);
    tg.bone.localToWorld(_v1);
    this.root.worldToLocal(_v1);
    tg.group.position.copy(_v1);
    tg.bone.getWorldQuaternion(_q1);
    _v2.copy(tg.dirLocal).transformDirection(tg.bone.matrixWorld);
    this.root.getWorldQuaternion(_q1).invert();
    _v2.applyQuaternion(_q1).normalize();
    // The imported punch clips pitch the head hard; a 2.5 m tongue would otherwise spear the
    // floor. Clamp the pitch so the lash stays readable and never penetrates the stage.
    if (_v2.y < -0.12) {
      _v2.y = -0.12;
      _v2.normalize();
    }
    if (_v2.lengthSq() > 1e-6) tg.group.quaternion.setFromUnitVectors(FORWARD, _v2);
  }

  private updateProps() {
    if (!this.props) return;
    if (!this.props.visible) return;
    for (const anchor of this.propAnchors) {
      if (!anchor.bone) continue;
      _v1.copy(anchor.offsetLocal);
      anchor.bone.localToWorld(_v1);
      this.root.worldToLocal(_v1);
      anchor.mesh.position.copy(_v1);
      // orientation: bone world rotation → root space, then the prop's own mounting rotation
      anchor.bone.getWorldQuaternion(_q1);
      this.root.getWorldQuaternion(_q2).invert();
      _q1.premultiply(_q2);
      anchor.mesh.quaternion.copy(_q1).multiply(_q2.setFromEuler(anchor.rot));
    }
  }

  private updateChargeGlow(dt: number) {
    const target = THREE.MathUtils.clamp(this.charge, 0, 1) * 0.85;
    this.glowMat.opacity += (target - this.glowMat.opacity) * (1 - Math.exp(-dt * 10));
    const s = 1.2 + this.charge * 1.6;
    this.chargeGlow.scale.setScalar(s);
    this.chargeGlow.visible = this.glowMat.opacity > 0.01;
  }

  /* ------------------------------------------------------------------ */
  /* Sockets                                                             */
  /* ------------------------------------------------------------------ */

  private socketWorld(key: string, out: THREE.Vector3, fallbackY: number): THREE.Vector3 {
    const s = this.sockets.get(key) ?? this.sockets.get("chest");
    if (!s || !s.bone) {
      return out.set(this.root.position.x, this.root.position.y + fallbackY, this.root.position.z);
    }
    _v1.copy(s.offsetLocal);
    s.bone.localToWorld(_v1);
    return out.copy(_v1);
  }

  override chestWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.socketWorld("chest", out, FIGHTERS[this.binding.id].height * 0.55);
  }

  /** World position of the visible striking part for a move slot. */
  override strikeWorld(move: string, out: THREE.Vector3): THREE.Vector3 {
    // the tongue tip is the real contact point for King Croak's lash and grab
    if (this.tongue && (move === "light" || move === "heavy") && this.tongue.len > 0.15) {
      return this.tongue.tip.getWorldPosition(out);
    }
    return this.socketWorld(`strike:${move}`, out, FIGHTERS[this.binding.id].height * 0.6);
  }

  override grabAnchorWorld(out: THREE.Vector3): THREE.Vector3 {
    if (this.tongue && this.tongue.len > 0.15) return this.tongue.tip.getWorldPosition(out);
    return this.socketWorld("grab", out, FIGHTERS[this.binding.id].height * 0.5);
  }

  /** How far the tongue currently reaches (world units) — used by the harness and the review HUD. */
  tongueReach(): number {
    return this.tongue && this.tongue.group.visible ? this.tongue.group.scale.z : 0;
  }

  /** World position of the tongue's mouth anchor (diagnostics: must sit at the frog's snout). */
  tongueMouthWorld(out: THREE.Vector3): THREE.Vector3 {
    if (!this.tongue) return out.set(0, 0, 0);
    return this.tongue.group.getWorldPosition(out);
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

  override tick(dt: number, _time: number, fx: CharacterFXHooks | null, state: string) {
    if (this.disposed) return;
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
      this.chestWorld(_v3);
      fx.steam(_v3, 1, this.binding.accent, 0.28);
    }
    if (state === "ko" && Math.random() < dt * 1.4) {
      this.chestWorld(_v3);
      fx.steam(_v3, 1, 0xb9c6d0, 0.4);
    }
  }

  /** Diagnostics for the animation review panel and the offline harness. */
  describe(): RigReport[] {
    return STATE_KEYS.map((key) => {
      const cb = this.binding.states[key];
      const pc = this.clips.get(key);
      return { state: key, clip: cb.clip, playable: !!pc, provisional: !!cb.provisional, note: cb.note };
    });
  }

  /** Currently playing state key (diagnostics). */
  get state(): StateKey {
    return this.stateName;
  }

  /** Release everything this instance owns. Safe to call twice; never touches cache-owned data. */
  disposeRig() {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.actions.clear();
    this.currentAction = null;
    this.active = null;
    for (const m of this.instanceMats) m.dispose();
    this.instanceMats = [];
    for (const g of this.ownedGeometries) g.dispose();
    this.ownedGeometries = [];
    this.glowMat.dispose(); // the glow *texture* is shared by every rig
    this.chargeGlow.removeFromParent();
    this.tongue?.group.removeFromParent();
    this.props?.removeFromParent();
    this.holder.removeFromParent();
    this.root.removeFromParent();
    this.bones.clear();
    this.sockets.clear();
    this.propAnchors = [];
    this.overlayBones = [];
    this.overlayBase = [];
  }
}

/** Convenience type guard for Game disposal. */
export function isSkinnedFighter(rig: unknown): rig is SkinnedFighter {
  return rig instanceof SkinnedFighter;
}
