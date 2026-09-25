export type CharId = "chicken" | "buffalo" | "ewe" | "toad" | "dog";
export type MoveSlot = "light" | "heavy" | "special" | "air";
export type Band = "high" | "mid" | "low";

export interface HitWindow {
  start: number;
  end: number;
  damage: number;
  reach: number;
  band: Band;
  knockback: number;
  launch?: number;
  hitstun: number;
  blockstun: number;
  shake: number;
  hitstop: number;
  unblockable?: boolean;
  /** command grab: victim is held at the attacker's grab anchor, then thrown */
  grab?: { hold: number; throwX: number; throwY: number };
}

export interface MoveDef {
  slot: MoveSlot;
  name: string;
  duration: number;
  hits: HitWindow[];
  meterCost?: number;
  meterGain: number;
  /** forward movement window */
  lunge?: { start: number; end: number; speed: number; stopOnHit?: boolean };
  /** window (after a successful hit) where another attack may be chained */
  cancel?: { start: number; end: number };
  fx:
    | "peck"
    | "kick"
    | "laser"
    | "dive"
    | "headbutt"
    | "horn"
    | "stampede"
    | "slam"
    | "jab"
    | "uppercut"
    | "meteor"
    | "missiles"
    | "tongue"
    | "grab"
    | "belch"
    | "flop";
  /** initial velocity applied when the move starts (used for air moves) */
  impulse?: { x: number; y: number };
  /** time when the special "fires" for FX purposes */
  fireAt?: number;
  /** spawns homing projectiles during the move */
  projectile?: { fireAt: number; count: number; interval: number; speed: number; arc: number; homing: number };
  /** spawns a lingering, slowly travelling gas cloud at `fireAt` */
  hazard?: { speed: number; travel: number; linger: number; radius: number; damage: number; poison: { duration: number; dps: number } };
}

export interface FighterStats {
  speed: number;
  power: number;
  tough: number;
  icon: string;
}

export interface FighterConfig {
  id: CharId;
  name: string;
  title: string;
  maxHp: number;
  walkSpeed: number;
  backSpeed: number;
  jumpVel: number;
  weight: number;
  width: number;
  height: number;
  color: string;
  colorHex: number;
  stats: FighterStats;
  moves: Record<MoveSlot, MoveDef>;
  moveNames: { light: string; heavy: string; special: string; air: string };
}

const chicken: FighterConfig = {
  id: "chicken",
  name: "ROBO-CLUCK",
  title: "Unit CK-77 · Foundry Prototype",
  maxHp: 100,
  walkSpeed: 3.8,
  backSpeed: 2.9,
  jumpVel: 11.5,
  weight: 0.9,
  width: 0.55,
  height: 2.2,
  color: "#38e8ff",
  colorHex: 0x38e8ff,
  stats: { speed: 5, power: 3, tough: 2, icon: "🐔" },
  moveNames: { light: "Piston Peck", heavy: "Talon Kick", special: "Laser Gaze", air: "Dive Talon" },
  moves: {
    light: {
      slot: "light",
      name: "Piston Peck",
      duration: 0.42,
      hits: [{ start: 0.13, end: 0.22, damage: 6, reach: 1.55, band: "high", knockback: 3.5, hitstun: 0.36, blockstun: 0.2, shake: 0.15, hitstop: 0.06 }],
      meterGain: 6,
      cancel: { start: 0.2, end: 0.4 },
      fx: "peck",
      lunge: { start: 0.1, end: 0.18, speed: 2.5 },
    },
    heavy: {
      slot: "heavy",
      name: "Talon Kick",
      duration: 0.8,
      hits: [{ start: 0.26, end: 0.4, damage: 13, reach: 1.9, band: "mid", knockback: 6.5, launch: 7.5, hitstun: 0.6, blockstun: 0.32, shake: 0.4, hitstop: 0.1 }],
      meterGain: 10,
      fx: "kick",
      lunge: { start: 0.2, end: 0.3, speed: 3.5 },
    },
    special: {
      slot: "special",
      name: "Laser Gaze",
      duration: 1.1,
      hits: [{ start: 0.39, end: 0.5, damage: 20, reach: 7.5, band: "high", knockback: 9, launch: 5.5, hitstun: 0.8, blockstun: 0.5, shake: 0.6, hitstop: 0.12 }],
      meterCost: 50,
      meterGain: 0,
      fx: "laser",
      fireAt: 0.39,
    },
    air: {
      slot: "air",
      name: "Dive Talon",
      duration: 0.7,
      hits: [{ start: 0.1, end: 0.5, damage: 9, reach: 1.5, band: "mid", knockback: 4.5, launch: 3, hitstun: 0.45, blockstun: 0.25, shake: 0.25, hitstop: 0.08 }],
      meterGain: 7,
      fx: "dive",
      impulse: { x: 5.5, y: -5 },
    },
  },
};

