import type { CharId } from "../moves";

/**
 * Per-character binding from the 16 game-facing animation *state keys* to imported GLB clips.
 *
 * The state keys are what `Fighter` asks for; the clip names are what the GLB actually contains.
 * Nothing here silently reuses an unrelated clip: every row records the trim, the playback policy
 * and (where the source clip is only a body-motion reference) the authored procedural overlay that
 * makes the state legal. See docs/09-SKINNED-ANIMATION-CONTRACT.md.
 *
 * Timings come from `src/game/moves.ts` (authoritative):
 *   toad  light 0.42 hit 0.12-0.22 | heavy 1.15 grab 0.30-0.42 hold 0.50
 *         special 1.35 fireAt 0.55 | air 0.70 hit 0.12-0.50
 *   dog   light 0.42 hit 0.14-0.23 | heavy 0.82 hit 0.29-0.42
 *         special 1.10 hits 0.40-0.54 | air 0.70 hit 0.12-0.50
 */

export type StateKey =
  | "idle"
  | "walkF"
  | "walkB"
  | "jump"
  | "block"
  | "light"
  | "heavy"
  | "special"
  | "air"
  | "hit"
  | "launched"
  | "down"
  | "ko"
  | "getup"
  | "victory"
  | "intro";

export const STATE_KEYS: StateKey[] = [
  "idle",
  "walkF",
  "walkB",
  "jump",
  "block",
  "light",
  "heavy",
  "special",
  "air",
  "hit",
  "launched",
  "down",
  "ko",
  "getup",
  "victory",
  "intro",
];

/** Which local axis of the root bone maps onto which world axis in the source file. */
export interface RootAxes {
  /** index into the VEC3 track used for world X (sideways travel) */
  lateral: 0 | 1 | 2;
  /** index used for world Z (travel along the facing direction — always neutralised) */
  forward: 0 | 1 | 2;
  /** index used for world Y (height) */
  up: 0 | 1 | 2;
  /** sign of the up axis in local space */
  upSign: 1 | -1;
}

/**
 * Up-axis policy for the imported root translation:
 *  - `strip`: freeze at the first keyframe (no vertical clip travel at all)
 *  - `bob`:   keep only the high-frequency bob (mean removed), never the drift
 *  - `keep`:  keep the clip's own vertical travel (floor interactions: down / ko / getup)
 */
export type RootYPolicy = "strip" | "bob" | "keep";

export type OverlayId =
  | "breathe"
  | "recoil"
  | "guard"
  | "backLean"
  | "bellyFlop"
  | "tongueLight"
  | "tongueGrab"
  | "throatCharge"
  | "bow"
  | "airPhase"
  | "axes";

export interface ClipBinding {
  /** source clip name inside the GLB, or null for a fully authored procedural state */
  clip: string | null;
  /** trim range in source seconds (30 fps sources) */
  trim?: [number, number];
  /** explicit playback rate; ignored when `fit` is present */
  speed?: number;
  /** force the (trimmed) clip to last exactly this many game seconds */
  fit?: number;
  /** play the clip backwards (used for authored recoveries) */
  reverse?: boolean;
  loop?: boolean;
  /** hold the final pose when a one-shot ends instead of snapping back to bind pose */
  holdLast?: boolean;
  /** crossfade seconds when entering this state */
  fade?: number;
  rootY?: RootYPolicy;
  /** authored procedural overlay applied on top of the mixer output */
  overlay?: OverlayId;
  /** review note — why this candidate is legal (or still provisional) */
  note?: string;
}

/** A socket expressed in model space (Y up, +Z facing), refreshed from a bone each frame. */
export interface SocketDef {
  bone: string;
  offset: [number, number, number];
}

export interface TongueDef {
  bone: string;
  offset: [number, number, number];
  rest: number;
  maxLen: number;
  radius: number;
  color: number;
}

export interface PropDef {
  bone: string;
  offset: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  mirrored?: boolean;
}

