import { Fighter } from "./Fighter";
import { InputState, emptyInput } from "./Input";

export type Difficulty = "easy" | "normal" | "hard";

interface Profile {
  reaction: number;
  blockChance: number;
  aggression: number;
  specialChance: number;
  jumpInChance: number;
  mistake: number;
}

const PROFILES: Record<Difficulty, Profile> = {
  easy: { reaction: 0.42, blockChance: 0.2, aggression: 0.45, specialChance: 0.25, jumpInChance: 0.1, mistake: 0.35 },
  normal: { reaction: 0.24, blockChance: 0.5, aggression: 0.65, specialChance: 0.5, jumpInChance: 0.2, mistake: 0.18 },
  hard: { reaction: 0.12, blockChance: 0.8, aggression: 0.85, specialChance: 0.75, jumpInChance: 0.3, mistake: 0.06 },
};

type Plan = "idle" | "approach" | "retreat" | "block" | "jumpIn" | "light" | "heavy" | "special" | "air" | "hop" | "evade";

export class AIController {
  private p: Profile;
  /** set by the game when incoming projectiles are in flight */
  threat = false;
  /** x positions of lingering hazards (gas clouds) */
  hazards: number[] = [];
  private evadeDir = 1;
  private timer = 0;
  private plan: Plan = "idle";
  private planTime = 0;
  private pressed = false;
  private out: InputState = emptyInput();

  constructor(
    private me: Fighter,
    private opp: Fighter,
    difficulty: Difficulty,
  ) {
    this.p = PROFILES[difficulty];
  }

  update(dt: number): InputState {
    const o = this.out;
    o.left = o.right = o.up = o.down = o.light = o.heavy = o.special = false;
    o.jUp = o.jLight = o.jHeavy = o.jSpecial = false;

    if (!this.me.controllable) return o;

    this.timer -= dt;
    this.planTime += dt;
    const dist = Math.abs(this.opp.pos.x - this.me.pos.x);
    const toward = this.opp.pos.x > this.me.pos.x ? 1 : -1;

    // emergency: react to incoming attack or projectile
    if (this.plan !== "block" && ((this.opp.attackingWindowSoon && dist < 3.2 && this.timer < this.p.reaction * 0.5) || this.threat)) {
      if (Math.random() < this.p.blockChance) {
        this.plan = "block";
        this.planTime = 0;
        this.timer = 0.35 + Math.random() * 0.4;
      }
    }

    // incoming unblockable grab: hop away instead of blocking
    const incoming = this.opp.state === "attack" ? this.opp.move?.hits[0] : undefined;
    if (
      incoming?.unblockable &&
      this.opp.stateTime < incoming.start &&
      dist < 2.8 &&
      this.plan !== "hop" &&
      this.me.grounded &&
      this.me.state !== "attack" &&
      Math.random() < this.p.blockChance * 0.08
    ) {
      this.plan = "hop";
      this.planTime = 0;
      this.pressed = false;
      this.timer = 0.5;
    }

    // step out of gas clouds
    if (this.me.grounded && this.me.state !== "attack" && this.plan !== "evade" && this.plan !== "hop") {
      for (const hx of this.hazards) {
        if (Math.abs(hx - this.me.pos.x) < 2.0) {
          this.plan = "evade";
          this.evadeDir = this.me.pos.x >= hx ? 1 : -1;
          this.planTime = 0;
          this.timer = 0.4;
          break;
        }
      }
    }

    if (this.timer <= 0) {
      this.decide(dist);
    }

    switch (this.plan) {
      case "hop":
        if (!this.pressed) {
          o.up = true;
          o.jUp = true;
          this.pressed = true;
        }
        if (toward > 0) o.left = true;
        else o.right = true;
        break;
      case "evade":
        if (this.evadeDir > 0) o.right = true;
        else o.left = true;
        break;
      case "approach":
        if (toward > 0) o.right = true;
        else o.left = true;
        if (dist < 1.9) this.timer = 0;
        break;
      case "retreat":
        if (toward > 0) o.left = true;
        else o.right = true;
        break;
      case "block":
        o.down = true;
        break;
      case "jumpIn":
        if (!this.pressed) {
          o.up = true;
          o.jUp = true;
          this.pressed = true;
        }
        if (toward > 0) o.right = true;
        else o.left = true;
        if (!this.me.grounded && this.me.vel.y < 2 && dist < 2.6 && this.planTime > 0.25) {
          o.light = true;
          o.jLight = true;
          this.plan = "idle";
          this.timer = 0.3;
        }
        break;
      case "light":
      case "heavy":
      case "special":
      case "air": {
        if (!this.pressed) {
          this.pressed = true;
          if (this.plan === "light") {
            o.light = true;
            o.jLight = true;
          } else if (this.plan === "heavy") {
            o.heavy = true;
            o.jHeavy = true;
          } else {
            o.special = true;
            o.jSpecial = true;
          }
        } else if (this.me.state === "attack" && this.me.moveHitLanded && this.me.move?.cancel && Math.random() < this.p.aggression * 0.1) {
          // chain into a heavy on hit
          o.heavy = true;
          o.jHeavy = true;
        }
        if (this.me.state !== "attack" && this.planTime > 0.1) this.timer = 0;
        break;
      }
      default:
        break;
    }
    return o;
  }

  private decide(dist: number) {
    const p = this.p;
    this.pressed = false;
    this.planTime = 0;
    const r = Math.random();
    const canSpecial = this.me.meter >= (this.me.cfg.moves.special.meterCost ?? 50);
    const oppVulnerable = this.opp.state === "hit" || this.opp.state === "attack" || this.opp.state === "launched" || this.opp.state === "getup";
    const oppDown = this.opp.state === "down";

    if (oppDown) {
      // give space or set up
      this.plan = r < 0.5 ? "retreat" : "idle";
      this.timer = 0.4 + Math.random() * 0.3;
      return;
    }

    if (canSpecial && dist < 6 && r < p.specialChance * (oppVulnerable ? 1.5 : 0.6)) {
      this.plan = "special";
      this.timer = 1.6;
      return;
    }

    if (dist < 2.3) {
      if (r < p.mistake) {
        this.plan = "idle";
        this.timer = p.reaction + Math.random() * 0.2;
        return;
      }
      const a = Math.random();
      if (a < p.aggression) {
        this.plan = Math.random() < 0.6 ? "light" : "heavy";
        this.timer = 0.9;
      } else if (a < p.aggression + 0.2) {
        this.plan = "block";
        this.timer = 0.4 + Math.random() * 0.4;
      } else {
        this.plan = "retreat";
        this.timer = 0.3 + Math.random() * 0.4;
      }
      return;
    }

    if (dist > 2.3 && dist < 5.5 && r < p.jumpInChance) {
      this.plan = "jumpIn";
      this.timer = 1.2;
      return;
    }

    if (r < 0.12) {
      this.plan = "retreat";
      this.timer = 0.25 + Math.random() * 0.3;
    } else if (r < 0.2) {
      this.plan = "idle";
      this.timer = 0.2 + Math.random() * 0.3;
    } else {
      this.plan = "approach";
      this.timer = 0.4 + Math.random() * 0.5;
    }
  }
}
