import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Fighter, HitEvent, World } from "./Fighter";
import { CharacterRig, smooth } from "./Rig";
import { RobotChicken } from "./characters/RobotChicken";
import { FluffyBuffalo } from "./characters/FluffyBuffalo";
import { ScrapEwe } from "./characters/ScrapEwe";
import { KingCroak } from "./characters/KingCroak";
import { SkinnedFighter, isSkinnedFighter } from "./characters/SkinnedFighter";
import { bindingFor } from "./skinned/bindings";
import type { PreparedAssets, SkinnedId } from "./skinned/assets";
import { CharId, FIGHTERS, HitWindow, MoveDef } from "./moves";
import { FX } from "./FX";
import { MissileSystem } from "./Projectiles";
import { GasSystem } from "./Hazards";
import { InputManager } from "./Input";
import { AIController, Difficulty } from "./AI";
import { ARENA_BOUNDS, Arena, ArenaId } from "./arenas/common";
import { buildWasteland } from "./arenas/Wasteland";
import { buildFoundry } from "./arenas/Foundry";
import { buildMeadow } from "./arenas/Meadow";
import { buildKyoto } from "./arenas/Kyoto";
import { audio } from "./audio/AudioEngine";

export type GameMode = "attract" | "cpu" | "2p";
export type Phase = "attract" | "intro" | "fight" | "ko" | "roundEnd" | "matchEnd";

export interface Banner {
  text: string;
  sub?: string;
  key: number;
  hold?: boolean;
  color?: string;
}

export interface HUDFighter {
  name: string;
  hp: number;
  maxHp: number;
  meter: number;
  rounds: number;
  color: string;
  hitAge: number;
  combo: number;
  moveNames: { light: string; heavy: string; special: string; air: string };
  specialCost: number;
  poisoned: boolean;
}

export interface HUDState {
  p1: HUDFighter;
  p2: HUDFighter;
  timer: number;
  round: number;
  phase: Phase;
  banner: Banner | null;
  paused: boolean;
  winner: 0 | 1 | 2 | null;
  flash: number;
  flashKey: number;
  mode: GameMode;
}

export interface GameOptions {
  mode: GameMode;
  p1: CharId;
  p2: CharId;
  arena: ArenaId;
  difficulty: Difficulty;
  roundsToWin: number;
  onState(s: HUDState): void;
  /** parsed GLBs for this match (see src/game/skinned/assets.ts) — omitted in unit contexts */
  assets?: PreparedAssets;
}

const ROUND_TIME = 99;

/**
 * Build a rig for a character. Characters with a skinned binding (the dog, and King Croak when
 * his GLB loaded) require their asset; everything else stays procedural. A missing skinned asset
 * is an error rather than a silent substitution, so the UI can show what failed and offer a retry.
 */
function makeRig(id: CharId, assets?: PreparedAssets): CharacterRig {
  const binding = bindingFor(id);
  if (binding) {
    const source = assets?.fighters[binding.id as SkinnedId];
    if (!source) throw new Error(`${id}: "${binding.id}" asset was not loaded (see the load error banner)`);
    return new SkinnedFighter(source, binding);
  }
  if (id === "chicken") return new RobotChicken();
  if (id === "buffalo") return new FluffyBuffalo();
  if (id === "toad") return new KingCroak();
  if (id === "ewe") return new ScrapEwe();
  throw new Error(`No rig available for ${id}`);
}

interface MissileSpawn {
  at: number;
  f: Fighter;
  i: number;
  count: number;
  speed: number;
  arc: number;
  turn: number;
}

const MISSILE_WINDOW: HitWindow = {
  start: 0,
  end: 0,
  damage: 8,
  reach: 0,
  band: "mid",
  knockback: 7,
  launch: 5,
  hitstun: 0.5,
  blockstun: 0.3,
  shake: 0.3,
  hitstop: 0.08,
};

