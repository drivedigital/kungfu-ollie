import * as THREE from "three";
import { AnimCtx, CharacterRig } from "./Rig";
import { BAND_RANGES, FighterConfig, HitWindow, MoveDef, MoveSlot } from "./moves";
import { InputState, emptyInput } from "./Input";
import { FX } from "./FX";

export type FighterState =
  | "intro"
  | "idle"
  | "walkF"
  | "walkB"
  | "jump"
  | "block"
  | "blockstun"
  | "attack"
  | "hit"
  | "launched"
  | "grabbed"
  | "down"
  | "getup"
  | "ko"
  | "victory";

export interface HitEvent {
  attacker: Fighter;
  defender: Fighter;
  window: HitWindow;
  move: MoveDef;
  point: THREE.Vector3;
  blocked: boolean;
  ko: boolean;
  combo: number;
}

export interface World {
  bounds: number;
  fx: FX;
  time: number;
  dustColor: number;
  onHit(e: HitEvent): void;
  onMoveStart(f: Fighter, m: MoveDef): void;
  onLand(f: Fighter, impact: number): void;
  shake(amount: number): void;
}

const GRAVITY = 34;
const NO_INPUT = emptyInput();
const tmpV = new THREE.Vector3();

export class Fighter {
  cfg: FighterConfig;
  rig: CharacterRig;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  facing = 1;
  yaw = Math.PI / 2;
  hp: number;
  meter = 0;
  roundsWon = 0;
  state: FighterState = "idle";
  stateTime = 0;
  move: MoveDef | null = null;
  private hitFlags: boolean[] = [];
  moveHitLanded = false;
  /** set by the game once the hit-window visual for the current move has been spawned */
  fxDone = false;
  private airMoveUsed = false;
  stunTimer = 0;
  combo = 0;
  squash = 0;
  private squashVel = 0;
  controllable = true;
  input: InputState = emptyInput();
  private dustTimer = 0;
  dead = false;
  perfect = true;
  lastHitTime = -10;
  private fired = false;
  /** command-grab bookkeeping (victim side) */
  grabbedBy: Fighter | null = null;
  private grabTimer = 0;
  private grabThrow = { x: 0, y: 0 };
  /** poison status: remaining seconds */
  poison = 0;
  private poisonDps = 0;
  private poisonFx = 0;
  seed = Math.random() * 100;
  private ctx: AnimCtx = { vx: 0, vy: 0, grounded: true, fwd: 0, facing: 1, hpRatio: 1, seed: 0 };

  constructor(cfg: FighterConfig, rig: CharacterRig) {
    this.cfg = cfg;
    this.rig = rig;
    this.hp = cfg.maxHp;
    this.ctx.seed = this.seed;
  }

  get grounded() {
    return this.pos.y <= 0.0001;
  }
  get blocking() {
    return this.state === "block" || this.state === "blockstun";
  }
  get canBeHit() {
    if (this.dead) return false;
    switch (this.state) {
      case "down":
      case "getup":
      case "ko":
      case "victory":
      case "intro":
      case "grabbed":
        return false;
      default:
        return true;
    }
  }

  applyPoison(duration: number, dps: number, refreshOnly = false) {
    if (this.dead) return;
    this.poison = Math.max(this.poison, duration);
    if (!refreshOnly || this.poisonDps <= 0) this.poisonDps = dps;
  }
  get neutral() {
    return this.state === "idle" || this.state === "walkF" || this.state === "walkB" || this.state === "block" || this.state === "jump";
  }
  get attackingWindowSoon() {
    if (this.state !== "attack" || !this.move) return false;
    return this.move.hits.some((h) => this.stateTime < h.end);
  }

  reset(x: number, facing: number) {
    this.pos.set(x, 0, 0);
    this.vel.set(0, 0, 0);
    this.facing = facing;
    this.yaw = facing > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.hp = this.cfg.maxHp;
    this.move = null;
    this.combo = 0;
    this.dead = false;
    this.perfect = true;
    this.squash = 0;
    this.squashVel = 0;
    this.airMoveUsed = false;
    this.controllable = false;
    this.grabbedBy = null;
    this.poison = 0;
    this.poisonDps = 0;
    this.rig.tintAmount = 0;
    this.setState("intro");
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    this.updateCtx();
    this.rig.snap(this.ctx);
  }

  setState(s: FighterState, anim?: string) {
    this.state = s;
    this.stateTime = 0;
    this.rig.play(anim ?? (s === "blockstun" ? "block" : s), true);
  }

  private setStateIf(s: FighterState) {
    if (this.state !== s) this.setState(s);
  }

