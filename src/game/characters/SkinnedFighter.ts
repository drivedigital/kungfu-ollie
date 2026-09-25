import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { AnimCtx, CharacterFXHooks, CharacterRig } from "../Rig";

export type SkinnedId = "dog" | "toad";
export type SkinnedSource = { scene: THREE.Group; animations: THREE.AnimationClip[] };
const URLS: Record<SkinnedId, string> = {
  dog: "/models/dog-chin-corrected.glb",
  toad: "/models/kingcroak-corrected.glb",
};
const cache = new Map<SkinnedId, Promise<SkinnedSource>>();

export function loadSkinned(id: SkinnedId): Promise<SkinnedSource> {
  let pending = cache.get(id);
  if (!pending) {
    pending = new GLTFLoader().loadAsync(URLS[id]).then(({ scene, animations }) => ({ scene, animations }));
    cache.set(id, pending);
    pending.catch(() => cache.delete(id));
  }
  return pending;
}

type Binding = { clip: string; loop?: boolean; duration?: number; start?: number; end?: number; reverse?: boolean };

// Preview bindings. The combat rules and hit windows remain owned by moves.ts.
export const BINDINGS: Record<SkinnedId, Record<string, Binding>> = {
  dog: {
    idle: { clip: "Boxing", start: 0.4, end: 0.8, loop: true, duration: 1.2 },
    walkF: { clip: "Run Forward", loop: true, duration: 0.85 },
    walkB: { clip: "Run Forward", loop: true, duration: 1.1 },
    jump: { clip: "Front Twist Flip", duration: 0.9 },
    block: { clip: "Boxing", start: 0.4, end: 0.8, loop: true },
    light: { clip: "Punching Bag", duration: 0.42 },
    heavy: { clip: "Martelo 2", duration: 0.82 },
    special: { clip: "Dual Weapon Combo", duration: 1.1 },
    air: { clip: "Hurricane Kick", duration: 0.7 },
    hit: { clip: "Boxing", start: 0.4, end: 0.8, duration: 0.45 },
    launched: { clip: "Front Twist Flip", loop: true },
    down: { clip: "Run To Rolling", loop: false },
    ko: { clip: "Run To Rolling", loop: false },
    getup: { clip: "Run To Rolling", duration: 0.55, reverse: true },
    victory: { clip: "Thriller Part 3", loop: true },
    intro: { clip: "Boxing", duration: 2.5 },
  },
  toad: {
    idle: { clip: "Idle · softened", loop: true },
    walkF: { clip: "Dwarf Walk", loop: true },
    walkB: { clip: "Dwarf Walk", loop: true, duration: 1.2 },
    jump: { clip: "Jump", duration: 0.93 },
    block: { clip: "Boxing", loop: true },
    light: { clip: "Elbow Punch · open hands", duration: 0.48 },
    heavy: { clip: "Hook Punch · open hands", duration: 0.86 },
    special: { clip: "Joyful Jump", duration: 1.35 },
    air: { clip: "Capoeira · floor corrected", duration: 0.7 },
    hit: { clip: "Boxing", duration: 0.4 },
    launched: { clip: "Forward Jump", loop: true },
    down: { clip: "Dying", loop: false },
    ko: { clip: "Dying", loop: false },
    getup: { clip: "Dying", duration: 0.55, reverse: true },
    victory: { clip: "Victory · floor corrected", loop: true },
    intro: { clip: "Joyful Jump", duration: 2.5 },
  },
};

/** Preserves imported skin, bone hierarchy, quaternion tracks and PBR textures. */
export class SkinnedFighter extends CharacterRig {
  readonly accent: number;
  readonly sparkColor: number;
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private clips: Map<string, THREE.AnimationClip>;
  private actions = new Map<string, THREE.AnimationAction>();
  private active?: THREE.AnimationAction;
  private materials: THREE.MeshStandardMaterial[] = [];
  private bones: THREE.Bone[] = [];
  private normalization = new THREE.Group();
  private mouth?: THREE.Object3D;
  private tongue?: THREE.Mesh;
  private tongueTip?: THREE.Object3D;
  private id: SkinnedId;