const buffalo: FighterConfig = {
  id: "buffalo",
  name: "FLUFFALO",
  title: "Meadow Champion · 100% Fluff",
  maxHp: 120,
  walkSpeed: 3.1,
  backSpeed: 2.4,
  jumpVel: 10.2,
  weight: 1.35,
  width: 0.95,
  height: 1.9,
  color: "#ffb347",
  colorHex: 0xffb347,
  stats: { speed: 3, power: 5, tough: 5, icon: "🐃" },
  moveNames: { light: "Headbutt", heavy: "Horn Toss", special: "Stampede", air: "Fluff Slam" },
  moves: {
    light: {
      slot: "light",
      name: "Headbutt",
      duration: 0.45,
      hits: [{ start: 0.14, end: 0.25, damage: 7, reach: 1.75, band: "mid", knockback: 4.5, hitstun: 0.38, blockstun: 0.2, shake: 0.2, hitstop: 0.06 }],
      meterGain: 6,
      cancel: { start: 0.24, end: 0.43 },
      fx: "headbutt",
      lunge: { start: 0.1, end: 0.2, speed: 3 },
    },
    heavy: {
      slot: "heavy",
      name: "Horn Toss",
      duration: 0.85,
      hits: [{ start: 0.27, end: 0.42, damage: 14, reach: 1.8, band: "mid", knockback: 4, launch: 9.5, hitstun: 0.75, blockstun: 0.35, shake: 0.45, hitstop: 0.1 }],
      meterGain: 10,
      fx: "horn",
      lunge: { start: 0.2, end: 0.3, speed: 2.5 },
    },
    special: {
      slot: "special",
      name: "Stampede",
      duration: 1.45,
      hits: [{ start: 0.44, end: 1.0, damage: 22, reach: 1.6, band: "mid", knockback: 12, launch: 6.5, hitstun: 0.9, blockstun: 0.55, shake: 0.85, hitstop: 0.14 }],
      meterCost: 50,
      meterGain: 0,
      lunge: { start: 0.42, end: 1.0, speed: 13, stopOnHit: true },
      fx: "stampede",
      fireAt: 0.42,
    },
    air: {
      slot: "air",
      name: "Fluff Slam",
      duration: 0.75,
      hits: [{ start: 0.12, end: 0.55, damage: 11, reach: 1.4, band: "mid", knockback: 5, launch: 4, hitstun: 0.5, blockstun: 0.3, shake: 0.35, hitstop: 0.09 }],
      meterGain: 8,
      fx: "slam",
      impulse: { x: 2.5, y: -8 },
    },
  },
};

const ewe: FighterConfig = {
  id: "ewe",
  name: "SCRAP-EWE",
  title: "Pastoral Ordnance · 100% Wool, 200% Steel",
  maxHp: 105,
  walkSpeed: 3.4,
  backSpeed: 2.7,
  jumpVel: 11,
  weight: 1.12,
  width: 0.72,
  height: 2.15,
  color: "#ff5fa2",
  colorHex: 0xff5fa2,
  stats: { speed: 4, power: 4, tough: 3, icon: "🐑" },
  moveNames: { light: "Piston Jab", heavy: "Rocket Uppercut", special: "Ewe-Pod Barrage", air: "Meteor Knuckle" },
  moves: {
    light: {
      slot: "light",
      name: "Piston Jab",
      duration: 0.4,
      hits: [{ start: 0.1, end: 0.18, damage: 5, reach: 1.7, band: "mid", knockback: 3, hitstun: 0.32, blockstun: 0.16, shake: 0.12, hitstop: 0.04 }],
      meterGain: 7,
      cancel: { start: 0.16, end: 0.38 },
      fx: "jab",
      lunge: { start: 0.08, end: 0.16, speed: 2.2 },
    },
    heavy: {
      slot: "heavy",
      name: "Rocket Uppercut",
      duration: 0.85,
      hits: [{ start: 0.27, end: 0.38, damage: 13, reach: 1.85, band: "mid", knockback: 4, launch: 10.5, hitstun: 0.7, blockstun: 0.32, shake: 0.4, hitstop: 0.1 }],
      meterGain: 10,
      fx: "uppercut",
      lunge: { start: 0.2, end: 0.3, speed: 2.2 },
    },
    special: {
      slot: "special",
      name: "Ewe-Pod Barrage",
      duration: 1.3,
      hits: [],
      meterCost: 50,
      meterGain: 0,
      fx: "missiles",
      fireAt: 0.4,
      projectile: { fireAt: 0.4, count: 4, interval: 0.09, speed: 9, arc: 4.2, homing: 3.2 },
    },
    air: {
      slot: "air",
      name: "Meteor Knuckle",
      duration: 0.7,
      hits: [{ start: 0.12, end: 0.5, damage: 10, reach: 1.5, band: "mid", knockback: 6, launch: 3.5, hitstun: 0.45, blockstun: 0.25, shake: 0.3, hitstop: 0.08 }],
      meterGain: 7,
      fx: "meteor",
      impulse: { x: 2.5, y: -9 },
    },
  },
};