  startMove(slot: MoveSlot, world: World): boolean {
    const m = this.cfg.moves[slot];
    if (m.meterCost && this.meter < m.meterCost) return false;
    if (m.meterCost) this.meter -= m.meterCost;
    this.move = m;
    this.hitFlags = m.hits.map(() => false);
    this.moveHitLanded = false;
    this.fxDone = false;
    this.fired = false;
    this.setState("attack", slot);
    if (m.impulse) {
      this.vel.x = this.facing * m.impulse.x;
      this.vel.y = m.impulse.y;
    }
    if (slot === "air") this.airMoveUsed = true;
    this.rig.impulse(slot === "light" ? 0.25 : 0.5);
    world.onMoveStart(this, m);
    return true;
  }

  private tryAttack(inp: InputState, world: World): boolean {
    if (!this.grounded) return false;
    if (inp.jSpecial && this.meter >= (this.cfg.moves.special.meterCost ?? 0)) return this.startMove("special", world);
    if (inp.jHeavy) return this.startMove("heavy", world);
    if (inp.jLight) return this.startMove("light", world);
    return false;
  }

  update(dt: number, opp: Fighter, world: World) {
    this.stateTime += dt;
    const inp = this.controllable ? this.input : NO_INPUT;
    const wasAir = this.pos.y > 0;

    // poison status: slow drain (never lethal on its own) + rising green bubbles
    if (this.poison > 0 && !this.dead) {
      this.poison -= dt;
      if (this.hp > 1) this.hp = Math.max(1, this.hp - this.poisonDps * dt);
      this.poisonFx -= dt;
      if (this.poisonFx <= 0) {
        this.poisonFx = 0.11;
        this.rig.chestWorld(tmpV);
        tmpV.x += (Math.random() - 0.5) * 0.7;
        tmpV.y += (Math.random() - 0.3) * 0.9;
        world.fx.steam(tmpV, 1, 0x7dff5a, 0.28);
        if (Math.random() < 0.4) world.fx.embers(tmpV, 1, 0xb8ff80);
      }
    }
    const tintTarget = this.poison > 0 ? 0.75 : 0;
    this.rig.tintAmount += (tintTarget - this.rig.tintAmount) * (1 - Math.exp(-6 * dt));

    // Facing (only in neutral grounded states)
    if (this.grounded && (this.state === "idle" || this.state === "walkF" || this.state === "walkB" || this.state === "block")) {
      this.facing = opp.pos.x >= this.pos.x ? 1 : -1;
    }

    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const friction = Math.exp(-14 * dt);

    switch (this.state) {
      case "idle":
      case "walkF":
      case "walkB":
      case "block": {
        if (!this.grounded) {
          this.setState("jump");
          break;
        }
        if (this.tryAttack(inp, world)) break;
        if (inp.jUp) {
          this.vel.y = this.cfg.jumpVel;
          this.vel.x = dir * this.cfg.walkSpeed * 0.95;
          this.airMoveUsed = false;
          this.squash = -0.14;
          this.setState("jump");
          world.fx.dustPuff(this.pos, 8, 0.45, world.dustColor, 1.8, 1.5);
          break;
        }
        if (inp.down) {
          this.vel.x *= friction;
          this.setStateIf("block");
          break;
        }
        if (dir !== 0) {
          const fwd = dir === this.facing;
          this.vel.x = dir * (fwd ? this.cfg.walkSpeed : this.cfg.backSpeed);
          this.setStateIf(fwd ? "walkF" : "walkB");
          this.dustTimer -= dt;
          if (this.dustTimer <= 0) {
            this.dustTimer = 0.26;
            tmpV.set(this.pos.x - dir * 0.3, 0, this.pos.z + (Math.random() - 0.5) * 0.4);
            world.fx.dustPuff(tmpV, 3, 0.3, world.dustColor, 0.8, 0.6);
          }
        } else {
          this.vel.x *= friction;
          this.setStateIf("idle");
        }
        break;
      }
      case "jump": {
        if (!this.airMoveUsed && (inp.jLight || inp.jHeavy || inp.jSpecial)) {
          this.startMove("air", world);
          break;
        }
        // light air control
        this.vel.x += dir * 5 * dt;
        this.vel.x = THREE.MathUtils.clamp(this.vel.x, -this.cfg.walkSpeed, this.cfg.walkSpeed);
        break;
      }
      case "attack": {
        const m = this.move!;
        const l = m.lunge;
        if (l && this.stateTime >= l.start && this.stateTime <= l.end && !(l.stopOnHit && this.moveHitLanded)) {
          this.vel.x = this.facing * l.speed;
        } else if (this.grounded) {
          this.vel.x *= friction;
        }
        if (m.fireAt !== undefined && !this.fired && this.stateTime >= m.fireAt) {
          this.fired = true;
          world.onMoveStart(this, { ...m, name: "__fire" });
        }
        if (this.moveHitLanded && m.cancel && this.stateTime >= m.cancel.start && this.stateTime <= m.cancel.end) {
          if (this.tryAttack(inp, world)) break;
        }
        if (this.stateTime >= m.duration) {
          this.move = null;
          this.setState(this.grounded ? "idle" : "jump");
        }
        break;
      }
      case "hit": {
        this.vel.x *= Math.exp(-6 * dt);
        if (this.stateTime >= this.stunTimer) this.setState(this.dead ? "ko" : this.grounded ? "idle" : "jump");
        break;
      }
      case "blockstun": {
        this.vel.x *= Math.exp(-8 * dt);
        if (this.stateTime >= this.stunTimer) this.setState(inp.down ? "block" : "idle");
        break;
      }
      case "launched": {
        this.vel.x *= Math.exp(-0.8 * dt);
        break;
      }
      case "grabbed": {
        const g = this.grabbedBy;
        this.grabTimer -= dt;
        if (g && g.state === "attack" && this.grabTimer > 0) {
          g.rig.grabAnchorWorld(tmpV);
          const lim = world.bounds - this.cfg.width * 0.6;
          this.pos.x = THREE.MathUtils.clamp(tmpV.x, -lim, lim);
          this.pos.y = Math.max(0, tmpV.y - this.cfg.height * 0.5);
          this.vel.set(0, 0, 0);
        } else {
          // thrown
          const dir = g ? g.facing : this.facing;
          this.vel.x = dir * this.grabThrow.x;
          this.vel.y = this.grabThrow.y;
          this.pos.y = Math.max(this.pos.y, 0.02);
          this.grabbedBy = null;
          this.squash = -0.15;
          world.fx.ring(this.pos, 0xa4ff6a, 1.6, 0.35);
          world.fx.dustPuff(this.pos, 8, 0.5, world.dustColor, 1.6, 1.2);
          world.shake(0.35);
          this.setState("launched");
        }
        break;
      }
      case "down": {
        this.vel.x *= Math.exp(-6 * dt);
        if (this.stateTime >= 0.85) this.setState("getup");
        break;
      }
      case "getup": {
        if (this.stateTime >= 0.55) this.setState("idle");
        break;
      }
      case "ko":
      case "victory":
      case "intro": {
        if (this.grounded) this.vel.x *= friction;
        break;
      }
    }

    // physics (a grabbed fighter is positioned by the grabber instead)
    if (this.state !== "grabbed") {
      if (this.pos.y > 0 || this.vel.y > 0) this.vel.y -= GRAVITY * dt;
      this.pos.x += this.vel.x * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= 0) {
        const impact = -this.vel.y;
        this.pos.y = 0;
        this.vel.y = 0;
        if (wasAir) this.onLand(impact, world);
      }
      const b = world.bounds - this.cfg.width * 0.6;
      if (this.pos.x < -b) {
        this.pos.x = -b;
        if (this.vel.x < 0) this.vel.x *= -0.2;
      } else if (this.pos.x > b) {
        this.pos.x = b;
        if (this.vel.x > 0) this.vel.x *= -0.2;
      }
    }