export interface SkinnedBinding {
  id: CharId;
  url: string;
  /** root bone whose translation carries the imported root motion */
  rootBone: string;
  axes: RootAxes;
  /** target world height (feet -> head) in game units; the model is scaled once at import */
  height: number;
  /** bones used to measure bind-pose height / floor contact during normalisation */
  measureBones: { top: string; bottom: string[] };
  accent: number;
  sparkColor: number;
  sockets: {
    chest: SocketDef;
    strike: Record<string, SocketDef>;
    grab?: SocketDef;
  };
  tongue?: TongueDef;
  props?: { id: string; left?: PropDef; right?: PropDef };
  /** bones used by the authored guard / recoil overlays */
  guardBones?: { arm: [string, string]; forearm: [string, string] };
  /** spine chain used by overlays (root -> chest -> head) */
  spineBones?: [string, string, string];
  states: Record<StateKey, ClipBinding>;
}

/**
 * DOG GLB: the Blender-exported armature carries a +90deg X rotation, so the Hips *local*
 * translation track uses +Y for forward travel and -Z for height. Measured from the bind pose
 * and from the `Run Forward` root track (local +Y -> world +Z), so the dog faces local +Z.
 */
const DOG_ROOT: RootAxes = { lateral: 0, forward: 1, up: 2, upSign: -1 };
/** King Croak: bone_0 local space already matches world axes; Dwarf Walk travels local +Z. */
const CROAK_ROOT: RootAxes = { lateral: 0, forward: 2, up: 1, upSign: 1 };

/**
 * DOG — Mixamo humanoid hierarchy, 10 preserved clips. Bipedal; axes are optional props used
 * only by the special. `Skinning Test` is diagnostic only and is never bound.
 *
 * Timings from current moves.ts:
 *   light 0.42s hit 0.14-0.23 | heavy 0.82s hit 0.29-0.42
 *   special 1.10s hits 0.40-0.54 | air 0.70s hit 0.12-0.50
 */