const toad: FighterConfig = {
  id: "toad",
  name: "KING CROAK",
  title: "Bog Royalty · Eats Flies, Fights Dirty",
  maxHp: 115,
  walkSpeed: 2.9,
  backSpeed: 2.3,
  jumpVel: 12.5,
  weight: 1.25,
  width: 0.9,
  height: 1.6,
  color: "#8dff5a",
  colorHex: 0x8dff5a,
  stats: { speed: 2, power: 4, tough: 4, icon: "🐸" },
  moveNames: { light: "Tongue Lash", heavy: "Gullet Toss", special: "Toxic Croak", air: "Royal Belly Flop" },
  moves: {
    light: {
      slot: "light",
      name: "Tongue Lash",
      duration: 0.42,
      // negative knockback = reels the opponent in
      hits: [{ start: 0.12, end: 0.22, damage: 6, reach: 2.6, band: "mid", knockback: -1.6, hitstun: 0.36, blockstun: 0.2, shake: 0.15, hitstop: 0.05 }],
      meterGain: 6,
      cancel: { start: 0.22, end: 0.4 },
      fx: "tongue",
    },
    heavy: {
      slot: "heavy",
      name: "Gullet Toss",
      duration: 1.15,
      // unblockable command grab; "low" band means it whiffs on airborne opponents
      hits: [
        {
          start: 0.3,
          end: 0.42,
          damage: 15,
          reach: 2.0,
          band: "low",
          knockback: 0,
          hitstun: 0,
          blockstun: 0.3,
          shake: 0.5,
          hitstop: 0.1,
          unblockable: true,
          grab: { hold: 0.5, throwX: -5.5, throwY: 11.5 },
        },
      ],
      meterGain: 12,
      fx: "grab",
      lunge: { start: 0.22, end: 0.3, speed: 2 },
    },
    special: {
      slot: "special",
      name: "Toxic Croak",
      duration: 1.35,
      hits: [],
      meterCost: 50,
      meterGain: 0,
      fx: "belch",
      fireAt: 0.55,
      hazard: { speed: 2.4, travel: 1.3, linger: 2.6, radius: 1.25, damage: 9, poison: { duration: 4, dps: 3 } },
    },
    air: {
      slot: "air",
      name: "Royal Belly Flop",
      duration: 0.7,
      hits: [{ start: 0.12, end: 0.5, damage: 11, reach: 1.5, band: "mid", knockback: 5, launch: 4, hitstun: 0.5, blockstun: 0.3, shake: 0.35, hitstop: 0.09 }],
      meterGain: 8,
      fx: "flop",
      impulse: { x: 2.5, y: -9 },
    },
  },
};

const dog: FighterConfig = {
  id: "dog", name: "OLLIE", title: "Twin-Fang Kung Fu", maxHp: 100,
  walkSpeed: 3.7, backSpeed: 2.8, jumpVel: 11.2, weight: 1,
  width: 0.7, height: 2.15, color: "#4ab6f4", colorHex: 0x4ab6f4,
  stats: { speed: 4, power: 3, tough: 3, icon: "🐕" },
  moveNames: { light: "Snap Strike", heavy: "Martelo Kick", special: "Twin Fang Rush", air: "Pounce Slam" },
  moves: {
    light: { slot: "light", name: "Snap Strike", duration: 0.42,
      hits: [{ start: 0.14, end: 0.23, damage: 6, reach: 1.6, band: "high", knockback: 3.5, hitstun: 0.36, blockstun: 0.2, shake: 0.15, hitstop: 0.06 }],
      meterGain: 6, cancel: { start: 0.21, end: 0.39 }, fx: "jab", lunge: { start: 0.1, end: 0.2, speed: 2.5 } },
    heavy: { slot: "heavy", name: "Martelo Kick", duration: 0.82,
      hits: [{ start: 0.29, end: 0.42, damage: 13, reach: 1.95, band: "mid", knockback: 6.5, launch: 6, hitstun: 0.6, blockstun: 0.32, shake: 0.4, hitstop: 0.1 }],
      meterGain: 10, fx: "kick", lunge: { start: 0.2, end: 0.31, speed: 2.8 } },
    special: { slot: "special", name: "Twin Fang Rush", duration: 1.1,
      hits: [{ start: 0.4, end: 0.54, damage: 18, reach: 2.2, band: "mid", knockback: 9, launch: 5, hitstun: 0.72, blockstun: 0.42, shake: 0.55, hitstop: 0.12 }],
      meterCost: 50, meterGain: 0, fx: "uppercut", lunge: { start: 0.35, end: 0.48, speed: 5 } },
    air: { slot: "air", name: "Pounce Slam", duration: 0.7,
      hits: [{ start: 0.12, end: 0.5, damage: 10, reach: 1.55, band: "mid", knockback: 5, launch: 3, hitstun: 0.48, blockstun: 0.28, shake: 0.32, hitstop: 0.09 }],
      meterGain: 8, fx: "flop", impulse: { x: 4, y: -6 } },
  },
};

export const FIGHTERS: Record<CharId, FighterConfig> = { chicken, buffalo, ewe, toad, dog };

export const BAND_RANGES: Record<Band, [number, number]> = {
  high: [0.9, 2.4],
  mid: [0.3, 1.8],
  low: [0, 0.9],
};
