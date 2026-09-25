import { FIGHTERS } from "../moves";
import type { CharId } from "../moves";

/**
 * Per-character binding from the 16 game-facing animation *state keys* to imported GLB clips.
 *
 * `Fighter` asks for a state key; this table decides which clip plays, which slice of it, how fast
 * and with which authored procedural overlay. Nothing here silently reuses an unrelated clip:
 * every row records why its candidate is legal, and rows that are still placeholders are flagged
 * `provisional` so the review list in docs/11 stays honest.
 *
 * Timing authority is `src/game/moves.ts` — the `fit` values below are read from it at module
 * load, so a gameplay change can never silently desynchronise the animation.
 *
 * Measurements used here (see tools/validate/*.mjs for the scripts that produced them):
 *   dog  root mixamorig:Hips, gait travel local +Y → world +Z, up = local −Z, height 2.08 m,
 *        bind-pose ground Y = 0, snout tip (0, 1.58, 0.38), Spine2 (0, 1.36, 0.0)
 *   frog root bone_0, gait travel local +Z, up = local +Y, height 1.90 m, ground Y = 0,
 *        head bone bone_5 (2,847 weight units of head geometry), snout tip (0, 1.30, 0.73)
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
  lateral: 0 | 1 | 2;
  forward: 0 | 1 | 2;
  up: 0 | 1 | 2;
  upSign: 1 | -1;
}

/**
 * Vertical policy for the imported root translation:
 *  - `strip`: freeze at the first key (Fighter owns jump height and stage travel),
 *  - `bob`:   keep the high-frequency bob only — a moving-average high pass plus a hard clamp, so
 *             clip drift and lean can never accumulate into a second jump,
 *  - `keep`:  keep the clip's own vertical travel (floor interactions: down / ko / getup).
 */
export type RootYPolicy = "strip" | "bob" | "keep";

export type OverlayId =
  | "breathe"
  | "guard"
  | "backLean"
  | "bellyFlop"
  | "tongueLight"
  | "tongueGrab"
  | "throatCharge"
  | "bow"
  | "airPhase"
  | "axes"
  | "recoilOnly";

export interface ClipBinding {
  /** source clip name inside the GLB */
  clip: string | null;
  /** trim range in source seconds (both endpoints are sampled exactly, not frame-rounded) */
  trim?: [number, number];
  /** explicit playback rate; ignored when `fit` is present */
  speed?: number;
  /** force the trimmed clip to last exactly this many game seconds */
  fit?: number;
  /** play the clip backwards (reverse gait, authored recoveries) */
  reverse?: boolean;
  loop?: boolean;
  /** hold the final pose when a one-shot ends instead of snapping back to bind pose */
  holdLast?: boolean;
  /** crossfade seconds when entering this state */
  fade?: number;
  rootY?: RootYPolicy;
  /** authored procedural overlay applied on top of the mixer output */
  overlay?: OverlayId;
  /**
   * Vertical compensation in *source* units for a clip whose own root height does not put the feet
   * on the stage floor. Measured per state in the browser (docs/11); positive lifts.
   */
  yOffset?: number;
  /** still a placeholder / unreviewed candidate — must be listed as such in the report */
  provisional?: boolean;
  /** why this candidate is legal (or what is still missing) */
  note: string;
}

/** A socket defined by a point in *fighter model space* (Y up, ground 0, +Z facing, metres). */
export interface SocketDef {
  bone: string;
  point: [number, number, number];
}

export interface TongueDef {
  /** bone the mouth is attached to */
  bone: string;
  /** tongue root in model space */
  root: [number, number, number];
  /** resting length when retracted */
  rest: number;
  /** fully extended length */
  maxLen: number;
  radius: number;
  color: number;
  /** reach used by the gameplay hit window, in model units (moves.ts reach) */
  reach: number;
}

export interface PropDef {
  bone: string;
  point: [number, number, number];
  /** rotation applied in the hand's local frame */
  rotation: [number, number, number];
  mirrored?: boolean;
}

