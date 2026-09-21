import * as THREE from "three";
import { Sky } from "../Sky";
import { FX, Motes } from "../FX";
import { crackedEarthTexture, makeRng } from "../textures";
import { Arena, addWind, disposeGroup, makeGround, makeSun, scatter } from "./common";

export function buildWasteland(): Arena {
  const group = new THREE.Group();
  const rng = makeRng(404);
  const windTime = { value: 0 };

  const sky = new Sky({
    top: "#1c3038",
    mid: "#d9683a",
    bottom: "#f0a86c",
    sunColor: "#ffd9a0",
    sunDir: new THREE.Vector3(0.62, 0.12, -0.75),
    sunSize: 0.006,
    haze: 0.9,
    sunGlow: 0.55,
    clouds: { count: 14, colorA: "#2a3d46", colorB: "#ff9b5c", height: [70, 170], scale: 160, opacity: 0.75 },
  });
  group.add(sky.group);

  // ground
  const ground = makeGround(crackedEarthTexture(), 0xd39a66, 55);
  group.add(ground);

  // sun & fills
  const sun = makeSun(0xffb478, 3.4, new THREE.Vector3(22, 14, 12));
  group.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x5b7d8c, 0x8a5a3a, 1.1);
  group.add(hemi);
  const rim = new THREE.DirectionalLight(0x3ec1d3, 1.2);
  rim.position.set(-18, 9, -14);
  group.add(rim);

  // mesas
  const mesaMat = new THREE.MeshStandardMaterial({ color: 0x6b3d33, roughness: 1 });
  const mesaTopMat = new THREE.MeshStandardMaterial({ color: 0x7d4a3a, roughness: 1 });
  const mesaSpecs = [
    [-150, -180, 34, 28],
    [-90, -210, 24, 20],
    [40, -230, 44, 36],
    [120, -190, 30, 26],
    [200, -120, 26, 18],
    [-220, -90, 22, 16],
    [-60, -260, 40, 30],
    [260, -200, 50, 34],
  ];
  for (const [x, z, r, h] of mesaSpecs) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r, h * 0.6, 7), mesaMat);
    base.position.set(x, h * 0.3, z);
    base.rotation.y = rng() * Math.PI;
    group.add(base);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.72, h * 0.4, 7), mesaTopMat);
    top.position.set(x, h * 0.8, z);
    top.rotation.y = base.rotation.y;
    group.add(top);
  }
  // mid-ground buttes / rocks
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 1, flatShading: true });
  const rockGeo = new THREE.DodecahedronGeometry(1, 1);
  const rocks = scatter({ count: 34, minR: 0.4, maxR: 2.6, zRange: [-60, 14], xRange: [-70, 70], rng, padZ: 4 });
  const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  rocks.forEach((r, i) => {
    e.set(rng() * 0.6, r.r, rng() * 0.6);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(r.x, r.s * 0.35, r.z), q, new THREE.Vector3(r.s * 1.3, r.s * 0.7, r.s));
    rockMesh.setMatrixAt(i, m4);
  });
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  group.add(rockMesh);

  // dry grass tufts
  const grassMat = new THREE.MeshStandardMaterial({ color: 0xc9a05c, roughness: 1, side: THREE.DoubleSide });
  addWind(grassMat, windTime, 0.12, 0.6);
  const tuftGeo = new THREE.ConeGeometry(0.16, 0.7, 5, 3, true);
  tuftGeo.translate(0, 0.35, 0);
  const tufts = scatter({ count: 1400, minR: 0.5, maxR: 1.4, zRange: [-45, 18], xRange: [-60, 60], rng, padZ: 2.6 });
  const tuftMesh = new THREE.InstancedMesh(tuftGeo, grassMat, tufts.length);
  tufts.forEach((t, i) => {
    e.set(0, t.r, 0);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
    tuftMesh.setMatrixAt(i, m4);
  });
  tuftMesh.receiveShadow = true;
  group.add(tuftMesh);

  // near-arena scrub inside the strip (short, sparse)
  const nearTufts = scatter({ count: 90, minR: 0.3, maxR: 0.6, zRange: [-2.4, 2.4], xRange: [-12, 12], rng, avoidArena: false });
  const nearMesh = new THREE.InstancedMesh(tuftGeo, grassMat, nearTufts.length);
  nearTufts.forEach((t, i) => {
    e.set(0, t.r, 0);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(t.x, 0, t.z + (t.z > 0 ? 1.2 : -1.2)), q, new THREE.Vector3(t.s, t.s, t.s));
    nearMesh.setMatrixAt(i, m4);
  });
  group.add(nearMesh);

  /* ---------- props ---------- */
  const rust = new THREE.MeshStandardMaterial({ color: 0x7a3b2a, roughness: 0.85, metalness: 0.3 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2f2a26, roughness: 0.8, metalness: 0.4 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5c3f2a, roughness: 1 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fb8c8, roughness: 0.2, metalness: 0.6 });

  // windmill
  const windmill = new THREE.Group();
  windmill.position.set(-19, 0, -24);
  for (let i = 0; i < 4; i++) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 11, 0.18), darkMetal);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    leg.position.set(Math.cos(a) * 1.3, 5.5, Math.sin(a) * 1.3);
    leg.rotation.z = -Math.cos(a) * 0.12;
    leg.rotation.x = Math.sin(a) * 0.12;
    leg.castShadow = true;
    windmill.add(leg);
  }
  for (let y = 2.5; y < 11; y += 2.8) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35 - y * 0.08, 0.05, 6, 4), darkMetal);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = Math.PI / 4;
    ring.position.y = y;
    windmill.add(ring);
  }
  const hub = new THREE.Group();
  hub.position.set(0, 11.2, 0.9);
  const blades = new THREE.Group();
  for (let i = 0; i < 12; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.6, 0.04), rust);
    b.position.y = 1.5;
    b.rotation.y = 0.5;
    const holder = new THREE.Group();
    holder.rotation.z = (i / 12) * Math.PI * 2;
    holder.add(b);
    blades.add(holder);
  }
  const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.4, 10), darkMetal);
  hubCap.rotation.x = Math.PI / 2;
  hub.add(blades, hubCap);
  const vane = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.2, 1.6), rust);
  vane.position.set(0, 11.2, -1.8);
  windmill.add(hub, vane);
  group.add(windmill);

  // wrecked pickup truck
  const truck = new THREE.Group();
  truck.position.set(15, 0, -11);
  truck.rotation.y = -0.5;
  truck.rotation.z = 0.06;
  const bed = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.0, 1.9), rust);
  bed.position.y = 0.95;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.8), rust);
  cab.position.set(0.9, 1.9, 0);
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 1.5), glass);
  windshield.position.set(1.72, 1.95, 0);
  windshield.rotation.z = -0.35;
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.8), rust);
  hood.position.set(2.5, 1.55, 0);
  truck.add(bed, cab, windshield, hood);
  const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.35, 14);
  for (const [x, z] of [
    [-1.4, 1],
    [-1.4, -1],
    [1.8, 1],
    [1.8, -1],
  ]) {
    const w = new THREE.Mesh(wheelGeo, darkMetal);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.45, z);
    truck.add(w);
  }
  truck.traverse((o) => {
    o.castShadow = true;
  });
  group.add(truck);

  // power poles
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 9, 8);
  const crossGeo = new THREE.BoxGeometry(2.2, 0.15, 0.15);
  const poles: THREE.Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    const pole = new THREE.Mesh(poleGeo, wood);
    const x = -32 + i * 16;
    pole.position.set(x, 4.5, -34);
    pole.castShadow = true;
    const cross = new THREE.Mesh(crossGeo, wood);
    cross.position.set(x, 8.2, -34);
    group.add(pole, cross);
    poles.push(new THREE.Vector3(x, 8.15, -34));
  }
  const wireMat = new THREE.LineBasicMaterial({ color: 0x1a1512 });
  for (let i = 0; i < poles.length - 1; i++) {
    for (const off of [-0.9, 0.9]) {
      const a = poles[i].clone().add(new THREE.Vector3(off, 0, 0));
      const b = poles[i + 1].clone().add(new THREE.Vector3(off, 0, 0));
      const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -1.1, 0));
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(16));
      group.add(new THREE.Line(geo, wireMat));
    }
  }

  // ruined shack silhouette
  const shack = new THREE.Group();
  shack.position.set(-38, 0, -40);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(7, 3.5, 0.3), wood);
  wall.position.y = 1.75;
  const wall2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 5), wood);
  wall2.position.set(-3.4, 1.5, 2.4);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.2, 5.5), rust);
  roof.position.set(0, 3.5, 2.5);
  roof.rotation.x = 0.12;
  shack.add(wall, wall2, roof);
  group.add(shack);

  // tumbleweed
  const tumbleMat = new THREE.MeshStandardMaterial({ color: 0x9a7a48, wireframe: true, roughness: 1 });
  const tumble = new THREE.Group();
  const tw1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), tumbleMat);
  const tw2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 1), tumbleMat);
  tw2.rotation.set(0.5, 0.8, 0.2);
  tumble.add(tw1, tw2);
  tumble.position.set(-40, 0.55, -5.2);
  group.add(tumble);
  let tumbleT = -3;

  // ambient dust
  const motes = new Motes({
    count: 320,
    box: { x: 0, y: 2.5, z: -3, w: 40, h: 6, d: 22 },
    color: 0xe8c8a0,
    size: 0.35,
    opacity: 0.22,
    velocity: new THREE.Vector3(1.4, 0.15, 0),
    jitter: 0.6,
  });
  group.add(motes.points);
  // low rolling dust haze near the ground (large soft)
  const haze = new Motes({
    count: 60,
    box: { x: 0, y: 0.8, z: -6, w: 60, h: 1.6, d: 26 },
    color: 0xe0b48c,
    size: 6,
    opacity: 0.06,
    velocity: new THREE.Vector3(1.8, 0, 0),
    jitter: 0.3,
  });
  group.add(haze.points);

  let dustTimer = 0;

  return {
    group,
    sun,
    exposure: 1.02,
    bloom: { strength: 0.55, threshold: 0.9, radius: 0.5 },
    fog: new THREE.Fog(0xe0925c, 40, 320),
    background: new THREE.Color(0xe0925c),
    dustColor: 0xd8b68a,
    update(dt: number, time: number, fx: FX) {
      windTime.value = time;
      sky.update(dt);
      blades.rotation.z += dt * 1.3;
      hub.rotation.y = Math.sin(time * 0.2) * 0.25;
      motes.update(dt);
      haze.update(dt);
      // tumbleweed
      tumbleT += dt;
      if (tumbleT > 0) {
        tumble.position.x += dt * 3.2;
        tumble.position.y = 0.55 + Math.abs(Math.sin(tumbleT * 4.2)) * 0.5;
        tumble.rotation.z -= dt * 5.5;
        tumble.rotation.x += dt * 0.8;
        if (tumble.position.x > 42) {
          tumble.position.x = -42;
          tumbleT = -(6 + Math.random() * 8);
          tumble.position.z = -4.6 - Math.random() * 4;
        }
      }
      // occasional wind gust dust
      dustTimer -= dt;
      if (dustTimer <= 0) {
        dustTimer = 0.4 + Math.random() * 0.6;
        const p = new THREE.Vector3(-14 + Math.random() * 28, 0.1, -3.5 - Math.random() * 6);
        fx.dustPuff(p, 2, 1.4, 0xd9b184, 0.6, 0.25);
      }
    },
    dispose() {
      disposeGroup(group);
    },
  };
}
