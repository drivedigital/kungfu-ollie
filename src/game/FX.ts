import * as THREE from "three";
import { smokeTexture, softCircleTexture, sparkTexture } from "./textures";

/* ------------------------------------------------------------------ */
/* Pooled GPU point particles                                          */
/* ------------------------------------------------------------------ */

export interface EmitOpts {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  color: THREE.Color | number;
  alpha?: number;
  gravity?: number;
  drag?: number;
  grow?: number; // size multiplier at end of life
  fadeIn?: number; // 0..1 portion of life used for fade-in
}

const pVert = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  uniform float uScale;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.5, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const pFrag = /* glsl */ `
  uniform sampler2D uMap;
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
    if (gl_FragColor.a < 0.003) discard;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class ParticleSystem {
  points: THREE.Points;
  private capacity: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size0: Float32Array;
  private grow: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private fadeIn: Float32Array;
  private baseColor: Float32Array;
  private sizeAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private posAttr: THREE.BufferAttribute;
  private cursor = 0;
  private material: THREE.ShaderMaterial;
  private tmp = new THREE.Color();

  constructor(capacity: number, texture: THREE.Texture, additive: boolean) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.fadeIn = new Float32Array(capacity);
    this.baseColor = new Float32Array(capacity * 4);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(capacity * 4), 4);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.posAttr);
    geo.setAttribute("aSize", this.sizeAttr);
    geo.setAttribute("aColor", this.colAttr);
    this.material = new THREE.ShaderMaterial({
      vertexShader: pVert,
      fragmentShader: pFrag,
      uniforms: { uMap: { value: texture }, uScale: { value: 400 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 10;
  }

  setViewport(heightPx: number, pixelRatio: number) {
    this.material.uniforms.uScale.value = heightPx * pixelRatio * 0.9;
  }

  emit(o: EmitOpts) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pos[i * 3] = o.x;
    this.pos[i * 3 + 1] = o.y;
    this.pos[i * 3 + 2] = o.z;
    this.vel[i * 3] = o.vx ?? 0;
    this.vel[i * 3 + 1] = o.vy ?? 0;
    this.vel[i * 3 + 2] = o.vz ?? 0;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.size0[i] = o.size;
    this.grow[i] = o.grow ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.fadeIn[i] = o.fadeIn ?? 0;
    const c = typeof o.color === "number" ? this.tmp.setHex(o.color) : o.color;
    this.baseColor[i * 4] = c.r;
    this.baseColor[i * 4 + 1] = c.g;
    this.baseColor[i * 4 + 2] = c.b;
    this.baseColor[i * 4 + 3] = o.alpha ?? 1;
  }

  update(dt: number) {
    const size = this.sizeAttr.array as Float32Array;
    const col = this.colAttr.array as Float32Array;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        size[i] = 0;
        continue;
      }
      const d = this.drag[i] > 0 ? Math.exp(-this.drag[i] * dt) : 1;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] *= d;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i]; // 0..1
      let a = 1 - t;
      a = a * a * (3 - 2 * a);
      if (this.fadeIn[i] > 0 && t < this.fadeIn[i]) a *= t / this.fadeIn[i];
      size[i] = this.size0[i] * (1 + (this.grow[i] - 1) * t);
      col[i * 4] = this.baseColor[i * 4];
      col[i * 4 + 1] = this.baseColor[i * 4 + 1];
      col[i * 4 + 2] = this.baseColor[i * 4 + 2];
      col[i * 4 + 3] = this.baseColor[i * 4 + 3] * a;
    }
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* Ambient drifting motes (dust / pollen / embers)                      */
/* ------------------------------------------------------------------ */

export interface MotesOpts {
  count: number;
  box: { x: number; y: number; z: number; w: number; h: number; d: number };
  color: number;
  size: number;
  opacity: number;
  additive?: boolean;
  velocity: THREE.Vector3;
  jitter: number;
  texture?: THREE.Texture;
}

export class Motes {
  points: THREE.Points;
  private opts: MotesOpts;
  private pos: Float32Array;
  private seeds: Float32Array;
  private time = 0;

  constructor(opts: MotesOpts) {
    this.opts = opts;
    const n = opts.count;
    this.pos = new Float32Array(n * 3);
    this.seeds = new Float32Array(n);
    const b = opts.box;
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = b.x + (Math.random() - 0.5) * b.w;
      this.pos[i * 3 + 1] = b.y + (Math.random() - 0.5) * b.h;
      this.pos[i * 3 + 2] = b.z + (Math.random() - 0.5) * b.d;
      this.seeds[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.PointsMaterial({
      map: opts.texture ?? softCircleTexture(),
      color: opts.color,
      size: opts.size,
      transparent: true,
      opacity: opts.opacity,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      sizeAttenuation: true,
      fog: !opts.additive,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  update(dt: number) {
    this.time += dt;
    const b = this.opts.box;
    const v = this.opts.velocity;
    const j = this.opts.jitter;
    for (let i = 0; i < this.opts.count; i++) {
      const s = this.seeds[i];
      this.pos[i * 3] += (v.x + Math.sin(this.time * 0.7 + s) * j) * dt;
      this.pos[i * 3 + 1] += (v.y + Math.cos(this.time * 0.9 + s * 1.3) * j * 0.5) * dt;
      this.pos[i * 3 + 2] += (v.z + Math.sin(this.time * 0.5 + s * 0.7) * j) * dt;
      // wrap
      const dx = this.pos[i * 3] - b.x;
      const dy = this.pos[i * 3 + 1] - b.y;
      const dz = this.pos[i * 3 + 2] - b.z;
      if (dx > b.w / 2) this.pos[i * 3] -= b.w;
      else if (dx < -b.w / 2) this.pos[i * 3] += b.w;
      if (dy > b.h / 2) this.pos[i * 3 + 1] -= b.h;
      else if (dy < -b.h / 2) this.pos[i * 3 + 1] += b.h;
      if (dz > b.d / 2) this.pos[i * 3 + 2] -= b.d;
      else if (dz < -b.d / 2) this.pos[i * 3 + 2] += b.d;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* High level FX manager                                                */
/* ------------------------------------------------------------------ */

interface Transient {
  obj: THREE.Object3D;
  update: (dt: number) => boolean;
  dispose?: () => void;
}

export class FX {
  sparks: ParticleSystem;
  dust: ParticleSystem;
  smoke: ParticleSystem;
  private transients: Transient[] = [];
  private scene: THREE.Scene;
  private ringGeo = new THREE.RingGeometry(0.85, 1, 48);
  private discGeo = new THREE.CircleGeometry(1, 32);
  private beamGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
  private arcGeo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sparks = new ParticleSystem(1500, sparkTexture(), true);
    this.dust = new ParticleSystem(900, smokeTexture(), false);
    this.smoke = new ParticleSystem(600, smokeTexture(), false);
    scene.add(this.sparks.points, this.dust.points, this.smoke.points);
    // slash arc: partial ring in XY plane
    this.arcGeo = new THREE.RingGeometry(0.55, 1, 32, 1, 0, Math.PI * 0.85);
  }

  setViewport(h: number, pr: number) {
    this.sparks.setViewport(h, pr);
    this.dust.setViewport(h, pr);
    this.smoke.setViewport(h, pr);
  }

  update(dt: number) {
    this.sparks.update(dt);
    this.dust.update(dt);
    this.smoke.update(dt);
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const t = this.transients[i];
      if (!t.update(dt)) {
        this.scene.remove(t.obj);
        t.dispose?.();
        this.transients.splice(i, 1);
      }
    }
  }

  /* ---- particle helpers ---- */

  hitSparks(p: THREE.Vector3, color: number, count = 26, power = 1, dir = 0) {
    const c = new THREE.Color(color);
    const white = new THREE.Color(0xffffff);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = (Math.random() - 0.5) * Math.PI;
      const sp = (2 + Math.random() * 6) * power;
      this.sparks.emit({
        x: p.x,
        y: p.y,
        z: p.z,
        vx: Math.cos(a) * Math.cos(b) * sp + dir * 3 * power,
        vy: Math.sin(b) * sp + 2,
        vz: Math.sin(a) * Math.cos(b) * sp,
        life: 0.25 + Math.random() * 0.45,
        size: (0.06 + Math.random() * 0.12) * power,
        color: Math.random() < 0.3 ? white : c,
        gravity: 14,
        drag: 1.5,
        grow: 0.2,
      });
    }
    // bright core flash
    this.sparks.emit({ x: p.x, y: p.y, z: p.z, life: 0.12, size: 1.3 * power, color: white, alpha: 0.9, grow: 1.8 });
    this.sparks.emit({ x: p.x, y: p.y, z: p.z, life: 0.22, size: 0.9 * power, color: c, alpha: 0.8, grow: 2.4 });
  }

  blockSparks(p: THREE.Vector3, dir: number) {
    const c = new THREE.Color(0x9fd8ff);
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 3;
      this.sparks.emit({
        x: p.x,
        y: p.y,
        z: p.z,
        vx: dir * sp + (Math.random() - 0.5) * 2,
        vy: Math.sin(a) * sp,
        vz: Math.cos(a) * sp * 0.6,
        life: 0.2 + Math.random() * 0.25,
        size: 0.05 + Math.random() * 0.08,
        color: c,
        gravity: 6,
        grow: 0.3,
      });
    }
    this.sparks.emit({ x: p.x, y: p.y, z: p.z, life: 0.15, size: 1.0, color: c, alpha: 0.7, grow: 1.6 });
  }

  dustPuff(p: THREE.Vector3, count = 10, size = 0.5, color = 0xc9a173, spread = 1.5, up = 1.2) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * spread;
      this.dust.emit({
        x: p.x + (Math.random() - 0.5) * 0.3,
        y: p.y + 0.05,
        z: p.z + (Math.random() - 0.5) * 0.3,
        vx: Math.cos(a) * sp,
        vy: Math.random() * up,
        vz: Math.sin(a) * sp * 0.6,
        life: 0.5 + Math.random() * 0.7,
        size: size * (0.6 + Math.random() * 0.8),
        color: c,
        alpha: 0.45,
        drag: 2.5,
        grow: 2.2,
        gravity: -0.3,
      });
    }
  }

  steam(p: THREE.Vector3, count = 1, color = 0xd8e8ee, size = 0.35) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      this.smoke.emit({
        x: p.x + (Math.random() - 0.5) * 0.1,
        y: p.y,
        z: p.z + (Math.random() - 0.5) * 0.1,
        vx: (Math.random() - 0.5) * 0.4,
        vy: 0.8 + Math.random() * 0.8,
        vz: (Math.random() - 0.5) * 0.4,
        life: 0.8 + Math.random() * 0.8,
        size,
        color: c,
        alpha: 0.28,
        drag: 1.2,
        grow: 3,
        fadeIn: 0.15,
      });
    }
  }

  embers(p: THREE.Vector3, count: number, color = 0xffa040) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 4;
      this.sparks.emit({
        x: p.x,
        y: p.y,
        z: p.z,
        vx: Math.cos(a) * sp,
        vy: 2 + Math.random() * 4,
        vz: Math.sin(a) * sp,
        life: 0.6 + Math.random() * 1.0,
        size: 0.03 + Math.random() * 0.05,
        color: c,
        gravity: 9,
        drag: 0.8,
        grow: 0.1,
      });
    }
  }

  /* ---- mesh transients ---- */

  ring(p: THREE.Vector3, color: number, maxRadius = 2.5, duration = 0.45, y = 0.03) {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, y, p.z);
    m.scale.setScalar(0.2);
    this.scene.add(m);
    let t = 0;
    this.transients.push({
      obj: m,
      update: (dt) => {
        t += dt / duration;
        const e = 1 - Math.pow(1 - Math.min(t, 1), 3);
        m.scale.setScalar(0.2 + e * maxRadius);
        mat.opacity = 0.9 * (1 - t);
        return t < 1;
      },
      dispose: () => mat.dispose(),
    });
  }

  flash(p: THREE.Vector3, color: number, intensity = 30, duration = 0.25, distance = 8) {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.position.copy(p);
    this.scene.add(light);
    let t = 0;
    this.transients.push({
      obj: light,
      update: (dt) => {
        t += dt / duration;
        light.intensity = intensity * Math.max(0, 1 - t);
        return t < 1;
      },
    });
  }

  beam(from: THREE.Vector3, dir: number, length: number, color: number, duration = 0.35, radius = 0.12) {
    const group = new THREE.Group();
    const matOuter = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const matCore = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const outer = new THREE.Mesh(this.beamGeo, matOuter);
    const core = new THREE.Mesh(this.beamGeo, matCore);
    outer.rotation.z = Math.PI / 2;
    core.rotation.z = Math.PI / 2;
    outer.scale.set(radius, length, radius);
    core.scale.set(radius * 0.4, length, radius * 0.4);
    group.add(outer, core);
    group.position.set(from.x + (dir * length) / 2, from.y, from.z);
    this.scene.add(group);
    let t = 0;
    this.transients.push({
      obj: group,
      update: (dt) => {
        t += dt / duration;
        const k = Math.max(0, 1 - t);
        outer.scale.x = outer.scale.z = radius * (1 + t * 2) * k;
        core.scale.x = core.scale.z = radius * 0.4 * k;
        matOuter.opacity = 0.85 * k;
        matCore.opacity = k;
        return t < 1;
      },
      dispose: () => {
        matOuter.dispose();
        matCore.dispose();
      },
    });
  }

  slash(p: THREE.Vector3, dir: number, color: number, size = 1.4, duration = 0.22, tilt = 0) {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(this.arcGeo, mat);
    m.position.copy(p);
    m.rotation.z = dir > 0 ? -Math.PI * 0.45 + tilt : Math.PI * 0.55 - tilt;
    m.rotation.y = 0;
    m.scale.set(size * dir, size, size);
    this.scene.add(m);
    let t = 0;
    this.transients.push({
      obj: m,
      update: (dt) => {
        t += dt / duration;
        m.rotation.z += dir * dt * 9;
        m.scale.x = size * dir * (1 + t * 0.4);
        m.scale.y = size * (1 + t * 0.4);
        mat.opacity = 0.85 * (1 - t);
        return t < 1;
      },
      dispose: () => mat.dispose(),
    });
  }

  shockDisc(p: THREE.Vector3, color: number, radius = 1.5, duration = 0.3) {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(this.discGeo, mat);
    m.position.copy(p);
    m.scale.setScalar(0.1);
    this.scene.add(m);
    let t = 0;
    this.transients.push({
      obj: m,
      update: (dt) => {
        t += dt / duration;
        m.scale.setScalar(0.1 + radius * Math.min(1, t * 1.4));
        mat.opacity = 0.6 * (1 - t);
        return t < 1;
      },
      dispose: () => mat.dispose(),
    });
  }
}