  constructor(id: SkinnedId, source: SkinnedSource) {
    super();
    this.id = id;
    this.accent = id === "dog" ? 0x44b5ec : 0x80d35b;
    this.sparkColor = id === "dog" ? 0x9beaff : 0xb4ff60;
    this.model = clone(source.scene);
    const localMaterials = new Map<THREE.Material, THREE.Material>();
    this.model.traverse((o) => {
      if (o instanceof THREE.Bone) this.bones.push(o);
      if (o instanceof THREE.Mesh) {
        const local = (m: THREE.Material) => {
          if (!localMaterials.has(m)) localMaterials.set(m, m.clone());
          return localMaterials.get(m)!;
        };
        o.material = Array.isArray(o.material) ? o.material.map(local) : local(o.material);
        o.castShadow = true;
        o.receiveShadow = true;
        o.userData.sharedGeometry = true;
        if (o instanceof THREE.SkinnedMesh) o.frustumCulled = false;
      }
    });
    this.materials = [...localMaterials.values()].filter((m): m is THREE.MeshStandardMaterial => m instanceof THREE.MeshStandardMaterial);
    this.registerFlash(this.materials);
    this.normalization.add(this.model);
    this.root.add(this.normalization);
    if (id === "toad") {
      const head = this.bone(/^bone_4$/);
      if (head) {
        this.mouth = new THREE.Object3D();
        this.mouth.position.set(0, -0.08, 0.25);
        head.add(this.mouth);
        const geo = new THREE.CylinderGeometry(0.045, 0.055, 1, 8);
        geo.rotateX(Math.PI / 2);
        geo.translate(0, 0, 0.5);
        this.tongue = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xe887a1, roughness: 0.5 }));
        this.mouth.add(this.tongue);
        this.tongueTip = new THREE.Object3D();
        this.mouth.add(this.tongueTip);
        this.tongue.visible = false;
      }
    }
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const h = box.max.y - box.min.y;
    if (!Number.isFinite(h) || h <= 0) throw new Error(`Invalid ${id} model bounds`);
    const desiredHeight = id === "dog" ? 2.15 : 2.3;
    const scale = desiredHeight / h;
    this.normalization.scale.setScalar(scale);
    this.normalization.position.set(-(box.min.x + box.max.x) * scale / 2, -box.min.y * scale, -(box.min.z + box.max.z) * scale / 2);
    this.clips = new Map(source.animations.map((c) => [c.name, this.inPlace(c)]));
    this.mixer = new THREE.AnimationMixer(this.model);
    this.play("idle");
  }

  private inPlace(clip: THREE.AnimationClip) {
    const copy = clip.clone();
    for (const track of copy.tracks) {
      if (!/\.(position)$/.test(track.name) || !/(?:^|:)Hips\.position$|^bone_0\.position$/.test(track.name)) continue;
      // Clip translation would otherwise double-move a Fighter under game physics.
      // Preserve its bind offset while removing all animated root translation.
      const stride = track.getValueSize();
      if (stride !== 3) continue;
      for (let i = stride; i < track.values.length; i += stride) {
        track.values[i] = track.values[0];
        track.values[i + 1] = track.values[1];
        track.values[i + 2] = track.values[2];
      }
    }
    return copy;
  }

  override play(name: string, force = false) {
    if (!force && this.current === name && this.active) return;
    const binding = BINDINGS[this.id][name] ?? BINDINGS[this.id].idle;
    const original = this.clips.get(binding.clip);
    if (!original) throw new Error(`Missing ${this.id} animation: ${binding.clip}`);
    const key = `${name}:${binding.clip}:${binding.start ?? 0}:${binding.end ?? original.duration}`;
    let action = this.actions.get(key);
    if (!action) {
      let clip = original;
      if (binding.start !== undefined || binding.end !== undefined) {
        const fps = 60;
        clip = THREE.AnimationUtils.subclip(original, key, Math.round((binding.start ?? 0) * fps), Math.round((binding.end ?? original.duration) * fps), fps);
      }
      action = this.mixer.clipAction(clip);
      this.actions.set(key, action);
    }
    const previous = this.active;
    action.reset();
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale((binding.duration ? action.getClip().duration / binding.duration : 1) * (binding.reverse ? -1 : 1));
    if (binding.reverse) action.time = action.getClip().duration;
    action.setLoop(binding.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.play();
    if (previous && previous !== action) previous.crossFadeTo(action, 0.12, false);
    this.active = action;
    this.current = name;
    this.time = 0;
    this.charge = 0;
  }

  override update(dt: number, _ctx: AnimCtx) {
    this.mixer.update(dt);
    this.updateMaterialEffects(dt);
    if (this.current === "special") this.charge = Math.min(1, this.time / 0.4);
    if (this.tongue && this.tongueTip) {
      const extending = this.current === "light";
      const reach = extending ? 0.1 + 1.25 * Math.sin(Math.PI * Math.min(1, this.time / 0.48)) : 0;
      this.tongue.visible = reach > 0.12;
      this.tongue.scale.z = reach;
      this.tongueTip.position.z = reach;
    }
  }

  private updateMaterialEffects(dt: number) {
    // Rig owns the existing flash/tint behavior; no registered procedural joints.
    super.update(dt, { vx: 0, vy: 0, grounded: true, fwd: 0, facing: 1, hpRatio: 1, seed: 0 });
  }

  override snap(_ctx: AnimCtx) { this.mixer.update(0); }

  private bone(pattern: RegExp) { return this.bones.find((b) => pattern.test(b.name)); }
  chestWorld(out: THREE.Vector3) {
    this.root.updateMatrixWorld(true);
    return (this.bone(this.id === "dog" ? /Spine2|Spine1/ : /^bone_2$/) ?? this.model).getWorldPosition(out);
  }
  strikeWorld(move: string, out: THREE.Vector3) {
    this.root.updateMatrixWorld(true);
    if (this.id === "toad" && move === "light" && this.tongueTip) return this.tongueTip.getWorldPosition(out);
    if (this.id === "toad" && move === "special" && this.mouth) return this.mouth.getWorldPosition(out);
    const right = this.bone(this.id === "dog" ? /RightHand$/ : /^bone_25$/);
    const foot = this.bone(this.id === "dog" ? /RightFoot$/ : /^bone_44$/);
    const target = move === "heavy" || move === "air" ? foot : right;
    return (target ?? this.model).getWorldPosition(out);
  }
  tick(_dt: number, _time: number, _fx: CharacterFXHooks | null, _state: string) {}
  override grabAnchorWorld(out: THREE.Vector3) {
    this.root.updateMatrixWorld(true);
    return this.tongueTip?.getWorldPosition(out) ?? this.chestWorld(out);
  }
  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const m of this.materials) m.dispose();
    this.tongue?.geometry.dispose();
    (this.tongue?.material as THREE.Material | undefined)?.dispose();
    this.root.removeFromParent();
  }
}
