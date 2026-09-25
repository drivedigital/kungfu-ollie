import type { CharId } from "../moves";
import type { ArenaId } from "../arenas/common";

/**
 * Every playable sound has a *slot*. A slot has a default remote URL (see defaults.ts, sourced from
 * Pixabay) and a procedural synth recipe that is used when the URL is empty, unreachable or blocked.
 * Users can override any slot URL from the Settings screen (persisted in localStorage).
 */
export type SoundKind = "sfx" | "music" | "ambient";
export type SynthId =
  | "whoosh.soft"
  | "whoosh.hard"
  | "clang.soft"
  | "clang.hard"
  | "punch.soft"
  | "punch.hard"
  | "knock.soft"
  | "knock.hard"
  | "thud.soft"
  | "thud.hard"
  | "slap.soft"
  | "slap.hard"
  | "squelch.soft"
  | "squelch.hard"
  | "voice.chicken.soft"
  | "voice.chicken.hard"
  | "voice.buffalo.soft"
  | "voice.buffalo.hard"
  | "voice.ewe.soft"
  | "voice.ewe.hard"
  | "voice.toad.soft"
  | "voice.toad.hard"
  | "special.laser"
  | "special.stampede"
  | "special.missiles"
  | "special.belch"
  | "ui.click"
  | "ui.hover"
  | "ui.back"
  | "ui.select"
  | "ui.transition"
  | "ui.start"
  | "bell"
  | "gong"
  | "fanfare.short"
  | "fanfare.long"
  | "tick"
  | "crowd.cheer"
  | "crowd.gasp"
  | "ko.impact"
  | "ko.slowmo"
  | "ambient.wasteland"
  | "ambient.foundry"
  | "ambient.meadow"
  | "ambient.kyoto"
  | "music.menu"
  | "music.wasteland"
  | "music.foundry"
  | "music.meadow"
  | "music.kyoto";

export interface SoundSlot {
  id: string;
  label: string;
  group: string;
  kind: SoundKind;
  synth: SynthId;
  /** base gain multiplier applied to every playback of this slot */
  gain: number;
  /** minimum seconds between two triggers of the same slot */
  minInterval?: number;
  /** fade the one-shot out after this many seconds (remote files are often longer than the action) */
  cut?: number;
}

export const CHAR_IDS: CharId[] = ["chicken", "buffalo", "ewe", "toad", "dog"];
export const CHAR_LABEL: Record<CharId, string> = { chicken: "Robo-Cluck", buffalo: "Fluffalo", ewe: "Scrap-Ewe", toad: "King Croak", dog: "Ollie" };
export const ARENA_IDS: ArenaId[] = ["wasteland", "foundry", "meadow", "kyoto"];
export const ARENA_LABEL: Record<ArenaId, string> = { wasteland: "Wasteland Sunset", foundry: "Scrapyard Foundry", meadow: "Golden Meadow", kyoto: "Kyoto Coliseum" };

const VOICE_LABEL: Record<CharId, string> = { chicken: "cluck / crow", buffalo: "snort / bellow", ewe: "bleat", toad: "croak", dog: "bark / growl" };
const SPECIAL_LABEL: Record<CharId, string> = { chicken: "Laser Gaze zap", buffalo: "Stampede rumble", ewe: "Missile launch", toad: "Toxic belch", dog: "Twin Fang Rush" };
const SPECIAL_SYNTH: Record<CharId, SynthId> = { chicken: "special.laser", buffalo: "special.stampede", ewe: "special.missiles", toad: "special.belch", dog: "whoosh.hard" };
/** organic fighters "clang" is a body block, robots ring like metal */
const CLANG_SYNTH: Record<CharId, [SynthId, SynthId]> = {
  chicken: ["clang.soft", "clang.hard"],
  ewe: ["clang.soft", "clang.hard"],
  buffalo: ["slap.soft", "slap.hard"],
  toad: ["slap.soft", "slap.hard"],
  dog: ["slap.soft", "slap.hard"],
};
const KNOCK_SYNTH: Record<CharId, [SynthId, SynthId]> = {
  chicken: ["knock.soft", "knock.hard"],
  ewe: ["knock.soft", "knock.hard"],
  buffalo: ["knock.soft", "knock.hard"],
  toad: ["squelch.soft", "squelch.hard"],
  dog: ["knock.soft", "knock.hard"],
};

function fighterSlots(c: CharId): SoundSlot[] {
  const g = CHAR_LABEL[c];
  const s = (id: string, label: string, synth: SynthId, gain = 1, minInterval?: number, cut?: number): SoundSlot => ({
    id: `${c}.${id}`,
    label,
    group: g,
    kind: "sfx",
    synth,
    gain,
    minInterval,
    cut,
  });
  return [
    s("whoosh.soft", "Whoosh — soft (light swing / jump)", "whoosh.soft", 0.7, undefined, 0.7),
    s("whoosh.hard", "Whoosh — hard (heavy / air swing)", "whoosh.hard", 0.9, undefined, 1.1),
    s("punch.soft", "Punch — soft (light hit)", "punch.soft", 0.9, undefined, 1.2),
    s("punch.hard", "Punch — hard (heavy hit)", "punch.hard", 1, undefined, 1.6),
    s("clang.soft", "Clang — soft (blocked light)", CLANG_SYNTH[c][0], 0.8, undefined, 1.2),
    s("clang.hard", "Clang — hard (blocked heavy)", CLANG_SYNTH[c][1], 0.9, undefined, 1.8),
    s("knock.soft", "Knock — soft (grab / pull)", KNOCK_SYNTH[c][0], 0.9, undefined, 1.2),
    s("knock.hard", "Knock — hard (launcher / knockdown)", KNOCK_SYNTH[c][1], 1, undefined, 1.6),
    s("thud.soft", "Thud — soft (landing)", "thud.soft", 0.7, 0.12, 1.0),
    s("thud.hard", "Thud — hard (slam / floor impact)", "thud.hard", 1, 0.12, 1.6),
    s("hiya.soft", `Battle cry — soft (${VOICE_LABEL[c]})`, `voice.${c === "dog" ? "buffalo" : c}.soft` as SynthId, 0.8, 0.25, 1.6),
    s("hiya.hard", `Battle cry — hard (${VOICE_LABEL[c]})`, `voice.${c === "dog" ? "buffalo" : c}.hard` as SynthId, 0.95, 0.4, 2.6),
    s("intro", "Round intro cry", `voice.${c === "dog" ? "buffalo" : c}.hard` as SynthId, 0.95, 1, 3),
    s("special", `Special — ${SPECIAL_LABEL[c]}`, SPECIAL_SYNTH[c], 1, 0.3, 2.6),
  ];
}