export interface SkinnedBinding {
  id: CharId;
  /** root bone whose translation carries the imported root motion */
  rootBone: string;
  axes: RootAxes;
  /** bones used for the once-per-import scale/ground normalisation */
  measureBones: { top: string; bottom: string[] };
  /** measured height of the source model in metres (feet → head bone) */
  sourceHeight: number;
  accent: number;
  sparkColor: number;
  sockets: {
    chest: SocketDef;
    strike: Record<string, SocketDef>;
    grab: SocketDef;
  };
  tongue?: TongueDef;
  props?: { id: string; left: PropDef; right: PropDef };
  /** arm / forearm bones used by the authored guard and idle overlays */
  guardBones: { arm: [string, string]; forearm: [string, string] };
  /** overlays rotate this chain: [root, mid, head] */
  spineBones: [string, string, string];
  /** measured ground speed of the locomotion source clip, m/s (used for cadence, not travel) */
  clipGroundSpeed: number;
  states: Record<StateKey, ClipBinding>;
}

/**
 * Dog: the Blender-exported armature carries a +90° X rotation, so the Hips local translation
 * track travels +Y for world +Z and −Z for world up. Measured from `Run Forward` (local Δ =
 * (0, 2.236, 0) → world Δ = (0, 0, 2.236)) and from the bind pose (Hips local Z = −0.881).
 */
const DOG_ROOT: RootAxes = { lateral: 0, forward: 1, up: 2, upSign: -1 };
/** Frog: bone_0 local space matches world axes — `Dwarf Walk` travels local +Z, up is local +Y. */
const CROAK_ROOT: RootAxes = { lateral: 0, forward: 2, up: 1, upSign: 1 };

/** `Run Forward` covers 2.236 m in 0.5 s. */
const DOG_GAIT_SPEED = 4.47;
/** `Dwarf Walk` covers 2.067 m in 1.167 s. */
const CROAK_GAIT_SPEED = 1.77;

const DOG_MOVES = FIGHTERS.dog.moves;
const CROAK_MOVES = FIGHTERS.toad.moves;

/**
 * DOG — Mixamo humanoid hierarchy, 10 preserved clips, chin/head weights already corrected in the
 * source asset (never remapped here). `Skinning Test` is diagnostic and is never bound.
 * Facing: model +Z. Character's right side is −X (Mixamo naming).
 */
