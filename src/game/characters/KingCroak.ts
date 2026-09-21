import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CharacterFXHooks, CharacterRig, Pose, kf, pulse, shiver, smooth } from "../Rig";
import { makeRng, metalTexture, toadGlowTexture, toadSkinTexture } from "../textures";
import { capsuleDown, ellipsoid } from "../geom";

const tmp = new THREE.Vector3();
/** rest scale of the tongue group along its length (hidden inside the mouth) */
const TONGUE_REST = 0.03;

export class KingCroak extends CharacterRig {
  readonly accent = 0x8dff5a;
  readonly sparkColor = 0xb8ff80;
  private glowMat: THREE.MeshBasicMaterial;
  private glowLight: THREE.PointLight;
  private padMat: THREE.MeshStandardMaterial;
  private tongue: THREE.Group;
  private tongueTipMesh: THREE.Mesh;
  private tongueTip = new THREE.Object3D();
  private mouth = new THREE.Object3D();
  private chest = new THREE.Object3D();
  private lids: THREE.Object3D[] = [];
  private fly: THREE.Group;
  private flyWings: THREE.Mesh[] = [];
  private flySeed = Math.random() * 10;
  /** eye openness requested by the current animation (1 = normal, >1 = wide) */
  private lidOpen = 1;
  private blinkTimer = 2;
  private blink = 0;
  private blinkPhase = 0;
  private wispTimer = 0;
  private sparkTimer = 0;

