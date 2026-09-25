import * as THREE from "three";
import { Sky } from "../Sky";
import { FX, Motes } from "../FX";
import { makeRng } from "../textures";
import { Arena, ARENA_BOUNDS, CameraEnvelope, makeSun } from "./common";
import type { StageSource } from "../skinned/assets";

/**
 * KYOTO COLISEUM — card-backed courtyard stage.
 *
 * Layout, from the camera outward (the fighting strip stays at Y=0 / Z=0 with the ±7.6 bounds):
 *
 *   z = +8.4 … +15.5  camera envelope (clamped by Game.updateCamera)
 *   z = 0             fight plane
 *   z = -11 … -20     curved stone tiers with animated crowd bands (instanced, never orbiting)
 *   z = -26           approved coliseum art plane (sky, Mt Fuji, pagoda, blossom, upper crowd)
 *
 * The tiers sit in front of the art so the art reads as the far city and the low wall hides the
 * seam where the 3D floor meets the painted one. Everything below is either stage-owned (created
 * here, disposed here) or a clone of a cache-owned GLB node graph whose geometry and textures
 * stay alive for the next match.
 */

/* ------------------------------------------------------------------ */
/* Procedural canvas art                                               */
/* ------------------------------------------------------------------ */

const texCache = new Map<string, THREE.Texture>();

function cachedTex(key: string, make: () => THREE.Texture) {
  const hit = texCache.get(key);
  if (hit) return hit;
  const t = make();
  texCache.set(key, t);
  return t;
}

