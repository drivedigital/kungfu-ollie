import * as THREE from "three";
import type { Fighter, World } from "./Fighter";
import type { HitWindow, MoveDef } from "./moves";
import { smokeTexture, softCircleTexture } from "./textures";

export interface GasSpec {
  x: number;
  dir: number;
  speed: number;
  travel: number;
  linger: number;
  radius: number;
  damage: number;
  poison: { duration: number; dps: number };
}

const GAS_BASE: Omit<HitWindow, "damage"> = {
  start: 0,
  end: 0,
  reach: 0,
  band: "mid",
  knockback: 3.5,
  hitstun: 0.42,
  blockstun: 0.28,
  shake: 0.25,
  hitstop: 0.05,
};

interface Puff {
  s: THREE.Sprite;
  off: THREE.Vector3;
  spin: number;
  phase: number;
  base: number;
  size: number;
}

/** A slowly travelling, lingering cloud of toxic gas. */
class GasCloud {
  group = new THREE.Group();
  x: number;
  private puffs: Puff[] = [];
  private bubbles: Puff[] = [];
  private light: THREE.PointLight;
  private age = 0;
  private hit = new Set<Fighter>();
  private emitT = 0;
  private window: HitWindow;

  constructor(
    public spec: GasSpec,
    public owner: Fighter,
    public move: MoveDef,
  ) {
    this.x = spec.x;
    this.window = { ...GAS_BASE, damage: spec.damage };
    const smoke = smokeTexture();
    const soft = softCircleTexture();
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.SpriteMaterial({
        map: smoke,
        color: new THREE.Color().setHSL(0.27 + Math.random() * 0.05, 0.8, 0.42 + Math.random() * 0.15),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        rotation: Math.random() * Math.PI * 2,
      });
      const s = new THREE.Sprite(mat);
      const off = new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.35 + Math.random() * 0.9, (Math.random() - 0.5) * 0.9);
      this.puffs.push({ s, off, spin: (Math.random() - 0.5) * 1.2, phase: Math.random() * 6.28, base: 0.3 + Math.random() * 0.2, size: 1.4 + Math.random() });
      this.group.add(s);
    }
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.SpriteMaterial({ map: soft, color: 0xb8ff80, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const s = new THREE.Sprite(mat);
      const off = new THREE.Vector3((Math.random() - 0.5) * 1.4, Math.random() * 1.5, (Math.random() - 0.5) * 0.8);
      this.bubbles.push({ s, off, spin: 0.4 + Math.random() * 0.5, phase: Math.random() * 6.28, base: 0.7, size: 0.12 + Math.random() * 0.14 });
      this.group.add(s);
    }
    this.light = new THREE.PointLight(0x8dff5a, 0, 7, 2);
    this.light.position.set(0, 0.9, 0);
    this.group.add(this.light);
    this.group.position.set(spec.x, 0, 0);
  }

  get life() {
    return this.spec.travel + this.spec.linger;
  }

  /** Returns false when the cloud has dissipated. */
  update(dt: number, time: number, fighters: Fighter[], world: World, active: boolean): boolean {
    this.age += dt;
    const sp = this.spec;
    const t = this.age;
    if (t < sp.travel) this.x += sp.dir * sp.speed * dt;
    this.x = THREE.MathUtils.clamp(this.x, -world.bounds - 0.5, world.bounds + 0.5);
    this.group.position.x = this.x;
    const grow = 0.55 + 0.45 * Math.min(1, t / sp.travel);
    const a = Math.min(1, t / 0.25) * THREE.MathUtils.clamp((this.life - t) / 0.7, 0, 1);
    const r = sp.radius * grow;

    for (const p of this.puffs) {
      const ang = p.spin * t;
      const cx = p.off.x * Math.cos(ang) - p.off.z * Math.sin(ang);
      const cz = p.off.x * Math.sin(ang) + p.off.z * Math.cos(ang);
      p.s.position.set(cx * r, p.off.y + Math.sin(time * 1.3 + p.phase) * 0.08, cz * r);
      const sc = p.size * r * (1 + 0.1 * Math.sin(time * 1.1 + p.phase));
      p.s.scale.set(sc, sc * 0.8, 1);
      p.s.material.rotation += p.spin * 0.4 * dt;
      p.s.material.opacity = p.base * a;
    }
    for (const b of this.bubbles) {
      b.off.y += b.spin * dt;
      if (b.off.y > 1.7) {
        b.off.y = 0.05;
        b.off.x = (Math.random() - 0.5) * 1.4;
      }
      b.s.position.set(b.off.x * r, b.off.y, b.off.z * r + Math.sin(time * 3 + b.phase) * 0.05);
      const sc = b.size * (0.8 + 0.4 * Math.sin(time * 5 + b.phase));
      b.s.scale.set(sc, sc, 1);
      b.s.material.opacity = b.base * a;
    }
    this.light.intensity = (7 + Math.sin(time * 9) * 1.5) * a;

    // turbulence feeding the shared particle systems
    this.emitT -= dt;
    if (this.emitT <= 0 && a > 0.2) {
      this.emitT = 0.06;
      const px = this.x + (Math.random() - 0.5) * r * 1.6;
      world.fx.steam(new THREE.Vector3(px, 0.15 + Math.random() * 0.5, (Math.random() - 0.5) * r), 1, 0x6fd94a, 0.55);
    }

    // contact: one hit per victim, poison refreshed while inside
    if (active && t > 0.1 && a > 0.3) {
      for (const f of fighters) {
        if (f === this.owner || !f.canBeHit) continue;
        if (Math.abs(f.pos.x - this.x) > r + f.cfg.width * 0.5) continue;
        if (f.pos.y > 1.6) continue;
        if (!this.hit.has(f)) {
          this.hit.add(f);
          this.owner.landHit(f, this.window, this.move, new THREE.Vector3(f.pos.x, f.pos.y + 1, 0), world, false);
          f.applyPoison(sp.poison.duration, sp.poison.dps);
        } else {
          f.applyPoison(1.2, sp.poison.dps, true);
        }
      }
    }
    return t < this.life;
  }

  dispose() {
    for (const p of this.puffs) p.s.material.dispose();
    for (const b of this.bubbles) b.s.material.dispose();
  }
}

export class GasSystem {
  group = new THREE.Group();
  private clouds: GasCloud[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  spawn(spec: GasSpec, owner: Fighter, move: MoveDef) {
    const c = new GasCloud(spec, owner, move);
    this.group.add(c.group);
    this.clouds.push(c);
  }

  /** X positions of active clouds (used by the AI to avoid them). */
  positions() {
    return this.clouds.map((c) => c.x);
  }

  update(dt: number, time: number, fighters: Fighter[], world: World, active: boolean) {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      if (!c.update(dt, time, fighters, world, active)) {
        this.group.remove(c.group);
        c.dispose();
        this.clouds.splice(i, 1);
      }
    }
  }

  clear() {
    for (const c of this.clouds) {
      this.group.remove(c.group);
      c.dispose();
    }
    this.clouds = [];
  }

  dispose() {
    this.clear();
  }
}