  constructor() {
    super();
    const skinTex = toadSkinTexture();
    const glowTex = toadGlowTexture();
    const skin = new THREE.MeshPhysicalMaterial({ map: skinTex, color: 0xdfe8c8, roughness: 0.5, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.25 });
    const belly = new THREE.MeshPhysicalMaterial({ color: 0xe6dfae, roughness: 0.55, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    const sacMat = new THREE.MeshPhysicalMaterial({ color: 0xf0e2b0, roughness: 0.45, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.2 });
    const pinkMat = new THREE.MeshPhysicalMaterial({ color: 0xe0537f, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a2412, roughness: 0.7 });
    const irisMat = new THREE.MeshStandardMaterial({ color: 0xf0b62e, emissive: 0xb07a10, emissiveIntensity: 0.5, roughness: 0.25 });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2 });
    const shineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.3 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xd2a93c, map: metalTexture(), metalness: 0.85, roughness: 0.5, side: THREE.DoubleSide });
    const padMat = (this.padMat = new THREE.MeshStandardMaterial({ color: 0x2f4a1a, emissive: 0x8dff5a, emissiveIntensity: 1.6, roughness: 0.4 }));
    const glowMat = (this.glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      color: 0x8dff5a,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this.registerFlash([skin, belly, sacMat, pinkMat, darkMat, crownMat]);

    const sph = (r: number, m: THREE.Material, ws = 14, hs = 10) => new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m);
    const rbox = (w: number, h: number, d: number, m: THREE.Material, r = 0.03) =>
      new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, Math.min(w, h, d) / 2)), m);
    const cap = (r: number, len: number, m: THREE.Material) => new THREE.Mesh(capsuleDown(r, len), m);
    const glowShells: THREE.Mesh[] = [];
    const glowShell = (geo: THREE.BufferGeometry) => {
      const g = new THREE.Mesh(geo, glowMat);
      g.scale.setScalar(1.012);
      glowShells.push(g);
      return g;
    };

    /* ---------------- body ---------------- */
    const hips = new THREE.Group();
    hips.position.set(0, 0.62, 0);
    this.joint("hips", hips, this.root);
    const body = new THREE.Group();
    this.joint("body", body, hips);

    const bodyGeo = ellipsoid(0, 0.08, -0.05, 0.72, 0.52, 0.78, 32, 20);
    body.add(new THREE.Mesh(bodyGeo, skin));
    body.add(glowShell(bodyGeo));
    body.add(new THREE.Mesh(ellipsoid(0, -0.04, 0.12, 0.62, 0.44, 0.7, 24, 16), belly));
    // warty back bumps
    const rng = makeRng(99);
    const bumps = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), skin, 44);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s3 = new THREE.Vector3();
    for (let i = 0; i < 44; i++) {
      const th = rng() * Math.PI * 2;
      const u = 0.15 + rng() * 0.8;
      const rr = Math.sqrt(1 - u * u);
      v.set(rr * Math.cos(th) * 0.72, 0.08 + u * 0.52, -0.05 + rr * Math.sin(th) * 0.78);
      const s = 0.035 + rng() * 0.05;
      s3.set(s, s * 0.7, s);
      m4.compose(v, q, s3);
      bumps.setMatrixAt(i, m4);
    }
    body.add(bumps);
    this.chest.position.set(0, 0.15, 0.1);
    body.add(this.chest);
    this.glowLight = new THREE.PointLight(0x8dff5a, 3, 3.5, 2);
    this.glowLight.position.set(0, 0.5, -0.1);
    body.add(this.glowLight);

    /* ---------------- head ---------------- */
    const head = new THREE.Group();
    head.position.set(0, 0.36, 0.42);
    this.joint("head", head, body);
    const headGeo = ellipsoid(0, 0.05, 0.1, 0.62, 0.36, 0.5, 32, 18);
    head.add(new THREE.Mesh(headGeo, skin));
    head.add(glowShell(headGeo));
    head.add(new THREE.Mesh(ellipsoid(0, -0.1, 0.12, 0.56, 0.24, 0.46, 24, 14), belly));

    // mouth line
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 12; k++) {
      const a = (k / 12 - 0.5) * 1.7;
      pts.push(new THREE.Vector3(Math.sin(a) * 0.545, -0.13 + Math.abs(a) * 0.04, 0.1 + Math.cos(a) * 0.445));
    }
    head.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.018, 6, false), darkMat));
    for (const sx of [-1, 1]) {
      const n = sph(0.02, darkMat, 6, 5);
      n.position.set(sx * 0.1, 0.16, 0.58);
      head.add(n);
    }

    // eyes: mound, golden eyeball, slit pupil, shine, heavy eyelid
    for (const sx of [-1, 1]) {
      head.add(new THREE.Mesh(ellipsoid(sx * 0.36, 0.2, 0.06, 0.22, 0.14, 0.22, 16, 10), skin));
      const eyeG = new THREE.Group();
      eyeG.position.set(sx * 0.36, 0.3, 0.1);
      head.add(eyeG);
      eyeG.add(sph(0.17, irisMat, 20, 14));
      const pupil = rbox(0.16, 0.05, 0.03, pupilMat, 0.015);
      pupil.position.set(0, 0, 0.165);
      eyeG.add(pupil);
      const sh = sph(0.035, shineMat, 8, 6);
      sh.position.set(-sx * 0.06, 0.07, 0.15);
      eyeG.add(sh);
      const lid = new THREE.Group();
      lid.rotation.x = -0.35;
      lid.add(new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), skin));
      eyeG.add(lid);
      this.lids.push(lid);
    }

    // jaw, throat sac
    const jaw = new THREE.Group();
    jaw.position.set(0, -0.16, 0.1);
    this.joint("jaw", jaw, head);
    jaw.add(new THREE.Mesh(ellipsoid(0, -0.04, 0.04, 0.55, 0.13, 0.47, 24, 12), belly));
    jaw.add(new THREE.Mesh(ellipsoid(0, 0.05, 0.08, 0.48, 0.05, 0.4, 20, 8), darkMat));
    const sac = new THREE.Group();
    sac.position.set(0, -0.32, 0.22);
    this.joint("sac", sac, head);
    sac.add(sph(0.22, sacMat, 18, 14));

    // crown
    const crown = new THREE.Group();
    crown.position.set(0, 0.36, -0.02);
    crown.rotation.set(-0.1, 0, 0.2);
    crown.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.11, 8, 1, true), crownMat));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 5), crownMat);
      spike.position.set(Math.cos(a) * 0.145, 0.1, Math.sin(a) * 0.145);
      if (k === 2) {
        spike.rotation.z = 0.9;
        spike.position.y = 0.07;
      }
      crown.add(spike);
    }
    const jewel = sph(0.03, pinkMat, 8, 6);
    jewel.position.set(0, 0.02, 0.15);
    crown.add(jewel);
    head.add(crown);

    // tongue (scaled along +Z by the pose system; tip mesh is counter-scaled in tick)
    const tongue = (this.tongue = new THREE.Group());
    tongue.position.set(0, -0.12, 0.42);
    tongue.scale.z = TONGUE_REST;
    this.joint("tongue", tongue, head);
    const shaftGeo = new THREE.CylinderGeometry(0.045, 0.06, 1, 10);
    shaftGeo.rotateX(Math.PI / 2);
    shaftGeo.translate(0, 0, 0.5);
    tongue.add(new THREE.Mesh(shaftGeo, pinkMat));
    this.tongueTipMesh = sph(0.085, pinkMat, 12, 9);
    this.tongueTipMesh.position.z = 1;
    tongue.add(this.tongueTipMesh);
    this.tongueTip.position.z = 1;
    tongue.add(this.tongueTip);
    this.mouth.position.set(0, -0.1, 0.5);
    head.add(this.mouth);
    this.instant.add("tongue");
    this.instant.add("jaw");
    this.instant.add("sac");

    /* ---------------- front legs ---------------- */
    const buildArm = (side: number) => {
      const S = side > 0 ? "L" : "R";
      const arm = new THREE.Group();
      arm.position.set(side * 0.56, -0.05, 0.42);
      arm.rotation.x = -0.15;
      arm.rotation.z = side * 0.15;
      this.joint("arm" + S, arm, hips);
      arm.add(cap(0.1, 0.3, skin));
      const elbow = new THREE.Group();
      elbow.position.set(0, -0.3, 0);
      elbow.rotation.x = 0.12;
      this.joint("elbow" + S, elbow, arm);
      elbow.add(cap(0.08, 0.26, skin));
      const hand = new THREE.Group();
      hand.position.set(0, -0.27, 0.02);
      elbow.add(hand);
      const palm = rbox(0.2, 0.05, 0.2, skin, 0.02);
      palm.position.set(0, 0, 0.06);
      hand.add(palm);
      for (let k = -1; k <= 1; k++) {
        const toe = new THREE.Group();
        toe.rotation.y = k * 0.55;
        hand.add(toe);
        const tg = new THREE.CapsuleGeometry(0.03, 0.16, 3, 8);
        tg.rotateX(Math.PI / 2);
        tg.translate(0, 0, 0.16);
        toe.add(new THREE.Mesh(tg, skin));
        const pad = sph(0.04, padMat, 8, 6);
        pad.position.set(0, 0, 0.27);
        toe.add(pad);
      }
    };
    buildArm(1);
    buildArm(-1);

    /* ---------------- hind legs (folded frog sit) ---------------- */
    const buildLeg = (side: number) => {
      const S = side > 0 ? "L" : "R";
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.58, 0.02, -0.28);
      thigh.rotation.x = 1.9;
      thigh.rotation.z = side * 0.2;
      this.joint("thigh" + S, thigh, hips);
      thigh.add(cap(0.17, 0.42, skin));
      const knee = new THREE.Group();
      knee.position.set(0, -0.42, 0);
      knee.rotation.x = -2.62;
      this.joint("knee" + S, knee, thigh);
      knee.add(sph(0.14, skin, 12, 9));
      knee.add(cap(0.1, 1.0, skin));
      const ankle = new THREE.Group();
      ankle.position.set(0, -1.0, 0);
      ankle.rotation.x = -0.85;
      this.joint("ankle" + S, ankle, knee);
      const foot = rbox(0.2, 0.42, 0.06, skin, 0.03);
      foot.position.set(0, -0.2, 0.02);
      ankle.add(foot);
      for (let k = -1; k <= 1; k++) {
        const toe = new THREE.Group();
        toe.position.set(0, -0.4, 0.02);
        toe.rotation.z = k * 0.45;
        ankle.add(toe);
        toe.add(cap(0.03, 0.2, skin));
        const pad = sph(0.045, padMat, 8, 6);
        pad.position.set(0, -0.26, 0);
        toe.add(pad);
      }
    };
    buildLeg(1);
    buildLeg(-1);

    /* ---------------- pet fly ---------------- */
    const fly = (this.fly = new THREE.Group());
    fly.add(sph(0.028, darkMat, 8, 6));
    const wingGeo = new THREE.PlaneGeometry(0.06, 0.03);
    const wingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(wingGeo, wingMat);
      w.position.set(sx * 0.035, 0.015, 0);
      w.rotation.x = -Math.PI / 2;
      fly.add(w);
      this.flyWings.push(w);
    }
    this.root.add(fly);

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    for (const g of glowShells) g.castShadow = false;
    for (const w of this.flyWings) w.castShadow = false;

    this.defineAnims();
  }

  /* ------------------------------------------------------------------ */

  private defineAnims() {
    const A = this.anims;
    const B = this.blendSpeed;
    /** k = 1 fully extended (kick / leap), 0 folded sit, negative = tucked */
    const legsExt = (p: Pose, k: number, rz = 0) => {
      p.thighL = { rx: -1.1 * k, rz };
      p.thighR = { rx: -1.1 * k, rz: -rz };
      p.kneeL = { rx: 2.6 * k };
      p.kneeR = { rx: 2.6 * k };
      p.ankleL = { rx: 1.1 * k };
      p.ankleR = { rx: 1.1 * k };
    };
    const arms = (p: Pose, rx: number, rz = 0, el = 0) => {
      p.armL = { rx, rz };
      p.armR = { rx, rz: -rz };
      p.elbowL = { rx: el };
      p.elbowR = { rx: el };
    };
    const tongue = (p: Pose, len: number, ry = 0) => {
      p.tongue = { sz: Math.max(len, 0.02) / TONGUE_REST, ry };
    };

    A.idle = (t, p) => {
      const br = Math.sin(t * 2.6);
      const croak = pulse(t % 7.1, 2.0, 2.35, 3.1);
      const snap = pulse(t % 6.3, 4.0, 4.06, 4.3);
      p.hips = { py: 0.012 * br };
      p.body = { sy: 1 + 0.02 * br, sx: 1 + 0.01 * br };
      p.head = { ry: 0.25 * Math.sin(t * 0.5), rx: -0.06 * croak + 0.03 * br - 0.12 * snap };
      p.sac = { s: 1 + 0.12 * Math.sin(t * 3.3) + 0.9 * croak };
      p.jaw = { rx: 0.28 * croak + 0.35 * snap };
      tongue(p, 1.6 * snap);
      arms(p, 0.03 * br);
      p.thighL = { rx: 0.02 * br };
      p.thighR = { rx: -0.02 * br };
      this.lidOpen = 1;
      this.charge = 0;
    };
    B.idle = 6;

    const hopCycle = (p: Pose, phi: number, back: boolean) => {
      const s = Math.sin(phi);
      const hop = Math.max(0, s);
      const push = Math.max(0, Math.sin(phi - 0.5));
      const land = Math.max(0, -s);
      p.hips = { py: 0.24 * hop - 0.05 * land, rx: (back ? 0.15 : -0.18) * hop + 0.06 * land };
      legsExt(p, 0.9 * push - 0.15 * land);
      arms(p, -0.7 * hop + 0.15 * land, 0.2 * hop);
      p.body = { sy: 1 - 0.06 * land + 0.03 * hop };
      p.head = { rx: 0.1 * hop };
      p.sac = { s: 1 + 0.05 * Math.sin(phi * 2) };
      this.lidOpen = 1;
    };
    A.walkF = (t, p) => hopCycle(p, t * 6.5, false);
    A.walkB = (t, p) => hopCycle(p, t * 5.5, true);
    B.walkF = 11;
    B.walkB = 11;

    A.jump = (_t, p, c) => {
      const u = smooth((-c.vy + 3) / 7);
      legsExt(p, 1 - u - 0.3 * u, 0.3 * u);
      arms(p, -1.3 * (1 - u) - 0.4 * u, 0.5 * u, -0.4 * u);
      p.hips = { rx: -0.25 * (1 - u) + 0.2 * u };
      p.head = { rx: 0.1 * (1 - u) };
      this.lidOpen = 1.2;
    };
    B.jump = 12;

    A.block = (_t, p) => {
      arms(p, -2.1, 0.1, -1.0);
      p.head = { rx: 0.25 };
      p.hips = { py: -0.1 };
      p.body = { sy: 0.95, sx: 1.03 };
      p.sac = { s: 0.85 };
      this.lidOpen = 0.45;
    };
    B.block = 16;

    // Tongue Lash
    A.light = (t, p) => {
      const len = kf(t, [
        [0, 0],
        [0.05, 0.15],
        [0.12, 2.1],
        [0.22, 2.1],
        [0.34, 0],
      ]);
      tongue(p, len);
      const lunge = pulse(t, 0.02, 0.12, 0.4);
      p.jaw = {
        rx: kf(t, [
          [0, 0],
          [0.06, 0.45],
          [0.24, 0.35],
          [0.4, 0],
        ]),
      };
      p.head = { rx: -0.12 * lunge, pz: 0.1 * lunge };
      p.hips = { pz: 0.08 * lunge, rx: -0.06 * lunge };
      arms(p, -0.3 * lunge);
      p.sac = { s: 1 - 0.15 * lunge };
      this.lidOpen = 1.25;
    };
    B.light = 26;

    // Gullet Toss (command grab)
    A.heavy = (t, p) => {
      const len = kf(t, [
        [0, 0],
        [0.18, 0],
        [0.3, 1.95],
        [0.42, 1.95],
        [0.8, 0.55],
        [0.98, 0.55],
        [1.15, 0],
      ]);
      tongue(p, len);
      const wind = pulse(t, 0, 0.18, 0.32);
      const rear = kf(t, [
        [0.42, 0],
        [0.8, 0.6],
        [0.9, 1],
        [1.05, 1],
        [1.15, 0],
      ]);
      const fling = pulse(t, 0.82, 0.92, 1.1);
      p.hips = { py: -0.12 * wind + 0.22 * rear, pz: -0.1 * wind + 0.05 * rear, rx: 0.1 * wind - 0.35 * rear };
      p.head = { rx: 0.15 * wind - 0.55 * fling - 0.15 * rear, pz: 0.05 };
      p.jaw = {
        rx: kf(t, [
          [0.18, 0],
          [0.3, 0.6],
          [0.8, 0.5],
          [0.92, 0.7],
          [1.15, 0],
        ]),
      };
      arms(p, -0.4 * rear - 0.9 * fling, 0.3 * fling, -0.5 * rear);
      legsExt(p, 0.35 * rear);
      p.sac = { s: 1 + 0.4 * rear };
      p.body = { sy: 1 + 0.05 * rear };
      this.lidOpen = 1.3;
    };
    B.heavy = 18;

    // Toxic Croak
    A.special = (t, p) => {
      const inhale = kf(t, [
        [0, 0],
        [0.5, 1],
        [0.55, 1],
        [0.62, 0.15],
        [1.0, 0.1],
        [1.35, 0],
      ]);
      const belch = pulse(t, 0.5, 0.58, 0.95);
      this.charge = kf(t, [
        [0, 0],
        [0.5, 1],
        [0.6, 0.5],
        [1.2, 0],
      ]);
      p.sac = { s: 1 + 1.6 * inhale };
      p.body = { sy: 1 + 0.12 * inhale, sx: 1 + 0.08 * inhale, sz: 1 + 0.06 * inhale };
      p.head = { rx: -0.35 * inhale + 0.25 * belch, pz: 0.14 * belch, py: 0.04 * inhale };
      p.jaw = { rx: 0.75 * belch };
      p.hips = { py: 0.06 * inhale - 0.06 * belch, pz: 0.12 * belch, rx: -0.1 * inhale + 0.15 * belch };
      arms(p, -0.5 * inhale - 0.2 * belch, 0.25 * inhale);
      p.thighL = { rx: 0.15 * inhale };
      p.thighR = { rx: 0.15 * inhale };
      this.lidOpen = 1 - 0.6 * inhale + 0.5 * belch;
    };
    B.special = 14;

    // Royal Belly Flop
    A.air = (t, p) => {
      const u = smooth(t / 0.12);
      arms(p, -1.4 * u, 1.0 * u, -0.3 * u);
      legsExt(p, 0.7 * u, 0.6 * u);
      p.hips = { rx: 0.4 * u };
      p.sac = { s: 1 + 0.5 * u };
      p.body = { sy: 1 + 0.06 * u, sx: 1 + 0.05 * u };
      p.head = { rx: -0.2 * u };
      this.lidOpen = 1.3;
    };
    B.air = 18;

    A.hit = (t, p) => {
      const e = Math.exp(-t * 5);
      const s = shiver(t, 26, 8);
      p.head = { rx: -0.35 * e, rz: 0.1 * s };
      p.hips = { pz: -0.1 * e, rz: 0.05 * s, py: -0.04 * e };
      p.body = { sx: 1 + 0.06 * e * Math.cos(t * 30), sy: 1 - 0.05 * e * Math.cos(t * 30) };
      arms(p, -0.9 * e, 0.4 * e);
      p.jaw = { rx: 0.4 * e };
      tongue(p, 0.35 * e);
      p.sac = { s: 1 - 0.2 * e };
      this.lidOpen = 1.3;
    };
    B.hit = 22;

    A.launched = (t, p) => {
      const s = Math.sin(t * 14);
      p.hips = { rx: -0.6 };
      arms(p, -1.8 + 0.3 * s, 0.6, -0.3);
      legsExt(p, 0.6 + 0.3 * s);
      p.jaw = { rx: 0.5 };
      tongue(p, 0.5);
      p.head = { rx: -0.2 };
      this.lidOpen = 1.35;
    };
    B.launched = 9;

    const lying = (t: number, p: Pose, limp: number) => {
      const k = 1 - limp;
      p.hips = { py: 0.05, rz: -2.7, rx: -0.2 };
      arms(p, -1.2 + 0.2 * Math.sin(t * 5) * k, 0.5, -0.6);
      legsExt(p, 0.3 + 0.15 * Math.sin(t * 4 + 1) * k);
      p.head = { rx: -0.3, ry: 0.2 * limp };
      p.jaw = { rx: 0.35 + 0.2 * limp };
      tongue(p, 0.35 + 0.45 * limp, 0.5 * limp);
      p.sac = { s: 1 + 0.08 * Math.sin(t * 3) * k - 0.2 * limp };
      this.lidOpen = limp > 0.5 ? 0.05 : 0.7;
    };
    A.down = (t, p) => lying(t, p, 0);
    A.ko = (t, p) => lying(t, p, 1);
    B.down = 9;
    B.ko = 6;

    A.getup = (t, p) => {
      const u = smooth(t / 0.5);
      p.hips = { py: 0.05 * (1 - u), rz: -1.2 * (1 - u), rx: -0.2 * (1 - u) };
      arms(p, -0.6 * (1 - u), 0.3 * (1 - u));
      legsExt(p, 0.2 * (1 - u));
      p.head = { rx: -0.15 * (1 - u) };
      this.lidOpen = 1;
    };
    B.getup = 8;

    A.victory = (t, p) => {
      const hop = Math.abs(Math.sin(t * 6.5));
      const s = Math.sin(t * 6.5);
      const croak = pulse(t % 2.4, 0.3, 0.6, 1.4);
      p.hips = { py: 0.22 * hop, rx: -0.1 * hop };
      legsExt(p, 0.8 * Math.max(0, s));
      arms(p, -1.6 * croak - 0.6 * hop, 0.5 * croak, -0.4);
      p.sac = { s: 1 + 1.1 * croak };
      p.jaw = { rx: 0.5 * croak };
      p.head = { rx: -0.3 * croak, ry: 0.15 * Math.sin(t * 2) };
      tongue(p, 1.2 * pulse(t % 2.4, 1.6, 1.66, 1.9));
      this.lidOpen = 1.1;
    };
    B.victory = 10;

    A.intro = (t, p) => {
      const sleepy = kf(t, [
        [0, 1],
        [0.9, 1],
        [1.1, 0],
      ]);
      const croak = pulse(t, 1.15, 1.5, 2.1);
      const snap = pulse(t, 2.1, 2.16, 2.4);
      p.hips = { py: -0.12 * sleepy };
      p.head = { rx: 0.15 * sleepy - 0.25 * croak - 0.1 * snap, ry: 0.1 * Math.sin(t * 3) * (1 - sleepy) };
      p.sac = { s: 1 + 1.4 * croak + 0.1 * Math.sin(t * 3) };
      p.jaw = { rx: 0.45 * croak + 0.35 * snap };
      tongue(p, 1.7 * snap);
      arms(p, -0.2 * croak);
      this.lidOpen = 0.35 * sleepy + 1.1 * (1 - sleepy);
      this.charge = croak * 0.5;
    };
    B.intro = 7;
  }

  /* ------------------------------------------------------------------ */

  chestWorld(out: THREE.Vector3) {
    return this.chest.getWorldPosition(out);
  }

  strikeWorld(move: string, out: THREE.Vector3) {
    switch (move) {
      case "light":
      case "heavy":
        return this.tongueTip.getWorldPosition(out);
      case "special":
        return this.mouth.getWorldPosition(out);
      default:
        return this.chestWorld(out);
    }
  }

  grabAnchorWorld(out: THREE.Vector3) {
    return this.tongueTip.getWorldPosition(out);
  }

  tick(dt: number, time: number, fx: CharacterFXHooks | null, state: string) {
    const c = this.charge;
    const g = 0.55 + 0.35 * Math.sin(time * 2.1) + c * 2.2;
    this.glowMat.color.setHex(0x8dff5a).multiplyScalar(g);
    this.glowLight.intensity = 2.5 + 1.5 * Math.sin(time * 2.1) + c * 16;
    this.padMat.emissiveIntensity = 1.2 + 0.6 * Math.sin(time * 2.1 + 1) + c * 3;

    // keep the tongue tip round while the shaft stretches
    const sz = Math.max(0.01, this.tongue.scale.z);
    this.tongueTipMesh.scale.set(1, 1, 1 / sz);

    // blinking eyelids
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkPhase === 0) {
      this.blinkPhase = 1;
      this.blinkTimer = 2.2 + Math.random() * 3.5;
    }
    if (this.blinkPhase === 1) {
      this.blink = Math.min(1, this.blink + dt / 0.06);
      if (this.blink >= 1) this.blinkPhase = 2;
    } else if (this.blinkPhase === 2) {
      this.blink = Math.max(0, this.blink - dt / 0.1);
      if (this.blink <= 0) this.blinkPhase = 0;
    }
    const open = Math.max(0, this.lidOpen * (1 - this.blink));
    const rot = open >= 1 ? -0.35 - (open - 1) * 0.5 : -0.35 + (1 - open) * 1.55;
    const k = 1 - Math.exp(-dt * 30);
    for (const l of this.lids) l.rotation.x += (rot - l.rotation.x) * k;

    // the fly
    const ft = time + this.flySeed;
    this.fly.position.set(Math.sin(ft * 2.3) * 0.55, 1.45 + Math.sin(ft * 6.1) * 0.12, 0.55 + Math.cos(ft * 1.7) * 0.45);
    this.fly.rotation.y = ft * 2.3 + Math.PI / 2;
    const flap = Math.sin(time * 90) * 0.5;
    this.flyWings[0].rotation.z = 0.5 + flap;
    this.flyWings[1].rotation.z = -0.5 - flap;

    if (!fx) return;
    this.wispTimer -= dt;
    if (c > 0.25 && this.wispTimer <= 0) {
      this.wispTimer = 0.05;
      this.mouth.getWorldPosition(tmp);
      fx.steam(tmp, 1, 0x7ddf50, 0.3);
      if (Math.random() < 0.5) fx.embers(tmp, 1, 0xb8ff80);
    }
    if (state === "ko") {
      this.sparkTimer -= dt;
      if (this.sparkTimer <= 0) {
        this.sparkTimer = 0.5 + Math.random();
        this.chestWorld(tmp);
        fx.steam(tmp, 1, 0x88b070, 0.4);
      }
    }
  }
}