function cv(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function finish(c: HTMLCanvasElement, repeat: [number, number] = [1, 1]) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

/** Warm stone slab floor: staggered tiles, pitting, grout, sunset stain. */
function stoneTileTexture() {
  return cachedTex("kyoto.stone", () => {
    const s = 1024;
    const c = cv(s, s);
    const ctx = c.getContext("2d")!;
    const rng = makeRng(7717);
    ctx.fillStyle = "#a8917a";
    ctx.fillRect(0, 0, s, s);
    const tiles = 8;
    const ts = s / tiles;
    for (let y = 0; y < tiles; y++) {
      for (let x = 0; x < tiles; x++) {
        const off = y % 2 ? ts * 0.5 : 0;
        const g = 152 + Math.floor(rng() * 40) - 18;
        ctx.fillStyle = `rgb(${g + 18},${g + 4},${g - 20})`;
        ctx.fillRect(x * ts + off, y * ts, ts - 3, ts - 3);
        for (let i = 0; i < 24; i++) {
          const px = x * ts + off + rng() * ts;
          const py = y * ts + rng() * ts;
          const r = 1 + rng() * 7;
          ctx.fillStyle = rng() > 0.55 ? "rgba(60,46,36,0.16)" : "rgba(240,214,178,0.14)";
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.strokeStyle = "rgba(48,38,30,0.5)";
    ctx.lineWidth = 3;
    for (let i = 0; i <= tiles; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * ts);
      ctx.lineTo(s, i * ts);
      ctx.stroke();
    }
    for (let y = 0; y < tiles; y++) {
      const off = y % 2 ? ts * 0.5 : 0;
      for (let x = 0; x <= tiles; x++) {
        ctx.beginPath();
        ctx.moveTo(x * ts + off, y * ts);
        ctx.lineTo(x * ts + off, (y + 1) * ts);
        ctx.stroke();
      }
    }
    return finish(c, [12, 12]);
  });
}

/** Ground inlay: 16-petal chrysanthemum inside concentric rings. */
function medallionTexture() {
  return cachedTex("kyoto.medallion", () => {
    const s = 1024;
    const c = cv(s, s);
    const ctx = c.getContext("2d")!;
    const rng = makeRng(313);
    const cx = s / 2;
    ctx.fillStyle = "#8b7761";
    ctx.fillRect(0, 0, s, s);
    const ring = (r: number, w: number, col: string) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(cx, cx, r, 0, Math.PI * 2);
      ctx.stroke();
    };
    ring(470, 26, "#6a5947");
    ring(430, 8, "#cba878");
    ring(330, 5, "#75624e");
    ctx.save();
    ctx.translate(cx, cx);
    for (let i = 0; i < 16; i++) {
      ctx.rotate((Math.PI * 2) / 16);
      ctx.fillStyle = i % 2 ? "#c9a97c" : "#a98c62";
      ctx.beginPath();
      ctx.ellipse(0, 130, 34, 104, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ring(46, 10, "#6a5947");
    for (let i = 0; i < 900; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * 500;
      ctx.fillStyle = rng() > 0.5 ? "rgba(70,55,40,0.10)" : "rgba(250,230,200,0.10)";
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cx + Math.sin(a) * r, 1 + rng() * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(c, [1, 1]);
  });
}

/** A single petal sprite used by both the falling field and the ground piles. */
function petalTexture() {
  return cachedTex("kyoto.petal", () => {
    const s = 64;
    const c = cv(s, s);
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, "rgba(255,226,238,0.98)");
    g.addColorStop(0.55, "rgba(255,178,208,0.95)");
    g.addColorStop(1, "rgba(226,124,166,0.9)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.06);
    ctx.bezierCurveTo(s * 0.96, s * 0.3, s * 0.92, s * 0.82, s * 0.5, s * 0.96);
    ctx.bezierCurveTo(s * 0.08, s * 0.82, s * 0.04, s * 0.3, s * 0.5, s * 0.06);
    ctx.fill();
    ctx.strokeStyle = "rgba(190,90,130,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.12);
    ctx.lineTo(s * 0.5, s * 0.9);
    ctx.stroke();
    return finish(c);
  });
}

/**
 * The approved audience panel has a flat grey backdrop. Key it out on a canvas so the crowd can
 * be used as an alpha band on the tiers instead of a rectangle of grey sky.
 */
function keyedCrowdTexture(url: string, crop: [number, number, number, number], keyTolerance = 26) {
  return cachedTex(`kyoto.crowd:${url}:${crop.join(",")}`, () => {
    const c = cv(crop[2], crop[3]);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#d9cfc8";
    ctx.fillRect(0, 0, c.width, c.height);
    const t = new THREE.Texture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      ctx.drawImage(img, crop[0], crop[1], crop[2], crop[3], 0, 0, crop[2], crop[3]);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      const px = data.data;
      // sample the panel's own flat backdrop from the top-left corner
      const kr = px[0];
      const kg = px[1];
      const kb = px[2];
      for (let i = 0; i < px.length; i += 4) {
        const d = Math.abs(px[i] - kr) + Math.abs(px[i + 1] - kg) + Math.abs(px[i + 2] - kb);
        if (d < keyTolerance) px[i + 3] = 0;
        else if (d < keyTolerance * 2) px[i + 3] = Math.round(255 * ((d - keyTolerance) / keyTolerance));
      }
      ctx.putImageData(data, 0, 0);
      t.needsUpdate = true;
    };
    img.src = url;
    return t;
  });
}

/* ------------------------------------------------------------------ */
/* Falling petals + bursts                                             */
/* ------------------------------------------------------------------ */

class PetalField {
  mesh: THREE.InstancedMesh;
  private count: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private spin: Float32Array;
  private scale: Float32Array;
  private burstUntil: Float32Array;
  private box: { x: number; z: number; w: number; d: number; top: number };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private time = 0;

  constructor(count: number, box: { x: number; z: number; w: number; d: number; top: number }, own: <T>(x: T) => T) {
    this.count = count;
    this.box = box;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.spin = new Float32Array(count * 3);
    this.scale = new Float32Array(count);
    this.burstUntil = new Float32Array(count);
    const rng = makeRng(90125);
    for (let i = 0; i < count; i++) {
      this.pos[i * 3] = box.x + (rng() - 0.5) * box.w;
      this.pos[i * 3 + 1] = rng() * box.top;
      this.pos[i * 3 + 2] = box.z + (rng() - 0.5) * box.d;
      this.vel[i * 3] = 0.35 + rng() * 0.5;
      this.vel[i * 3 + 1] = -(0.35 + rng() * 0.45);
      this.vel[i * 3 + 2] = (rng() - 0.5) * 0.3;
      this.spin[i * 3] = (rng() - 0.5) * 5;
      this.spin[i * 3 + 1] = (rng() - 0.5) * 7;
      this.spin[i * 3 + 2] = (rng() - 0.5) * 4;
      this.scale[i] = 0.55 + rng() * 0.85;
    }
    const geo = own(new THREE.PlaneGeometry(0.19, 0.19));
    const mat = own(new THREE.MeshBasicMaterial({
      map: petalTexture(),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      opacity: 0.95,
    }));
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.write();
  }

  /** kick a handful of petals up from a footfall / landing point */
  burst(x: number, z: number, strength: number) {
    const rng = Math.random;
    const n = Math.min(this.count, 6 + Math.round(strength * 18));
    let placed = 0;
    for (let i = 0; i < this.count && placed < n; i++) {
      // recycle petals that are already near the ground and offline
      if (this.pos[i * 3 + 1] > 1.2) continue;
      this.pos[i * 3] = x + (rng() - 0.5) * 1.5;
      this.pos[i * 3 + 1] = 0.06 + rng() * 0.5;
      this.pos[i * 3 + 2] = z + (rng() - 0.5) * 1.5;
      this.vel[i * 3] = (rng() - 0.5) * (1.2 + strength * 2.6);
      this.vel[i * 3 + 1] = 0.8 + rng() * (1.6 + strength * 2.4);
      this.vel[i * 3 + 2] = (rng() - 0.5) * (1.2 + strength * 2.6);
      this.burstUntil[i] = this.time + 1.1 + strength;
      placed++;
    }
  }

  update(dt: number, time: number) {
    this.time = time;
    const b = this.box;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      const bursting = this.time < this.burstUntil[i];
      if (bursting) {
        this.vel[i3 + 1] -= 3.2 * dt;
      }
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (bursting) {
        this.vel[i3] *= Math.exp(-dt * 2.4);
        this.vel[i3 + 2] *= Math.exp(-dt * 2.4);
      } else {
        // gentle drift, resampled when a petal lands
        this.pos[i3] += Math.sin(time * 1.3 + i) * 0.12 * dt;
        if (this.pos[i3 + 1] < 0.04) {
          this.pos[i3 + 1] = b.top * (0.55 + Math.random() * 0.45);
          this.pos[i3] = b.x + (Math.random() - 0.5) * b.w;
          this.pos[i3 + 2] = b.z + (Math.random() - 0.5) * b.d;
        }
      }
    }
    this.write();
  }

  private write() {
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      this.v.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
      this.e.set(this.spin[i3] * this.time, this.spin[i3 + 1] * this.time, this.spin[i3 + 2] * this.time);
      this.q.setFromEuler(this.e);
      const sc = this.scale[i];
      this.s.set(sc, sc, sc);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* Stage                                                               */
/* ------------------------------------------------------------------ */

const KYOTO_CAMERA: CameraEnvelope = {
  minZ: 8.4,
  maxZ: 15.5,
  minX: -9.4,
  maxX: 9.4,
  minY: 1.15,
  maxY: 5.4,
  orbit: false,
  lookY: 1.18,
};

const TIER_ARC = Math.PI * 0.86;
const TIER_START = Math.PI - TIER_ARC / 2;
/**
 * Stadium bowl. The lowest ring is a low parapet at the edge of the fighting floor so the crowd
 * starts above a fighter's head (the dog is 2.08 m) instead of looming over the fight.
 */
const TIERS = [
  { r: 11.8, y: 0.0, h: 1.15 },
  { r: 14.6, y: 1.15, h: 1.5 },
  { r: 17.4, y: 2.65, h: 1.8 },
];

export function buildKyoto(stage?: StageSource | null): Arena {
  const group = new THREE.Group();
  const rng = makeRng(1701);
  /**
   * Everything this stage creates goes in here, and `dispose()` walks it once. Anything cloned
   * from a cache-owned GLB node graph (the tree's buffers and textures) is deliberately absent:
   * the asset cache owns it and the next match reuses it.
   */
  const owned: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  let disposed = false;
  const own = <T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(x: T): T => {
    owned.push(x);
    return x;
  };

  /* ---------- sky: cheap gradient dome behind the art plane ---------- */
  const sky = new Sky({
    top: "#2f2350",
    mid: "#c06a58",
    bottom: "#f6cd94",
    sunColor: "#ffd9a0",
    sunDir: new THREE.Vector3(-0.5, 0.14, -0.85),
    sunSize: 0.02,
    haze: 1.3,
    sunGlow: 0.8,
  });
  group.add(sky.group);

  const sun = makeSun(0xffc489, 2.6, new THREE.Vector3(-16, 11, -12), 1024);
  group.add(sun, sun.target);
  group.add(new THREE.HemisphereLight(0xc39ad8, 0x6d4a38, 1.25));
  const fill = new THREE.DirectionalLight(0xffe3c2, 0.85);
  fill.position.set(7, 8, 15);
  group.add(fill);

  /* ---------- stone courtyard at Y=0 ---------- */
  const groundMat = own(new THREE.MeshStandardMaterial({ map: stoneTileTexture(), color: 0xbda588, roughness: 0.94, metalness: 0 }));
  const ground = new THREE.Mesh(own(new THREE.PlaneGeometry(150, 150)), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const medallionMat = own(new THREE.MeshStandardMaterial({ map: medallionTexture(), color: 0xcbb094, roughness: 0.86, metalness: 0 }));
  const medallion = new THREE.Mesh(own(new THREE.CircleGeometry(3.7, 64)), medallionMat);
  medallion.rotation.x = -Math.PI / 2;
  medallion.position.y = 0.015;
  medallion.receiveShadow = true;
  group.add(medallion);

  // readable fight boundary inlay at x = ±ARENA_BOUNDS
  const lineMat = own(new THREE.MeshStandardMaterial({ color: 0xf0dcae, roughness: 0.7, emissive: 0x2a1c10, emissiveIntensity: 0.35 }));
  const boundary: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const line = new THREE.Mesh(own(new THREE.BoxGeometry(0.09, 0.02, 5.4)), lineMat);
    line.position.set(sx * ARENA_BOUNDS, 0.022, 0);
    boundary.push(line);
    group.add(line);
  }

  /* ---------- approved coliseum art as the deep backdrop ---------- */
  const backdropUrl = "/arenas/kyoto-coliseum-gameplay-view.png";
  const backdropTex = new THREE.TextureLoader().load(backdropUrl);
  backdropTex.colorSpace = THREE.SRGBColorSpace;
  backdropTex.anisotropy = 4;
  const backdropW = 96;
  const backdropH = backdropW * (864 / 1536);
  const backdrop = new THREE.Mesh(
    own(new THREE.PlaneGeometry(backdropW, backdropH)),
    own(new THREE.MeshBasicMaterial({ map: backdropTex, fog: false, depthWrite: true })),
  );
  // pad to the court floor, so the painted floor band lines up with the 3D floor
  backdrop.position.set(0, 0.3, -30);
  group.add(backdrop);

  /* ---------- curved audience tiers ---------- */
  const stoneMat = own(new THREE.MeshStandardMaterial({ color: 0x7c6a5b, roughness: 0.95, side: THREE.DoubleSide }));
  const deckMat = own(new THREE.MeshStandardMaterial({ color: 0x6a594b, roughness: 0.98, side: THREE.DoubleSide }));
  for (const t of TIERS) {
    const wall = new THREE.Mesh(own(new THREE.CylinderGeometry(t.r, t.r, t.h, 44, 1, true, TIER_START, TIER_ARC)), stoneMat);
    wall.position.y = t.y + t.h / 2;
    group.add(wall);
    const deck = new THREE.Mesh(own(new THREE.RingGeometry(t.r - 2.6, t.r + 0.2, 44, 1, TIER_START, TIER_ARC)), deckMat);
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = t.y + t.h;
    deck.receiveShadow = true;
    group.add(deck);
  }

  /* ---------- crowd: approved audience art, keyed to alpha, on the two front tiers ---------- */
  const crowdUrl = "/arenas/kyoto-audience-concept-panel.png";
  const crowdLayers: { mesh: THREE.Mesh; base: number; amp: number; speed: number; phase: number }[] = [];
  const crowdTexA = keyedCrowdTexture(crowdUrl, [0, 300, 1536, 520]);
  const crowdTexB = keyedCrowdTexture(crowdUrl, [0, 90, 1536, 500]);
  // The approved panel is a single wall of faces. Stretched over every tier it stacks into a
  // carpet, so each band shows one row of the art at its own depth and stands a little taller than
  // the stone step it sits on; the deep tiers are tinted down so the tiers read as distance.
  const crowdSpecs = [
    { tex: crowdTexA, r: TIERS[0].r - 0.5, y: TIERS[0].y + TIERS[0].h, w: 5.4, h: 1.95, amp: 0.07, speed: 3.6, phase: 0, tint: 0xc9b6ac, count: 12 },
    { tex: crowdTexA, r: TIERS[1].r - 0.6, y: TIERS[1].y + TIERS[1].h, w: 5.4, h: 1.75, amp: 0.09, speed: 3.1, phase: 1.3, tint: 0xa08a82, count: 14 },
    { tex: crowdTexB, r: TIERS[2].r - 0.7, y: TIERS[2].y + TIERS[2].h, w: 6.0, h: 1.95, amp: 0.11, speed: 2.7, phase: 2.4, tint: 0x7d6a66, count: 14 },
  ];
  for (const spec of crowdSpecs) {
    const mat = own(new THREE.MeshBasicMaterial({ map: spec.tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.98, fog: true, color: spec.tint }));
    const count = spec.count;
    const geo = own(new THREE.PlaneGeometry(spec.w, spec.h));
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.frustumCulled = false;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    const r = spec.r;
    for (let i = 0; i < count; i++) {
      const th = TIER_START + ((i + 0.5) / count) * TIER_ARC;
      v.set(Math.sin(th) * r, spec.y + spec.h * 0.46, Math.cos(th) * r);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), th + Math.PI);
      // mirror and jitter alternate panels so the same art never reads as repeating wallpaper
      const flip = i % 2 === 1 ? -1 : 1;
      const sc = 1 + ((i * 13) % 7) / 40;
      s.set(sc * flip, sc * (0.92 + ((i * 7) % 5) / 25), 1);
      m4.compose(v, q, s);
      inst.setMatrixAt(i, m4);
    }
    group.add(inst);
    crowdLayers.push({ mesh: inst as unknown as THREE.Mesh, base: spec.y, amp: spec.amp, speed: spec.speed, phase: spec.phase });
  }

  /* ---------- torii gate behind the tiers ---------- */
  const toriiMat = own(new THREE.MeshStandardMaterial({ color: 0xb8352c, roughness: 0.62 }));
  const toriiDark = own(new THREE.MeshStandardMaterial({ color: 0x2b2018, roughness: 0.7 }));
  const torii = new THREE.Group();
  for (const sx of [-1, 1]) {
    const pillar = new THREE.Mesh(own(new THREE.CylinderGeometry(0.34, 0.42, 7.4, 12)), toriiMat);
    pillar.position.set(sx * 3.1, 3.7, 0);
    pillar.castShadow = true;
    torii.add(pillar);
  }
  const lintelTop = new THREE.Mesh(own(new THREE.BoxGeometry(8.9, 0.42, 0.62)), toriiDark);
  lintelTop.position.set(0, 7.5, 0);
  torii.add(lintelTop);
  const lintel = new THREE.Mesh(own(new THREE.BoxGeometry(7.9, 0.34, 0.5)), toriiMat);
  lintel.position.set(0, 6.6, 0);
  torii.add(lintel);
  torii.position.set(0, 0, -12.4);
  group.add(torii);

  /* ---------- stone lanterns + warm glow ---------- */
  const lanternStone = own(new THREE.MeshStandardMaterial({ color: 0x8a8074, roughness: 0.9 }));
  const lanternGlowMat = own(new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb45e, emissiveIntensity: 2.4, roughness: 0.5 }));
  const lanternLights: THREE.PointLight[] = [];
  const lanternSpots: [number, number][] = [
    [-9.6, -2.4],
    [9.6, -2.4],
    [-9.6, 3.6],
    [9.6, 3.6],
  ];
  lanternSpots.forEach(([x, z], i) => {
    const l = new THREE.Group();
    l.add(new THREE.Mesh(own(new THREE.CylinderGeometry(0.42, 0.55, 0.28, 10)), lanternStone).translateY(0.14));
    l.add(new THREE.Mesh(own(new THREE.CylinderGeometry(0.2, 0.24, 1.5, 10)), lanternStone).translateY(1.0));
    const box = new THREE.Mesh(own(new THREE.BoxGeometry(0.62, 0.5, 0.62)), lanternStone);
    box.position.y = 1.98;
    l.add(box);
    const glow = new THREE.Mesh(own(new THREE.BoxGeometry(0.5, 0.34, 0.5)), lanternGlowMat);
    glow.position.y = 1.98;
    l.add(glow);
    const roof = new THREE.Mesh(own(new THREE.ConeGeometry(0.62, 0.42, 4)), lanternStone);
    roof.position.y = 2.42;
    roof.rotation.y = Math.PI / 4;
    l.add(roof);
    l.position.set(x, 0, z);
    group.add(l);
    if (i < 2) {
      const pl = new THREE.PointLight(0xffb45e, 5.5, 11, 2);
      pl.position.set(x * 0.92, 2.0, z);
      group.add(pl);
      lanternLights.push(pl);
    }
  });

  /* ---------- cherry tree: the optimized GLB as a single foreground edge prop ---------- */
  const treeHolder = new THREE.Group();
  treeHolder.position.set(-10.6, 0, 2.4);
  group.add(treeHolder);
  const stageMaterials: THREE.Material[] = [];
  if (stage?.scene) {
    // clone the node graph (instances share buffers) but give the stage its own materials
    const model = stage.scene.clone(true);
    const matMap = new Map<THREE.Material, THREE.Material>();
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.Material | THREE.Material[];
      const local = (m: THREE.Material) => {
        let c = matMap.get(m);
        if (!c) {
          c = m.clone();
          matMap.set(m, c);
          stageMaterials.push(c);
        }
        return c;
      };
      mesh.material = Array.isArray(src) ? src.map(local) : local(src);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      // buffers and textures belong to the asset cache — never dispose them here
      mesh.userData.sharedGeometry = true;
      mesh.userData.sharedAssets = true;
    });
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const h = Math.max(1, box.max.y - box.min.y);
    const s = 5.6 / h;
    model.scale.setScalar(s);
    model.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
    model.rotation.y = 0.6;
    treeHolder.add(model);
  } else {
    // procedural stand-in while the GLB is loading or if it failed
    const trunkMat = own(new THREE.MeshStandardMaterial({ color: 0x4a3226, roughness: 0.9 }));
    stageMaterials.push(trunkMat);
    const trunk = new THREE.Mesh(own(new THREE.CylinderGeometry(0.22, 0.42, 3.2, 9)), trunkMat);
    trunk.position.y = 1.6;
    trunk.castShadow = true;
    treeHolder.add(trunk);
    const blossomMat = own(new THREE.MeshStandardMaterial({ color: 0xf2a8c0, roughness: 0.85, emissive: 0x3a1622, emissiveIntensity: 0.4 }));
    stageMaterials.push(blossomMat);
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Mesh(own(new THREE.SphereGeometry(0.7 + rng() * 0.6, 10, 8)), blossomMat);
      b.position.set((rng() - 0.5) * 2.6, 3.1 + rng() * 1.5, (rng() - 0.5) * 2.2);
      b.castShadow = true;
      treeHolder.add(b);
    }
  }

  /* ---------- petal piles under the tree and at the court edges ---------- */
  const pileMat = own(new THREE.MeshBasicMaterial({ map: petalTexture(), transparent: true, depthWrite: false, opacity: 0.7 }));
  const piles = new THREE.InstancedMesh(own(new THREE.CircleGeometry(0.6, 10)), pileMat, 46);
  {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < 46; i++) {
      const nearTree = i < 26;
      const x = nearTree ? -10.6 + (rng() - 0.5) * 7 : (rng() - 0.5) * 26;
      const z = nearTree ? 2.4 + (rng() - 0.5) * 6 : -6 - rng() * 5;
      v.set(x, 0.028, z);
      s.setScalar(0.5 + rng() * 1.5);
      m4.compose(v, q, s);
      piles.setMatrixAt(i, m4);
    }
  }
  piles.renderOrder = 1;
  group.add(piles);

  /* ---------- falling petals (instantiated, cheap) + hover motes ---------- */
  const petals = new PetalField(150, { x: -1, z: 0, w: 36, d: 24, top: 8 }, own as never);
  group.add(petals.mesh);
  const motes = new Motes({
    count: 40,
    box: { x: 0, y: 2.6, z: 0, w: 26, h: 5, d: 14 },
    color: 0xffd9e8,
    size: 0.1,
    opacity: 0.5,
    velocity: new THREE.Vector3(0.1, 0.08, 0.02),
    jitter: 0.4,
  });
  own(motes.points.geometry as THREE.BufferGeometry);
  own(motes.points.material as THREE.Material);
  group.add(motes.points);

  return {
    group,
    sun,
    exposure: 1.06,
    bloom: { strength: 0.52, threshold: 0.88, radius: 0.68 },
    fog: new THREE.Fog(0xd99a76, 34, 165),
    background: new THREE.Color(0xd99a76),
    dustColor: 0xf0c6ac,
    camera: KYOTO_CAMERA,
    footfall(x: number, z: number, strength: number, fx: FX) {
      petals.burst(x, z, strength);
      fx.dustPuff(new THREE.Vector3(x, 0.05, z), 3 + Math.round(strength * 5), 0.42, 0xf3c9d6, 1.4, 0.9);
    },
    update(dt: number, t: number, _fx: FX) {
      sky.update(dt);
      petals.update(dt, t);
      motes.update(dt);
      // crowd bands bob on the spot: enough motion to read as a living crowd with no crowd rig
      for (const layer of crowdLayers) {
        layer.mesh.position.y = Math.sin(t * layer.speed + layer.phase) * layer.amp;
      }
      const flicker = 0.82 + Math.sin(t * 7.3) * 0.08 + Math.sin(t * 17.1) * 0.05;
      lanternGlowMat.emissiveIntensity = 2.2 * flicker;
      for (const pl of lanternLights) pl.intensity = 5.2 * flicker;
    },
    dispose() {
      // Idempotent, and limited to stage-owned resources: the tree's shared geometry and textures
      // belong to the asset cache and must survive this call (docs/09 ownership rules).
      if (disposed) return;
      disposed = true;
      sky.group.removeFromParent();
      for (const r of owned) r.dispose();
      owned.length = 0;
      for (const t of texCache.values()) t.dispose();
      texCache.clear();
    },
  };
}
