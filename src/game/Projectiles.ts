import * as THREE from "three";
import type { Fighter, World } from "./Fighter";
import type { HitWindow, MoveDef } from "./moves";

interface Missile {
  g: THREE.Group;
  vel: THREE.Vector3;
  age: number;
  ttl: number;
  owner: Fighter;
  w: HitWindow;
  m: MoveDef;
  flame: THREE.Mesh;
  trail: number;
  speed: number;
  turn: number;
  dead: boolean;
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const tmpDir = new THREE.Vector3();

export class MissileSystem {
  group = new THREE.Group();
  private list: Missile[] = [];
  private bodyGeo: THREE.BufferGeometry;
  private flameGeo: THREE.BufferGeometry;
  private flameMat: THREE.MeshBasicMaterial;
  private bodyMat: THREE.MeshStandardMaterial;
  private collars = new Map<number, THREE.MeshStandardMaterial>();
  private q = new THREE.Quaternion();

  constructor(scene: THREE.Scene) {
    const red = new THREE.MeshStandardMaterial({ color: 0xc2462f, metalness: 0.5, roughness: 0.5 });
    this.bodyMat = red;
    this.flameMat = new THREE.MeshBasicMaterial({
      color: 0xffb050,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.bodyGeo = new THREE.BufferGeometry();
    const parts: THREE.BufferGeometry[] = [];
    // body (axis +X)
    const body = new THREE.CylinderGeometry(0.05, 0.06, 0.42, 10);
    body.rotateZ(-Math.PI / 2);
    parts.push(body.toNonIndexed());
    // nose cone
    const nose = new THREE.ConeGeometry(0.08, 0.2, 10);
    nose.rotateZ(-Math.PI / 2);
    nose.translate(0.28, 0, 0);
    parts.push(nose.toNonIndexed());
    // four rear fins
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.BoxGeometry(0.02, 0.09, 0.09);
      fin.translate(-0.2, 0, 0);
      fin.rotateX((i * Math.PI) / 2);
      const off = new THREE.Vector3(0, i % 2 === 0 ? 0.085 : 0, i < 2 ? 0.085 : 0);
      fin.translate(off.x, off.y, off.z);
      parts.push(fin.toNonIndexed());
    }
    let count = 0;
    for (const p of parts) count += p.attributes.position.count;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    let o = 0;
    for (const p of parts) {
      pos.set(p.attributes.position.array as Float32Array, o * 3);
      nor.set(p.attributes.normal.array as Float32Array, o * 3);
      o += p.attributes.position.count;
    }
    this.bodyGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.bodyGeo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));

    const flameGeo = new THREE.ConeGeometry(0.06, 0.26, 8);
    flameGeo.rotateZ(Math.PI / 2);
    flameGeo.translate(-0.3, 0, 0);
    this.flameGeo = flameGeo;

    scene.add(this.group);
  }