export const DOG_BINDING: SkinnedBinding = {
  id: "dog",
  rootBone: "mixamorig:Hips",
  axes: DOG_ROOT,
  measureBones: { top: "mixamorig:Head", bottom: ["mixamorig:LeftFoot", "mixamorig:RightFoot"] },
  sourceHeight: 2.08,
  accent: 0x44b5ec,
  sparkColor: 0x9beaff,
  spineBones: ["mixamorig:Hips", "mixamorig:Spine1", "mixamorig:Head"],
  guardBones: { arm: ["mixamorig:LeftArm", "mixamorig:RightArm"], forearm: ["mixamorig:LeftForeArm", "mixamorig:RightForeArm"] },
  clipGroundSpeed: DOG_GAIT_SPEED,
  sockets: {
    chest: { bone: "mixamorig:Spine2", point: [0, 1.36, 0.0] },
    strike: {
      light: { bone: "mixamorig:RightHand", point: [-0.58, 1.34, 0.05] },
      heavy: { bone: "mixamorig:RightFoot", point: [-0.28, 0.14, 0.16] },
      special: { bone: "mixamorig:RightHand", point: [-0.58, 1.34, 0.3] },
      air: { bone: "mixamorig:RightFoot", point: [-0.28, 0.14, 0.16] },
    },
    grab: { bone: "mixamorig:RightHand", point: [-0.58, 1.34, 0.12] },
  },
  props: {
    id: "axes",
    left: { bone: "mixamorig:LeftHand", point: [0.57, 1.34, 0.0], rotation: [1.35, 0, 0.2], mirrored: true },
    right: { bone: "mixamorig:RightHand", point: [-0.58, 1.34, 0.0], rotation: [1.35, 0, -0.2] },
  },
  states: {
    idle: { clip: "Boxing", trim: [0, 0.55], speed: 0.4, loop: true, fade: 0.18, rootY: "bob", overlay: "breathe", note: "Guard segment of the Boxing clip slowed to 0.4x; the breathe overlay damps the residual bounce." , yOffset: -0.077 },
    walkF: { clip: "Run Forward", loop: true, fade: 0.14, rootY: "bob", note: "Sprint clip neutralised in place and slowed to a combat walk; cadence follows ctx.fwd against the clip's measured 4.47 m/s." , yOffset: 0.023 },
    walkB: { clip: "Run Forward", loop: true, reverse: true, speed: 0.75, fade: 0.16, rootY: "bob", overlay: "backLean", note: "Forward gait genuinely reversed (negative playback rate) with an authored backward lean." , yOffset: 0.023 },
    jump: { clip: "Front Twist Flip", trim: [0, 0.85], loop: false, holdLast: true, fade: 0.08, rootY: "strip", overlay: "airPhase", note: "Acrobatic rise; Fighter owns jump height so clip Y is frozen." , yOffset: 0.0093 },
    block: { clip: "Boxing", trim: [0, 0.4], speed: 1.4, loop: false, holdLast: true, fade: 0.08, rootY: "strip", overlay: "guard", note: "Guard segment held; the authored arm raise keeps the hands protecting the body." , yOffset: -0.0819 },
    light: { clip: "Punching Bag", trim: [0, 0.5], fit: DOG_MOVES.light.duration, loop: false, holdLast: true, fade: 0.05, rootY: "strip", note: "Single jab retimed to the 0.42 s Snap Strike; contact window 0.14–0.23 s." , yOffset: -0.0528 },
    heavy: { clip: "Martelo 2", trim: [0, 1.15], fit: DOG_MOVES.heavy.duration, loop: false, holdLast: true, fade: 0.07, rootY: "strip", note: "Martelo kick retimed to the 0.82 s Martelo Kick; contact window 0.29–0.42 s." , yOffset: 0.0153 },
    special: { clip: "Dual Weapon Combo", fit: DOG_MOVES.special.duration, loop: false, holdLast: true, fade: 0.06, rootY: "strip", overlay: "axes", note: "Twin Fang Rush; axes are equipped for this action only and the contact window is 0.40–0.54 s." , yOffset: 0.0133 },
    air: { clip: "Hurricane Kick", trim: [0.25, 0.95], fit: DOG_MOVES.air.duration, loop: false, holdLast: true, fade: 0.05, rootY: "strip", note: "Retimed to the 0.70 s Pounce Slam; contact window 0.12–0.50 s." , yOffset: 0.0372 },
    hit: { clip: "Boxing", trim: [0, 0.3], speed: 0.7, loop: true, fade: 0.04, rootY: "strip", overlay: "recoilOnly", note: "Quiet loop plus the global recoil; interruptible at any time by state exit." , yOffset: 0.0988 },
    launched: { clip: "Front Twist Flip", trim: [0.45, 1.5], speed: 0.85, loop: true, fade: 0.08, rootY: "strip", note: "Mid-flip flail; tolerates a grab hold and a throw." , yOffset: -0.018 },
    down: { clip: "Run To Rolling", trim: [1.15, 1.6], speed: 0.9, loop: false, holdLast: true, fade: 0.08, rootY: "keep", note: "Knockdown ending pose; clip Y kept so the body settles on the floor (0.85 s state)." , yOffset: -0.2572 },
    ko: { clip: "Run To Rolling", trim: [1.45, 1.6], speed: 1, loop: false, holdLast: true, fade: 0.12, rootY: "keep", note: "Limp held pose, no fall loop." , yOffset: -0.2624 },
    getup: { clip: "Run To Rolling", trim: [0.95, 1.5], reverse: true, fit: 0.55, loop: false, holdLast: true, fade: 0.06, rootY: "keep", note: "Reversed recovery fitted to the fixed 0.55 s get-up.", provisional: true , yOffset: -0.35 },
    victory: { clip: "Thriller Part 3", trim: [0.6, 2.4], speed: 0.8, loop: true, fade: 0.2, rootY: "bob", note: "Celebration segment looped through the round-end phase.", provisional: true , yOffset: 0.0845 },
    intro: { clip: "Boxing", trim: [0, 1.1], speed: 0.75, loop: false, holdLast: true, fade: 0.12, rootY: "strip", overlay: "bow", note: "Authored bow into guard, reaching the fight stance by the 2.5 s start." , yOffset: -0.0661 },
  },
};