const UI = "Interface & Transitions";
const ANN = "Announcer & Intros";
const KO = "Knockout";

export const CATALOG: SoundSlot[] = [
  // interface
  { id: "ui.click", label: "Button click", group: UI, kind: "sfx", synth: "ui.click", gain: 0.6, cut: 1 },
  { id: "ui.hover", label: "Button hover", group: UI, kind: "sfx", synth: "ui.hover", gain: 0.25, minInterval: 0.05, cut: 0.6 },
  { id: "ui.back", label: "Back / cancel", group: UI, kind: "sfx", synth: "ui.back", gain: 0.6, cut: 1 },
  { id: "ui.select", label: "Fighter / arena selected", group: UI, kind: "sfx", synth: "ui.select", gain: 0.7, cut: 1.2 },
  { id: "ui.transition", label: "Screen transition swoosh", group: UI, kind: "sfx", synth: "ui.transition", gain: 0.8, cut: 1.5 },
  { id: "ui.start", label: "FIGHT! button (match start hit)", group: UI, kind: "sfx", synth: "ui.start", gain: 1, cut: 3.5 },
  { id: "music.menu", label: "Menu music", group: UI, kind: "music", synth: "music.menu", gain: 0.55 },
  // announcer / intros
  { id: "announce.round", label: "Round start bell / gong", group: ANN, kind: "sfx", synth: "gong", gain: 0.9 },
  { id: "announce.fight", label: "FIGHT! sting", group: ANN, kind: "sfx", synth: "ui.start", gain: 1 },
  { id: "announce.win", label: "Round won fanfare", group: ANN, kind: "sfx", synth: "fanfare.short", gain: 0.85 },
  { id: "announce.match", label: "Match won fanfare", group: ANN, kind: "sfx", synth: "fanfare.long", gain: 0.9 },
  { id: "timer.tick", label: "Last-10-seconds tick", group: ANN, kind: "sfx", synth: "tick", gain: 0.6, minInterval: 0.5, cut: 0.45 },
  { id: "crowd.cheer", label: "Crowd cheer", group: ANN, kind: "sfx", synth: "crowd.cheer", gain: 0.6, minInterval: 1 },
  { id: "crowd.gasp", label: "Crowd gasp", group: ANN, kind: "sfx", synth: "crowd.gasp", gain: 0.6, minInterval: 1 },
  // knockout
  { id: "ko.impact", label: "KO impact", group: KO, kind: "sfx", synth: "ko.impact", gain: 1, cut: 3 },
  { id: "announce.ko", label: "K.O. sting", group: KO, kind: "sfx", synth: "ko.impact", gain: 0.9, cut: 3 },
  { id: "ko.slowmo", label: "Slow-motion whoosh", group: KO, kind: "sfx", synth: "ko.slowmo", gain: 0.8, cut: 4 },
  { id: "ko.fall", label: "Body hits the floor", group: KO, kind: "sfx", synth: "thud.hard", gain: 1, cut: 1.6 },
  { id: "ko.bell", label: "Final bell", group: KO, kind: "sfx", synth: "bell", gain: 0.8 },
  // fighters
  ...CHAR_IDS.flatMap(fighterSlots),
  // arenas
  ...ARENA_IDS.flatMap((a): SoundSlot[] => [
    { id: `arena.${a}.music`, label: `${ARENA_LABEL[a]} — music`, group: `Arena: ${ARENA_LABEL[a]}`, kind: "music", synth: `music.${a}` as SynthId, gain: 0.5 },
    { id: `arena.${a}.ambient`, label: `${ARENA_LABEL[a]} — ambience loop`, group: `Arena: ${ARENA_LABEL[a]}`, kind: "ambient", synth: `ambient.${a}` as SynthId, gain: 0.4 },
  ]),
];

export const SLOT_BY_ID: Record<string, SoundSlot> = Object.fromEntries(CATALOG.map((s) => [s.id, s]));
export const GROUPS: string[] = [...new Set(CATALOG.map((s) => s.group))];

export function slotsForFighter(c: CharId) {
  return CATALOG.filter((s) => s.id.startsWith(c + "."));
}
export function slotsForArena(a: ArenaId) {
  return CATALOG.filter((s) => s.id.startsWith(`arena.${a}.`));
}
export const CORE_SLOT_IDS = CATALOG.filter((s) => [UI, ANN, KO].includes(s.group) && s.kind === "sfx").map((s) => s.id);
