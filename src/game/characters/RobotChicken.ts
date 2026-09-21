import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CharacterFXHooks, CharacterRig, JointPose, Pose, kf, pulse, shiver, smooth } from "../Rig";
import { metalTexture } from "../textures";

const tmp = new THREE.Vector3();

export class RobotChicken extends CharacterRig {
  readonly accent = 0x38e8ff;
  readonly sparkColor = 0x5df6ff;
  private neon: THREE.MeshStandardMaterial;
  private eyeMat: THREE.MeshStandardMaterial;
  private chestLight: THREE.PointLight;
  private vents: THREE.Object3D[] = [];
  private beakTip = new THREE.Object3D();
  private eyeCenter = new THREE.Object3D();
  private footR = new THREE.Object3D();
  private footL = new THREE.Object3D();
  private chest = new THREE.Object3D();
  private steamTimer = 0;
  private sparkTimer = 0;

  constructor() {
    super();
    const metalTex = metalTexture();
    const metal = new THREE.MeshStandardMaterial({
      color: 0xc3cbd2,
      map: metalTex,
      roughnessMap: metalTex,
      metalness: 0.85,
      roughness: 0.5,
    });
    const plate = new THREE.MeshStandardMaterial({
      color: 0x9aa4ac,
      map: metalTex,
      metalness: 0.9,
      roughness: 0.42,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a3036, metalness: 0.8, roughness: 0.55 });
    const neon = (this.neon = new THREE.MeshStandardMaterial({
      color: 0x083640,
      emissive: 0x28e8ff,
      emissiveIntensity: 2.6,
      roughness: 0.3,
      metalness: 0.1,
    }));
    const eyeMat = (this.eyeMat = new THREE.MeshStandardMaterial({
      color: 0x0a3d48,
      emissive: 0x4ef4ff,
      emissiveIntensity: 3.5,
      roughness: 0.2,
    }));
    const red = new THREE.MeshStandardMaterial({ color: 0xd63a2f, roughness: 0.5, metalness: 0.35 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.35, metalness: 0.8 });
    this.registerFlash([metal, plate, dark, red, gold]);

    const rbox = (w: number, h: number, d: number, m: THREE.Material, r = 0.05) => {
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, Math.min(w, h, d) / 2)), m);
      return mesh;
    };
    const cyl = (rt: number, rb: number, h: number, m: THREE.Material, seg = 14) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
    const sph = (r: number, m: THREE.Material, ws = 14, hs = 10) => new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m);
    const torus = (r: number, t: number, m: THREE.Material) => new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, 24), m);
    const capsuleDown = (r: number, len: number, m: THREE.Material) => {
      const g = new THREE.CapsuleGeometry(r, len, 4, 12);
      g.translate(0, -len / 2, 0);
      return new THREE.Mesh(g, m);
    };

    /* ---------------- hips & body ---------------- */
    const hips = new THREE.Group();
    hips.position.set(0, 0.95, 0);
    this.joint("hips", hips, this.root);

    const body = new THREE.Group();
    body.position.set(0, 0.42, 0.02);
    body.rotation.x = 0.1;
    this.joint("body", body, hips);

    const chassis = rbox(0.74, 0.62, 0.98, metal, 0.18);
    body.add(chassis);
    // belly plate
    const belly = rbox(0.6, 0.2, 0.8, dark, 0.08);
    belly.position.set(0, -0.28, 0.02);
    body.add(belly);
    // chest plate + core
    const chestPlate = rbox(0.56, 0.44, 0.16, plate, 0.08);
    chestPlate.position.set(0, -0.02, 0.5);
    body.add(chestPlate);
    const core = sph(0.1, neon);
    core.position.set(0, -0.02, 0.58);
    body.add(core);
    const coreRing = torus(0.16, 0.022, neon);
    coreRing.position.set(0, -0.02, 0.575);
    body.add(coreRing);
    this.chest.position.set(0, 0, 0.3);
    body.add(this.chest);
    // rivets
    const rivetGeo = new THREE.SphereGeometry(0.022, 6, 5);
    const rivets = new THREE.InstancedMesh(rivetGeo, dark, 22);
    const rm = new THREE.Matrix4();
    let ri = 0;
    const rivetAt = (x: number, y: number, z: number) => {
      rm.makeTranslation(x, y, z);
      rivets.setMatrixAt(ri++, rm);
    };
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) rivetAt(sx * 0.22, -0.02 + sy * 0.16, 0.585);
    for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) rivetAt(sx * 0.375, 0.2, -0.35 + k * 0.23);
    for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) rivetAt(sx * 0.3, 0.32, -0.36 + k * 0.18);
    rivets.count = ri;
    body.add(rivets);
    // side neon strips
    for (const sx of [-1, 1]) {
      const strip = rbox(0.02, 0.05, 0.62, neon, 0.01);
      strip.position.set(sx * 0.375, -0.06, -0.02);
      body.add(strip);
      // shoulder discs
      const disc = cyl(0.17, 0.17, 0.12, dark, 18);
      disc.rotation.z = Math.PI / 2;
      disc.position.set(sx * 0.4, 0.12, 0.08);
      body.add(disc);
      const ring = torus(0.17, 0.02, neon);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(sx * 0.46, 0.12, 0.08);
      body.add(ring);
      // top vents
      const vent = cyl(0.06, 0.075, 0.18, dark, 10);
      vent.position.set(sx * 0.16, 0.36, -0.22);
      body.add(vent);
      const ventTop = new THREE.Object3D();
      ventTop.position.set(sx * 0.16, 0.46, -0.22);
      body.add(ventTop);
      this.vents.push(ventTop);
    }
    // back armour plate
    const backPlate = rbox(0.5, 0.3, 0.2, plate, 0.06);
    backPlate.position.set(0, 0.1, -0.48);
    body.add(backPlate);
    // chest light
    this.chestLight = new THREE.PointLight(0x38e8ff, 6, 4.5, 2);
    this.chestLight.position.set(0, 0, 0.75);
    body.add(this.chestLight);

    /* ---------------- neck & head ---------------- */
    const neck = new THREE.Group();
    neck.position.set(0, 0.3, 0.4);
    neck.rotation.x = -0.15;
    this.joint("neck", neck, body);
    for (let i = 0; i < 3; i++) {
      const seg = cyl(0.085 - i * 0.008, 0.095 - i * 0.008, 0.12, i % 2 ? dark : metal, 12);
      seg.position.set(0, 0.07 + i * 0.13, i * 0.02);
      neck.add(seg);
      if (i === 1) {
        const r = torus(0.1, 0.014, neon);
        r.rotation.x = Math.PI / 2;
        r.position.set(0, 0.2, 0.02);
        neck.add(r);
      }
    }
    const head = new THREE.Group();
    head.position.set(0, 0.42, 0.06);
    head.rotation.x = 0.1;
    this.joint("head", head, neck);
    const skull = rbox(0.4, 0.38, 0.52, metal, 0.13);
    skull.position.set(0, 0.1, 0.08);
    head.add(skull);
    const brow = rbox(0.44, 0.09, 0.22, dark, 0.03);
    brow.position.set(0, 0.24, 0.26);
    brow.rotation.x = 0.35;
    head.add(brow);
    const cheekPlate = rbox(0.46, 0.2, 0.3, plate, 0.05);
    cheekPlate.position.set(0, 0.02, 0.08);
    head.add(cheekPlate);
    for (const sx of [-1, 1]) {
      const socket = cyl(0.075, 0.075, 0.06, dark, 12);
      socket.rotation.x = Math.PI / 2;
      socket.position.set(sx * 0.15, 0.12, 0.32);
      head.add(socket);
      const eye = sph(0.058, eyeMat, 12, 8);
      eye.scale.set(1, 0.75, 0.6);
      eye.position.set(sx * 0.15, 0.12, 0.35);
      head.add(eye);
      const earPlate = cyl(0.07, 0.07, 0.05, dark, 10);
      earPlate.rotation.z = Math.PI / 2;
      earPlate.position.set(sx * 0.21, 0.08, 0.0);
      head.add(earPlate);
      const earDot = sph(0.025, neon, 8, 6);
      earDot.position.set(sx * 0.235, 0.08, 0.0);
      head.add(earDot);
    }
    this.eyeCenter.position.set(0, 0.12, 0.36);
    head.add(this.eyeCenter);
    // beak
    const beakGeo = new THREE.ConeGeometry(0.11, 0.38, 4);
    beakGeo.rotateX(Math.PI / 2);
    beakGeo.translate(0, 0, 0.19);
    const beak = new THREE.Mesh(beakGeo, gold);
    beak.position.set(0, 0.02, 0.32);
    beak.rotation.z = Math.PI / 4;
    head.add(beak);
    this.beakTip.position.set(0, 0.02, 0.7);
    head.add(this.beakTip);
    const jaw = new THREE.Group();
    jaw.position.set(0, -0.05, 0.3);
    this.joint("jaw", jaw, head);
    const jawGeo = new THREE.ConeGeometry(0.08, 0.28, 4);
    jawGeo.rotateX(Math.PI / 2);
    jawGeo.translate(0, 0, 0.14);
    const jawMesh = new THREE.Mesh(jawGeo, gold);
    jawMesh.rotation.z = Math.PI / 4;
    jawMesh.rotation.x = 0.12;
    jaw.add(jawMesh);
    // wattle
    const wattle = sph(0.06, red, 10, 8);
    wattle.scale.set(0.8, 1.5, 0.7);
    wattle.position.set(0, -0.16, 0.24);
    head.add(wattle);
    // comb
    const combSpec = [
      [0.2, 0.13],
      [0.08, 0.2],
      [-0.04, 0.19],
      [-0.16, 0.15],
      [-0.26, 0.1],
    ];
    combSpec.forEach(([z, h]) => {
      const c = rbox(0.06, h, 0.11, red, 0.03);
      c.position.set(0, 0.3 + h / 2 - 0.02, z);
      c.rotation.x = -0.35;
      head.add(c);
    });

    /* ---------------- wings ---------------- */
    const buildWing = (side: number) => {
      const wing = new THREE.Group();
      wing.position.set(side * 0.42, 0.1, 0.1);
      wing.rotation.z = side * 0.12;
      this.joint(side > 0 ? "wingL" : "wingR", wing, body);
      const socket = sph(0.09, dark, 10, 8);
      wing.add(socket);
      for (let i = 0; i < 5; i++) {
        const len = 0.62 - i * 0.05;
        const g = new RoundedBoxGeometry(0.035, len, 0.15 - i * 0.012, 2, 0.015);
        g.translate(0, -len / 2, 0);
        const blade = new THREE.Mesh(g, i % 2 ? plate : metal);
        blade.position.set(side * (0.01 + i * 0.012), -0.02, -0.02 - i * 0.05);
        blade.rotation.x = 0.25 + i * 0.3;
        blade.rotation.z = side * i * 0.05;
        wing.add(blade);
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.04, len * 0.8, 0.02), neon);
        edge.position.set(0, -len * 0.55, -(0.075 - i * 0.006));
        blade.add(edge);
      }
      // piston bracket
      const bracket = rbox(0.06, 0.18, 0.1, dark, 0.02);
      bracket.position.set(side * 0.04, -0.12, 0.02);
      wing.add(bracket);
    };
    buildWing(1);
    buildWing(-1);

    /* ---------------- tail ---------------- */
    const tail = new THREE.Group();
    tail.position.set(0, 0.2, -0.5);
    this.joint("tail", tail, body);
    for (let j = 0; j < 5; j++) {
      const len = 0.55 - Math.abs(j - 2) * 0.08;
      const g = new RoundedBoxGeometry(0.035, len, 0.13, 2, 0.015);
      g.translate(0, len / 2, 0);
      const blade = new THREE.Mesh(g, j % 2 ? metal : plate);
      blade.rotation.x = -0.8;
      blade.rotation.z = (j - 2) * 0.32;
      blade.position.set((j - 2) * 0.04, 0, -0.02 * Math.abs(j - 2));
      tail.add(blade);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.04, len * 0.75, 0.02), neon);
      edge.position.set(0, len * 0.55, -0.065);
      blade.add(edge);
    }

    /* ---------------- legs ---------------- */
    const buildLeg = (side: number) => {
      const S = side > 0 ? "L" : "R";
      const hip = new THREE.Group();
      hip.position.set(side * 0.21, -0.02, 0.02);
      hip.rotation.x = -0.5;
      this.joint("hip" + S, hip, hips);
      const hipCap = sph(0.13, dark, 12, 10);
      hip.add(hipCap);
      const thigh = capsuleDown(0.105, 0.5, metal);
      hip.add(thigh);
      const thighPlate = rbox(0.12, 0.34, 0.2, plate, 0.04);
      thighPlate.position.set(side * 0.06, -0.24, 0.02);
      hip.add(thighPlate);

      const knee = new THREE.Group();
      knee.position.set(0, -0.5, 0);
      knee.rotation.x = 1.0;
      this.joint("knee" + S, knee, hip);
      const kneeRing = torus(0.1, 0.02, neon);
      kneeRing.rotation.y = Math.PI / 2;
      knee.add(kneeRing);
      const kneeCap = sph(0.09, dark, 12, 10);
      knee.add(kneeCap);
      const shin = capsuleDown(0.07, 0.5, metal);
      knee.add(shin);
      const piston = cyl(0.028, 0.028, 0.36, dark, 8);
      piston.position.set(side * 0.05, -0.28, -0.07);
      knee.add(piston);
      const pistonRod = cyl(0.016, 0.016, 0.3, plate, 8);
      pistonRod.position.set(side * 0.05, -0.12, -0.07);
      knee.add(pistonRod);

      const ankle = new THREE.Group();
      ankle.position.set(0, -0.5, 0);
      ankle.rotation.x = -0.5;
      this.joint("ankle" + S, ankle, knee);
      const ankleCap = sph(0.075, dark, 10, 8);
      ankle.add(ankleCap);
      const pad = rbox(0.16, 0.08, 0.18, dark, 0.03);
      pad.position.set(0, -0.04, 0.02);
      ankle.add(pad);
      for (let k = -1; k <= 1; k++) {
        const toeG = new RoundedBoxGeometry(0.06, 0.055, 0.32, 2, 0.02);
        toeG.translate(0, 0, 0.16);
        const toe = new THREE.Mesh(toeG, plate);
        toe.position.set(0, -0.05, 0.04);
        toe.rotation.y = k * 0.5;
        ankle.add(toe);
        const clawG = new THREE.ConeGeometry(0.03, 0.12, 6);
        clawG.rotateX(Math.PI / 2);
        clawG.translate(0, 0, 0.06);
        const claw = new THREE.Mesh(clawG, dark);
        claw.position.set(0, -0.005, 0.32);
        claw.rotation.x = 0.35;
        toe.add(claw);
      }
      const spurG = new RoundedBoxGeometry(0.05, 0.05, 0.16, 2, 0.02);
      spurG.translate(0, 0, -0.08);
      const spur = new THREE.Mesh(spurG, plate);
      spur.position.set(0, -0.05, -0.02);
      ankle.add(spur);
      const footMarker = new THREE.Object3D();
      footMarker.position.set(0, -0.05, 0.3);
      ankle.add(footMarker);
      if (side > 0) this.footL = footMarker;
      else this.footR = footMarker;
    };
    buildLeg(1);
    buildLeg(-1);

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
      }
    });

    this.defineAnims();
  }

  /* ------------------------------------------------------------------ */

  private defineAnims() {
    const A = this.anims;
    const B = this.blendSpeed;

    const legs = (p: Pose, S: "L" | "R", hip: number, knee: number, ankle: number) => {
      p["hip" + S] = { rx: hip };
      p["knee" + S] = { rx: knee };
      p["ankle" + S] = { rx: ankle };
    };
    const wings = (p: Pose, raise: number, fwd = 0, extra?: JointPose) => {
      p.wingL = { rz: raise, rx: -fwd, ...(extra ?? {}) };
      p.wingR = { rz: -raise, rx: -fwd, ...(extra ?? {}) };
    };

    A.idle = (t, p) => {
      const b = Math.sin(t * 2.4);
      const ph = t % 2.7;
      const twitch = pulse(ph, 0.0, 0.05, 0.16) - pulse(ph, 0.16, 0.2, 0.3);
      p.hips = { py: b * 0.015, px: Math.sin(t * 0.8) * 0.01 };
      p.body = { rx: 0.03 * b };
      p.neck = { rx: 0.05 * Math.sin(t * 1.7) };
      p.head = { ry: 0.35 * Math.sin(t * 0.6) + twitch * 0.3, rx: -0.04 * b + twitch * 0.15 };
      p.jaw = { rx: 0.04 + 0.03 * b };
      wings(p, 0.05 + 0.05 * b, 0);
      p.tail = { ry: 0.12 * Math.sin(t * 1.3), rx: 0.05 * b };
      legs(p, "L", -0.03 * b, 0.05 * b, -0.02 * b);
      legs(p, "R", 0.03 * b, -0.05 * b, 0.02 * b);
      this.charge = 0;
    };
    B.idle = 6;

    const walk = (p: Pose, phi: number, back: boolean) => {
      const s = Math.sin(phi);
      const c = Math.cos(phi);
      const liftL = Math.max(0, c);
      const liftR = Math.max(0, -c);
      legs(p, "L", -0.6 * s, 0.75 * liftL, -0.45 * liftL);
      legs(p, "R", 0.6 * s, 0.75 * liftR, -0.45 * liftR);
      p.hips = { py: 0.035 * Math.abs(c) - 0.01 };
      p.body = { rx: (back ? -0.06 : 0.08) + 0.02 * Math.sin(2 * phi) };
      const bob = Math.sin(2 * phi + 0.6);
      p.neck = { rx: 0.15 * (0.5 + 0.5 * bob) };
      p.head = { pz: 0.06 * bob, rx: -0.12 * bob };
      p.tail = { rx: 0.1 * Math.sin(2 * phi), ry: 0.08 * s };
      wings(p, 0.06 + 0.12 * Math.max(0, Math.sin(2 * phi)), 0);
      p.jaw = { rx: 0.05 };
    };
    A.walkF = (t, p) => walk(p, t * 10.5, false);
    A.walkB = (t, p) => walk(p, -t * 9, true);
    B.walkF = 10;
    B.walkB = 10;

    A.jump = (t, p, c) => {
      const u = smooth((-c.vy + 3) / 7); // 0 rising -> 1 falling
      const flap = Math.sin(t * 22) * 0.35 * (1 - u * 0.6);
      wings(p, 1.15 + flap, 0.2 * (1 - u));
      legs(p, "L", -0.5 * (1 - u) + 0.1 * u, 1.0 * (1 - u) - 0.25 * u, -0.3 * (1 - u) + 0.2 * u);
      legs(p, "R", -0.5 * (1 - u) + 0.1 * u, 1.0 * (1 - u) - 0.25 * u, -0.3 * (1 - u) + 0.2 * u);
      p.body = { rx: -0.15 * (1 - u) + 0.1 * u };
      p.neck = { rx: 0.3 * u - 0.1 * (1 - u) };
      p.head = { rx: 0.1 * u };
      p.tail = { rx: -0.3 * (1 - u) + 0.15 * u };
    };
    B.jump = 12;

    A.block = (t, p) => {
      const b = Math.sin(t * 6) * 0.02;
      wings(p, 0.45, 1.35, { ry: 0.25 });
      p.wingR!.ry = -0.25;
      p.body = { rx: -0.12 + b };
      p.neck = { rx: 0.3 };
      p.head = { rx: 0.25 };
      p.hips = { py: -0.08 };
      legs(p, "L", -0.2, 0.35, -0.15);
      legs(p, "R", -0.2, 0.35, -0.15);
      p.tail = { rx: -0.2 };
    };
    B.block = 16;

    // Peck
    A.light = (t, p) => {
      const w = kf(t, [
        [0, 0],
        [0.09, -0.55],
        [0.15, 0.95],
        [0.24, 0.85],
        [0.42, 0],
      ]);
      p.neck = { rx: w * 0.9 };
      p.head = { rx: w * 0.35, pz: Math.max(0, w) * 0.1 };
      p.body = {
        rx: kf(t, [
          [0, 0],
          [0.09, -0.12],
          [0.15, 0.3],
          [0.42, 0],
        ]),
      };
      p.hips = {
        pz: kf(t, [
          [0, 0],
          [0.09, -0.05],
          [0.15, 0.2],
          [0.42, 0],
        ]),
      };
      p.jaw = {
        rx: kf(t, [
          [0, 0],
          [0.09, 0.5],
          [0.2, 0.05],
          [0.3, 0],
        ]),
      };
      const br = pulse(t, 0.02, 0.15, 0.4);
      wings(p, 0.3 * br, -0.4 * br);
      legs(p, "L", -0.2 * br, 0.3 * br, -0.1 * br);
      legs(p, "R", 0.15 * br, 0.1 * br, -0.05 * br);
      p.tail = { rx: 0.3 * br };
    };
    B.light = 24;

    // Talon kick
    A.heavy = (t, p) => {
      const lift = kf(t, [
        [0, 0],
        [0.18, 1],
        [0.42, 1],
        [0.75, 0],
      ]);
      const ext = kf(t, [
        [0.18, 0],
        [0.28, 1],
        [0.42, 1],
        [0.7, 0],
      ]);
      legs(p, "R", -1.1 * lift - 0.5 * ext, 1.4 * lift - 2.2 * ext, -0.4 * lift + 0.7 * ext);
      legs(p, "L", 0.2 * lift, 0.3 * lift, -0.2 * lift);
      p.body = { rx: -0.2 * lift + 0.05 * ext, ry: 0.25 * ext };
      p.hips = {
        py: -0.06 * lift + 0.1 * ext,
        pz: kf(t, [
          [0, 0],
          [0.18, -0.08],
          [0.3, 0.25],
          [0.75, 0],
        ]),
      };
      wings(p, 1.0 * lift, -0.3 * lift);
      p.neck = { rx: -0.2 * lift + 0.3 * ext };
      p.head = { rx: 0.2 * ext };
      p.tail = { rx: -0.45 * lift };
      p.jaw = { rx: 0.3 * ext };
    };
    B.heavy = 18;

    // Laser gaze
    A.special = (t, p) => {
      const charge = kf(t, [
        [0, 0],
        [0.35, 1],
        [0.9, 1],
        [1.1, 0],
      ]);
      this.charge = charge * (t < 0.42 ? 1 : 0.5);
      p.neck = {
        rx: kf(t, [
          [0, 0],
          [0.3, -0.55],
          [0.38, 0.35],
          [0.85, 0.3],
          [1.1, 0],
        ]),
      };
      p.head = {
        rx: kf(t, [
          [0, 0],
          [0.3, -0.3],
          [0.38, 0.15],
          [1.1, 0],
        ]),
        rz: shiver(Math.max(0, t - 0.38), 40, 6) * 0.04,
      };
      p.body = {
        rx: kf(t, [
          [0, 0],
          [0.3, -0.15],
          [0.4, 0.12],
          [1.1, 0],
        ]),
      };
      wings(p, kf(t, [
        [0, 0],
        [0.3, 1.45],
        [0.9, 1.3],
        [1.1, 0],
      ]) + Math.sin(t * 30) * 0.05 * charge, -0.2 * charge);
      p.hips = { py: -0.1 * charge, pz: -0.15 * pulse(t, 0.36, 0.42, 0.7) };
      legs(p, "L", -0.25 * charge, 0.35 * charge, -0.1 * charge);
      legs(p, "R", -0.25 * charge, 0.35 * charge, -0.1 * charge);
      p.tail = { rx: -0.55 * charge };
      p.jaw = { rx: 0.5 * charge };
    };
    B.special = 16;

    // Dive talon
    A.air = (t, p) => {
      const u = smooth(t / 0.12);
      legs(p, "L", -1.3 * u, -0.5 * u, 0.55 * u);
      legs(p, "R", -1.2 * u, -0.45 * u, 0.5 * u);
      p.body = { rx: 0.5 * u };
      wings(p, 0.95 * u, -0.9 * u);
      p.neck = { rx: 0.25 * u };
      p.head = { rx: 0.15 * u };
      p.tail = { rx: -0.3 * u };
      p.jaw = { rx: 0.35 * u };
    };
    B.air = 18;

    A.hit = (t, p) => {
      const e = Math.exp(-t * 5);
      const s = shiver(t, 28, 9);
      p.body = { rx: -0.35 * e + 0.05 * s, rz: 0.08 * s };
      p.neck = { rx: -0.5 * e };
      p.head = { rx: -0.3 * e, rz: 0.2 * s };
      wings(p, 0.9 * e, 0.3 * e);
      p.hips = { pz: -0.12 * e, py: -0.05 * e };
      legs(p, "L", -0.15 * e, 0.35 * e, -0.15 * e);
      legs(p, "R", -0.15 * e, 0.35 * e, -0.15 * e);
      p.tail = { rx: -0.4 * e };
      p.jaw = { rx: 0.45 * e };
    };
    B.hit = 22;

    A.launched = (t, p) => {
      const s = Math.sin(t * 15);
      p.body = { rx: -0.9 };
      legs(p, "L", -0.6 + 0.3 * s, 0.5, 0.1);
      legs(p, "R", -0.4 - 0.3 * s, 0.5, 0.1);
      wings(p, 1.3 + 0.2 * s, 0.4);
      p.neck = { rx: -0.6 };
      p.head = { rx: -0.2 };
      p.tail = { rx: -0.5 };
      p.jaw = { rx: 0.5 };
    };
    B.launched = 9;

    const lying = (t: number, p: Pose, limp: number) => {
      p.hips = { py: -0.62, rx: -1.45 };
      p.body = { rx: 0.05 };
      legs(p, "L", -0.3 + 0.2 * Math.sin(t * 6) * (1 - limp), 0.6, 0.1);
      legs(p, "R", -0.4 - 0.2 * Math.sin(t * 6 + 1) * (1 - limp), 0.6, 0.1);
      wings(p, 1.2 + 0.3 * limp, 0.5);
      p.neck = { rx: 0.35 + 0.3 * limp };
      p.head = { rx: 0.2, rz: shiver(t, 20, 3) * 0.15 * limp };
      p.tail = { rx: 0.4 };
      p.jaw = { rx: 0.5 };
    };
    A.down = (t, p) => lying(t, p, 0);
    A.ko = (t, p) => lying(t, p, 1);
    B.down = 9;
    B.ko = 6;

    A.getup = (t, p) => {
      const u = smooth(t / 0.5);
      p.hips = { py: -0.3 * (1 - u), rx: -0.4 * (1 - u) };
      p.body = { rx: 0.35 * (1 - u) };
      legs(p, "L", -0.45 * (1 - u), 0.7 * (1 - u), -0.25 * (1 - u));
      legs(p, "R", -0.45 * (1 - u), 0.7 * (1 - u), -0.25 * (1 - u));
      wings(p, 0.6 * (1 - u), 0.4 * (1 - u));
      p.neck = { rx: 0.3 * (1 - u) };
    };
    B.getup = 8;

    A.victory = (t, p) => {
      const hop = Math.abs(Math.sin(t * 7));
      const crow = pulse(t % 3.2, 0.4, 0.9, 1.6);
      p.hips = { py: hop * 0.14 };
      wings(p, 1.0 + 0.45 * Math.sin(t * 14), 0.2);
      p.neck = { rx: 0.15 * Math.sin(t * 7) - 0.6 * crow };
      p.head = { rx: -0.3 * crow, ry: 0 };
      p.jaw = { rx: 0.6 * crow };
      p.tail = { ry: 0.4 * Math.sin(t * 10), rx: -0.3 };
      legs(p, "L", -0.3 * hop, 0.5 * hop, -0.2 * hop);
      legs(p, "R", -0.3 * hop, 0.5 * hop, -0.2 * hop);
      p.body = { rx: -0.1 };
    };
    B.victory = 10;

    A.intro = (t, p) => {
      const rise = kf(t, [
        [0, 0],
        [0.8, 0],
        [1.5, 1],
      ]);
      const crow = pulse(t, 1.3, 1.7, 2.3);
      p.hips = { py: -0.25 * (1 - rise) };
      legs(p, "L", -0.4 * (1 - rise), 0.7 * (1 - rise), -0.3 * (1 - rise));
      legs(p, "R", -0.4 * (1 - rise), 0.7 * (1 - rise), -0.3 * (1 - rise));
      wings(p, -0.1 + 1.6 * crow, 0.2 * crow);
      p.neck = { rx: 0.4 * (1 - rise) - 0.65 * crow };
      p.head = { rx: 0.2 * (1 - rise) - 0.25 * crow };
      p.jaw = { rx: 0.65 * crow };
      p.body = { rx: 0.25 * (1 - rise) - 0.1 * crow };
      p.tail = { rx: -0.4 * crow };
      this.charge = crow * 0.6;
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
        return this.beakTip.getWorldPosition(out);
      case "heavy":
        return this.footR.getWorldPosition(out);
      case "special":
        return this.eyeCenter.getWorldPosition(out);
      case "air":
        return this.footL.getWorldPosition(out);
      default:
        return this.chestWorld(out);
    }
  }

  tick(dt: number, time: number, fx: CharacterFXHooks | null, state: string) {
    const c = this.charge;
    this.neon.emissiveIntensity = 2.4 + 0.45 * Math.sin(time * 3) + c * 3;
    this.eyeMat.emissiveIntensity = 3.2 + 0.8 * Math.sin(time * 5.3) + c * 9;
    this.chestLight.intensity = 5 + 2.5 * Math.sin(time * 3) + c * 25;
    if (!fx) return;
    this.steamTimer -= dt;
    if (this.steamTimer <= 0) {
      this.steamTimer = 0.14 + Math.random() * 0.1;
      const v = this.vents[Math.floor(Math.random() * this.vents.length)];
      v.getWorldPosition(tmp);
      fx.steam(tmp, 1, state === "ko" ? 0x333333 : 0xd8e8ee, state === "ko" ? 0.6 : 0.3);
    }
    if (state === "ko" || state === "down") {
      this.sparkTimer -= dt;
      if (this.sparkTimer <= 0) {
        this.sparkTimer = 0.25 + Math.random() * 0.4;
        this.chestWorld(tmp);
        fx.embers(tmp, 6, 0x7af8ff);
      }
    }
  }
}