/**
 * KING CROAK — original 46-bone skin; 19 imported clips plus 5 correction variants.
 * Bone map measured with tools/validate/skeleton-map.mjs (weights + bind centroids):
 *   bone_0 root · bone_1/2 lower spine · bone_3 chest · bone_4 neck · bone_5 head + gullet
 *   arms bone_6-9 (left, +X) and bone_22-25 (right, −X); legs bone_38-41 (left) / bone_42-45 (right)
 * Elbow Punch and Hook Punch are body-motion references only — the tongue is authored
 * procedurally so the visible contact matches moves.ts. The known right-hand chin/gullet clip and
 * elbow stretch are *not* repaired here; see docs/11 for the measured numbers.
 */
export const CROAK_BINDING: SkinnedBinding = {
  id: "toad",
  rootBone: "bone_0",
  axes: CROAK_ROOT,
  measureBones: { top: "bone_5", bottom: ["bone_41", "bone_45"] },
  sourceHeight: 1.9,
  accent: 0x8dff5a,
  sparkColor: 0xb8ff80,
  spineBones: ["bone_0", "bone_3", "bone_5"],
  guardBones: { arm: ["bone_6", "bone_22"], forearm: ["bone_7", "bone_23"] },
  clipGroundSpeed: CROAK_GAIT_SPEED,
  sockets: {
    chest: { bone: "bone_3", point: [0, 1.0, 0.35] },
    strike: {
      // measured: bone_25 hand centre (−0.694, 0.744, 0.331) is the frog's right hand (−X)
      light: { bone: "bone_25", point: [-0.69, 0.74, 0.33] },
      heavy: { bone: "bone_25", point: [-0.69, 0.74, 0.33] },
      special: { bone: "bone_5", point: [0, 1.29, 0.62] },
      air: { bone: "bone_2", point: [0, 0.95, 0.55] },
    },
    grab: { bone: "bone_5", point: [0, 1.29, 0.62] },
  },
  tongue: { bone: "bone_5", root: [0, 1.3, 0.58], rest: 0.06, maxLen: 2.5, radius: 0.075, color: 0xe0537f, reach: CROAK_MOVES.light.hits[0]?.reach ?? 2.6 },
  states: {
    idle: { clip: "Idle · softened", speed: 0.9, loop: true, fade: 0.22, rootY: "bob", overlay: "breathe", note: "Approved softened idle; the breathe overlay damps the residual bounce." , yOffset: 0.094 },
    walkF: { clip: "Dwarf Walk", loop: true, fade: 0.16, rootY: "bob", note: "Approved gait, neutralised in place; cadence follows ctx.fwd against the clip's measured 1.77 m/s." , yOffset: -0.1 },
    walkB: { clip: "Dwarf Walk", loop: true, reverse: true, speed: 0.8, fade: 0.18, rootY: "bob", overlay: "backLean", note: "Dwarf Walk genuinely reversed with an authored backward lean." , yOffset: -0.1 },
    jump: { clip: "Jump", loop: false, holdLast: true, fade: 0.08, rootY: "strip", overlay: "airPhase", note: "0.93 s Jump clip held while Fighter owns the airtime of jumpVel 12.5 at g 34." , yOffset: 0.0068 },
    block: { clip: "Idle · softened", speed: 0.4, loop: true, fade: 0.1, rootY: "strip", overlay: "guard", note: "Authored guard pose on a quiet base so the frog can react without dropping guard." , yOffset: 0.1365 },
    light: { clip: "Elbow Punch · open hands", trim: [0, 0.5], fit: CROAK_MOVES.light.duration, loop: false, holdLast: true, fade: 0.05, rootY: "strip", overlay: "tongueLight", provisional: true, note: "Body-motion reference plus the authored Tongue Lash: reach 2.6 over the 0.12–0.22 s window. The source clip's right hand still crosses the chin." , yOffset: -0.0605 },
    heavy: { clip: "Hook Punch · open hands", trim: [0, 1.2], fit: CROAK_MOVES.heavy.duration, loop: false, holdLast: true, fade: 0.07, rootY: "strip", overlay: "tongueGrab", provisional: true, note: "Body-motion reference plus the authored Gullet Toss: grab 0.30–0.42 s, 0.50 s hold, throw at 0.92 s." , yOffset: 0.1082 },
    special: { clip: "Idle · softened", speed: 0.55, loop: true, fade: 0.16, rootY: "strip", overlay: "throatCharge", provisional: true, note: "Authored Toxic Croak: throat charge driven by rig.charge, gas released at fireAt 0.55 s." , yOffset: 0.1346 },
    air: { clip: "Capoeira · floor corrected", trim: [0.2, 0.95], fit: CROAK_MOVES.air.duration, loop: false, holdLast: true, fade: 0.05, rootY: "strip", overlay: "bellyFlop", provisional: true, note: "Capoeira is a movement reference; the belly-led flop covers the 0.12–0.50 s window and landing cancels it." , yOffset: 0.065 },
    hit: { clip: "Idle · softened", speed: 0.8, loop: true, fade: 0.04, rootY: "strip", overlay: "recoilOnly", provisional: true, note: "Quiet loop plus the global recoil overlay." , yOffset: 0.0261 },
    launched: { clip: "Jump Backward", speed: 0.8, loop: true, fade: 0.08, rootY: "strip", note: "Airborne flail; also used while grabbed." , yOffset: 0.021 },
    down: { clip: "Dying", trim: [0.9, 1.7], speed: 1, loop: false, holdLast: true, fade: 0.08, rootY: "keep", note: "Knockdown ending pose with clip Y kept so the body settles on the floor." , yOffset: 0.1795 },
    ko: { clip: "Dying", trim: [1.55, 1.7], speed: 1, loop: false, holdLast: true, fade: 0.14, rootY: "keep", note: "Limp held Dying final pose, no fall loop." , yOffset: 0.1805 },
    getup: { clip: "Dying", trim: [1.0, 1.7], reverse: true, fit: 0.55, loop: false, holdLast: true, fade: 0.06, rootY: "keep", provisional: true, note: "Authored 0.55 s recovery: Dying reversed." , yOffset: 0.0148 },
    victory: { clip: "Victory · floor corrected", speed: 0.85, loop: true, fade: 0.22, rootY: "bob", note: "Floor-corrected victory clip, looped." , yOffset: -0.1595 },
    intro: { clip: "Joyful Jump", speed: 0.8, loop: true, fade: 0.14, rootY: "strip", provisional: true, note: "Unreviewed candidate for the 2.5 s round-start phase." , yOffset: 0.1639 },
  },
};

export const SKINNED_BINDINGS: Partial<Record<CharId, SkinnedBinding>> = {
  dog: DOG_BINDING,
  toad: CROAK_BINDING,
};

export function bindingFor(id: CharId): SkinnedBinding | null {
  return SKINNED_BINDINGS[id] ?? null;
}

/** States that still need a visual pass, per binding row. */
export function provisionalStates(b: SkinnedBinding): StateKey[] {
  return STATE_KEYS.filter((k) => b.states[k].provisional);
}

/** Copies of a binding's rows that mix loop/one-shot policy on the same source clip. */
export function statesSharingClips(b: SkinnedBinding): { clip: string; states: StateKey[] }[] {
  const byClip = new Map<string, StateKey[]>();
  for (const key of STATE_KEYS) {
    const clip = b.states[key].clip;
    if (!clip) continue;
    const list = byClip.get(clip) ?? [];
    list.push(key);
    byClip.set(clip, list);
  }
  return [...byClip.entries()]
    .filter(([, states]) => states.length > 1)
    .map(([clip, states]) => ({ clip, states }));
}
