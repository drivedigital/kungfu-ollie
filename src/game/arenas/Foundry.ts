import * as THREE from "three";
import { FX, Motes } from "../FX";
import { concreteTexture, hazardStripeTexture, makeRng, sparkTexture } from "../textures";
import { Arena, disposeGroup, makeGround, makeSun, scatter } from "./common";

export function buildFoundry(): Arena {
  const group = new THREE.Group();
  const rng = makeRng(777);

  // ground
  const ground = makeGround(concreteTexture(), 0x8a9096, 40, 400, 0.85);
  group.add(ground);
  // hazard stripes along arena edges
  const hz = hazardStripeTexture();
  const stripeMat = new THREE.MeshStandardMaterial({ map: hz, roughness: 0.8 });
  for (const z of [-3.2, 3.2]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(22, 0.5), stripeMat);
    s.rotation.x = -Math.PI / 2;
    s.position.set(0, 0.012, z);
    s.receiveShadow = true;
    group.add(s);
  }
  for (const x of [-11.2, 11.2]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 6.9), stripeMat);
    s.rotation.x = -Math.PI / 2;
    s.rotation.z = Math.PI / 2;
    s.position.set(x, 0.012, 0);
    group.add(s);
  }
  // steel floor plate in the center
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x3f474d, metalness: 0.8, roughness: 0.45 });
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.02, 48), plateMat);
  plate.position.y = 0.01;
  plate.receiveShadow = true;
  group.add(plate);
  const plateRing = new THREE.Mesh(new THREE.RingGeometry(4.15, 4.4, 48), new THREE.MeshStandardMaterial({ color: 0xe0b520, roughness: 0.7 }));
  plateRing.rotation.x = -Math.PI / 2;
  plateRing.position.y = 0.015;
  group.add(plateRing);

  // lights
  const sun = makeSun(0xbdf3f8, 2.6, new THREE.Vector3(5, 14, 9));
  group.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x2a5866, 0x0e1114, 1.25);
  group.add(hemi);
  const camFill = new THREE.DirectionalLight(0x7fd4e0, 0.7);
  camFill.position.set(-6, 6, 14);
  group.add(camFill);
  const furnaceLight = new THREE.PointLight(0xff7a20, 60, 40, 1.8);
  furnaceLight.position.set(-13, 3, -7);
  group.add(furnaceLight);
  const tealLight = new THREE.PointLight(0x38e8ff, 25, 20, 2);
  tealLight.position.set(8, 5, -5);
  group.add(tealLight);
  const warmLamp = new THREE.PointLight(0xffd27a, 18, 18, 2);
  warmLamp.position.set(-4, 6, 4);
  group.add(warmLamp);

  const steel = new THREE.MeshStandardMaterial({ color: 0x3a4146, metalness: 0.7, roughness: 0.55 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x21262a, metalness: 0.6, roughness: 0.6 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe0b520, metalness: 0.4, roughness: 0.6 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x6e3a24, metalness: 0.4, roughness: 0.85 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x151a1e, roughness: 0.95 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x9be9f0, emissive: 0xbffcff, emissiveIntensity: 3.5 });
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x0b3a44, emissive: 0x2ee6ff, emissiveIntensity: 1.8 });
  const orangeGlow = new THREE.MeshStandardMaterial({ color: 0xff8a2a, emissive: 0xff7a1a, emissiveIntensity: 4 });

  // walls & ceiling
  const back = new THREE.Mesh(new THREE.BoxGeometry(80, 18, 0.5), wallMat);
  back.position.set(0, 9, -20);
  group.add(back);
  for (const x of [-30, 30]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.5, 18, 60), wallMat);
    side.position.set(x, 9, -5);
    group.add(side);
  }
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(80, 0.5, 60), wallMat);
  ceiling.position.set(0, 16, -5);
  group.add(ceiling);
  // wall panels with rivets/pipes
  for (let i = -6; i <= 6; i++) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(5.4, 12, 0.3), i % 2 ? steel : darkSteel);
    panel.position.set(i * 5.8, 6, -19.6);
    group.add(panel);
  }

  // columns & girders
  for (const x of [-24, -16, -8, 8, 16, 24]) {
    for (const z of [-18, -9]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.7, 15, 0.7), steel);
      col.position.set(x, 7.5, z);
      col.castShadow = true;
      group.add(col);
      const flange = new THREE.Mesh(new THREE.BoxGeometry(1.1, 15, 0.15), darkSteel);
      flange.position.set(x, 7.5, z);
      group.add(flange);
    }
  }
  for (const z of [-18, -9]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(56, 0.7, 0.7), steel);
    beam.position.set(0, 13.5, z);
    group.add(beam);
  }
  for (const x of [-24, -16, -8, 8, 16, 24]) {
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 10), steel);
    cross.position.set(x, 13.5, -13.5);
    group.add(cross);
  }
  // truss lattice
  const latticeMat = new THREE.LineBasicMaterial({ color: 0x5b666d });
  for (const z of [-18, -9]) {
    const pts: THREE.Vector3[] = [];
    for (let x = -28; x < 28; x += 2) {
      pts.push(new THREE.Vector3(x, 13.2, z), new THREE.Vector3(x + 1, 14.4, z), new THREE.Vector3(x + 2, 13.2, z));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), latticeMat));
  }

  // overhead crane
  const craneBeam = new THREE.Mesh(new THREE.BoxGeometry(50, 1.0, 1.4), yellow);
  craneBeam.position.set(0, 11, -4);
  craneBeam.castShadow = true;
  group.add(craneBeam);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(50, 0.2, 0.3), darkSteel);
  rail.position.set(0, 10.4, -4);
  group.add(rail);
  const trolley = new THREE.Group();
  trolley.position.set(-6, 10.2, -4);
  const trolleyBox = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 2.0), steel);
  trolley.add(trolleyBox);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6), darkSteel);
  cable.position.y = -0.5;
  const hookGroup = new THREE.Group();
  const cableLen = 4.2;
  cable.scale.y = cableLen;
  cable.position.y = -cableLen / 2;
  const hookBlock = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.5), yellow);
  hookBlock.position.y = -cableLen - 0.45;
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.09, 8, 16, Math.PI * 1.4), darkSteel);
  hook.position.y = -cableLen - 1.25;
  hook.rotation.z = Math.PI * 0.8;
  hookGroup.add(cable, hookBlock, hook);
  hookGroup.traverse((o) => (o.castShadow = true));
  trolley.add(hookGroup);
  group.add(trolley);

  // hanging cables (catenaries)
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x111416, roughness: 0.9 });
  const anchors = [
    [-20, -17, -6, -17],
    [-6, -17, 10, -17],
    [10, -17, 22, -17],
    [-14, -8.5, 4, -8.5],
    [4, -8.5, 20, -8.5],
  ];
  for (const [x0, z0, x1, z1] of anchors) {
    const a = new THREE.Vector3(x0, 13.2, z0);
    const b = new THREE.Vector3(x1, 13.2, z1);
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -2.5 - rng() * 2, 0));
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.05, 6, false), cableMat));
  }

  // overhead lamps
  const lamps: THREE.Mesh[] = [];
  for (const x of [-9, -3, 3, 9]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3, 6), darkSteel);
    rod.position.set(x, 12.2, -1);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.6, 12, 1, true), darkSteel);
    shade.position.set(x, 10.6, -1);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.5), lampMat);
    bulb.position.set(x, 10.35, -1);
    group.add(rod, shade, bulb);
    lamps.push(bulb);
  }

  // furnace
  const furnace = new THREE.Group();
  furnace.position.set(-14, 0, -9);
  const fBody = new THREE.Mesh(new THREE.BoxGeometry(6, 7, 5), darkSteel);
  fBody.position.y = 3.5;
  fBody.castShadow = true;
  const fMouth = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.2), orangeGlow);
  fMouth.position.set(0, 2.2, 2.51);
  const fFrame = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.8, 0.3), rust);
  fFrame.position.set(0, 2.2, 2.4);
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 9, 12), steel);
  stack.position.set(1.5, 11, -1);
  const stack2 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 7, 12), rust);
  stack2.position.set(-1.6, 10, -1);
  furnace.add(fBody, fFrame, fMouth, stack, stack2);
  const stackTop = new THREE.Vector3(-12.5, 15.4, -10);
  const stackTop2 = new THREE.Vector3(-15.6, 13.4, -10);
  group.add(furnace);
  // molten glow floor patch
  const glowPatch = new THREE.Mesh(new THREE.CircleGeometry(2.4, 24), new THREE.MeshBasicMaterial({ color: 0xff6a10, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
  glowPatch.rotation.x = -Math.PI / 2;
  glowPatch.position.set(-14, 0.02, -5.5);
  group.add(glowPatch);

  // machinery blocks with screens
  const machineSpecs = [
    [10, -12, 4, 3, 3],
    [15, -13, 3, 4.5, 3],
    [20, -11, 5, 2.5, 4],
    [-4, -14, 3.5, 2.6, 2.5],
    [2, -15, 4, 3.5, 3],
    [-22, -12, 4, 3, 3],
  ];
  for (const [x, z, w, h, d] of machineSpecs) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rng() > 0.5 ? steel : darkSteel);
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    group.add(m);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.4, h * 0.25), screenMat);
    screen.position.set(x, h * 0.65, z + d / 2 + 0.01);
    group.add(screen);
    for (let k = 0; k < 3; k++) {
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), k === 1 ? orangeGlow : screenMat);
      led.position.set(x - w * 0.3 + k * 0.3, h * 0.3, z + d / 2 + 0.05);
      group.add(led);
    }
  }

  // pipes along the back wall
  for (const [y, r] of [
    [4, 0.22],
    [5.2, 0.14],
    [7.5, 0.3],
  ]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 56, 10), y > 6 ? rust : steel);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, y, -19);
    group.add(pipe);
  }
  for (const x of [-10, 6, 18]) {
    const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 8, 10), steel);
    drop.position.set(x, 4, -18.6);
    group.add(drop);
    const valve = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 6, 12), rust);
    valve.position.set(x, 2.4, -18.3);
    group.add(valve);
  }
  const vents = [new THREE.Vector3(-10, 0.6, -18.2), new THREE.Vector3(18, 0.6, -18.2)];

  // barrels
  const barrelGeo = new THREE.CylinderGeometry(0.4, 0.4, 1.0, 14);
  const barrelMats = [rust, yellow, steel];
  const barrels = scatter({ count: 16, minR: 0.9, maxR: 1.1, zRange: [-16, -4.5], xRange: [-24, 24], rng, padZ: 4 });
  barrels.forEach((b, i) => {
    const m = new THREE.Mesh(barrelGeo, barrelMats[i % 3]);
    const tipped = rng() > 0.7;
    m.position.set(b.x, tipped ? 0.4 : 0.5, b.z);
    if (tipped) m.rotation.z = Math.PI / 2;
    m.rotation.y = b.r;
    m.castShadow = true;
    group.add(m);
  });
  // gears leaning around
  const gearMat = rust;
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    const r = 0.8 + rng() * 0.8;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.18, 8, 24), gearMat);
    g.add(ring);
    for (let k = 0; k < 6; k++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.15, r * 2, 0.12), gearMat);
      spoke.rotation.z = (k / 6) * Math.PI;
      g.add(spoke);
    }
    for (let k = 0; k < 12; k++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.3, 0.2), gearMat);
      const a = (k / 12) * Math.PI * 2;
      tooth.position.set(Math.cos(a) * (r + 0.25), Math.sin(a) * (r + 0.25), 0);
      tooth.rotation.z = a;
      g.add(tooth);
    }
    g.position.set(-26 + i * 14 + rng() * 3, r + 0.2, -17.5);
    g.rotation.x = -0.25;
    g.traverse((o) => (o.castShadow = true));
    group.add(g);
  }
  // scrap piles: heaps of random boxes
  const scrapMat = new THREE.MeshStandardMaterial({ color: 0x4a4f54, metalness: 0.7, roughness: 0.5, flatShading: true });
  const scrapGeo = new THREE.BoxGeometry(1, 1, 1);
  const scraps = scatter({ count: 120, minR: 0.2, maxR: 0.9, zRange: [-17, -4], xRange: [-28, 28], rng, padZ: 4 });
  const scrapMesh = new THREE.InstancedMesh(scrapGeo, scrapMat, scraps.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  scraps.forEach((s, i) => {
    e.set(rng() * 0.8, s.r, rng() * 0.8);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(s.x, s.s * 0.4, s.z), q, new THREE.Vector3(s.s, s.s * 0.5, s.s * (0.5 + rng())));
    scrapMesh.setMatrixAt(i, m4);
  });
  scrapMesh.castShadow = true;
  group.add(scrapMesh);

  // embers & smoke motes
  const embers = new Motes({
    count: 220,
    box: { x: 0, y: 4, z: -4, w: 40, h: 9, d: 20 },
    color: 0xff9a3a,
    size: 0.14,
    opacity: 0.8,
    additive: true,
    velocity: new THREE.Vector3(0.2, 0.7, 0),
    jitter: 0.8,
    texture: sparkTexture(),
  });
  group.add(embers.points);
  const smog = new Motes({
    count: 50,
    box: { x: 0, y: 5, z: -8, w: 60, h: 8, d: 24 },
    color: 0x8fb4bc,
    size: 9,
    opacity: 0.05,
    velocity: new THREE.Vector3(0.4, 0.2, 0),
    jitter: 0.3,
  });
  group.add(smog.points);

  const weldPos = new THREE.Vector3(12, 4.2, -12);
  const weldLight = new THREE.PointLight(0x9fe8ff, 0, 12, 2);
  weldLight.position.copy(weldPos);
  group.add(weldLight);
  let weldTimer = 2;
  let weldOn = 0;
  let steamTimer = 0;
  let smokeTimer = 0;
  let trolleyDir = 1;

  return {
    group,
    sun,
    exposure: 1.0,
    bloom: { strength: 0.75, threshold: 0.85, radius: 0.55 },
    fog: new THREE.Fog(0x07141a, 10, 70),
    background: new THREE.Color(0x07141a),
    dustColor: 0x8a8f94,
    update(dt: number, time: number, fx: FX) {
      embers.update(dt);
      smog.update(dt);
      // furnace flicker
      furnaceLight.intensity = 55 + Math.sin(time * 9.3) * 8 + Math.sin(time * 23.7) * 5 + Math.random() * 4;
      orangeGlow.emissiveIntensity = 3.6 + Math.sin(time * 7) * 0.6;
      // lamps buzz
      lampMat.emissiveIntensity = 3.3 + (Math.random() < 0.02 ? -1.5 : 0) + Math.sin(time * 40) * 0.1;
      // crane trolley
      trolley.position.x += trolleyDir * dt * 0.6;
      if (trolley.position.x > 8) trolleyDir = -1;
      if (trolley.position.x < -8) trolleyDir = 1;
      hookGroup.rotation.z = Math.sin(time * 0.9) * 0.08 * trolleyDir;
      hookGroup.rotation.x = Math.sin(time * 0.7 + 1) * 0.05;
      // welding sparks
      weldTimer -= dt;
      if (weldTimer <= 0) {
        weldOn = 0.5 + Math.random() * 0.8;
        weldTimer = 2.5 + Math.random() * 4;
      }
      if (weldOn > 0) {
        weldOn -= dt;
        weldLight.intensity = 40 + Math.random() * 60;
        if (Math.random() < 0.7) fx.embers(weldPos, 4, 0xffd080);
        if (Math.random() < 0.3) fx.hitSparks(weldPos, 0xbff6ff, 3, 0.4);
      } else {
        weldLight.intensity *= 0.6;
      }
      // steam vents
      steamTimer -= dt;
      if (steamTimer <= 0) {
        steamTimer = 0.05;
        const v = vents[Math.floor(time / 4) % 2];
        if ((time % 4) < 1.4) fx.steam(new THREE.Vector3(v.x, v.y, v.z + 0.3), 2, 0xcfe4ea, 0.6);
      }
      // stack smoke
      smokeTimer -= dt;
      if (smokeTimer <= 0) {
        smokeTimer = 0.12;
        fx.steam(stackTop, 1, 0x555a5e, 1.6);
        if (Math.random() < 0.5) fx.steam(stackTop2, 1, 0x6a6e70, 1.2);
      }
    },
    dispose() {
      disposeGroup(group);
    },
  };
}
