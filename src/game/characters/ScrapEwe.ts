import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CharacterFXHooks, CharacterRig, Pose, kf, pulse, shiver, smooth } from "../Rig";
import { metalTexture } from "../textures";
import { FurShared, furShells } from "../fur";
import { ellipsoid } from "../geom";

const tmp = new THREE.Vector3();

export class ScrapEwe extends CharacterRig {
  readonly accent = 0xff5fa2;
  readonly sparkColor = 0xff8fb8;
  private neon: THREE.MeshStandardMaterial;
  private chestLight: THREE.PointLight;
  private fur: FurShared = { time: { value: 0 }, jiggle: { value: 0 } };
  private fistL = new THREE.Object3D();
  private fistR = new THREE.Object3D();
  private podCenter = new THREE.Object3D();
  private cockpit = new THREE.Object3D();
  private feet: THREE.Object3D[] = [];
  private exhausts: THREE.Object3D[] = [];
  private steamTimer = 0;
  private jetTimer = 0;
  private sparkTimer = 0;

  constructor() {
    super();
    const metalTex = metalTexture();
    const red = new THREE.MeshStandardMaterial({ color: 0xb8432e, map: metalTex, roughnessMap: metalTex, metalness: 0.55, roughness: 0.55 });
    const cream = new THREE.MeshStandardMaterial({ color: 0xe3dac4, map: metalTex, metalness: 0.35, roughness: 0.6 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x98a1a8, map: metalTex, roughnessMap: metalTex, metalness: 0.85, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x272a2e, metalness: 0.75, roughness: 0.55 });
    const neon = (this.neon = new THREE.MeshStandardMaterial({
      color: 0x3a0d22,
      emissive: 0xff4f9a,
      emissiveIntensity: 2.4,
      roughness: 0.3,
      metalness: 0.1,
    }));
    const glass = new THREE.MeshStandardMaterial({ color: 0x12303c, metalness: 0.85, roughness: 0.08, transparent: true, opacity: 0.55 });
    const woolSkin = new THREE.MeshStandardMaterial({ color: 0xd9bd9c, roughness: 0.9 });
    const pink = new THREE.MeshStandardMaterial({ color: 0xe89ab0, roughness: 0.7 });
    const eye = new THREE.MeshStandardMaterial({ color: 0x141014, roughness: 0.15 });
    const shine = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.3 });
    const hornMat = new THREE.MeshStandardMaterial({ color: 0xcbb89a, roughness: 0.5 });
    this.registerFlash([red, cream, steel, dark, woolSkin, pink]);

    const rbox = (w: number, h: number, d: number, m: THREE.Material, r = 0.05) =>
      new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, Math.min(w, h, d) / 2)), m);
    const cyl = (rt: number, rb: number, h: number, m: THREE.Material, seg = 14) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
    const sph = (r: number, m: THREE.Material, ws = 14, hs = 10) => new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m);
    const torus = (r: number, t: number, m: THREE.Material) => new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, 24), m);
    const capsuleDown = (r: number, len: number, m: THREE.Material) => {
      const g = new THREE.CapsuleGeometry(r, len, 4, 12);
      g.translate(0, -len / 2, 0);
      return new THREE.Mesh(g, m);
    };
    const furMats: THREE.MeshStandardMaterial[] = [];
    const coat = (parent: THREE.Object3D, geo: THREE.BufferGeometry, opts: Parameters<typeof furShells>[1]) => {
      const m = furShells(geo, opts, this.fur);
      furMats.push(m.material);
      parent.add(m);
      return m;
    };

    /* ---------------- hips & body ---------------- */
    const hips = new THREE.Group();
    hips.position.set(0, 1.02, 0);
    this.joint("hips", hips, this.root);
    const pelvis = rbox(0.66, 0.34, 0.56, red, 0.1);
    hips.add(pelvis);
    const belt = rbox(0.7, 0.1, 0.6, dark, 0.04);
    belt.position.y = 0.2;
    hips.add(belt);
    // front skirt plate
    const cod = rbox(0.4, 0.24, 0.12, cream, 0.04);
    cod.position.set(0, -0.22, 0.28);
    cod.rotation.x = -0.15;
    hips.add(cod);

    const body = new THREE.Group();
    body.position.set(0, 0.5, 0);
    body.rotation.x = 0.04;
    this.joint("body", body, hips);
    // barrel torso
    const barrel = cyl(0.42, 0.46, 0.78, red, 16);
    barrel.position.y = 0.1;
    body.add(barrel);
    const chest = rbox(0.62, 0.44, 0.5, red, 0.14);
    chest.position.set(0, 0.32, 0.12);
    body.add(chest);
    // rivet bands
    for (const y of [-0.18, 0.42]) {
      const band = torus(0.44, 0.025, dark);
      band.rotation.x = Math.PI / 2;
      band.position.set(0, y, 0);
      body.add(band);
    }
    // back exhausts
    for (const sx of [-1, 1]) {
      const ex = cyl(0.07, 0.085, 0.4, dark, 10);
      ex.position.set(sx * 0.15, 0.42, -0.38);
      body.add(ex);
      const rim = torus(0.075, 0.012, steel);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(sx * 0.15, 0.63, -0.38);
      body.add(rim);
      const mark = new THREE.Object3D();
      mark.position.set(sx * 0.15, 0.66, -0.38);
      body.add(mark);
      this.exhausts.push(mark);
    }
    // neon chest strip + core
    const strip = rbox(0.5, 0.05, 0.04, neon, 0.02);
    strip.position.set(0, 0.2, 0.38);
    body.add(strip);
    const core = sph(0.07, neon);
    core.position.set(0, 0.38, 0.36);
    body.add(core);

    // cockpit
    this.cockpit.position.set(0, 0.16, 0.42);
    body.add(this.cockpit);
    const glassBall = sph(0.3, glass, 18, 14);
    glassBall.scale.set(0.92, 0.8, 1.05);
    glassBall.position.z = 0.02;
    this.cockpit.add(glassBall);
    const frame = torus(0.26, 0.035, cream);
    frame.position.set(0, 0, -0.04);
    this.cockpit.add(frame);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const bolt = sph(0.02, dark, 6, 5);
      bolt.position.set(Math.cos(a) * 0.26, Math.sin(a) * 0.26, -0.02);
      this.cockpit.add(bolt);
    }

    // the sheep pilot's head
    const head = new THREE.Group();
    head.position.set(0, 0.02, 0.12);
    this.joint("head", head, this.cockpit);
    const skullGeo = ellipsoid(0, 0, 0, 0.16, 0.15, 0.16, 18, 12);
    const skullBase = new THREE.Mesh(skullGeo, new THREE.MeshStandardMaterial({ color: 0x8f867c, roughness: 1 }));
    head.add(skullBase);
    coat(head, skullGeo, { layers: 9, length: 0.085, density: 38, droop: 0.5, curl: 0.5, variation: 0.14, color: 0xf1e8d4 });
    // muzzle
    const muzzle = sph(0.085, woolSkin, 12, 9);
    muzzle.scale.set(1.05, 0.8, 0.95);
    muzzle.position.set(0, -0.045, 0.13);
    head.add(muzzle);
    const noseDot = sph(0.03, pink, 8, 6);
    noseDot.scale.set(1.4, 0.8, 0.6);
    noseDot.position.set(0, -0.04, 0.21);
    head.add(noseDot);
    for (const sx of [-1, 1]) {
      const e = sph(0.038, eye, 10, 8);
      e.position.set(sx * 0.07, 0.025, 0.145);
      head.add(e);
      const hs = sph(0.012, shine, 6, 5);
      hs.position.set(sx * 0.083, 0.04, 0.175);
      head.add(hs);
      // ear
      const ear = new THREE.Group();
      ear.position.set(sx * 0.15, 0.03, -0.01);
      ear.rotation.z = sx * 0.9;
      this.joint(sx > 0 ? "earL" : "earR", ear, head);
      const earOuter = sph(0.07, new THREE.MeshStandardMaterial({ color: 0xefe6d2, roughness: 0.95 }), 10, 8);
      earOuter.scale.set(1.5, 0.55, 0.7);
      earOuter.position.x = sx * 0.05;
      ear.add(earOuter);
      const earInner = sph(0.05, pink, 8, 6);
      earInner.scale.set(1.4, 0.35, 0.5);
      earInner.position.set(sx * 0.06, 0, 0.02);
      ear.add(earInner);
      // little curled horn nubs
      const nubGeo = new THREE.TorusGeometry(0.04, 0.016, 6, 10, Math.PI * 1.3);
      const nub = new THREE.Mesh(nubGeo, hornMat);
      nub.position.set(sx * 0.07, 0.13, -0.02);
      nub.rotation.set(0.4, 0, sx * 0.8);
      head.add(nub);
    }
    this.chestLight = new THREE.PointLight(0xff5fa2, 5, 3.5, 2);
    this.chestLight.position.set(0, 0.1, 0.5);
    this.cockpit.position.z = 0.42;

    /* ---------------- shoulders, arms & pods ---------------- */
    const buildArm = (side: number) => {
      const S = side > 0 ? "L" : "R";
      const pauldron = sph(0.21, red, 14, 10);
      pauldron.scale.set(1, 0.9, 1);
      pauldron.position.set(side * 0.4, 0.32, 0.05);
      body.add(pauldron);
      const pauldronRing = torus(0.18, 0.02, dark);
      pauldronRing.rotation.y = Math.PI / 2;
      pauldronRing.position.set(side * 0.4, 0.32, 0.05);
      body.add(pauldronRing);
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.4, 0.28, 0.06);
      shoulder.rotation.x = -0.12;
      this.joint("shoulder" + S, shoulder, body);
      const cap = cyl(0.12, 0.12, 0.16, dark, 12);
      cap.rotation.z = Math.PI / 2;
      shoulder.add(cap);
      const upper = capsuleDown(0.085, 0.3, red);
      shoulder.add(upper);
      const upperStripe = rbox(0.06, 0.2, 0.12, cream, 0.02);
      upperStripe.position.set(0, -0.14, 0.04);
      shoulder.add(upperStripe);
      const elbow = new THREE.Group();
      elbow.position.set(0, -0.38, 0);
      elbow.rotation.x = -0.12;
      this.joint("elbow" + S, elbow, shoulder);
      const jointCap = sph(0.1, dark, 12, 9);
      elbow.add(jointCap);
      const fore = capsuleDown(0.1, 0.24, steel);
      elbow.add(fore);
      // piston
      const piston = cyl(0.025, 0.025, 0.22, dark, 8);
      piston.position.set(side * 0.08, -0.1, -0.02);
      elbow.add(piston);
      // fist
      const fist = rbox(0.24, 0.22, 0.26, cream, 0.08);
      fist.position.set(0, -0.34, 0.04);
      elbow.add(fist);
      for (let k = -1; k <= 1; k++) {
        const knuckle = sph(0.045, steel, 8, 6);
        knuckle.position.set(k * 0.07, -0.32, 0.18);
        elbow.add(knuckle);
      }
      const knuckleBar = rbox(0.2, 0.05, 0.05, neon, 0.02);
      knuckleBar.position.set(0, -0.4, 0.2);
      elbow.add(knuckleBar);
      const marker = new THREE.Object3D();
      marker.position.set(0, -0.34, 0.28);
      elbow.add(marker);
      if (side > 0) this.fistL = marker;
      else this.fistR = marker;
    };
    buildArm(1);
    buildArm(-1);

    // missile pods on the shoulders (open during special)
    for (const sx of [-1, 1]) {
      const pod = new THREE.Group();
      pod.position.set(sx * 0.4, 0.52, -0.12);
      pod.rotation.x = -0.12;
      this.joint(sx > 0 ? "podL" : "podR", pod, body);
      const box = rbox(0.2, 0.42, 0.3, dark, 0.04);
      pod.add(box);
      const lid = rbox(0.16, 0.04, 0.26, cream, 0.02);
      lid.position.set(0, 0.23, 0);
      pod.add(lid);
      for (let k = -1; k <= 1; k++) {
        const hole = cyl(0.038, 0.038, 0.05, neon, 10);
        hole.position.set(0, 0.1 + k * 0.1, 0.14);
        hole.rotation.x = Math.PI / 2;
        pod.add(hole);
      }
    }
    this.podCenter.position.set(0, 0.42, 0.18);
    body.add(this.podCenter);

    /* ---------------- legs ---------------- */
    const buildLeg = (side: number) => {
      const S = side > 0 ? "L" : "R";
      const hip = new THREE.Group();
      hip.position.set(side * 0.2, -0.12, 0);
      hip.rotation.x = -0.4;
      this.joint("hip" + S, hip, hips);
      const hipCap = sph(0.13, dark, 12, 10);
      hip.add(hipCap);
      const thigh = capsuleDown(0.12, 0.4, red);
      hip.add(thigh);
      const thighPlate = rbox(0.16, 0.3, 0.2, cream, 0.04);
      thighPlate.position.set(0, -0.2, 0.05);
      hip.add(thighPlate);
      const knee = new THREE.Group();
      knee.position.set(0, -0.52, 0);
      knee.rotation.x = 0.85;
      this.joint("knee" + S, knee, hip);
      const kneeCap = sph(0.11, dark, 12, 9);
      knee.add(kneeCap);
      const shin = capsuleDown(0.09, 0.34, steel);
      knee.add(shin);
      const neonRing = torus(0.1, 0.016, neon);
      neonRing.rotation.y = Math.PI / 2;
      knee.add(neonRing);
      const ankle = new THREE.Group();
      ankle.position.set(0, -0.44, 0);
      ankle.rotation.x = -0.45;
      this.joint("ankle" + S, ankle, knee);
      const boot = rbox(0.28, 0.16, 0.42, dark, 0.05);
      boot.position.set(0, -0.05, 0.08);
      ankle.add(boot);
      const toe = rbox(0.26, 0.08, 0.16, cream, 0.04);
      toe.position.set(0, -0.04, 0.3);
      ankle.add(toe);
      const jet = cyl(0.07, 0.09, 0.1, dark, 10);
      jet.position.set(0, -0.02, -0.16);
      ankle.add(jet);
      const mark = new THREE.Object3D();
      mark.position.set(0, -0.05, -0.22);
      ankle.add(mark);
      this.feet.push(mark);
    };
    buildLeg(1);
    buildLeg(-1);

    this.cockpit.add(this.chestLight);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });

    this.registerFlash(furMats);
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
    const arms = (p: Pose, sl: number, el: number, sr: number, er: number) => {
      p.shoulderL = { rx: sl };
      p.elbowL = { rx: el };
      p.shoulderR = { rx: sr };
      p.elbowR = { rx: er };
    };
    const pods = (p: Pose, open: number, fan = 0) => {
      p.podL = { rx: -1.15 * open, rz: 0.35 * fan };
      p.podR = { rx: -1.15 * open, rz: -0.35 * fan };
    };

    A.idle = (t, p) => {
      const b = Math.sin(t * 2.2);
      p.hips = { py: b * 0.015 };
      p.body = { rx: 0.04 + 0.02 * b };
      p.head = { ry: 0.3 * Math.sin(t * 0.55), rz: 0.05 * Math.sin(t * 1.4) };
      arms(p, -0.12 + 0.04 * b, -0.12, -0.12 - 0.04 * b, -0.12);
      legs(p, "L", -0.02 * b, 0.03 * b, -0.02 * b);
      legs(p, "R", 0.02 * b, -0.03 * b, 0.02 * b);
      pods(p, 0, 0);
      p.earL = { rz: 0.08 * Math.sin(t * 3) };
      p.earR = { rz: -0.08 * Math.sin(t * 3) };
      this.charge = 0;
    };
    B.idle = 7;

    const walk = (p: Pose, phi: number, back: boolean) => {
      const s = Math.sin(phi);
      const c = Math.cos(phi);
      legs(p, "L", -0.55 * s, 0.85 * Math.max(0, c) - 0.1, -0.5 * Math.max(0, c));
      legs(p, "R", 0.55 * s, 0.85 * Math.max(0, -c) - 0.1, -0.5 * Math.max(0, -c));
      arms(p, -0.12 + 0.45 * s, -0.12, -0.12 - 0.45 * s, -0.12);
      p.hips = { py: 0.04 * Math.abs(c) - 0.01 };
      p.body = { rx: (back ? -0.04 : 0.08) + 0.03 * Math.sin(2 * phi) };
      p.head = { ry: -0.08 * s, rz: 0 };
      pods(p, 0);
    };
    A.walkF = (t, p) => walk(p, t * 9.5, false);
    A.walkB = (t, p) => walk(p, -t * 8, true);
    B.walkF = 11;
    B.walkB = 11;

    A.jump = (_t, p, c) => {
      const u = smooth((-c.vy + 3) / 7);
      legs(p, "L", -0.9 * (1 - u) + 0.2 * u, 1.1 * (1 - u) - 0.2 * u, -0.5 * (1 - u) + 0.3 * u);
      legs(p, "R", -0.9 * (1 - u) + 0.2 * u, 1.1 * (1 - u) - 0.2 * u, -0.5 * (1 - u) + 0.3 * u);
      arms(p, -1.7 * (1 - u) - 0.3 * u, -0.5, -1.7 * (1 - u) - 0.3 * u, -0.5);
      p.body = { rx: -0.1 * (1 - u) + 0.15 * u };
      p.head = { rz: 0.05 * u };
      pods(p, 0.2 * (1 - u));
    };
    B.jump = 12;

    A.block = (t, p) => {
      const b = Math.sin(t * 6) * 0.02;
      arms(p, -1.35, -1.7, -1.35, -1.7);
      p.body = { rx: -0.1 + b };
      p.hips = { py: -0.08 };
      legs(p, "L", -0.25, 0.45, -0.2);
      legs(p, "R", -0.25, 0.45, -0.2);
      p.head = { py: 0.02 };
      pods(p, 0.15);
    };
    B.block = 16;

    // Piston Jab (lead left)
    A.light = (t, p) => {
      const jab = kf(t, [
        [0, 0],
        [0.08, -0.2],
        [0.14, 1],
        [0.22, 0.9],
        [0.36, 0],
      ]);
      arms(p, -0.12 - 1.5 * jab, -0.12 + 0.3 * jab, -0.7, -0.9);
      p.body = {
        ry: kf(t, [
          [0, 0],
          [0.14, -0.22],
          [0.36, 0],
        ]),
        rx: 0.04,
      };
      p.hips = {
        pz: kf(t, [
          [0, 0],
          [0.14, 0.18],
          [0.36, 0],
        ]),
      };
      legs(p, "L", 0.15 * jab, 0, 0);
      legs(p, "R", -0.2 * jab, 0.3 * jab, -0.1 * jab);
      p.head = { ry: -0.1 * jab };
    };
    B.light = 26;

    // Rocket Uppercut (right)
    A.heavy = (t, p) => {
      const wind = kf(t, [
        [0, 0],
        [0.2, 1],
        [0.28, 0],
      ]);
      const rise = kf(t, [
        [0.22, 0],
        [0.32, 1],
        [0.5, 1],
        [0.8, 0],
      ]);
      arms(p, -0.9 * rise, -1.3 * rise, 0.5 * wind - 2.7 * rise, -1.1 * wind + 0.15 * rise);
      p.hips = {
        py: -0.12 * wind + 0.16 * rise,
        pz: kf(t, [
          [0, 0],
          [0.2, -0.08],
          [0.32, 0.12],
          [0.8, 0],
        ]),
      };
      p.body = { rx: 0.15 * wind - 0.2 * rise, ry: 0.18 * rise };
      legs(p, "L", 0.2 * wind - 0.4 * rise, 0.4 * rise, -0.2 * rise);
      legs(p, "R", 0.3 * wind - 0.5 * rise, 0.5 * rise, -0.3 * rise);
      p.head = { ry: 0.12 * rise };
      pods(p, 0.25 * rise);
    };
    B.heavy = 18;

    // Missile barrage
    A.special = (t, p) => {
      const brace = kf(t, [
        [0, 0],
        [0.25, 1],
        [0.85, 1],
        [1.05, 0],
      ]);
      const fire = pulse(t, 0.36, 0.42, 0.75);
      this.charge = kf(t, [
        [0, 0],
        [0.3, 1],
        [0.8, 0.4],
        [1.05, 0],
      ]);
      arms(p, -1.1 * brace, -1.5 * brace, -1.1 * brace, -1.5 * brace);
      pods(p, brace, brace);
      p.body = { rx: -0.18 * brace - 0.05 * fire, ry: shiver(Math.max(0, t - 0.4), 30, 8) * 0.03 };
      p.hips = { py: -0.12 * brace, pz: -0.12 * brace - 0.06 * fire };
      legs(p, "L", -0.35 * brace, 0.55 * brace, -0.25 * brace);
      legs(p, "R", -0.35 * brace, 0.55 * brace, -0.25 * brace);
      p.head = { py: -0.08 * brace, s: 1 - 0.5 * brace };
    };
    B.special = 16;

    // Meteor Knuckle (air)
    A.air = (t, p) => {
      const u = smooth(t / 0.12);
      const wind = kf(t, [
        [0, 1],
        [0.12, 1],
        [0.3, 0],
      ]);
      arms(p, -1.5 * u, -1 * u, -2.6 * wind * u - 0.35 * (1 - wind) * u, -0.8 * wind * u);
      legs(p, "L", -0.7 * u, 0.9 * u, -0.4 * u);
      legs(p, "R", -0.5 * u, 0.7 * u, -0.3 * u);
      p.body = { rx: 0.45 * u };
      p.head = { rx: -0.1 * u };
      pods(p, 0.4 * u);
    };
    B.air = 18;

    A.hit = (t, p) => {
      const e = Math.exp(-t * 5);
      const s = shiver(t, 26, 9);
      p.body = { rx: -0.3 * e, rz: 0.08 * s };
      p.head = { rx: -0.25 * e, ry: 0.2 * s };
      arms(p, -0.8 * e, -1.2 * e, -0.5 * e, -0.9 * e);
      p.hips = { pz: -0.12 * e, py: -0.05 * e };
      legs(p, "L", -0.1 * e, 0.3 * e, -0.1 * e);
      legs(p, "R", -0.1 * e, 0.3 * e, -0.1 * e);
      pods(p, 0.3 * e);
    };
    B.hit = 22;

    A.launched = (t, p) => {
      const s = Math.sin(t * 15);
      p.body = { rx: -0.8 };
      arms(p, -2.2 + 0.2 * s, -0.5, -2.2 - 0.2 * s, -0.5);
      legs(p, "L", -0.7 + 0.3 * s, 0.6, 0.1);
      legs(p, "R", -0.5 - 0.3 * s, 0.6, 0.1);
      p.head = { rx: -0.3 };
      pods(p, 0.6);
    };
    B.launched = 9;

    const lying = (t: number, p: Pose, limp: number) => {
      p.hips = { py: -0.6, rx: -1.35 };
      p.body = { rx: 0.1 };
      arms(p, -2.4 + 0.2 * Math.sin(t * 5) * (1 - limp), -0.4, -2.0 - 0.2 * Math.sin(t * 5) * (1 - limp), -0.4);
      legs(p, "L", -0.4, 0.6, 0.2);
      legs(p, "R", -0.6, 0.7, 0.2);
      p.head = { py: -0.1 * limp, s: 1 - 0.6 * limp };
      pods(p, 0.7 * limp);
    };
    A.down = (t, p) => lying(t, p, 0);
    A.ko = (t, p) => lying(t, p, 1);
    B.down = 9;
    B.ko = 6;

    A.getup = (t, p) => {
      const u = smooth(t / 0.5);
      p.hips = { py: -0.3 * (1 - u), rx: -0.4 * (1 - u) };
      p.body = { rx: 0.3 * (1 - u) };
      arms(p, -1.6 * (1 - u), -0.8 * (1 - u), -1.2 * (1 - u), -0.6 * (1 - u));
      legs(p, "L", -0.4 * (1 - u), 0.6 * (1 - u), -0.2 * (1 - u));
      legs(p, "R", -0.4 * (1 - u), 0.6 * (1 - u), -0.2 * (1 - u));
      p.head = { py: 0, s: 0.4 + 0.6 * u };
      pods(p, 0.3 * (1 - u));
    };
    B.getup = 8;

    A.victory = (t, p) => {
      const hop = Math.abs(Math.sin(t * 7));
      const pumpL = pulse(t % 1.6, 0, 0.25, 0.8);
      const pumpR = pulse((t + 0.8) % 1.6, 0, 0.25, 0.8);
      p.hips = { py: hop * 0.13 };
      arms(p, -2.7 * pumpL - 0.3, -0.3 * pumpL - 0.2, -2.7 * pumpR - 0.3, -0.3 * pumpR - 0.2);
      legs(p, "L", -0.3 * hop, 0.5 * hop, -0.2 * hop);
      legs(p, "R", -0.3 * hop, 0.5 * hop, -0.2 * hop);
      p.head = { rz: 0.12 * Math.sin(t * 14), ry: 0.2 * Math.sin(t * 3) };
      p.body = { rx: -0.08 };
      pods(p, 0.25, Math.sin(t * 7));
    };
    B.victory = 10;

    A.intro = (t, p) => {
      const rise = kf(t, [
        [0, 0],
        [0.7, 0],
        [1.3, 1],
      ]);
      const bump = pulse(t, 1.5, 1.6, 1.85);
      const podTest = pulse(t, 1.25, 1.35, 1.5);
      this.charge = bump;
      p.hips = { py: -0.28 * (1 - rise) };
      legs(p, "L", -0.5 * (1 - rise), 0.8 * (1 - rise), -0.3 * (1 - rise));
      legs(p, "R", -0.5 * (1 - rise), 0.8 * (1 - rise), -0.3 * (1 - rise));
      p.body = { rx: 0.3 * (1 - rise) - 0.08 * bump };
      arms(p, -0.3 * (1 - rise) - 1.5 * bump, -0.3 * (1 - rise), -0.3 * (1 - rise) - 1.5 * bump, -0.3 * (1 - rise));
      p.head = { s: 0.3 + 0.7 * rise, py: -0.05 * (1 - rise), rz: 0.1 * bump };
      pods(p, podTest, podTest);
    };
    B.intro = 7;
  }

  /* ------------------------------------------------------------------ */

  chestWorld(out: THREE.Vector3) {
    return this.cockpit.getWorldPosition(out);
  }

  strikeWorld(move: string, out: THREE.Vector3) {
    switch (move) {
      case "heavy":
        return this.fistR.getWorldPosition(out);
      case "air":
        return this.fistR.getWorldPosition(out);
      case "special":
        return this.podCenter.getWorldPosition(out);
      default:
        return this.fistL.getWorldPosition(out);
    }
  }

  flash(amount = 1) {
    super.flash(amount);
    this.fur.jiggle.value = Math.max(this.fur.jiggle.value, amount);
  }

  impulse(amount: number) {
    this.fur.jiggle.value = Math.max(this.fur.jiggle.value, amount);
  }

  tick(dt: number, time: number, fx: CharacterFXHooks | null, state: string) {
    this.fur.time.value = time;
    this.fur.jiggle.value *= Math.exp(-dt * 5);
    const c = this.charge;
    this.neon.emissiveIntensity = 2.2 + 0.5 * Math.sin(time * 3.4) + c * 4;
    this.chestLight.intensity = 4 + 2 * Math.sin(time * 3) + c * 18;
    if (!fx) return;

    this.steamTimer -= dt;
    this.jetTimer -= dt;
    this.sparkTimer -= dt;

    if (state === "ko" || state === "down") {
      if (this.sparkTimer <= 0) {
        this.sparkTimer = 0.2 + Math.random() * 0.4;
        this.chestWorld(tmp);
        fx.embers(tmp, 6, 0xff5fa2);
        if (Math.random() < 0.5) fx.steam(tmp, 1, 0x222222, 0.5);
      }
      return;
    }

    // idle exhaust puffs
    if (this.steamTimer <= 0) {
      this.steamTimer = 0.22 + Math.random() * 0.15;
      const ex = this.exhausts[Math.floor(Math.random() * this.exhausts.length)];
      ex.getWorldPosition(tmp);
      fx.steam(tmp, 1, 0xcfd6d8, 0.22);
    }
    // jet boots while airborne
    if ((state === "jump" || (state === "attack" && !this.isGrounded())) && this.jetTimer <= 0) {
      this.jetTimer = 0.05;
      for (const f of this.feet) {
        f.getWorldPosition(tmp);
        fx.embers(tmp, 2, 0xffa04a);
      }
    }
    void state;
  }

  private isGrounded() {
    return this.root.position.y <= 0.001;
  }
}