  private collarMaterial(accent: number) {
    let m = this.collars.get(accent);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: 0x14161a, emissive: accent, emissiveIntensity: 2.4, roughness: 0.4 });
      this.collars.set(accent, m);
    }
    return m;
  }

  clear() {
    for (const m of this.list) this.group.remove(m.g);
    this.list = [];
  }

  get activeCount() {
    return this.list.length;
  }

  spawn(pos: THREE.Vector3, vel: THREE.Vector3, owner: Fighter, w: HitWindow, m: MoveDef, turn: number) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.bodyGeo, this.bodyMat);
    body.castShadow = true;
    // accent collar
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.014, 6, 14), this.collarMaterial(owner.rig.accent));
    collar.rotation.y = Math.PI / 2;
    collar.position.x = 0.1;
    // exhaust flame (points backward: -X)
    const flame = new THREE.Mesh(this.flameGeo, this.flameMat);
    g.add(body, collar, flame);
    g.position.copy(pos);
    this.group.add(g);
    this.list.push({
      g,
      vel: vel.clone(),
      age: 0,
      ttl: 3.6,
      owner,
      w,
      m,
      flame,
      trail: 0,
      speed: vel.length(),
      turn,
      dead: false,
    });
  }

  private boom(p: THREE.Vector3, world: World, power: number) {
    world.fx.hitSparks(p, 0xffb060, Math.round(38 * power), 1.1 * power);
    world.fx.hitSparks(p, 0xffffff, 10, power);
    world.fx.ring(p, 0xffa040, 2.0 * power, 0.5, Math.max(0.05, p.y));
    world.fx.flash(p, 0xff8a30, 30 * power, 0.3, 9);
    world.fx.shockDisc(p, 0xffb060, 1.2 * power, 0.3);
    world.fx.dustPuff(p, 10, 0.6 * power, 0x6b6258, 2, 1.4);
    world.shake?.(0.5 * power);
  }

  update(dt: number, targets: Fighter[], world: World, homing: boolean) {
    const want = tmpDir;
    for (const ms of this.list) {
      if (ms.dead) continue;
      ms.age += dt;
      const p = ms.g.position;

      // homing toward the living target
      if (homing && ms.age > 0.12) {
        let target: Fighter | null = null;
        for (const t of targets) {
          if (t.canBeHit) target = t;
        }
        if (target) {
          want.set(target.pos.x, THREE.MathUtils.clamp(target.pos.y + 1.0, 0.4, 2.0), 0).sub(p);
          if (want.lengthSq() > 0.01) {
            want.normalize().multiplyScalar(ms.speed);
            ms.vel.lerp(want, 1 - Math.exp(-ms.turn * dt));
            ms.vel.normalize().multiplyScalar(ms.speed);
          }
        }
      }
      ms.vel.y -= 1.0 * dt;
      p.addScaledVector(ms.vel, dt);

      // orient along velocity
      this.q.setFromUnitVectors(X_AXIS, ms.vel.clone().normalize());
      ms.g.quaternion.copy(this.q);
      // flame flicker
      const fl = 0.8 + Math.sin(ms.age * 60) * 0.25 + Math.random() * 0.2;
      ms.flame.scale.set(fl, 0.7 + Math.random() * 0.3, 0.7 + Math.random() * 0.3);

      // trail
      ms.trail -= dt;
      if (ms.trail <= 0) {
        ms.trail = 0.035;
        const rear = p.clone().addScaledVector(ms.vel, -0.28 / ms.speed);
        world.fx.steam(rear, 1, 0x9a948c, 0.16);
        world.fx.embers(rear, 1, 0xff9a40);
      }

      // target collision
      for (const t of targets) {
        if (!t.canBeHit || t === ms.owner) continue;
        if (Math.abs(t.pos.x - p.x) > t.cfg.width * 0.85 + 0.25) continue;
        if (p.y < t.pos.y + 0.1 || p.y > t.pos.y + t.cfg.height) continue;
        ms.dead = true;
        const point = p.clone();
        ms.owner.landHit(t, ms.w, ms.m, point, world, false);
        this.boom(point, world, 1);
        break;
      }
      // ground
      if (!ms.dead && p.y <= 0.12 && ms.vel.y < 0) {
        ms.dead = true;
        const point = p.clone();
        point.y = 0.06;
        this.boom(point, world, 0.7);
      }
      // timeout fizzle
      if (!ms.dead && ms.age > ms.ttl) {
        ms.dead = true;
        world.fx.dustPuff(p, 4, 0.3, 0x6b6258, 1, 0.6);
      }
    }
    if (this.list.some((m) => m.dead)) {
      this.list = this.list.filter((m) => {
        if (m.dead) this.group.remove(m.g);
        return !m.dead;
      });
    }
  }

  dispose() {
    this.clear();
    this.bodyGeo.dispose();
    this.flameGeo.dispose();
    this.flameMat.dispose();
    this.bodyMat.dispose();
    this.collars.forEach((m) => m.dispose());
  }
}