    // squash & stretch spring
    this.squashVel += (-this.squash * 220 - this.squashVel * 16) * dt;
    this.squash += this.squashVel * dt;

    // yaw
    const targetYaw = this.facing > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.yaw += (targetYaw - this.yaw) * (1 - Math.exp(-14 * dt));

    this.applyToRig(dt, world);
  }

  private onLand(impact: number, world: World) {
    this.rig.impulse(Math.min(1, impact / 12));
    if (this.state === "launched") {
      this.squash = 0.22;
      world.fx.dustPuff(this.pos, 16, 0.7, world.dustColor, 2.4, 1.6);
      world.onLand(this, impact + 6);
      this.setState(this.dead ? "ko" : "down");
      this.vel.x *= 0.3;
      return;
    }
    if (impact > 3) {
      this.squash = Math.min(0.2, impact * 0.015);
      world.fx.dustPuff(this.pos, 8, 0.5, world.dustColor, 1.6, 1.0);
      world.onLand(this, impact);
    }
    if (this.state === "jump" || this.state === "hit") this.setState(this.dead ? "ko" : "idle");
    else if (this.state === "attack" && this.move?.slot === "air") {
      this.move = null;
      this.setState("idle");
    }
  }

  private updateCtx() {
    const c = this.ctx;
    c.vx = this.vel.x;
    c.vy = this.vel.y;
    c.grounded = this.grounded;
    c.fwd = this.vel.x * this.facing;
    c.facing = this.facing;
    c.hpRatio = this.hp / this.cfg.maxHp;
  }

  private applyToRig(dt: number, world: World) {
    this.updateCtx();
    this.rig.update(dt, this.ctx);
    const r = this.rig.root;
    r.position.copy(this.pos);
    r.rotation.y = this.yaw;
    const s = this.squash;
    r.scale.set(1 + s, 1 - s, 1 + s);
    this.rig.tick(dt, world.time, world.fx, this.state);
  }

  /** Called by the game after both fighters update. */
  checkHits(opp: Fighter, world: World) {
    if (this.state !== "attack" || !this.move) return;
    const m = this.move;
    for (let i = 0; i < m.hits.length; i++) {
      if (this.hitFlags[i]) continue;
      const w = m.hits[i];
      if (this.stateTime < w.start || this.stateTime > w.end) continue;
      if (!opp.canBeHit) continue;
      const front = this.pos.x + this.facing * w.reach;
      const minX = Math.min(this.pos.x, front);
      const maxX = Math.max(this.pos.x, front);
      const oMin = opp.pos.x - opp.cfg.width;
      const oMax = opp.pos.x + opp.cfg.width;
      if (maxX < oMin || minX > oMax) continue;
      const [b0, b1] = BAND_RANGES[w.band];
      const a0 = this.pos.y + b0;
      const a1 = this.pos.y + b1;
      if (a1 < opp.pos.y || a0 > opp.pos.y + opp.cfg.height) continue;
      this.hitFlags[i] = true;
      this.landHit(opp, w, m, null, world, true);
    }
  }

  /**
   * Resolve a damaging hit window. `melee` marks hits coming from this fighter's
   * own attack animation; projectiles pass `false` and supply a contact point.
   */
  landHit(opp: Fighter, w: HitWindow, m: MoveDef, pointIn: THREE.Vector3 | null, world: World, melee: boolean) {
    const point = pointIn ? pointIn.clone() : new THREE.Vector3();
    if (!pointIn) this.rig.strikeWorld(m.slot, point);
    // keep the contact point inside the defender's silhouette
    const nearX = opp.pos.x - this.facing * opp.cfg.width * 0.6;
    point.x = this.facing > 0 ? Math.min(point.x, nearX + 0.3) : Math.max(point.x, nearX - 0.3);
    point.x = THREE.MathUtils.lerp(point.x, nearX, 0.5);
    point.y = THREE.MathUtils.clamp(point.y, opp.pos.y + 0.3, opp.pos.y + opp.cfg.height - 0.2);
    point.z = 0;

    const dir = this.facing;
    const blocked = opp.blocking && opp.grounded && !w.unblockable;
    if (blocked) {
      const chip = w.damage * 0.12;
      opp.hp = Math.max(1, opp.hp - chip);
      opp.stunTimer = w.blockstun;
      opp.setState("blockstun");
      opp.vel.x = (dir * w.knockback * 0.7) / opp.cfg.weight;
      if (melee && this.grounded && m.slot !== "special") this.vel.x = -dir * 1.5;
      opp.meter = Math.min(100, opp.meter + w.damage * 0.35);
      this.meter = Math.min(100, this.meter + (m.meterGain ?? 0) * 0.4);
      opp.rig.flash(0.3);
      world.onHit({ attacker: this, defender: opp, window: w, move: m, point, blocked: true, ko: false, combo: 0 });
      return true;
    }

    const inCombo = opp.state === "hit" || opp.state === "launched";
    this.combo = inCombo ? this.combo + 1 : 1;
    opp.hp -= w.damage;
    opp.perfect = false;
    opp.lastHitTime = world.time;
    opp.rig.flash(1);
    opp.squash = 0.12;
    if (melee) this.moveHitLanded = true;
    this.meter = Math.min(100, this.meter + (m.meterGain ?? 0));
    opp.meter = Math.min(100, opp.meter + w.damage * 0.5);
    const ko = opp.hp <= 0;
    if (ko) {
      opp.hp = 0;
      opp.dead = true;
    }
    const kb = w.knockback / opp.cfg.weight;
    const launch = w.launch ?? 0;
    if (ko) {
      opp.vel.x = dir * Math.max(kb, 5);
      opp.vel.y = Math.max(launch, 6);
      opp.pos.y = Math.max(opp.pos.y, 0.02);
      opp.setState("launched");
    } else if (w.grab && melee) {
      // command grab: hold the victim on the grab anchor, throw when released
      opp.grabbedBy = this;
      opp.grabTimer = w.grab.hold;
      opp.grabThrow.x = w.grab.throwX;
      opp.grabThrow.y = w.grab.throwY;
      opp.vel.set(0, 0, 0);
      opp.setState("grabbed", "launched");
    } else if (launch > 0 || !opp.grounded) {
      opp.vel.x = dir * kb;
      opp.vel.y = Math.max(launch, 4);
      opp.pos.y = Math.max(opp.pos.y, 0.02);
      opp.setState("launched");
    } else {
      opp.vel.x = dir * kb;
      opp.stunTimer = w.hitstun;
      opp.setState("hit");
    }
    world.onHit({ attacker: this, defender: opp, window: w, move: m, point, blocked: false, ko, combo: this.combo });
    return !ko;
  }
}