function buildArena(id: ArenaId, assets?: PreparedAssets): Arena {
  switch (id) {
    case "foundry":
      return buildFoundry();
    case "meadow":
      return buildMeadow();
    case "kyoto":
      return buildKyoto(assets?.stages.kyoto ?? null);
    default:
      return buildWasteland();
  }
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private arena: Arena;
  private fx: FX;
  private missiles: MissileSystem;
  private gas: GasSystem;
  private missileQueue: MissileSpawn[] = [];
  private meteorAccum = new WeakMap<Fighter, number>();
  private input = new InputManager();
  fighters: [Fighter, Fighter];
  private ai: AIController | null = null;
  private opts: GameOptions;
  private frameTimer = new THREE.Timer();
  private raf = 0;
  private disposed = false;
  private time = 0;
  phase: Phase = "attract";
  private phaseTime = 0;
  private round = 0;
  private timer = ROUND_TIME;
  private hitstop = 0;
  private timeScale = 1;
  private shake = 0;
  private camPos = new THREE.Vector3(0, 2.5, 10);
  private camLook = new THREE.Vector3(0, 1.2, 0);
  private lastFrameInfo = { calls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0, frameMs: 0, fps: 0 };
  private banner: Banner | null = null;
  private bannerKey = 0;
  private hudAccum = 0;
  paused = false;
  private flash = 0;
  private flashKey = 0;
  private winner: 0 | 1 | 2 | null = null;
  private loser: Fighter | null = null;
  private comboShow: { idx: number; count: number; until: number } | null = null;
  private tauntTimer = 4;
  private lastTick = -1;
  private world: World;
  private tmp = new THREE.Vector3();
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, opts: GameOptions) {
    this.opts = opts;
    this.canvas = canvas;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(w, h, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 1500);

    this.arena = buildArena(opts.arena, opts.assets);
    this.scene.add(this.arena.group);
    this.scene.fog = this.arena.fog;
    this.scene.background = this.arena.background;
    this.renderer.toneMappingExposure = this.arena.exposure;

    this.fx = new FX(this.scene);
    this.fx.setViewport(h, this.renderer.getPixelRatio());
    this.missiles = new MissileSystem(this.scene);
    this.gas = new GasSystem(this.scene);

    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), this.arena.bloom.strength, this.arena.bloom.radius, this.arena.bloom.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    const f1 = new Fighter(FIGHTERS[opts.p1], makeRig(opts.p1, opts.assets));
    const f2 = new Fighter(FIGHTERS[opts.p2], makeRig(opts.p2, opts.assets));
    this.fighters = [f1, f2];
    this.scene.add(f1.rig.root, f2.rig.root);

    this.world = {
      bounds: ARENA_BOUNDS,
      fx: this.fx,
      time: 0,
      dustColor: this.arena.dustColor,
      onHit: (e) => this.onHit(e),
      onMoveStart: (f, m) => this.onMoveStart(f, m),
      onLand: (f, impact) => this.onLand(f, impact),
      shake: (amount) => {
        this.shake = Math.max(this.shake, amount);
      },
      cue: (kind, f, other) => {
        const c = f.cfg.id;
        if (kind === "jump") audio.play(`${c}.whoosh.soft`, { gain: 0.45, rate: 1.25, vary: 0.05 });
        else if (kind === "throw") {
          audio.play(`${c}.hiya.soft`, { rate: 1.12, gain: 0.8 });
          if (other) audio.play(`${other.cfg.id}.whoosh.hard`, { gain: 0.8 });
        } else if (kind === "getup") audio.play(`${c}.thud.soft`, { gain: 0.35, rate: 1.1 });
      },
    };

    // audio: assets for this match, music bed and ambience
    audio.preloadFor([opts.p1, opts.p2], opts.arena);
    audio.setMusicRate(1);
    audio.playMusic(opts.mode === "attract" ? "music.menu" : `arena.${opts.arena}.music`);
    audio.playAmbient(`arena.${opts.arena}.ambient`);

    this.input.attach();
    this.input.onPause(() => {
      if (this.phase !== "attract" && this.phase !== "matchEnd") this.togglePause();
    });

    window.addEventListener("resize", this.onResize);

    if (opts.mode === "attract") {
      this.phase = "attract";
      f1.reset(-2.6, 1);
      f2.reset(2.6, -1);
      f1.setState("idle");
      f2.setState("idle");
    } else {
      if (opts.mode === "cpu") this.ai = new AIController(f2, f1, opts.difficulty);
      this.startRound();
    }
    this.emitHud();
    (window as unknown as { __game?: Game }).__game = this;
    this.loop();
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  private onResize = () => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fx.setViewport(h, this.renderer.getPixelRatio());
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.input.detach();
    this.missiles.dispose();
    this.gas.dispose();
    this.arena.dispose();
    for (const f of this.fighters) if (isSkinnedFighter(f.rig)) f.rig.disposeRig();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !m.userData.sharedGeometry) m.geometry.dispose();
    });
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  togglePause() {
    this.setPaused(!this.paused);
  }

  setPaused(p: boolean) {
    if (p === this.paused) return;
    this.paused = p;
    if (p) audio.duckMusic(0.35, 3600);
    else audio.duckMusic(1, 0.1);
    this.emitHud();
  }

  restart() {
    for (const f of this.fighters) f.roundsWon = 0;
    this.round = 0;
    this.winner = null;
    this.paused = false;
    this.startRound();
  }

  /* ------------------------------------------------------------------ */
  /* Round flow                                                          */
  /* ------------------------------------------------------------------ */

  private setBanner(text: string, sub?: string, hold = false, color?: string) {
    this.banner = { text, sub, key: ++this.bannerKey, hold, color };
    this.emitHud();
  }

  private startRound() {
    const [a, b] = this.fighters;
    this.round++;
    this.timer = ROUND_TIME;
    this.timeScale = 1;
    this.hitstop = 0;
    this.loser = null;
    this.missiles.clear();
    this.gas.clear();
    this.missileQueue.length = 0;
    a.reset(-3.2, 1);
    b.reset(3.2, -1);
    this.phase = "intro";
    this.phaseTime = 0;
    const final = this.opts.roundsToWin > 1 && a.roundsWon === this.opts.roundsToWin - 1 && b.roundsWon === this.opts.roundsToWin - 1;
    this.setBanner(final ? "FINAL ROUND" : `ROUND ${this.round}`, final ? "Winner takes all" : undefined, true);
    // cinematic camera start: low angle beside player one
    if (this.opts.arena === "kyoto") {
      this.camPos.set(0, 2.4, 10.5);
      this.camLook.set(0, 1.2, 0);
    } else {
      this.camPos.set(a.pos.x - 2.5, 0.7, 4.5);
      this.camLook.set(a.pos.x + 1, 1.4, 0);
    }
    // audio: bell + staggered intro cries
    audio.setMusicRate(1);
    audio.play("announce.round");
    audio.play(`${a.cfg.id}.intro`, { delay: 0.55 });
    audio.play(`${b.cfg.id}.intro`, { delay: 1.45 });
    this.lastTick = -1;
  }

  private startFight() {
    this.phase = "fight";
    this.phaseTime = 0;
    for (const f of this.fighters) {
      f.controllable = true;
      if (f.state === "intro") f.setState("idle");
    }
    this.setBanner("FIGHT!", undefined, false, "#ffd23f");
    audio.play("announce.fight");
  }

  private triggerKO(loser: Fighter, timeOver = false) {
    const [a, b] = this.fighters;
    const winnerF = loser === a ? b : a;
    this.loser = loser;
    this.winner = winnerF === a ? 1 : 2;
    this.phase = "ko";
    this.phaseTime = 0;
    for (const f of this.fighters) f.controllable = false;
    if (timeOver) {
      loser.dead = true;
      loser.setState("ko");
      this.setBanner("TIME OVER", undefined, true, "#ffffff");
      audio.play("ko.bell");
      audio.duckMusic(0.5, 3);
    } else {
      this.timeScale = 0.18;
      this.setBanner("K.O.!", undefined, true, "#ff4d4d");
      this.flash = 1;
      this.flashKey++;
      audio.play("ko.impact");
      audio.play("ko.slowmo", { delay: 0.05 });
      audio.play("crowd.gasp", { delay: 0.15 });
      audio.play("announce.ko", { delay: 0.35 });
      audio.play(`${loser.cfg.id}.hiya.hard`, { rate: 0.85, delay: 0.1, gain: 0.9 });
      audio.duckMusic(0.3, 3.2);
      audio.setMusicRate(0.72);
    }
  }

  private endRound() {
    const [a, b] = this.fighters;
    this.timeScale = 1;
    this.phase = "roundEnd";
    this.phaseTime = 0;
    audio.setMusicRate(1);
    if (this.winner) {
      const w = this.winner === 1 ? a : b;
      w.roundsWon++;
      w.setState("victory");
      const perfect = w.perfect && w.hp === w.cfg.maxHp;
      this.setBanner(`${w.cfg.name} WINS`, perfect ? "PERFECT!" : `Round ${this.round}`, true, w.cfg.color);
      audio.play("announce.win", { delay: 0.15 });
      audio.play("crowd.cheer", { delay: 0.1 });
      audio.play(`${w.cfg.id}.hiya.hard`, { delay: 0.7 });
    } else {
      this.setBanner("DRAW", undefined, true);
      audio.play("ko.bell");
    }
  }

  private afterRound() {
    const [a, b] = this.fighters;
    const champ = a.roundsWon >= this.opts.roundsToWin ? a : b.roundsWon >= this.opts.roundsToWin ? b : null;
    if (champ) {
      this.phase = "matchEnd";
      this.phaseTime = 0;
      this.winner = champ === a ? 1 : 2;
      this.setBanner(`${champ.cfg.name} WINS THE MATCH`, this.opts.mode === "cpu" && champ === a ? "Flawless victory for the player" : undefined, true, champ.cfg.color);
      audio.play("announce.match");
      audio.play("crowd.cheer", { delay: 0.4, gain: 1.2 });
      audio.duckMusic(0.45, 4);
      this.emitHud();
    } else {
      this.startRound();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Combat callbacks                                                    */
  /* ------------------------------------------------------------------ */

  private onHit(e: HitEvent) {
    const att = e.attacker;
    const def = e.defender;
    const idx = att === this.fighters[0] ? 0 : 1;
    const hard = e.window.damage >= 10;
    const pan = Math.max(-0.6, Math.min(0.6, e.point.x / 8));
    if (e.blocked) {
      this.fx.blockSparks(e.point, att.facing);
      this.shake = Math.max(this.shake, e.window.shake * 0.35);
      this.hitstop = Math.max(this.hitstop, 0.03);
      audio.play(`${def.cfg.id}.clang.${hard ? "hard" : "soft"}`, { vary: 0.06, pan });
      return;
    }
    if (e.window.grab && !e.ko) {
      // tongue grab: wet slap, no big spark burst
      this.fx.ring(e.point, 0xa4ff6a, 1.3, 0.35, e.point.y);
      this.fx.hitSparks(e.point, 0xff7fb0, 12, 0.7, att.facing);
      this.fx.flash(e.point, 0x8dff5a, 20, 0.25, 6);
      this.shake = Math.max(this.shake, 0.3);
      this.hitstop = Math.max(this.hitstop, 0.06);
      audio.play(`${att.cfg.id}.knock.soft`, { pan });
      audio.play(`${def.cfg.id}.hiya.soft`, { rate: 1.15, delay: 0.06, gain: 0.8 });
      this.emitHud();
      return;
    }
    // impact sounds: attacker's punch, plus a knock for launchers and a hurt cry on hard hits
    if (!e.ko) {
      audio.play(`${att.cfg.id}.punch.${hard ? "hard" : "soft"}`, { vary: 0.07, pan });
      if ((e.window.launch ?? 0) > 0) audio.play(`${att.cfg.id}.knock.hard`, { delay: 0.02, gain: 0.85, pan });
      if (hard) audio.play(`${def.cfg.id}.hiya.soft`, { rate: 1.1, delay: 0.05, gain: 0.7 });
    }
    const power = 0.7 + e.window.damage / 18;
    this.fx.hitSparks(e.point, att.rig.sparkColor, 18 + e.window.damage * 1.2, power, att.facing);
    this.fx.flash(e.point, att.rig.accent, 25 + e.window.damage * 2, 0.25, 8);
    if (e.window.damage >= 12) {
      this.fx.shockDisc(e.point, att.rig.accent, 1.2 + e.window.damage * 0.05, 0.3);
      this.flash = 0.35;
      this.flashKey++;
    }
    this.shake = Math.max(this.shake, e.window.shake);
    this.hitstop = Math.max(this.hitstop, e.window.hitstop);
    if (e.combo >= 2) this.comboShow = { idx, count: e.combo, until: this.time + 1.6 };
    if (e.ko) {
      this.fx.hitSparks(e.point, 0xffffff, 60, 1.6, att.facing);
      this.fx.ring(e.point, att.rig.accent, 5, 0.7, e.point.y);
      this.shake = 1.2;
      this.hitstop = 0.16;
      this.triggerKO(e.defender);
    }
    this.emitHud();
  }

  private onMoveStart(f: Fighter, m: MoveDef) {
    const p = this.tmp;
    const c = f.cfg.id;
    if (m.name === "__fire") {
      audio.play(`${c}.special`);
      if (m.fx === "laser") {
        f.rig.strikeWorld("special", p);
        const from = p.clone();
        this.fx.beam(from, f.facing, 8, 0x5df6ff, 0.5, 0.16);
        this.fx.flash(from, 0x5df6ff, 80, 0.35, 12);
        this.fx.hitSparks(from, 0x9ffbff, 16, 0.8, f.facing);
        this.shake = Math.max(this.shake, 0.35);
      } else if (m.fx === "stampede") {
        this.fx.ring(f.pos, 0xffb347, 3, 0.5);
        this.fx.dustPuff(f.pos, 18, 0.9, this.arena.dustColor, 3, 1.5);
        this.shake = Math.max(this.shake, 0.25);
      } else if (m.fx === "belch" && m.hazard) {
        f.rig.strikeWorld("special", p);
        const from = p.clone();
        this.gas.spawn({ x: f.pos.x + f.facing * 1.1, dir: f.facing, ...m.hazard }, f, m);
        this.fx.flash(from, 0x7dff5a, 50, 0.4, 10);
        this.fx.ring(new THREE.Vector3(f.pos.x, 0, 0), 0x7dff5a, 2.4, 0.5);
        this.fx.hitSparks(from, 0xb8ff80, 16, 0.8, f.facing);
        for (let i = 0; i < 14; i++) {
          this.fx.steam(new THREE.Vector3(from.x + f.facing * Math.random() * 0.8, from.y + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.5), 1, 0x6fd94a, 0.7);
        }
        this.shake = Math.max(this.shake, 0.3);
      } else if (m.fx === "missiles" && m.projectile) {
        const pr = m.projectile;
        f.rig.impulse(0.8);
        f.rig.strikeWorld("special", p);
        this.fx.flash(p.clone(), 0xff5fa2, 40, 0.35, 10);
        this.fx.hitSparks(p.clone(), 0xffc0a0, 20, 0.9, f.facing);
        this.shake = Math.max(this.shake, 0.3);
        for (let i = 0; i < pr.count; i++) {
          this.missileQueue.push({
            at: this.time + i * pr.interval,
            f,
            i,
            count: pr.count,
            speed: pr.speed,
            arc: pr.arc,
            turn: pr.homing,
          });
        }
      }
      return;
    }
    // swing / voice at move start
    switch (m.slot) {
      case "light":
        audio.play(`${c}.whoosh.soft`, { vary: 0.08 });
        if (Math.random() < 0.3) audio.play(`${c}.hiya.soft`, { gain: 0.6, vary: 0.05 });
        break;
      case "heavy":
        audio.play(`${c}.whoosh.hard`, { vary: 0.06 });
        audio.play(`${c}.hiya.soft`, { delay: 0.05, vary: 0.05 });
        break;
      case "air":
        audio.play(`${c}.whoosh.hard`, { rate: 1.15, vary: 0.05 });
        break;
      case "special":
        audio.play(`${c}.hiya.hard`);
        break;
    }
    if (m.fx === "stampede" || m.fx === "missiles" || m.fx === "belch") {
      // stampede pawing dust handled per-frame; missiles / gas fire at fireAt
      return;
    }
    if (m.fx === "laser") {
      f.rig.strikeWorld("special", p);
      this.fx.flash(p.clone(), 0x38e8ff, 12, 0.4, 6);
    }
  }

  private spawnMissile(q: MissileSpawn) {
    const f = q.f;
    const zOff = (q.i % 2 === 0 ? 1 : -1) * (0.14 + Math.floor(q.i / 2) * 0.22);
    const pos = new THREE.Vector3(f.pos.x + f.facing * 0.28, f.pos.y + 1.82, zOff);
    const vel = new THREE.Vector3(f.facing * q.speed, q.arc - (q.i % 2) * 0.9, -zOff * 1.6);
    this.missiles.spawn(pos, vel, f, MISSILE_WINDOW, f.cfg.moves.special, q.turn);
  }

  private onLand(f: Fighter, impact: number) {
    const pan = Math.max(-0.6, Math.min(0.6, f.pos.x / 8));
    // cosmetic kick-up at the landing spot (petals in Kyoto); no effect on other stages
    this.arena.footfall?.(f.pos.x, f.pos.z, Math.min(1, impact / 13), this.fx);
    if (impact > 9) {
      this.fx.ring(f.pos, 0xffffff, 1.6 + impact * 0.05, 0.4);
      this.shake = Math.max(this.shake, Math.min(0.5, impact * 0.03));
      audio.play(`${f.cfg.id}.thud.hard`, { vary: 0.05, pan });
      if (f.state === "launched" || f.dead) audio.play("ko.fall", { gain: 0.6, delay: 0.01 });
    } else if (impact > 3) {
      audio.play(`${f.cfg.id}.thud.soft`, { gain: Math.min(1, 0.5 + impact * 0.05), vary: 0.06, pan });
    }
  }

  /** Per-frame move visuals (slash arcs at the hit window, stampede dust). */
  private moveFx(f: Fighter, dt: number) {
    if (f.state !== "attack" || !f.move) return;
    const m = f.move;
    const w = m.hits[0];
    if (w && !f.fxDone && f.stateTime >= w.start) {
      f.fxDone = true;
      const p = this.tmp;
      f.rig.strikeWorld(m.slot, p);
      p.z = 0.05;
      switch (m.fx) {
        case "peck":
          this.fx.slash(p.clone(), f.facing, 0x5df6ff, 0.55, 0.16, 0.3);
          break;
        case "kick":
          this.fx.slash(p.clone(), f.facing, 0x5df6ff, 1.35, 0.24, -0.4);
          break;
        case "dive":
          this.fx.slash(p.clone(), f.facing, 0x5df6ff, 1.1, 0.25, 0.9);
          break;
        case "headbutt":
          this.fx.shockDisc(p.clone(), 0xffb347, 0.6, 0.18);
          break;
        case "horn":
          this.fx.slash(p.clone(), f.facing, 0xffc25a, 1.45, 0.26, 1.2);
          break;
        case "slam":
          this.fx.shockDisc(p.clone(), 0xffb347, 0.9, 0.2);
          break;
        case "jab":
          this.fx.slash(p.clone(), f.facing, 0xff8fb8, 0.7, 0.14, 0.2);
          break;
        case "uppercut":
          this.fx.slash(p.clone(), f.facing, 0xff8fb8, 1.5, 0.26, 1.2);
          this.fx.hitSparks(p.clone(), 0xffd0b0, 10, 0.5, f.facing);
          break;
        case "meteor":
          this.fx.slash(p.clone(), f.facing, 0xff8fb8, 1.2, 0.24, 0.8);
          break;
        case "tongue":
          this.fx.shockDisc(p.clone(), 0xff9ac0, 0.35, 0.15);
          break;
        case "flop":
          this.fx.shockDisc(p.clone(), 0x8dff5a, 0.9, 0.2);
          break;
        default:
          break;
      }
    }
    // flaming meteor knuckle trail
    if (m.fx === "meteor" && !f.grounded) {
      const acc = (this.meteorAccum.get(f) ?? 0) + dt;
      if (acc > 0.045) {
        this.meteorAccum.set(f, 0);
        f.rig.strikeWorld("air", this.tmp);
        this.fx.embers(this.tmp.clone(), 3, 0xffa050);
      } else this.meteorAccum.set(f, acc);
    }
    if (m.fx === "stampede") {
      const l = m.lunge!;
      if (f.stateTime >= l.start && f.stateTime <= l.end && !f.moveHitLanded) {
        this.fx.dustPuff(new THREE.Vector3(f.pos.x - f.facing * 0.8, 0, (Math.random() - 0.5) * 0.6), 3, 0.8, this.arena.dustColor, 2, 1.2);
        this.shake = Math.max(this.shake, 0.08);
      } else if (f.stateTime < l.start && Math.random() < dt * 12) {
        this.fx.dustPuff(new THREE.Vector3(f.pos.x + f.facing * 0.6, 0, 0.2), 2, 0.4, this.arena.dustColor, 1, 0.8);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Main loop                                                           */
  /* ------------------------------------------------------------------ */

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.frameTimer.update();
    const raw = Math.min(0.05, this.frameTimer.getDelta());
    if (!this.paused) this.update(raw);
    this.updateCamera(raw);
    // the composer runs several render passes per frame; without this, info would only ever
    // describe the final full-screen pass
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.composer.render();
    // renderer.info is reset at the start of each render pass, so this is the one place where the
    // previous frame's draw calls / triangle count are readable in full
    this.lastFrameInfo = {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: this.renderer.info.programs?.length ?? 0,
      frameMs: raw * 1000,
      fps: raw > 0 ? 1 / raw : 0,
    };
  };

  private update(raw: number) {
    // slow-motion handling
    if (this.phase === "ko" && this.timeScale < 1) {
      if (this.phaseTime > 1.1) this.timeScale = Math.min(1, this.timeScale + raw * 1.5);
    }
    const dt = raw * this.timeScale;
    this.time += dt;
    this.world.time = this.time;
    this.phaseTime += raw;

    const [a, b] = this.fighters;

    // input routing
    if (this.opts.mode !== "attract") {
      if (this.ai) {
        this.ai.threat = this.missiles.activeCount > 0;
        this.ai.hazards = this.gas.positions();
      }
      a.input = this.input.p1.sample();
      b.input = this.ai ? this.ai.update(dt) : this.input.p2.sample();
    }

    // launch queued missiles
    if (this.phase === "fight" || this.phase === "ko") {
      for (let i = this.missileQueue.length - 1; i >= 0; i--) {
        const q = this.missileQueue[i];
        if (this.time >= q.at) {
          this.spawnMissile(q);
          this.missileQueue.splice(i, 1);
        }
      }
    }

    // arena ambience
    this.arena.update(dt, this.time, this.fx);
    this.fx.update(dt);

    // phases
    switch (this.phase) {
      case "attract":
        this.tauntTimer -= dt;
        if (this.tauntTimer <= 0) {
          this.tauntTimer = 4 + Math.random() * 4;
          const f = Math.random() < 0.5 ? a : b;
          f.setState(Math.random() < 0.6 ? "victory" : "intro");
          setTimeout(() => {
            if (!this.disposed && (f.state === "victory" || f.state === "intro")) f.setState("idle");
          }, 2600);
        }
        break;
      case "intro":
        if (this.phaseTime > 2.5) this.startFight();
        break;
      case "fight":
        this.timer = Math.max(0, this.timer - dt);
        {
          const sec = Math.ceil(this.timer);
          if (sec <= 10 && sec > 0 && sec !== this.lastTick) {
            this.lastTick = sec;
            audio.play("timer.tick", { rate: sec <= 3 ? 1.2 : 1 });
          }
        }
        if (this.timer <= 0) {
          const ra = a.hp / a.cfg.maxHp;
          const rb = b.hp / b.cfg.maxHp;
          if (Math.abs(ra - rb) < 1e-6) {
            this.winner = null;
            this.phase = "ko";
            this.phaseTime = 0;
            for (const f of this.fighters) f.controllable = false;
            this.setBanner("TIME OVER", "Draw", true);
          } else this.triggerKO(ra < rb ? a : b, true);
        }
        break;
      case "ko":
        if (this.phaseTime > 2.6) this.endRound();
        break;
      case "roundEnd":
        if (this.phaseTime > 3.2) this.afterRound();
        break;
      case "matchEnd":
        break;
    }

    // fighters (frozen during hit-stop)
    if (this.hitstop > 0) {
      this.hitstop -= raw;
    } else {
      a.update(dt, b, this.world);
      b.update(dt, a, this.world);
      this.separate(a, b);
      if (this.phase === "fight") {
        a.checkHits(b, this.world);
        if (this.phase === "fight") b.checkHits(a, this.world);
      }
      this.moveFx(a, dt);
      this.moveFx(b, dt);
      // combo bookkeeping
      if (b.neutral || b.state === "down") a.combo = 0;
      if (a.neutral || a.state === "down") b.combo = 0;
    }
    if (this.phase === "fight" || this.phase === "ko") {
      this.missiles.update(dt, [a, b], this.world, this.phase === "fight");
      this.gas.update(dt, this.time, [a, b], this.world, this.phase === "fight");
    }

    // screen flash decay
    this.flash = Math.max(0, this.flash - raw * 3);

    // HUD emission ~30Hz
    this.hudAccum += raw;
    if (this.hudAccum > 1 / 30) {
      this.hudAccum = 0;
      this.emitHud();
    }
  }

  private separate(a: Fighter, b: Fighter) {
    if (Math.abs(a.pos.y - b.pos.y) > 1.3) return;
    if (a.state === "ko" || b.state === "ko") return;
    // held victims sit on the grabber's anchor; thrown fighters may sail over the thrower
    if (a.state === "grabbed" || b.state === "grabbed") return;
    if ((a.state === "launched" && a.vel.y > 0) || (b.state === "launched" && b.vel.y > 0)) return;
    const minD = a.cfg.width + b.cfg.width;
    let dx = b.pos.x - a.pos.x;
    let ad = Math.abs(dx);
    if (ad >= minD) return;
    const s = dx === 0 ? a.facing : Math.sign(dx);
    const push = (minD - ad) / 2;
    a.pos.x -= s * push;
    b.pos.x += s * push;
    const bnd = ARENA_BOUNDS;
    const ca = THREE.MathUtils.clamp(a.pos.x, -bnd + a.cfg.width * 0.6, bnd - a.cfg.width * 0.6);
    const cb = THREE.MathUtils.clamp(b.pos.x, -bnd + b.cfg.width * 0.6, bnd - b.cfg.width * 0.6);
    if (ca !== a.pos.x) {
      a.pos.x = ca;
      b.pos.x = ca + s * minD;
    } else if (cb !== b.pos.x) {
      b.pos.x = cb;
      a.pos.x = cb - s * minD;
    }
    dx = b.pos.x - a.pos.x;
    ad = Math.abs(dx);
    a.rig.root.position.x = a.pos.x;
    b.rig.root.position.x = b.pos.x;
  }

  private updateCamera(raw: number) {
    const [a, b] = this.fighters;
    const mid = (a.pos.x + b.pos.x) / 2;
    const sep = Math.abs(a.pos.x - b.pos.x);
    const avgY = (a.pos.y + b.pos.y) / 2;
    const target = new THREE.Vector3();
    const look = new THREE.Vector3();
    let k = 1 - Math.exp(-raw * 5);
    // card-based stages publish a camera envelope, otherwise the backdrop planes show their edges
    const env = this.arena.camera;

    if (this.phase === "attract" && env && !env.orbit) {
      // lateral dolly instead of an orbit
      const sweep = Math.sin(this.time * 0.16) * 0.5 + 0.5;
      target.set(-5.2 + sweep * 10.4, env.minY + 0.95 + Math.sin(this.time * 0.4) * 0.35, env.minZ + 2.2);
      look.set(-1.4 + sweep * 2.8, (env.lookY ?? 1.15) + 0.15, 0);
      k = 1 - Math.exp(-raw * 1.6);
    } else if (this.phase === "attract" && env) {
      target.set(Math.sin(this.time * 0.18) * 1.1, 2.4, 11);
      look.set(0, 1.2, 0);
      k = 1 - Math.exp(-raw * 2);
    } else if (this.phase === "attract") {
      const ang = this.time * 0.11;
      target.set(Math.sin(ang) * 9.5, 2.4 + Math.sin(this.time * 0.35) * 0.5, Math.cos(ang) * 9.5);
      look.set(0, 1.1, 0);
      k = 1 - Math.exp(-raw * 2);
    } else if (this.phase === "ko" && this.loser) {
      const l = this.loser;
      target.set(l.pos.x + (mid - l.pos.x) * 0.25, 1.5 + l.pos.y * 0.4, 5.6);
      look.set(l.pos.x, 0.9 + l.pos.y * 0.5, 0);
      k = 1 - Math.exp(-raw * 3.5);
    } else {
      const near = env ? env.minZ - 0.8 : 7.6;
      const far = env ? env.maxZ : 13.5;
      const dist = THREE.MathUtils.clamp(5.6 + sep * 0.9, near, far);
      target.set(mid, 1.9 + sep * 0.06 + avgY * 0.35, dist);
      look.set(mid, 1.2 + avgY * 0.5, 0);
      if (this.phase === "intro") {
        k = 1 - Math.exp(-raw * (0.8 + smooth(this.phaseTime / 2.5) * 3));
      }
    }
    if (env) {
      // clamp the *target*; camPos lerps toward it, so the camera can never leave the envelope
      target.x = THREE.MathUtils.clamp(target.x, env.minX, env.maxX);
      target.y = THREE.MathUtils.clamp(target.y, env.minY, env.maxY);
      target.z = THREE.MathUtils.clamp(target.z, env.minZ, env.maxZ);
      look.y = env.lookY ?? look.y;
    } else {
      target.x = THREE.MathUtils.clamp(target.x, -ARENA_BOUNDS - 1, ARENA_BOUNDS + 1);
    }
    // optional debug override: window.__cam = { pos: [x,y,z], look: [x,y,z] }
    const dbg = (window as unknown as { __cam?: { pos: number[]; look: number[] } }).__cam;
    if (dbg) {
      target.fromArray(dbg.pos);
      look.fromArray(dbg.look);
      k = 1;
    }
    this.camPos.lerp(target, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    if (this.shake > 0.002) {
      const s = this.shake * 0.35;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s * 0.5;
      this.shake *= Math.exp(-raw * 6);
    }
    this.camera.lookAt(this.camLook);
  }

  /* ------------------------------------------------------------------ */

  /**
   * Read-only diagnostics for the offline preview harness (tools/preview) and the review overlay.
   * Deliberately narrow: renderer counters, camera state and per-fighter rig coverage.
   */
  debugSnapshot() {
    const info = this.renderer.info;
    const env = this.arena.camera;
    return {
      phase: this.phase,
      arena: this.opts.arena,
      time: +this.time.toFixed(2),
      render: {
        // renderer.info is cleared at the start of every render pass, so the authoritative
        // numbers for a completed frame are the ones cached by the loop above
        calls: this.lastFrameInfo.calls,
        triangles: this.lastFrameInfo.triangles,
        points: info.render.points,
        lines: info.render.lines,
        geometries: this.lastFrameInfo.geometries,
        textures: this.lastFrameInfo.textures,
        programs: this.lastFrameInfo.programs,
      },
      performance: { frameMs: +this.lastFrameInfo.frameMs.toFixed(2), fps: +this.lastFrameInfo.fps.toFixed(1) },
      pixelRatio: this.renderer.getPixelRatio(),
      size: [this.renderer.domElement.clientWidth, this.renderer.domElement.clientHeight],
      camera: {
        pos: this.camera.position.toArray().map((v) => +v.toFixed(3)),
        look: this.camLook.toArray().map((v) => +v.toFixed(3)),
        fov: this.camera.fov,
        aspect: +this.camera.aspect.toFixed(4),
        envelope: env ? { ...env } : null,
        insideEnvelope:
          !env ||
          (this.camera.position.x >= env.minX - 0.05 &&
            this.camera.position.x <= env.maxX + 0.05 &&
            this.camera.position.y >= env.minY - 0.05 &&
            this.camera.position.y <= env.maxY + 0.05 &&
            this.camera.position.z >= env.minZ - 0.05 &&
            this.camera.position.z <= env.maxZ + 0.05),
      },
      fighters: this.fighters.map((f) => {
        const rig = isSkinnedFighter(f.rig) ? f.rig : null;
        const chest = f.rig.chestWorld(new THREE.Vector3()).toArray().map((v) => +v.toFixed(3));
        const screen = new THREE.Vector3(chest[0], chest[1], chest[2]).project(this.camera);
        return {
          id: f.cfg.id,
          state: f.state,
          facing: f.facing,
          x: +f.pos.x.toFixed(3),
          y: +f.pos.y.toFixed(3),
          chest,
          // normalised device coordinates, so off-screen (>1) is detectable
          ndc: [+screen.x.toFixed(3), +screen.y.toFixed(3)],
          skinned: !!rig,
          rigState: rig ? rig.state : null,
          tongueReach: rig ? +rig.tongueReach().toFixed(3) : 0,
          missingStates: rig ? rig.missingStates : [],
          provisionalStates: rig ? rig.describe().filter((r) => r.provisional).map((r) => r.state) : [],
          flashMaterials: f.rig.flashMaterials.length,
        };
      }),
    };
  }

  private hudFighter(f: Fighter, idx: number): HUDFighter {
    const combo = this.comboShow && this.comboShow.idx === idx && this.comboShow.until > this.time ? this.comboShow.count : 0;
    return {
      name: f.cfg.name,
      hp: f.hp,
      maxHp: f.cfg.maxHp,
      meter: f.meter,
      rounds: f.roundsWon,
      color: f.cfg.color,
      hitAge: this.time - f.lastHitTime,
      combo,
      moveNames: f.cfg.moveNames,
      specialCost: f.cfg.moves.special.meterCost ?? 0,
      poisoned: f.poison > 0,
    };
  }

  private emitHud() {
    const [a, b] = this.fighters;
    this.opts.onState({
      p1: this.hudFighter(a, 0),
      p2: this.hudFighter(b, 1),
      timer: Math.ceil(this.timer),
      round: this.round,
      phase: this.phase,
      banner: this.banner,
      paused: this.paused,
      winner: this.winner,
      flash: this.flash,
      flashKey: this.flashKey,
      mode: this.opts.mode,
    });
  }
}