export const DOG_BINDING: SkinnedBinding = {
  id: "dog",
  url: "/models/dog.glb",
  rootBone: "mixamorig:Hips",
  axes: DOG_ROOT,
  height: 2.0,
  measureBones: { top: "mixamorig:Head", bottom: ["mixamorig:LeftFoot", "mixamorig:RightFoot"] },
  accent: 0xffb45e,
  sparkColor: 0xffd9a0,
  spineBones: ["mixamorig:Hips", "mixamorig:Spine1", "mixamorig:Head"],
  sockets: {
    chest: { bone: "mixamorig:Spine2", offset: [0, 0.06, 0.06] },
    strike: {
      light: { bone: "mixamorig:RightHand", offset: [0, 0, 0.08] },
      heavy: { bone: "mixamorig:RightFoot", offset: [0, 0, 0.16] },
      special: { bone: "mixamorig:RightHand", offset: [0, 0, 0.3] },
      air: { bone: "mixamorig:RightFoot", offset: [0, 0, 0.16] },
    },
    grab: { bone: "mixamorig:RightHand", offset: [0, 0, 0.12] },
  },
  props: {
    id: "axes",
    left: { bone: "mixamorig:LeftHand", offset: [0, 0.02, 0.06], rotation: [1.35, 0, 0.2], scale: 1, mirrored: true },
    right: { bone: "mixamorig:RightHand", offset: [0, 0.02, 0.06], rotation: [1.35, 0, -0.2], scale: 1 },
  },
  guardBones: { arm: ["mixamorig:LeftArm", "mixamorig:RightArm"], forearm: ["mixamorig:LeftForeArm", "mixamorig:RightForeArm"] },
  states: {
    idle: {
      clip: "Boxing",
      trim: [0, 0.55],
      speed: 0.4,
      loop: true,
      fade: 0.18,
      rootY: "bob",
      overlay: "breathe",
      note: "Boxing guard segment slowed to 0.4x; authored breathing overlay quietens residual bounce.",
    },
    walkF: { clip: "Run Forward", speed: 0.62, loop: true, fade: 0.14, rootY: "bob", note: "Slowed and neutralised in place; cadence follows ctx.fwd." },
    walkB: { clip: "Run Forward", speed: -0.5, loop: true, fade: 0.16, rootY: "bob", overlay: "backLean", note: "Forward gait reversed with an authored backward lean." },
    jump: { clip: "Front Twist Flip", trim: [0, 0.85], speed: 1, loop: false, fade: 0.08, rootY: "strip", overlay: "airPhase", note: "Acrobatic rise; game physics owns Y so clip Y is frozen." },
    block: { clip: "Boxing", trim: [0, 0.4], speed: 1.4, loop: false, holdLast: true, fade: 0.08, rootY: "strip", overlay: "guard", note: "Guard segment held; authored arm raise keeps hands protecting the body." },
    light: { clip: "Punching Bag", trim: [0, 0.5], fit: 0.42, loop: false, holdLast: true, fade: 0.05, rootY: "strip", note: "Single jab selected and retimed to 0.42s; contact inside 0.14-0.23." },
    heavy: { clip: "Martelo 2", trim: [0, 1.15], fit: 0.82, loop: false, holdLast: true, fade: 0.07, rootY: "strip", note: "Martelo kick retimed to 0.82s; contact inside 0.29-0.42." },
    special: { clip: "Dual Weapon Combo", fit: 1.1, loop: false, holdLast: true, fade: 0.06, rootY: "strip", overlay: "axes", note: "Axes equipped as props for this action only; hit window 0.40-0.54." },
    air: { clip: "Hurricane Kick", trim: [0.25, 0.95], fit: 0.7, loop: false, holdLast: true, fade: 0.05, rootY: "strip", note: "Retimed to the 0.70s air move; landing cancels it." },
    hit: { clip: "Boxing", trim: [0, 0.3], speed: 0.7, loop: true, fade: 0.04, rootY: "strip", overlay: "recoil", note: "Authored recoil overlay; interruptible at any time by state exit." },
    launched: { clip: "Front Twist Flip", trim: [0.45, 1.5], speed: 0.85, loop: true, fade: 0.08, rootY: "strip", note: "Mid-flip flail segment; tolerates a grab hold and throw." },
    down: { clip: "Run To Rolling", trim: [1.15, 1.6], speed: 0.9, loop: false, holdLast: true, fade: 0.08, rootY: "keep", note: "Ending pose candidate; clip Y kept for floor contact (0.85s state)." },
    ko: { clip: "Run To Rolling", trim: [1.45, 1.6], speed: 1, loop: false, holdLast: true, fade: 0.12, rootY: "keep", note: "Limp held pose, no motion loop." },
    getup: { clip: "Run To Rolling", trim: [0.95, 1.5], reverse: true, fit: 0.55, loop: false, holdLast: true, fade: 0.06, rootY: "keep", note: "Recovery candidate reversed and fit to the fixed 0.55s getup." },
    victory: { clip: "Thriller Part 3", trim: [0.6, 2.4], speed: 0.8, loop: true, fade: 0.2, rootY: "bob", note: "Celebration segment looped through the 3.2s round-end phase." },
    intro: { clip: "Boxing", trim: [0, 1.1], speed: 0.75, loop: false, holdLast: true, fade: 0.12, rootY: "strip", overlay: "bow", note: "Authored bow into guard." },
  },
};

/**
 * KING CROAK — original 46-bone skin, 19 transferred clips plus 5 correction variants.
 * Elbow/Hook Punch are body-motion references only: the tongue is authored procedurally so visible
 * contact matches moves.ts (Tongue Lash 0.12-0.22, Gullet Toss 0.30-0.42 plus a 0.50 hold).
 */
