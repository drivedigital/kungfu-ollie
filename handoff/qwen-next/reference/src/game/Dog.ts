import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { AnimCtx, CharacterFXHooks, CharacterRig, Pose, kf, pulse, shiver, smooth } from "../Rig";
import { furTexture, makeRng } from "../textures";
import { capsuleDown, ellipsoid } from "../geom";

/**
 * RONIN (dog) — procedural `CharacterRig`.
 *
 * This is the fallback for the skinned path (`src/game/skinned/SkinnedRig.ts` + DOG_BINDING).
 * It is authored against the same state machine and the same `moves.ts` timings:
 *   light  Paw Jab         0.40s  hit 0.11-0.19
 *   heavy  Martelo Kick     0.85s  hit 0.27-0.40
 *   special Whirlwind Axes  1.30s  hits 0.34-0.52 and 0.62-0.86
 *   air    Twist Flip Dive  0.70s  hit 0.12-0.50
 * Bipedal; the axes are props that only exist during the special.
 */

const tmp = new THREE.Vector3();
const AXE_REST = 0.001;

export class Dog extends CharacterRig {
  readonly accent = 0xffb45e;
  readonly sparkColor = 0xffd9a0;

  private chest = new THREE.Object3D();
  private mouth = new THREE.Object3D();
  private pawR = new THREE.Object3D();
  private pawL = new THREE.Object3D();
  private footR = new THREE.Object3D();
  private axes: THREE.Group;
  private axeSpin = 0;
  private bandMats: THREE.MeshStandardMaterial[] = [];
  private eyeGlow: THREE.MeshBasicMaterial;
  private lidL!: THREE.Object3D;
  private lidR!: THREE.Object3D;
  private blink = 0;
  private blinkTimer = 1.5;
  private earTwitch = 0;
  private sparkTimer = 0;
  private howled = false;

