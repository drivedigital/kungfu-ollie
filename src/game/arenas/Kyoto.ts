import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Sky } from "../Sky";
import { FX } from "../FX";
import { makeRng } from "../textures";
import { Arena, CameraEnvelope, ARENA_BOUNDS, disposeGroup, makeSun } from "./common";

/**
 * KYOTO COLISEUM — first playable pass.
 *
 * A real, level 3D stone courtyard at Y=0 with a low central medallion, the existing ±7.6 fight
 * boundary and the Z=0 gameplay plane. Depth-separated background planes (sky / mountains /
 * pagoda / distant blossom cards) sit behind curved audience tiers, and the supplied cherry tree
 * GLB is used as a single foreground edge prop — outside the fighting strip so it can never
 * obstruct a fighter. Cosmetic petal kick-up fires on footfalls and landings.
 *
 * Because the stage is card-based, it publishes a constrained camera envelope (no orbiting in
 * attract mode) so the cards never show their edges.
 */

/* ------------------------------------------------------------------ */
/* Baked card art (canvas) — distant detail is art, nearby detail is 3D */
/* ------------------------------------------------------------------ */

const texCache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture) {
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

function stoneTileTexture() {
  return cached("kyoto.stone", () => {
    const s = 1024;
    const c = cv(s, s);
    const ctx = c.getContext("2d")!;
    const rng = makeRng(7717);
    ctx.fillStyle = "#9c8b78";
    ctx.fillRect(0, 0, s, s);
    const tiles = 8;
    const ts = s / tiles;
    for (let y = 0; y < tiles; y++) {
      for (let x = 0; x < tiles; x++) {
        const off = y % 2 ? ts * 0.5 : 0;
        const g = 150 + Math.floor(rng() * 42) - 20;
        ctx.fillStyle = `rgb(${g + 14},${g + 2},${g - 18})`;
        ctx.fillRect(x * ts + off, y * ts, ts - 3, ts - 3);
        // pitting + warm sunset stain
        for (let i = 0; i < 26; i++) {
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
    // grout
    ctx.strokeStyle = "rgba(48,38,30,0.55)";
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
    return finish(c, [10, 10]);
  });
}

function medallionTexture() {
  return cached("kyoto.medallion", () => {
    const s = 1024;
    const c = cv(s, s);
    const ctx = c.getContext("2d")!;
    const rng = makeRng(313);
    const cx = s / 2;
    ctx.fillStyle = "#7d6c5c";
    ctx.fillRect(0, 0, s, s);
    const ring = (r: number, w: number, col: string) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(cx, cx, r, 0, Math.PI * 2);
      ctx.stroke();
    };
    ring(470, 26, "#5d4e41");
    ring(430, 8, "#c9a878");
    ring(330, 5, "#6b5a4a");
    // 16-petal chrysanthemum inlay
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx, cx);
      ctx.rotate(a);
      ctx.fillStyle = i % 2 ? "#b8996e" : "#a98b62";
      ctx.beginPath();
      ctx.ellipse(0, -210, 44, 118, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ring(120, 12, "#d8bd8c");
    ctx.fillStyle = "#6d5c4b";
    ctx.beginPath();
    ctx.arc(cx, cx, 108, 0, Math.PI * 2);
    ctx.fill();
    // taiji-style swirl so the centre reads as a fighting mark
    ctx.fillStyle = "#e0c79a";
    ctx.beginPath();
    ctx.arc(cx, cx, 78, Math.PI * 0.5, Math.PI * 1.5);
    ctx.arc(cx, cx - 39, 39, Math.PI * 1.5, Math.PI * 0.5);
    ctx.arc(cx, cx + 39, 39, Math.PI * 0.5, Math.PI * 1.5, true);
    ctx.fill();
    for (let i = 0; i < 900; i++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * 470;
      ctx.fillStyle = rng() > 0.5 ? "rgba(40,32,26,0.14)" : "rgba(255,232,200,0.1)";
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cx + Math.sin(a) * r, 1 + rng() * 5, 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(c);
  });
}

/** Two-frame crowd atlas: offset.x swaps between 0 and 0.5 to imply cheering. */
function crowdTexture(seed: number, tint: string) {
  return cached(`kyoto.crowd.${seed}`, () => {
    const w = 1024;
    const h = 256;
    const c = cv(w, h);
    const ctx = c.getContext("2d")!;
    const rng = makeRng(seed);
    ctx.clearRect(0, 0, w, h);
    const palette = ["#3a2b3f", "#4a3242", "#2f2740", "#54384a", "#3d2f36"];
    for (let frame = 0; frame < 2; frame++) {
      const ox = frame * (w / 2);
      const count = 46;
      for (let i = 0; i < count; i++) {
        const x = ox + (i / count) * (w / 2) + rng() * 8;
        const lift = frame === 0 ? 0 : 6 + rng() * 14;
        const bodyH = 90 + rng() * 46;
        const y = h - bodyH - lift;
        const col = palette[Math.floor(rng() * palette.length)];
        // body
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(x, y + bodyH * 0.62, 12 + rng() * 5, bodyH * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        // head + animal ears / snout silhouettes (anthropomorphic kung-fu crowd)
        ctx.beginPath();
        ctx.arc(x, y, 11 + rng() * 4, 0, Math.PI * 2);
        ctx.fill();
        const kind = rng();
        ctx.beginPath();
        if (kind < 0.34) {
          ctx.moveTo(x - 9, y - 6);
          ctx.lineTo(x - 4, y - 22);
          ctx.lineTo(x + 1, y - 7);
          ctx.moveTo(x + 9, y - 6);
          ctx.lineTo(x + 4, y - 22);
          ctx.lineTo(x - 1, y - 7);
        } else if (kind < 0.67) {
          ctx.ellipse(x + 12, y + 2, 9, 6, 0, 0, Math.PI * 2);
        } else {
          ctx.moveTo(x - 12, y - 4);
          ctx.lineTo(x - 16, y - 18);
          ctx.lineTo(x - 2, y - 10);
        }
        ctx.fill();
        // raised arms on the second frame
        if (frame === 1 && rng() > 0.35) {
          ctx.strokeStyle = col;
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(x - 8, y + 26);
          ctx.lineTo(x - 16, y - 14);
          ctx.moveTo(x + 8, y + 26);
          ctx.lineTo(x + 16, y - 14);
          ctx.stroke();
        }
        // warm rim light from the setting sun
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.arc(x - 5, y - 3, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const t = finish(c);
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.repeat.set(0.5, 1);
    return t;
  });
}

function mountainCardTexture() {
  return cached("kyoto.mountains", () => {
    const w = 2048;
    const h = 512;
    const c = cv(w, h);
    const ctx = c.getContext("2d")!;
    const rng = makeRng(9091);
    ctx.clearRect(0, 0, w, h);
    const ridge = (baseY: number, amp: number, col: string, freq: number) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 16) {
        const y =
          baseY -
          Math.abs(Math.sin(x * freq + rng() * 0.02)) * amp -
          Math.sin(x * freq * 3.1) * amp * 0.28 -
          Math.sin(x * freq * 7.3) * amp * 0.1;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    };
    ridge(430, 150, "rgba(96,74,110,0.55)", 0.0021);
    ridge(460, 210, "rgba(74,56,88,0.72)", 0.0014);
    ridge(500, 120, "rgba(52,40,62,0.85)", 0.0033);
    // snow caps on the tallest ridge
    ctx.fillStyle = "rgba(255,236,224,0.5)";
    for (let i = 0; i < 22; i++) {
      const x = rng() * w;
      ctx.beginPath();
      ctx.moveTo(x, 250 + rng() * 40);
      ctx.lineTo(x + 26, 300 + rng() * 30);
      ctx.lineTo(x - 26, 300 + rng() * 30);
      ctx.closePath();
      ctx.fill();
    }
    return finish(c);
  });
}

function pagodaCardTexture() {
  return cached("kyoto.pagoda", () => {
    const w = 1024;
    const h = 512;
    const c = cv(w, h);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    const dark = "#3a2733";
    const warm = "#7c4a3c";
    const roof = (cx: number, y: number, w2: number, h2: number) => {
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(cx - w2, y);
      ctx.quadraticCurveTo(cx - w2 * 0.4, y - h2 * 0.55, cx, y - h2);
      ctx.quadraticCurveTo(cx + w2 * 0.4, y - h2 * 0.55, cx + w2, y);
      ctx.quadraticCurveTo(cx, y + h2 * 0.35, cx - w2, y);
      ctx.fill();
    };
    const pagoda = (cx: number, baseY: number, scale: number) => {
      for (let i = 0; i < 5; i++) {
        const y = baseY - i * 74 * scale;
        const w2 = (150 - i * 20) * scale;
        ctx.fillStyle = warm;
        ctx.fillRect(cx - w2 * 0.52, y - 52 * scale, w2 * 1.04, 54 * scale);
        // lit windows
        ctx.fillStyle = "rgba(255,196,120,0.75)";
        for (let k = -1; k <= 1; k++) ctx.fillRect(cx + k * w2 * 0.3 - 5 * scale, y - 40 * scale, 10 * scale, 22 * scale);
        roof(cx, y - 46 * scale, w2 * 0.95, 34 * scale);
      }
      ctx.fillStyle = dark;
      ctx.fillRect(cx - 3 * scale, baseY - 5 * 74 * scale - 60 * scale, 6 * scale, 70 * scale);
    };
    pagoda(300, 470, 1);
    pagoda(760, 480, 0.62);
    // temple hall roof on the right
    ctx.fillStyle = warm;
    ctx.fillRect(860, 420, 150, 70);
    roof(935, 424, 130, 46);
    // tree line
    ctx.fillStyle = "rgba(48,34,44,0.9)";
    for (let x = 0; x < w; x += 22) {
      ctx.beginPath();
      ctx.arc(x, 492 - Math.sin(x * 0.05) * 8, 20, 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(c);
  });
}

function blossomCardTexture() {
  return cached("kyoto.blossomCard", () => {
    const s = 512;
    const c = cv(s, s);
    const ctx = c.getContext("2d")!;
    const rng = makeRng(4242);
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = "#4a3226";
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(s / 2, s);
    ctx.quadraticCurveTo(s / 2 - 20, s * 0.6, s / 2 + 10, s * 0.42);
    ctx.stroke();
    for (let i = 0; i < 7; i++) {
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(s / 2 + 6, s * 0.5);
      ctx.quadraticCurveTo(s / 2 + (rng() - 0.5) * 200, s * 0.34, s / 2 + (rng() - 0.5) * 300, s * 0.2 + rng() * 60);
      ctx.stroke();
    }
    for (let i = 0; i < 620; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.pow(rng(), 0.6) * 190;
      const x = s / 2 + Math.cos(a) * r * 1.25;
      const y = s * 0.3 + Math.sin(a) * r * 0.72;
      const p = rng();
      ctx.fillStyle = p > 0.72 ? "rgba(255,232,240,0.95)" : p > 0.35 ? "rgba(250,186,206,0.92)" : "rgba(228,140,170,0.85)";
      ctx.beginPath();
      ctx.arc(x, y, 5 + rng() * 12, 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(c);
  });
}

function petalTexture() {
  return cached("kyoto.petal", () => {
    const s = 64;
    const c = cv(s, s);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,240,246,1)");
    g.addColorStop(0.55, "rgba(252,190,210,0.95)");
    g.addColorStop(1, "rgba(232,140,172,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(s / 2, s / 2, s * 0.42, s * 0.28, 0.5, 0, Math.PI * 2);
    ctx.fill();
    const t = finish(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/* ------------------------------------------------------------------ */
/* Falling petals                                                      */
/* ------------------------------------------------------------------ */

const PETALS = 240;

class PetalField {
  mesh: THREE.InstancedMesh;
  private pos: Float32Array;
  private vel: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private box: { x: number; z: number; w: number; d: number; top: number };

  constructor(box: { x: number; z: number; w: number; d: number; top: number }) {
    this.box = box;
    const geo = new THREE.PlaneGeometry(0.13, 0.09);
    const mat = new THREE.MeshBasicMaterial({
      map: petalTexture(),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      opacity: 0.95,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, PETALS);
    this.mesh.frustumCulled = false;
    this.pos = new Float32Array(PETALS * 3);
    this.vel = new Float32Array(PETALS * 3);
    this.rot = new Float32Array(PETALS * 3);
    this.spin = new Float32Array(PETALS * 3);
    for (let i = 0; i < PETALS; i++) this.respawn(i, true);
    this.writeAll();
  }

  private respawn(i: number, anywhere = false) {
    const b = this.box;
    this.pos[i * 3] = b.x + (Math.random() - 0.5) * b.w;
    this.pos[i * 3 + 1] = anywhere ? Math.random() * b.top : b.top + Math.random() * 1.5;
    this.pos[i * 3 + 2] = b.z + (Math.random() - 0.5) * b.d;
    this.vel[i * 3] = -0.35 - Math.random() * 0.5;
    this.vel[i * 3 + 1] = -0.32 - Math.random() * 0.4;
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
    this.rot[i * 3] = Math.random() * Math.PI * 2;
    this.rot[i * 3 + 1] = Math.random() * Math.PI * 2;
    this.rot[i * 3 + 2] = Math.random() * Math.PI * 2;
    this.spin[i * 3] = (Math.random() - 0.5) * 3.4;
    this.spin[i * 3 + 1] = (Math.random() - 0.5) * 2.6;
    this.spin[i * 3 + 2] = (Math.random() - 0.5) * 3.0;
  }

  /** cosmetic kick-up at a footfall / landing */
  burst(x: number, z: number, strength: number) {
    const n = Math.min(14, 3 + Math.round(strength * 9));
    for (let k = 0; k < n; k++) {
      const i = Math.floor(Math.random() * PETALS);
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.7;
      this.pos[i * 3 + 1] = 0.06 + Math.random() * 0.2;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.9;
      this.vel[i * 3] = (Math.random() - 0.5) * 2.4;
      this.vel[i * 3 + 1] = 1.1 + Math.random() * 1.9 * (0.4 + strength);
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 1.6;
      this.spin[i * 3] = (Math.random() - 0.5) * 12;
      this.spin[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }
  }

  update(dt: number, time: number) {
    for (let i = 0; i < PETALS; i++) {
      const ix = i * 3;
      const flutter = Math.sin(time * 2.6 + i) * 0.55;
      this.vel[ix + 1] += (-0.55 - this.vel[ix + 1]) * dt * 1.4;
      this.pos[ix] += (this.vel[ix] + flutter * 0.5) * dt;
      this.pos[ix + 1] += this.vel[ix + 1] * dt;
      this.pos[ix + 2] += (this.vel[ix + 2] + flutter * 0.3) * dt;
      this.rot[ix] += this.spin[ix] * dt;
      this.rot[ix + 1] += this.spin[ix + 1] * dt;
      this.rot[ix + 2] += this.spin[ix + 2] * dt;
      if (this.pos[ix + 1] < 0.02 || this.pos[ix] < this.box.x - this.box.w / 2 - 2) this.respawn(i);
    }
    this.writeAll();
  }

  private writeAll() {
    for (let i = 0; i < PETALS; i++) {
      const ix = i * 3;
      this.v.set(this.pos[ix], this.pos[ix + 1], this.pos[ix + 2]);
      this.e.set(this.rot[ix], this.rot[ix + 1], this.rot[ix + 2]);
      this.q.setFromEuler(this.e);
      const sc = 0.7 + ((i * 37) % 11) / 16;
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

export function buildKyoto(tree?: GLTF | null): Arena {
  const group = new THREE.Group();
  const rng = makeRng(1701);

  const sky = new Sky({
    top: "#33264f",
    mid: "#d97a5c",
    bottom: "#f6cd94",
    sunColor: "#ffd9a0",
    sunDir: new THREE.Vector3(-0.55, 0.11, -0.82),
    sunSize: 0.014,
    haze: 1.5,
    sunGlow: 0.85,
    clouds: { count: 9, colorA: "#ffd9b8", colorB: "#c8789a", height: [70, 200], scale: 150, opacity: 0.42 },
  });
  group.add(sky.group);

  const sun = makeSun(0xffc489, 2.7, new THREE.Vector3(-18, 10, -12));
  group.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xc39ad8, 0x6d4a38, 1.35);
  group.add(hemi);
  const fill = new THREE.DirectionalLight(0xffe3c2, 0.95);
  fill.position.set(7, 8, 15);
  group.add(fill);

  /* ---------- level stone courtyard at Y=0 ---------- */
  const groundMat = new THREE.MeshStandardMaterial({ map: stoneTileTexture(), color: 0xb39c85, roughness: 0.94, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // low central medallion (inlay, not collision geometry)
  const medallion = new THREE.Mesh(
    new THREE.CircleGeometry(3.7, 64),
    new THREE.MeshStandardMaterial({ map: medallionTexture(), color: 0xc6b096, roughness: 0.86 }),
  );
  medallion.rotation.x = -Math.PI / 2;
  medallion.position.y = 0.015;
  medallion.receiveShadow = true;
  group.add(medallion);

  // fight boundary inlay at ±ARENA_BOUNDS: readable, purely cosmetic
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xe4cfa6, roughness: 0.7, emissive: 0x2a1c10, emissiveIntensity: 0.4 });
  for (const sx of [-1, 1]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 5.4), lineMat);
    line.position.set(sx * ARENA_BOUNDS, 0.02, 0);
    group.add(line);
  }

  /* ---------- curved audience tiers ---------- */
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6f5f52, roughness: 0.95 });
  const tierArc = Math.PI * 0.86;
  const tierStart = Math.PI - tierArc / 2;
  const tiers = [
    { r: 13.5, y: 0.0, h: 1.5 },
    { r: 17.0, y: 1.5, h: 1.7 },
    { r: 20.5, y: 3.2, h: 1.9 },
  ];
  for (const t of tiers) {
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(t.r, t.r, t.h, 44, 1, true, tierStart, tierArc), stoneMat);
    wall.position.y = t.y + t.h / 2;
    wall.material.side = THREE.DoubleSide;
    group.add(wall);
    const deck = new THREE.Mesh(new THREE.RingGeometry(t.r - 2.6, t.r, 44, 1, tierStart, tierArc), stoneMat);
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = t.y + t.h;
    group.add(deck);
  }

  /* ---------- crowd cards on the tiers (2-frame atlas, swapped) ---------- */
  const crowdMats: THREE.MeshBasicMaterial[] = [];
  const crowdLayers: { mat: THREE.MeshBasicMaterial; phase: number }[] = [];
  tiers.forEach((t, ti) => {
    const tex = crowdTexture(1234 + ti * 77, "rgba(255,205,150,0.85)");
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.95 });
    crowdMats.push(mat);
    crowdLayers.push({ mat, phase: ti * 0.13 });
    const count = 54;
    const geo = new THREE.PlaneGeometry(1.5, 1.55);
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.frustumCulled = false;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const th = tierStart + ((i + 0.5) / count) * tierArc;
      const rr = t.r - 1.3;
      v.set(Math.sin(th) * rr, t.y + t.h + 0.76 + (i % 3) * 0.04, Math.cos(th) * rr);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), th + Math.PI);
      const sc = 1.05 + ((i * 13) % 7) / 22;
      s.set(sc, sc, sc);
      m4.compose(v, q, s);
      inst.setMatrixAt(i, m4);
    }
    group.add(inst);
  });

  /* ---------- depth-separated background cards ---------- */
  const card = (tex: THREE.Texture, w: number, h: number, pos: [number, number, number], opacity = 1) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity, fog: true }),
    );
    m.position.set(...pos);
    group.add(m);
    return m;
  };
  card(mountainCardTexture(), 300, 75, [0, 26, -105], 0.95);
  card(pagodaCardTexture(), 120, 60, [-6, 18, -62], 0.98);
  card(blossomCardTexture(), 26, 26, [-30, 8, -40], 0.95);
  card(blossomCardTexture(), 20, 20, [33, 6.5, -44], 0.9);
  card(blossomCardTexture(), 15, 15, [22, 5, -30], 0.85);

  /* ---------- torii gate behind the tiers (3D, never in the fight strip) ---------- */
  const toriiMat = new THREE.MeshStandardMaterial({ color: 0xb8352c, roughness: 0.62 });
  const toriiDark = new THREE.MeshStandardMaterial({ color: 0x2b2018, roughness: 0.7 });
  const torii = new THREE.Group();
  for (const sx of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 7.4, 12), toriiMat);
    pillar.position.set(sx * 3.1, 3.7, 0);
    pillar.castShadow = true;
    torii.add(pillar);
  }
  const lintelTop = new THREE.Mesh(new THREE.BoxGeometry(8.9, 0.42, 0.62), toriiDark);
  lintelTop.position.set(0, 7.5, 0);
  torii.add(lintelTop);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(7.9, 0.34, 0.5), toriiMat);
  lintel.position.set(0, 6.6, 0);
  torii.add(lintel);
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.16), toriiDark);
  plaque.position.set(0, 7.02, 0);
  torii.add(plaque);
  torii.position.set(0, 0, -11.5);
  group.add(torii);

  /* ---------- stone lanterns + modest glow ---------- */
  const lanternStone = new THREE.MeshStandardMaterial({ color: 0x8a8074, roughness: 0.9 });
  const lanternGlowMat = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb45e, emissiveIntensity: 2.4, roughness: 0.5 });
  const lanternSpots: [number, number][] = [
    [-9.6, -2.4],
    [9.6, -2.4],
    [-9.6, 3.6],
    [9.6, 3.6],
  ];
  const lanternLights: THREE.PointLight[] = [];
  lanternSpots.forEach(([x, z], i) => {
    const l = new THREE.Group();
    l.add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.28, 10), lanternStone).translateY(0.14));
    l.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 1.5, 10), lanternStone).translateY(1.0));
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.62), lanternStone);
    box.position.y = 1.98;
    l.add(box);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.5), lanternGlowMat);
    glow.position.y = 1.98;
    l.add(glow);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.42, 4), lanternStone);
    roof.position.y = 2.42;
    roof.rotation.y = Math.PI / 4;
    l.add(roof);
    l.position.set(x, 0, z);
    l.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = false;
    });
    group.add(l);
    if (i < 2) {
      const pl = new THREE.PointLight(0xffb45e, 5.5, 11, 2);
      pl.position.set(x * 0.92, 2.0, z);
      group.add(pl);
      lanternLights.push(pl);
    }
  });

  /* ---------- cherry tree: supplied GLB as a single foreground edge prop ---------- */
  const treeHolder = new THREE.Group();
  treeHolder.position.set(-10.6, 0, 2.4);
  group.add(treeHolder);
  if (tree) {
    const model = tree.scene.clone(true);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const h = Math.max(1, box.max.y - box.min.y);
    const s = 5.4 / h;
    model.scale.setScalar(s);
    model.position.y = -box.min.y * s;
    model.position.x = -((box.min.x + box.max.x) / 2) * s;
    model.position.z = -((box.min.z + box.max.z) / 2) * s;
    model.rotation.y = 0.6;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = false;
        // one double-sided material, no normal map: keep alpha/overdraw cheap
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat && "side" in mat) mat.side = THREE.FrontSide;
      }
    });
    treeHolder.add(model);
  } else {
    // procedural stand-in if the review GLB is unavailable
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, 3.2, 9), new THREE.MeshStandardMaterial({ color: 0x4a3226, roughness: 0.9 }));
    trunk.position.y = 1.6;
    treeHolder.add(trunk);
    const blossom = new THREE.MeshStandardMaterial({ color: 0xf2a8c0, roughness: 0.85, emissive: 0x3a1622, emissiveIntensity: 0.4 });
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.7 + rng() * 0.6, 10, 8), blossom);
      b.position.set((rng() - 0.5) * 2.6, 3.1 + rng() * 1.5, (rng() - 0.5) * 2.2);
      treeHolder.add(b);
    }
  }
  // ground petal piles around the tree and the edges
  const pileMat = new THREE.MeshBasicMaterial({ map: petalTexture(), transparent: true, depthWrite: false, opacity: 0.75 });
  const piles = new THREE.InstancedMesh(new THREE.CircleGeometry(0.6, 10), pileMat, 46);
  piles.rotation.x = 0;
  {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < 46; i++) {
      const nearTree = i < 26;
      const x = nearTree ? -10.6 + (rng() - 0.5) * 7 : (rng() - 0.5) * 26;
      const z = nearTree ? 2.4 + (rng() - 0.5) * 6 : -6 - rng() * 6;
      v.set(x, 0.03, z);
      s.setScalar(0.5 + rng() * 1.5);
      m4.compose(v, q, s);
      piles.setMatrixAt(i, m4);
    }
  }
  group.add(piles);

  /* ---------- falling petals ---------- */
  const petals = new PetalField({ x: -2, z: -1, w: 34, d: 22, top: 7.5 });
  group.add(petals.mesh);

  let crowdFrame = 0;
  let crowdTimer = 0;

  return {
    group,
    sun,
    exposure: 1.06,
    bloom: { strength: 0.58, threshold: 0.88, radius: 0.72 },
    fog: new THREE.Fog(0xd99a76, 32, 175),
    background: new THREE.Color(0xe0a179),
    dustColor: 0xf0c6ac,
    camera: KYOTO_CAMERA,
    footfall(x: number, z: number, strength: number, fx: FX) {
      petals.burst(x, z, strength);
      fx.dustPuff(new THREE.Vector3(x, 0.05, z), 3 + Math.round(strength * 5), 0.42, 0xf3c9d6, 1.4, 0.9);
    },
    update(dt: number, time: number, _fx: FX) {
      sky.update(dt);
      petals.update(dt, time);
      // swap the crowd atlas frame so the tiers read as cheering without a skinned crowd
      crowdTimer += dt;
      if (crowdTimer > 0.26) {
        crowdTimer = 0;
        crowdFrame = 1 - crowdFrame;
      }
      for (const layer of crowdLayers) {
        const tex = layer.mat.map;
        if (!tex) continue;
        const swap = (time + layer.phase * 2) % 0.52 < 0.26 ? crowdFrame : 1 - crowdFrame;
        tex.offset.x = swap * 0.5;
      }
      const flicker = 0.82 + Math.sin(time * 7.3) * 0.08 + Math.sin(time * 17.1) * 0.05;
      lanternGlowMat.emissiveIntensity = 2.2 * flicker;
      for (const pl of lanternLights) pl.intensity = 5.2 * flicker;
    },
    dispose() {
      petals.mesh.geometry.dispose();
      (petals.mesh.material as THREE.Material).dispose();
      for (const m of crowdMats) m.dispose();
      disposeGroup(group);
    },
  };
}