export const CROAK_BINDING: SkinnedBinding = {
  id: "toad",
  url: "/models/kingcroak.glb",
  rootBone: "bone_0",
  axes: CROAK_ROOT,
  height: 1.6,
  measureBones: { top: "bone_5", bottom: ["bone_41", "bone_45"] },
  accent: 0x8dff5a,
  sparkColor: 0xb8ff80,
  spineBones: ["bone_0", "bone_3", "bone_5"],
  sockets: {
    chest: { bone: "bone_3", offset: [0, 0.05, 0.12] },
    strike: {
      light: { bone: "bone_9", offset: [0, 0, 0.1] },
      heavy: { bone: "bone_25", offset: [0, 0, 0.1] },
      special: { bone: "bone_5", offset: [0, -0.12, 0.3] },
      air: { bone: "bone_1", offset: [0, -0.1, 0.3] },
    },
    grab: { bone: "bone_5", offset: [0, -0.14, 0.42] },
  },
  tongue: { bone: "bone_5", offset: [0, -0.14, 0.24], rest: 0.04, maxLen: 2.5, radius: 0.055, color: 0xe0537f },
  guardBones: { arm: ["bone_6", "bone_22"], forearm: ["bone_7", "bone_23"] },
  states: {
    idle: { clip: "Idle · softened", speed: 0.9, loop: true, fade: 0.22, rootY: "bob", overlay: "breathe", note: "Softened idle; authored damp removes the residual bounce." },
    walkF: { clip: "Dwarf Walk", speed: 0.55, loop: true, fade: 0.16, rootY: "bob", note: "Approved gait, slowed and made in place." },
    walkB: { clip: "Dwarf Walk", speed: -0.45, loop: true, fade: 0.18, rootY: "bob", overlay: "backLean", note: "Dwarf Walk reversed with an authored backward lean." },
    jump: { clip: "Jump", fit: 0.74, loop: false, holdLast: true, fade: 0.08, rootY: "strip", overlay: "airPhase", note: "0.93s Jump fit to the real airtime of jumpVel 12.5 at g 34." },
    block: { clip: "Idle · softened", speed: 0.4, loop: true, fade: 0.1, rootY: "strip", overlay: "guard", note: "Authored guard pose on a quiet base; reacts without dropping guard." },
    light: { clip: "Elbow Punch · open hands", trim: [0, 0.5], fit: 0.42, loop: false, holdLast: true, fade: 0.05, rootY: "strip", overlay: "tongueLight", note: "Body-motion reference plus authored Tongue Lash reaching during 0.12-0.22." },
    heavy: { clip: "Hook Punch · open hands", trim: [0, 1.2], fit: 1.15, loop: false, holdLast: true, fade: 0.07, rootY: "strip", overlay: "tongueGrab", note: "Body-motion reference plus authored Gullet Toss anchor: hit 0.30-0.42, 0.50 hold." },
    special: { clip: "Idle · softened", speed: 0.55, loop: true, fade: 0.16, rootY: "strip", overlay: "throatCharge", note: "Authored Toxic Croak: throat/charge response with gas release at 0.55s." },
    air: { clip: "Capoeira · floor corrected", trim: [0.2, 0.95], fit: 0.7, loop: false, holdLast: true, fade: 0.05, rootY: "strip", overlay: "bellyFlop", note: "Capoeira is a movement reference; authored belly-led flop covers 0.12-0.50." },
    hit: { clip: "Idle · softened", speed: 0.8, loop: true, fade: 0.04, rootY: "strip", overlay: "recoil", note: "Authored recoil overlay." },
    launched: { clip: "Jump Backward", speed: 0.8, loop: true, fade: 0.08, rootY: "strip", note: "Airborne flail; also used for grabbed." },
    down: { clip: "Dying", trim: [0.9, 1.7], speed: 1, loop: false, holdLast: true, fade: 0.08, rootY: "keep", note: "Ending pose candidate with clip Y kept so the body settles on the floor." },
    ko: { clip: "Dying", trim: [1.55, 1.7], speed: 1, loop: false, holdLast: true, fade: 0.14, rootY: "keep", note: "Limp held Dying final pose, no fall loop." },
    getup: { clip: "Dying", trim: [1.0, 1.7], reverse: true, fit: 0.55, loop: false, holdLast: true, fade: 0.06, rootY: "keep", note: "Authored 0.55s recovery: Dying reversed." },
    victory: { clip: "Victory · floor corrected", speed: 0.85, loop: true, fade: 0.22, rootY: "bob", note: "Floor-corrected victory, looped." },
    intro: { clip: "Joyful Jump", speed: 0.8, loop: true, fade: 0.14, rootY: "strip", note: "Unreviewed candidate kept for the 2.5s round-start phase." },
  },
};

export const SKINNED_BINDINGS: Partial<Record<CharId, SkinnedBinding>> = {
  dog: DOG_BINDING,
  toad: CROAK_BINDING,
};

/** Which fighters have a skinned path (everything else stays procedural). */
export function skinnedBindingFor(id: CharId): SkinnedBinding | null {
  return SKINNED_BINDINGS[id] ?? null;
}