  constructor() {
    super();
    const rng = makeRng(2024);
    const furMat = new THREE.MeshStandardMaterial({ map: furTexture(), color: 0xd7a05c, roughness: 0.85, metalness: 0 });
    const creamMat = new THREE.MeshStandardMaterial({ color: 0xf4e3c4, roughness: 0.8 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.7 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x17110d, roughness: 0.35 });
    const giMat = new THREE.MeshStandardMaterial({ color: 0x2c3a5c, roughness: 0.92 });
    const giTrim = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.9 });
    const beltMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xc8342c, roughness: 0.75, side: THREE.DoubleSide });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x6b3d16, emissive: 0x3a1c05, emissiveIntensity: 0.6, roughness: 0.2 });
    const eyeGlow = (this.eyeGlow = new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xdfe7ee, roughness: 0.25, metalness: 0.95, emissive: 0x22323c, emissiveIntensity: 0.5 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5b3a21, roughness: 0.85 });
    this.bandMats = [bandMat];
    this.registerFlash([furMat, creamMat, giMat, giTrim, beltMat, bandMat, darkMat]);

    const sph = (r: number, m: THREE.Material, ws = 14, hs = 10) => new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m);
    const rbox = (w: number, h: number, d: number, m: THREE.Material, r = 0.03) =>
      new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, Math.min(w, h, d) / 2)), m);
    const cap = (r: number, len: number, m: THREE.Material) => new THREE.Mesh(capsuleDown(r, len), m);

    /* ---------------- hips + torso ---------------- */
    const hips = new THREE.Group();
    hips.position.set(0, 0.92, 0);
    this.joint("hips", hips, this.root);

    const body = new THREE.Group();
    body.position.set(0, 0.04, 0);
    this.joint("body", body, hips);

    // gi jacket over the chest
    body.add(new THREE.Mesh(ellipsoid(0, 0.24, 0, 0.3, 0.32, 0.24, 26, 18), giMat));
    // fur at the shoulders/neck
    body.add(new THREE.Mesh(ellipsoid(0, 0.5, -0.01, 0.24, 0.12, 0.2, 20, 14), furMat));
    // open V of the gi showing fur
    body.add(new THREE.Mesh(ellipsoid(0, 0.34, 0.14, 0.13, 0.18, 0.1, 16, 12), furMat));
    body.add(rbox(0.62, 0.07, 0.5, beltMat, 0.03).translateY(0.02));
    const knot = sph(0.06, beltMat, 10, 8);
    knot.position.set(0.05, 0.02, 0.26);
    body.add(knot);
    const sashL = rbox(0.07, 0.34, 0.02, beltMat, 0.02);
    sashL.position.set(0.02, -0.16, 0.25);
    sashL.rotation.z = 0.14;
    body.add(sashL);
    this.chest.position.set(0, 0.34, 0.04);
    body.add(this.chest);

    /* ---------------- head ---------------- */
    const head = new THREE.Group();
    head.position.set(0, 0.58, 0.01);
    this.joint("head", head, body);
    head.add(new THREE.Mesh(ellipsoid(0, 0.02, 0, 0.2, 0.19, 0.19, 24, 16), furMat));
    const muzzle = new THREE.Mesh(ellipsoid(0, -0.05, 0.15, 0.11, 0.09, 0.14, 18, 12), creamMat);
    head.add(muzzle);
    const nose = sph(0.045, noseMat, 10, 8);
    nose.position.set(0, -0.01, 0.28);
    head.add(nose);
    // brows + eyes
    for (const sx of [-1, 1]) {
      const brow = rbox(0.11, 0.025, 0.05, darkMat, 0.01);
      brow.position.set(sx * 0.1, 0.1, 0.16);
      brow.rotation.z = sx * -0.25;
      head.add(brow);
      const eye = sph(0.05, eyeMat, 12, 9);
      eye.position.set(sx * 0.1, 0.03, 0.165);
      head.add(eye);
      const glow = sph(0.075, eyeGlow, 10, 8);
      glow.position.copy(eye.position);
      head.add(glow);
      const lid = new THREE.Group();
      lid.position.copy(eye.position);
      lid.add(new THREE.Mesh(new THREE.SphereGeometry(0.056, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), furMat));
      lid.rotation.x = -0.2;
      head.add(lid);
      if (sx < 0) this.lidL = lid;
      else this.lidR = lid;
    }
    const jaw = new THREE.Group();
    jaw.position.set(0, -0.09, 0.06);
    this.joint("jaw", jaw, head);
    jaw.add(new THREE.Mesh(ellipsoid(0, -0.02, 0.1, 0.1, 0.05, 0.12, 14, 10), creamMat));
    for (const sx of [-1, 1]) {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.05, 6), giTrim);
      fang.position.set(sx * 0.055, 0.02, 0.19);
      fang.rotation.x = Math.PI;
      jaw.add(fang);
    }
    this.mouth.position.set(0, -0.04, 0.28);
    head.add(this.mouth);

    // ears: floppy, on their own joints
    for (const sx of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(sx * 0.15, 0.13, -0.03);
      this.joint(sx < 0 ? "earL" : "earR", ear, head);
      const flap = new THREE.Mesh(capsuleDown(0.06, 0.2), furMat);
      flap.rotation.z = sx * 0.5;
      flap.rotation.x = 0.25;
      ear.add(flap);
      ear.add(new THREE.Mesh(ellipsoid(sx * 0.02, -0.08, 0.02, 0.045, 0.07, 0.02, 10, 8), creamMat));
    }

    // headband + tails
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.028, 8, 24), bandMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.1;
    band.scale.set(1, 1, 0.72);
    head.add(band);
    for (const sx of [-1, 1]) {
      const tail = new THREE.Group();
      tail.position.set(sx * 0.04, 0.1, -0.19);
      this.joint(sx < 0 ? "bandL" : "bandR", tail, head);
      const strip = rbox(0.07, 0.005, 0.34, bandMat, 0.002);
      strip.position.set(sx * 0.03, 0, -0.17);
      strip.rotation.x = -0.15;
      tail.add(strip);
    }

    /* ---------------- arms ---------------- */
    const buildArm = (side: number) => {
      const S = side < 0 ? "L" : "R";
      const arm = new THREE.Group();
      arm.position.set(side * 0.29, 0.42, 0);
      this.joint("arm" + S, arm, body);
      arm.add(cap(0.075, 0.28, giMat));
      arm.add(new THREE.Mesh(ellipsoid(0, -0.02, 0, 0.09, 0.09, 0.09, 12, 9), giTrim));
      const elbow = new THREE.Group();
      elbow.position.set(0, -0.3, 0);
      this.joint("elbow" + S, elbow, arm);
      elbow.add(cap(0.062, 0.26, furMat));
      const hand = new THREE.Group();
      hand.position.set(0, -0.28, 0);
      this.joint("hand" + S, hand, elbow);
      hand.add(sph(0.085, furMat, 12, 9));
      for (let i = 0; i < 3; i++) {
        const toe = sph(0.026, creamMat, 7, 6);
        toe.position.set((i - 1) * 0.045, -0.03, 0.07);
        hand.add(toe);
      }
      const marker = new THREE.Object3D();
      marker.position.set(0, -0.04, 0.1);
      hand.add(marker);
      if (side < 0) this.pawL = marker;
      else this.pawR = marker;
    };
    buildArm(-1);
    buildArm(1);

    /* ---------------- legs ---------------- */
    const buildLeg = (side: number) => {
      const S = side < 0 ? "L" : "R";
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.16, -0.04, 0);
      this.joint("thigh" + S, thigh, hips);
      thigh.add(cap(0.1, 0.34, giMat));
      const knee = new THREE.Group();
      knee.position.set(0, -0.42, 0);
      this.joint("knee" + S, knee, thigh);
      knee.add(cap(0.075, 0.32, furMat));
      const ankle = new THREE.Group();
      ankle.position.set(0, -0.4, 0);
      this.joint("ankle" + S, ankle, knee);
      const foot = rbox(0.13, 0.07, 0.24, furMat, 0.03);
      foot.position.set(0, -0.03, 0.05);
      ankle.add(foot);
      for (let i = 0; i < 3; i++) {
        const toe = sph(0.028, creamMat, 7, 6);
        toe.position.set((i - 1) * 0.045, -0.05, 0.15);
        ankle.add(toe);
      }
      const marker = new THREE.Object3D();
      marker.position.set(0, -0.06, 0.1);
      ankle.add(marker);
      if (side > 0) this.footR = marker;
    };
    buildLeg(-1);
    buildLeg(1);

    /* ---------------- tail ---------------- */
    const tail = new THREE.Group();
    tail.position.set(0, 0.12, -0.22);
    this.joint("tail", tail, body);
    tail.add(new THREE.Mesh(capsuleDown(0.055, 0.2).rotateX(Math.PI * 0.72), furMat));
    const tail2 = new THREE.Group();
    tail2.position.set(0, 0.14, -0.16);
    this.joint("tail2", tail2, tail);
    tail2.add(new THREE.Mesh(capsuleDown(0.045, 0.18).rotateX(-Math.PI * 0.5), furMat));
    tail2.add(sph(0.05, creamMat, 9, 7).translateY(0.02).translateZ(-0.16));

    /* ---------------- axes (special only) ---------------- */
    this.axes = new THREE.Group();
    this.axes.visible = false;
    for (const sx of [-1, 1]) {
      const axe = new THREE.Group();
      axe.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.66, 8), woodMat));
      const bladeGeo = new THREE.BoxGeometry(0.04, 0.26, 0.2);
      bladeGeo.translate(0, 0.14, 0.07);
      const blade = new THREE.Mesh(bladeGeo, steelMat);
      blade.position.y = 0.28;
      axe.add(blade);
      axe.position.set(sx * 0.34, 1.28, 0.1);
      axe.scale.setScalar(AXE_REST);
      this.axes.add(axe);
    }
    this.root.add(this.axes);

    // a little fur speckle so the coat is not flat
    const speck = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 5, 4), creamMat, 26);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s3 = new THREE.Vector3();
    for (let i = 0; i < 26; i++) {
      v.set((rng() - 0.5) * 0.5, 0.1 + rng() * 0.5, (rng() - 0.5) * 0.4);
      s3.setScalar(0.012 + rng() * 0.02);
      m4.compose(v, q, s3);
      speck.setMatrixAt(i, m4);
    }
    body.add(speck);

    this.defineAnims();
  }

  /* ------------------------------------------------------------------ */

  private defineAnims() {
    const A = this.anims;
    const B = this.blendSpeed;
    /** k = 1 standing, 0 crouched, negative = tucked */
    const legs = (p: Pose, k: number, swingL = 0, swingR = 0) => {
      p.thighL = { rx: -0.12 * k + swingL };
      p.thighR = { rx: -0.12 * k + swingR };
      p.kneeL = { rx: 0.24 * (1 - k) + Math.max(0, -swingL) * 0.9 };
      p.kneeR = { rx: 0.24 * (1 - k) + Math.max(0, -swingR) * 0.9 };
      p.ankleL = { rx: 0.1 * k };
      p.ankleR = { rx: 0.1 * k };
    };
    const guard = (p: Pose, k = 1) => {
      p.armL = { rx: -0.95 * k, rz: 0.5 * k };
      p.armR = { rx: -0.95 * k, rz: -0.5 * k };
      p.elbowL = { rx: -1.5 * k };
      p.elbowR = { rx: -1.5 * k };
    };
    const sway = (p: Pose, k: number) => {
      p.armL = { rx: 0.1, rz: 0.16 + k };
      p.armR = { rx: 0.1, rz: -0.16 - k };
      p.elbowL = { rx: -0.3 };
      p.elbowR = { rx: -0.3 };
    };

    A.idle = (t, p) => {
      const br = Math.sin(t * 2.3);
      p.hips = { py: 0.014 * br, rx: 0.02 * br };
      p.body = { sy: 1 + 0.018 * br, rx: -0.03 * br };
      p.head = { ry: 0.2 * Math.sin(t * 0.55), rx: 0.03 * br - 0.04 };
      p.jaw = { rx: 0.05 + 0.05 * Math.max(0, Math.sin(t * 1.1)) };
      p.tail = { ry: Math.sin(t * 4.4) * 0.5 };
      p.tail2 = { ry: Math.sin(t * 4.4 - 0.6) * 0.45 };
      p.bandL = { rx: 0.2 + Math.sin(t * 3.1) * 0.12, ry: Math.sin(t * 2.2) * 0.2 };
      p.bandR = { rx: 0.2 + Math.sin(t * 3.1 + 1) * 0.12, ry: -Math.sin(t * 2.2 + 0.7) * 0.2 };
      this.earTwitch = pulse(t % 5.7, 3.0, 3.06, 3.3);
      p.earL = { rz: 0.3 + this.earTwitch * 0.5, rx: -0.2 * this.earTwitch };
      p.earR = { rz: -0.3 - this.earTwitch * 0.2 };
      guard(p, 0.82 + 0.04 * br);
      legs(p, 1);
      this.charge = 0;
      this.howled = false;
    };
    B.idle = 12;

    const gait = (t: number, p: Pose, c: AnimCtx, dir: number) => {
      const spd = THREE.MathUtils.clamp(Math.abs(c.fwd) / 3.6, 0.35, 1.7);
      const ph = t * 7.2 * spd * dir;
      const sL = Math.sin(ph) * 0.62;
      const sR = Math.sin(ph + Math.PI) * 0.62;
      p.hips = { py: -0.035 + Math.abs(Math.cos(ph)) * 0.045, ry: Math.sin(ph) * 0.09 * dir };
      p.body = { rx: dir > 0 ? 0.1 : -0.16, ry: -Math.sin(ph) * 0.12 * dir };
      p.head = { rx: dir > 0 ? -0.06 : 0.12, ry: Math.sin(ph) * 0.06 };
      legs(p, 1.05, sL, sR);
      p.armL = { rx: -0.7 - sR * 0.55, rz: 0.42 };
      p.armR = { rx: -0.7 - sL * 0.55, rz: -0.42 };
      p.elbowL = { rx: -1.25 - Math.max(0, sR) * 0.3 };
      p.elbowR = { rx: -1.25 - Math.max(0, sL) * 0.3 };
      p.tail = { ry: Math.sin(ph * 0.5) * 0.4, rx: -0.5 };
      p.tail2 = { ry: Math.sin(ph * 0.5 - 0.7) * 0.4 };
      p.bandL = { rx: 0.5 + Math.sin(ph) * 0.2 };
      p.bandR = { rx: 0.5 + Math.sin(ph + 1) * 0.2 };
      p.earL = { rz: 0.55, rx: -0.35 };
      p.earR = { rz: -0.55, rx: -0.35 };
    };
    A.walkF = (t, p, c) => gait(t, p, c, 1);
    A.walkB = (t, p, c) => gait(t * 0.8, p, c, -1);
    B.walkF = 16;
    B.walkB = 16;

    A.jump = (t, p, c) => {
      if (!c.grounded) {
        const rise = THREE.MathUtils.clamp(c.vy / 11, -1, 1);
        p.hips = { py: 0.02 * rise };
        p.body = { rx: -0.22 * rise };
        p.head = { rx: 0.18 * rise };
        legs(p, 0.55 - rise * 0.5, rise * 0.4, -rise * 0.25);
        p.armL = { rx: -1.5 - rise * 0.6, rz: 0.75 };
        p.armR = { rx: -1.5 - rise * 0.6, rz: -0.75 };
        p.elbowL = { rx: -0.5 };
        p.elbowR = { rx: -0.5 };
        p.tail = { rx: -0.9 - rise * 0.4, ry: Math.sin(t * 9) * 0.3 };
        p.tail2 = { ry: Math.sin(t * 9 - 0.8) * 0.35 };
        p.bandL = { rx: 0.9 };
        p.bandR = { rx: 0.9 };
        p.earL = { rz: 0.7, rx: -0.6 };
        p.earR = { rz: -0.7, rx: -0.6 };
      } else {
        // landing compression
        const k = Math.exp(-t * 9);
        p.hips = { py: -0.16 * k };
        legs(p, 1 - 0.35 * k);
        guard(p, 0.8);
        p.body = { rx: 0.16 * k };
      }
    };
    B.jump = 18;

    A.block = (t, p, c) => {
      const hit = shiver(t, 40, 12) * 0.5;
      p.hips = { py: -0.1, px: hit * 0.03 };
      p.body = { rx: 0.14 };
      p.head = { rx: -0.14, ry: hit * 0.1 };
      guard(p, 1.25);
      legs(p, 0.8);
      p.tail = { rx: -0.2, ry: 0.1 };
      p.earL = { rz: 0.6, rx: -0.4 };
      p.earR = { rz: -0.6, rx: -0.4 };
      void c;
    };
    B.block = 26;

    A.light = (t, p) => {
      // Paw Jab — 0.40s, contact 0.11-0.19
      const ext = kf(t, [
        [0, 0],
        [0.09, 0.25],
        [0.13, 1],
        [0.2, 1],
        [0.3, 0.25],
        [0.4, 0],
      ]);
      p.hips = { ry: -0.28 * ext, py: -0.02 * ext };
      p.body = { ry: -0.36 * ext, rx: 0.06 * ext };
      p.head = { ry: 0.22 * ext };
      p.armR = { rx: -1.55 * ext - 0.15, rz: -0.45 * (1 - ext) };
      p.elbowR = { rx: -1.5 + 1.42 * ext };
      p.armL = { rx: -0.9, rz: 0.5 };
      p.elbowL = { rx: -1.5 };
      p.jaw = { rx: 0.1 * ext };
      legs(p, 1, 0.1 * ext, -0.14 * ext);
      p.tail = { ry: -0.5 * ext };
      p.earR = { rz: -0.5 - 0.2 * ext };
    };
    B.light = 30;
    this.instant.add("handR");

    A.heavy = (t, p) => {
      // Martelo Kick — 0.85s, contact 0.27-0.40
      const wind = kf(t, [
        [0, 0],
        [0.22, 1],
        [0.27, 0.4],
      ]);
      const kick = kf(t, [
        [0.24, 0],
        [0.3, 1],
        [0.42, 1],
        [0.62, 0.3],
        [0.85, 0],
      ]);
      p.hips = { ry: 0.5 * wind - 0.75 * kick, py: -0.06 * wind - 0.02 * kick };
      p.body = { ry: 0.4 * wind - 0.55 * kick, rx: -0.18 * kick };
      p.head = { ry: -0.2 * wind + 0.3 * kick };
      p.thighR = { rx: -0.5 * wind - 1.55 * kick, rz: -0.35 * kick };
      p.kneeR = { rx: 1.5 * wind + 0.35 * kick };
      p.ankleR = { rx: 0.4 * kick };
      p.thighL = { rx: 0.12 * kick };
      p.kneeL = { rx: 0.22 + 0.2 * kick };
      p.armL = { rx: -0.6 - 0.8 * kick, rz: 0.7 + 0.5 * kick };
      p.armR = { rx: -0.4 + 0.9 * kick, rz: -0.6 - 0.6 * kick };
      p.elbowL = { rx: -1.1 };
      p.elbowR = { rx: -0.7 };
      p.tail = { ry: 0.6 * wind - 0.8 * kick, rx: -0.4 * kick };
      p.bandL = { rx: 0.4 + 0.5 * kick };
      p.bandR = { rx: 0.4 + 0.5 * kick };
      p.jaw = { rx: 0.24 * kick };
    };
    B.heavy = 22;

    A.special = (t, p) => {
      // Whirlwind Axes — 1.30s, contacts 0.34-0.52 and 0.62-0.86
      const charge = kf(t, [
        [0, 0],
        [0.3, 1],
        [0.34, 0.6],
      ]);
      const spin = kf(t, [
        [0.3, 0],
        [0.92, 1],
        [1.3, 1],
      ]);
      const turns = spin * Math.PI * 4;
      const crouch = 0.16 * charge + 0.1 * spin;
      p.hips = { ry: turns, py: -crouch };
      p.body = { ry: turns * 0.35, rx: 0.2 * spin };
      p.head = { ry: -turns * 0.2, rx: -0.1 };
      p.armL = { rx: -1.35 - 0.35 * spin, rz: 0.95 + 0.35 * spin };
      p.armR = { rx: -1.35 - 0.35 * spin, rz: -0.95 - 0.35 * spin };
      p.elbowL = { rx: -0.35 };
      p.elbowR = { rx: -0.35 };
      legs(p, 1 - crouch * 2.2, 0.25 * spin, -0.25 * spin);
      p.tail = { rx: -0.9, ry: turns * 0.5 };
      p.bandL = { rx: 1.1, ry: 0.5 };
      p.bandR = { rx: 1.1, ry: -0.5 };
      p.earL = { rz: 0.8, rx: -0.5 };
      p.earR = { rz: -0.8, rx: -0.5 };
      p.jaw = { rx: 0.3 * spin };
      this.charge = THREE.MathUtils.clamp(t < 0.34 ? t / 0.34 : 1 - (t - 0.9) / 0.4, 0, 1);
      this.axeSpin = t;
    };
    B.special = 26;
    this.instant.add("hips");
    this.instant.add("body");

    A.air = (t, p) => {
      // Twist Flip Dive — 0.70s, contact 0.12-0.50
      const dive = kf(t, [
        [0, 0],
        [0.12, 1],
        [0.5, 1],
        [0.7, 0.4],
      ]);
      const twist = kf(t, [
        [0, 0],
        [0.5, 1],
        [0.7, 1],
      ]);
      p.hips = { ry: twist * Math.PI * 1.4, rx: 0.45 * dive, py: -0.04 * dive };
      p.body = { rx: 0.5 * dive };
      p.head = { rx: -0.35 * dive };
      p.thighR = { rx: -1.5 * dive, rz: -0.2 };
      p.kneeR = { rx: 0.25 * dive };
      p.ankleR = { rx: 0.5 * dive };
      p.thighL = { rx: -0.5 * dive };
      p.kneeL = { rx: 1.3 * dive };
      p.armL = { rx: -2.1 * dive, rz: 0.5 };
      p.armR = { rx: -0.5 * dive, rz: -0.9 * dive };
      p.elbowL = { rx: -0.4 };
      p.elbowR = { rx: -1.1 };
      p.tail = { rx: -1.1 * dive, ry: twist * 0.8 };
      p.earL = { rz: 0.8, rx: -0.7 };
      p.earR = { rz: -0.8, rx: -0.7 };
      p.bandL = { rx: 1.2 };
      p.bandR = { rx: 1.2 };
    };
    B.air = 24;

    A.hit = (t, p) => {
      const k = Math.exp(-t * 7);
      const sh = shiver(t, 44, 10);
      p.hips = { px: -0.12 * k, py: -0.04 * k, ry: -0.2 * k };
      p.body = { rx: -0.3 * k, ry: -0.24 * k };
      p.head = { rx: -0.42 * k + sh * 0.12, ry: -0.3 * k };
      p.jaw = { rx: 0.35 * k };
      p.armL = { rx: -0.5 - 0.7 * k, rz: 0.9 * k };
      p.armR = { rx: -0.5 - 0.7 * k, rz: -0.9 * k };
      p.elbowL = { rx: -1.2 * k };
      p.elbowR = { rx: -1.2 * k };
      legs(p, 1 - 0.18 * k, -0.2 * k, 0.25 * k);
      p.earL = { rz: 0.9, rx: -0.5 };
      p.earR = { rz: -0.9, rx: -0.5 };
      p.tail = { rx: 0.3 * k };
    };
    B.hit = 34;

    A.launched = (t, p, c) => {
      const spin = t * 5.2;
      const rise = THREE.MathUtils.clamp(c.vy / 10, -1, 1);
      p.hips = { py: 0.02, ry: spin * 0.6 };
      p.body = { rx: -0.3 + rise * 0.25, ry: Math.sin(spin) * 0.3 };
      p.head = { rx: -0.4 - rise * 0.2, ry: Math.sin(spin * 1.3) * 0.4 };
      p.jaw = { rx: 0.4 };
      p.armL = { rx: -2.2 + Math.sin(spin * 1.7) * 0.8, rz: 1.1 };
      p.armR = { rx: -2.2 + Math.cos(spin * 1.5) * 0.8, rz: -1.1 };
      p.elbowL = { rx: -0.5 };
      p.elbowR = { rx: -0.5 };
      legs(p, 0.2, Math.sin(spin) * 0.7, Math.cos(spin) * 0.7);
      p.tail = { rx: -1.2, ry: Math.sin(spin * 2) * 0.6 };
      p.earL = { rz: 1, rx: -0.8 };
      p.earR = { rz: -1, rx: -0.8 };
      p.bandL = { rx: 1.3, ry: Math.sin(spin) * 0.6 };
      p.bandR = { rx: 1.3, ry: -Math.sin(spin) * 0.6 };
    };
    B.launched = 20;

    const floored = (p: Pose, limp: number, t: number) => {
      p.hips = { py: -0.6 + 0.02 * limp, rx: -1.28 - 0.1 * limp, ry: 0.22 * limp };
      p.body = { rx: -0.16, ry: 0.1 * limp };
      p.head = { rx: -0.35 - 0.15 * limp, ry: -0.4 * limp, rz: 0.3 * limp };
      p.jaw = { rx: 0.25 + 0.4 * limp };
      p.armL = { rx: -0.4, rz: 1.35 + 0.2 * limp };
      p.armR = { rx: -0.3, rz: -1.2 - 0.3 * limp };
      p.elbowL = { rx: -0.5 };
      p.elbowR = { rx: -0.7 };
      p.thighL = { rx: -0.9 + Math.sin(t * 1.3) * 0.05, rz: 0.35 };
      p.thighR = { rx: -1.15, rz: -0.2 };
      p.kneeL = { rx: 1.1 };
      p.kneeR = { rx: 0.7 };
      p.ankleL = { rx: 0.3 };
      p.ankleR = { rx: 0.4 };
      p.tail = { rx: 0.6, ry: 0.3 * limp };
      p.earL = { rz: 1.1, rx: -0.6 };
      p.earR = { rz: -1.1, rx: -0.6 };
      p.bandL = { rx: 1.2 };
      p.bandR = { rx: 1.2 };
    };
    A.down = (t, p) => {
      const settle = Math.exp(-t * 6);
      floored(p, 0.25, t);
      p.hips = { ...(p.hips ?? {}), py: -0.6 + 0.1 * settle, rx: -1.28 - 0.25 * settle };
      p.body = { ...(p.body ?? {}), rx: -0.16 + shiver(t, 26, 7) * 0.12 };
      p.thighL = { rx: -1.2 * settle - 0.5, rz: 0.4 };
      p.kneeL = { rx: 1.5 * settle + 0.6 };
    };
    B.down = 22;

    A.ko = (t, p) => {
      floored(p, 1, t * 0.2);
      const br = Math.sin(t * 1.5) * 0.02;
      p.body = { rx: -0.16 + br, ry: 0.1 };
      p.jaw = { rx: 0.72 + br * 2 };
      p.hips = { py: -0.62, rx: -1.34, ry: 0.24 };
    };
    B.ko = 8;

    A.getup = (t, p) => {
      const k = smooth(THREE.MathUtils.clamp(t / 0.55, 0, 1));
      floored(p, 1 - k, t);
      p.hips = { py: -0.6 + 0.6 * k, rx: -1.34 * (1 - k), ry: 0.24 * (1 - k) };
      p.body = { rx: -0.16 * (1 - k) + 0.22 * Math.sin(k * Math.PI) };
      p.head = { rx: -0.5 * (1 - k) + 0.2 * Math.sin(k * Math.PI), ry: -0.4 * (1 - k) };
      p.armL = { rx: -0.4 - 0.6 * k, rz: 1.35 * (1 - k) + 0.5 * k };
      p.armR = { rx: -0.3 - 0.7 * k, rz: -1.2 * (1 - k) - 0.5 * k };
      p.elbowL = { rx: -0.5 - 1.0 * k };
      p.elbowR = { rx: -0.7 - 0.8 * k };
      legs(p, k, 0.2 * (1 - k), 0.1 * (1 - k));
      p.jaw = { rx: 0.65 * (1 - k) };
    };
    B.getup = 20;

    A.victory = (t, p) => {
      const howl = kf(t % 3.2, [
        [0, 0],
        [0.5, 1],
        [1.9, 1],
        [2.6, 0],
        [3.2, 0],
      ]);
      const br = Math.sin(t * 3.1);
      p.hips = { py: 0.02 * br - 0.03 * howl, ry: Math.sin(t * 0.9) * 0.12 };
      p.body = { rx: -0.18 * howl, ry: Math.sin(t * 0.9) * 0.1 };
      p.head = { rx: -0.55 * howl + 0.05 * br, ry: Math.sin(t * 1.4) * 0.2 };
      p.jaw = { rx: 0.15 + 0.75 * howl };
      p.armL = { rx: -2.4 * howl - 0.9, rz: 0.6 + 0.3 * howl };
      p.armR = { rx: -2.4 * howl - 0.9, rz: -0.6 - 0.3 * howl };
      p.elbowL = { rx: -0.4 - 0.4 * howl };
      p.elbowR = { rx: -0.4 - 0.4 * howl };
      legs(p, 1, 0.05 * br, -0.05 * br);
      p.tail = { rx: -1.1 - 0.3 * howl, ry: Math.sin(t * 9) * 0.55 };
      p.tail2 = { ry: Math.sin(t * 9 - 0.8) * 0.5 };
      p.earL = { rz: 0.4 - 0.4 * howl, rx: -0.3 * howl };
      p.earR = { rz: -0.4 + 0.4 * howl, rx: -0.3 * howl };
      p.bandL = { rx: 0.7 + 0.4 * howl, ry: Math.sin(t * 4) * 0.3 };
      p.bandR = { rx: 0.7 + 0.4 * howl, ry: -Math.sin(t * 4 + 1) * 0.3 };
      this.lidOpen = 1 + 0.5 * howl;
      if (howl > 0.9 && !this.howled) this.howled = true;
      if (howl < 0.2) this.howled = false;
      this.charge = howl * 0.35;
    };
    B.victory = 10;

    A.intro = (t, p) => {
      // bow, then rise into the guard before the 2.5s fight start
      const bow = kf(t, [
        [0, 0],
        [0.45, 1],
        [1.15, 1],
        [1.9, 0],
      ]);
      const rise = kf(t, [
        [1.6, 0],
        [2.4, 1],
      ]);
      p.hips = { py: -0.14 * bow, rx: 0.1 * bow };
      p.body = { rx: 0.52 * bow - 0.04 * rise };
      p.head = { rx: 0.3 * bow - 0.05 * rise, ry: 0.1 * rise };
      p.jaw = { rx: 0.08 * rise };
      p.armL = { rx: -0.25 - 0.75 * rise, rz: 0.2 + 0.32 * rise + 0.3 * bow };
      p.armR = { rx: -0.25 - 0.75 * rise, rz: -0.2 - 0.32 * rise - 0.3 * bow };
      p.elbowL = { rx: -0.35 - 1.15 * rise };
      p.elbowR = { rx: -0.35 - 1.15 * rise };
      legs(p, 1 - 0.08 * bow);
      p.tail = { rx: -0.3 * bow, ry: Math.sin(t * 3.4) * 0.4 * (1 - bow) };
      p.tail2 = { ry: Math.sin(t * 3.4 - 0.6) * 0.35 };
      p.earL = { rz: 0.35 + 0.2 * bow };
      p.earR = { rz: -0.35 - 0.2 * bow };
      p.bandL = { rx: 0.3 + 0.3 * bow };
      p.bandR = { rx: 0.3 + 0.3 * bow };
      this.charge = 0;
    };
    B.intro = 9;
  }

  /** only used by victory; kept on the instance so the pose fn can write it */
  private lidOpen = 1;

  /* ------------------------------------------------------------------ */

  chestWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.chest.getWorldPosition(out);
  }

  strikeWorld(move: string, out: THREE.Vector3): THREE.Vector3 {
    switch (move) {
      case "light":
        return this.pawR.getWorldPosition(out);
      case "heavy":
        return this.footR.getWorldPosition(out);
      case "special":
        return this.pawR.getWorldPosition(out);
      case "air":
        return this.footR.getWorldPosition(out);
      default:
        return this.chestWorld(out);
    }
  }

  override impulse(amount: number) {
    this.earTwitch = Math.max(this.earTwitch, amount);
  }

  tick(dt: number, time: number, fx: CharacterFXHooks | null, state: string) {
    // axes are props: they exist only for the special
    const showAxes = state === "special" || this.current === "special";
    if (this.axes.visible !== showAxes) this.axes.visible = showAxes;
    if (showAxes) {
      const kids = this.axes.children;
      const anchors = [this.pawL, this.pawR];
      kids.forEach((axe, i) => {
        const a = anchors[i];
        if (!a) return;
        a.getWorldPosition(tmp);
        this.root.worldToLocal(tmp);
        axe.position.lerp(tmp, 1 - Math.exp(-dt * 30));
        axe.rotation.set(1.2 + Math.sin(this.axeSpin * 22 + i * Math.PI) * 0.5, this.axeSpin * 6, i === 0 ? -0.3 : 0.3);
        const s = axe.scale.x;
        const target = 0.95;
        axe.scale.setScalar(s + (target - s) * (1 - Math.exp(-dt * 18)));
      });
    }

    // eyes flare while charging
    const c = THREE.MathUtils.clamp(this.charge, 0, 1);
    this.eyeGlow.opacity = c * 0.85;

    // blink
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blink === 0) {
      this.blink = 1;
      this.blinkTimer = 2 + Math.random() * 3.5;
    }
    if (this.blink > 0) this.blink = Math.max(0, this.blink - dt / 0.11);
    const open = Math.max(0, this.lidOpen * (1 - this.blink));
    const rot = open >= 1 ? -0.2 - (open - 1) * 0.4 : -0.2 + (1 - open) * 1.5;
    const k = 1 - Math.exp(-dt * 30);
    if (this.lidL) this.lidL.rotation.x += (rot - this.lidL.rotation.x) * k;
    if (this.lidR) this.lidR.rotation.x += (rot - this.lidR.rotation.x) * k;

    if (!fx) return;
    if (state === "special" && Math.random() < dt * 30) {
      this.pawR.getWorldPosition(tmp);
      fx.embers(tmp, 1, this.sparkColor);
    }
    if (state === "ko") {
      this.sparkTimer -= dt;
      if (this.sparkTimer <= 0) {
        this.sparkTimer = 0.6 + Math.random();
        this.chestWorld(tmp);
        fx.steam(tmp, 1, 0xcbb79a, 0.4);
      }
    }
    void time;
  }
}
