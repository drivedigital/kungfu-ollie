import * as THREE from "three";
import { Sky } from "../Sky";
import { FX, Motes } from "../FX";
import { butterflyWingTexture, grassTexture, makeRng, strawTexture } from "../textures";
import { Arena, addWind, disposeGroup, makeGround, makeSun, scatter } from "./common";
import { mergeGeometries } from "../geom";

export function buildMeadow(): Arena {
  const group = new THREE.Group();
  const rng = makeRng(1313);
  const windTime = { value: 0 };

  const sky = new Sky({
    top: "#7fa2d6",
    mid: "#f7d3a4",
    bottom: "#f3be86",
    sunColor: "#ffe2b0",
    sunDir: new THREE.Vector3(0.35, 0.09, -0.92),
    sunSize: 0.012,
    haze: 1.3,
    sunGlow: 0.7,
    clouds: { count: 10, colorA: "#fff1dc", colorB: "#f8c9a0", height: [90, 220], scale: 150, opacity: 0.45 },
  });
  group.add(sky.group);

  const ground = makeGround(grassTexture(), 0xa9b453, 60);
  group.add(ground);

  const sun = makeSun(0xffd7a0, 2.9, new THREE.Vector3(14, 9, -16));
  group.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0xb69a55, 1.5);
  group.add(hemi);
  const fill = new THREE.DirectionalLight(0xffe6c8, 1.3);
  fill.position.set(-8, 8, 16);
  group.add(fill);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s3 = new THREE.Vector3();

  /* ---------- grass ---------- */
  const bladeGeo = new THREE.PlaneGeometry(0.09, 1, 1, 4);
  bladeGeo.translate(0, 0.5, 0);
  // taper blade toward the tip
  {
    const pos = bladeGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setX(i, pos.getX(i) * (1 - y * 0.85));
    }
    pos.needsUpdate = true;
  }
  const grassMat = new THREE.MeshStandardMaterial({ color: 0xb8c25a, roughness: 0.9, side: THREE.DoubleSide });
  addWind(grassMat, windTime, 0.22, 1);
  const tallGrassMat = new THREE.MeshStandardMaterial({ color: 0xcdb95e, roughness: 0.9, side: THREE.DoubleSide });
  addWind(tallGrassMat, windTime, 0.3, 1);

  const placeBlades = (mesh: THREE.InstancedMesh, pts: { x: number; z: number; r: number; s: number }[], hMul: number) => {
    pts.forEach((p, i) => {
      e.set((rng() - 0.5) * 0.25, p.r, (rng() - 0.5) * 0.25);
      q.setFromEuler(e);
      v.set(p.x, 0, p.z);
      s3.set(1 + rng() * 0.6, p.s * hMul, 1);
      m4.compose(v, q, s3);
      mesh.setMatrixAt(i, m4);
    });
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
  };

  const far = scatter({ count: 9000, minR: 0.7, maxR: 1.3, zRange: [-60, 26], xRange: [-70, 70], rng, padZ: 2.6 });
  const farMesh = new THREE.InstancedMesh(bladeGeo, tallGrassMat, far.length);
  placeBlades(farMesh, far, 1);
  group.add(farMesh);
  const near = scatter({ count: 1400, minR: 0.22, maxR: 0.42, zRange: [-2.6, 2.6], xRange: [-13, 13], rng, avoidArena: false });
  const nearMesh = new THREE.InstancedMesh(bladeGeo, grassMat, near.length);
  placeBlades(nearMesh, near, 1);
  group.add(nearMesh);

  /* ---------- wheat ---------- */
  const wheatMat = new THREE.MeshStandardMaterial({ color: 0xe0b866, roughness: 0.8 });
  addWind(wheatMat, windTime, 0.3, 1.3, false);
  const stalkGeo = new THREE.CylinderGeometry(0.012, 0.02, 1.3, 4);
  stalkGeo.translate(0, 0.65, 0);
  const headGeo = new THREE.CapsuleGeometry(0.035, 0.16, 3, 6);
  headGeo.translate(0, 1.3, 0);
  const wheatGeo = mergeGeometries([stalkGeo, headGeo]);
  const wheatPts = scatter({ count: 2600, minR: 0.8, maxR: 1.25, zRange: [-40, 18], xRange: [-50, 50], rng, padZ: 3.2 });
  const wheatMesh = new THREE.InstancedMesh(wheatGeo, wheatMat, wheatPts.length);
  wheatPts.forEach((p, i) => {
    e.set((rng() - 0.5) * 0.3, p.r, (rng() - 0.5) * 0.3);
    q.setFromEuler(e);
    v.set(p.x, 0, p.z);
    s3.set(1, p.s, 1);
    m4.compose(v, q, s3);
    wheatMesh.setMatrixAt(i, m4);
  });
  wheatMesh.frustumCulled = false;
  group.add(wheatMesh);

  /* ---------- wildflowers ---------- */
  const flowerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  addWind(flowerMat, windTime, 0.18, 0.9, false);
  const stemGeo = new THREE.CylinderGeometry(0.01, 0.015, 0.7, 4);
  stemGeo.translate(0, 0.35, 0);
  const blossomGeo = new THREE.SphereGeometry(0.07, 7, 6);
  blossomGeo.scale(1, 0.6, 1);
  blossomGeo.translate(0, 0.72, 0);
  const flowerGeo = mergeGeometries([stemGeo, blossomGeo]);
  const flowerPts = scatter({ count: 700, minR: 0.8, maxR: 1.3, zRange: [-30, 16], xRange: [-40, 40], rng, padZ: 2.4 });
  const flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerPts.length);
  const palette = [0x4f6fe0, 0x4f6fe0, 0x5b7cf0, 0xf2c53d, 0xf6efe0, 0xb07ad8, 0xff8fb0];
  const col = new THREE.Color();
  flowerPts.forEach((p, i) => {
    e.set(0, p.r, 0);
    q.setFromEuler(e);
    v.set(p.x, 0, p.z);
    s3.set(1, p.s, 1);
    m4.compose(v, q, s3);
    flowerMesh.setMatrixAt(i, m4);
    col.setHex(palette[Math.floor(rng() * palette.length)]);
    flowerMesh.setColorAt(i, col);
  });
  flowerMesh.frustumCulled = false;
  group.add(flowerMesh);
  // stems should look green: second instanced mesh for stems with green material
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x5f8a3a, roughness: 0.9 });
  addWind(stemMat, windTime, 0.18, 0.9, false);
  const stemMesh = new THREE.InstancedMesh(stemGeo, stemMat, flowerPts.length);
  flowerPts.forEach((p, i) => {
    e.set(0, p.r, 0);
    q.setFromEuler(e);
    v.set(p.x, 0, p.z);
    s3.set(1.2, p.s * 1.02, 1.2);
    m4.compose(v, q, s3);
    stemMesh.setMatrixAt(i, m4);
  });
  stemMesh.frustumCulled = false;
  group.add(stemMesh);

  /* ---------- hills, trees ---------- */
  const hillMat = new THREE.MeshStandardMaterial({ color: 0xa9b36a, roughness: 1 });
  const hillFarMat = new THREE.MeshStandardMaterial({ color: 0x9aa47a, roughness: 1 });
  const hills = [
    [-120, -170, 90, 0.28],
    [30, -210, 120, 0.22],
    [170, -160, 80, 0.3],
    [-220, -120, 70, 0.26],
    [260, -230, 140, 0.2],
    [-40, -300, 160, 0.18],
  ];
  hills.forEach(([x, z, r, sy], i) => {
    const h = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), i > 2 ? hillFarMat : hillMat);
    h.position.set(x, -r * (1 - sy) + 2, z);
    h.scale.set(1.4, 1, 1);
    group.add(h);
  });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 1 });
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x6f8c3c, roughness: 1 });
  const canopyDark = new THREE.MeshStandardMaterial({ color: 0x55703a, roughness: 1 });
  const treeAt = (x: number, z: number, s: number, shadow = false) => {
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * s, 0.4 * s, 3 * s, 8), trunkMat);
    trunk.position.y = 1.5 * s;
    const c1 = new THREE.Mesh(new THREE.SphereGeometry(2.2 * s, 12, 10), canopyMat);
    c1.position.set(0, 4.2 * s, 0);
    const c2 = new THREE.Mesh(new THREE.SphereGeometry(1.7 * s, 12, 10), canopyDark);
    c2.position.set(1.4 * s, 3.4 * s, 0.5 * s);
    const c3 = new THREE.Mesh(new THREE.SphereGeometry(1.6 * s, 12, 10), canopyMat);
    c3.position.set(-1.3 * s, 3.6 * s, -0.4 * s);
    t.add(trunk, c1, c2, c3);
    t.position.set(x, 0, z);
    if (shadow) t.traverse((o) => (o.castShadow = true));
    group.add(t);
  };
  treeAt(-15, -13, 1.1, true);
  treeAt(26, -22, 1.3);
  treeAt(-40, -30, 1.6);
  treeAt(48, -45, 2);
  for (let i = 0; i < 18; i++) treeAt(-120 + rng() * 240, -60 - rng() * 80, 1.5 + rng() * 2);

  // hay bales
  const strawMat = new THREE.MeshStandardMaterial({ map: strawTexture(), color: 0xd8b36a, roughness: 1 });
  const baleGeo = new THREE.CylinderGeometry(0.85, 0.85, 1.5, 18);
  for (const [x, z, r] of [
    [12, -8, 0.4],
    [14.5, -9.5, 1.9],
    [-22, -18, 0.8],
    [-9, -24, 2.4],
  ]) {
    const b = new THREE.Mesh(baleGeo, strawMat);
    b.rotation.z = Math.PI / 2;
    b.rotation.y = r;
    b.position.set(x, 0.85, z);
    b.castShadow = true;
    group.add(b);
  }
  // wooden fence in the distance
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1 });
  for (let i = -8; i <= 8; i++) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.2, 0.15), fenceMat);
    post.position.set(i * 2.2, 0.6, -16);
    group.add(post);
  }
  for (const y of [0.45, 0.95]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(36, 0.08, 0.06), fenceMat);
    rail.position.set(0, y, -16);
    group.add(rail);
  }

  /* ---------- butterflies ---------- */
  interface Butterfly {
    g: THREE.Group;
    wl: THREE.Mesh;
    wr: THREE.Mesh;
    seed: number;
    speed: number;
    cx: number;
    cz: number;
    h: number;
  }
  const butterflies: Butterfly[] = [];
  const wingColors = ["#4f7bff", "#ff9a3a", "#f9e37a", "#ffffff", "#7fd6ff", "#ff7ab0"];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.Group();
    const tex = butterflyWingTexture(wingColors[i % wingColors.length]);
    const wm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.3 });
    const wg = new THREE.PlaneGeometry(0.26, 0.26);
    wg.translate(0.13, 0, 0);
    const wl = new THREE.Mesh(wg, wm);
    const wr = new THREE.Mesh(wg, wm);
    wr.scale.x = -1;
    wl.rotation.x = -Math.PI / 2;
    wr.rotation.x = -Math.PI / 2;
    g.add(wl, wr);
    butterflies.push({ g, wl, wr, seed: rng() * 100, speed: 0.5 + rng() * 0.5, cx: -10 + rng() * 20, cz: -3 - rng() * 6, h: 0.9 + rng() * 1.6 });
    group.add(g);
  }

  const pollen = new Motes({
    count: 260,
    box: { x: 0, y: 2, z: -2, w: 34, h: 5, d: 16 },
    color: 0xffe8a8,
    size: 0.12,
    opacity: 0.85,
    additive: true,
    velocity: new THREE.Vector3(0.5, 0.1, 0),
    jitter: 0.5,
  });
  group.add(pollen.points);
  const seeds = new Motes({
    count: 60,
    box: { x: 0, y: 2.5, z: -4, w: 40, h: 6, d: 20 },
    color: 0xfff6e6,
    size: 0.32,
    opacity: 0.5,
    velocity: new THREE.Vector3(0.9, -0.1, 0),
    jitter: 0.8,
  });
  group.add(seeds.points);

  return {
    group,
    sun,
    exposure: 1.12,
    bloom: { strength: 0.6, threshold: 0.85, radius: 0.7 },
    fog: new THREE.Fog(0xf3cfa0, 30, 260),
    background: new THREE.Color(0xf3cfa0),
    dustColor: 0xd9c98a,
    update(dt: number, time: number, _fx: FX) {
      windTime.value = time;
      sky.update(dt);
      pollen.update(dt);
      seeds.update(dt);
      for (const b of butterflies) {
        const t = time * b.speed + b.seed;
        const x = b.cx + Math.sin(t * 0.7) * 3 + Math.sin(t * 1.9) * 0.6;
        const z = b.cz + Math.cos(t * 0.5) * 1.5;
        const y = b.h + Math.sin(t * 2.3) * 0.35 + Math.sin(t * 7) * 0.05;
        const px = b.g.position.x;
        const pz = b.g.position.z;
        b.g.position.set(x, y, z);
        const dx = x - px;
        const dz = z - pz;
        if (Math.abs(dx) + Math.abs(dz) > 1e-4) b.g.rotation.y = Math.atan2(dx, dz);
        const flap = Math.sin(time * 18 + b.seed) * 1.1;
        b.wl.rotation.y = -flap;
        b.wr.rotation.y = flap;
      }
    },
    dispose() {
      disposeGroup(group);
    },
  };
}
