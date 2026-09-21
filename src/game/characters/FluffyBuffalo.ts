import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CharacterFXHooks, CharacterRig, Pose, kf, pulse, shiver, smooth } from "../Rig";
import { furTexture } from "../textures";
import { FurShared, FurShellOpts, furShells } from "../fur";
import { capsuleDown, ellipsoid, mergeGeometries } from "../geom";

const tmp = new THREE.Vector3();

/** Tube that tapers along a curve (horns). */
function taperedTube(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, tubular = 14, radial = 8) {
  const geo = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    const r = r0 + (r1 - r0) * t;
    curve.getPointAt(t, c);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      p.fromBufferAttribute(pos, idx);
      p.sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(idx, p.x, p.y, p.z);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export class FluffyBuffalo extends CharacterRig {
  readonly accent = 0xffb347;
  readonly sparkColor = 0xffc25a;
  private noseTip = new THREE.Object3D();
  private hornMid = new THREE.Object3D();
  private belly = new THREE.Object3D();
  private nostrils: THREE.Object3D[] = [];
  private snort = 0;
  private snortTimer = 0;
  private fur: FurShared = { time: { value: 0 }, jiggle: { value: 0 } };

  constructor() {
    super();
    const furTex = furTexture();
    // dark undercoat visible between tufts -> depth
    const undercoat = new THREE.MeshStandardMaterial({ color: 0x6b4323, map: furTex, roughness: 1, metalness: 0 });
    const snoutMat = new THREE.MeshStandardMaterial({ color: 0xcaa273, map: furTex, roughness: 0.95 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x3a2b25, roughness: 0.45, metalness: 0.05 });
    const hoof = new THREE.MeshStandardMaterial({ color: 0x2b211d, roughness: 0.6, metalness: 0.1 });
    const horn = new THREE.MeshStandardMaterial({ color: 0xd9cdb4, roughness: 0.45, metalness: 0.05 });
    const eye = new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 0.12, metalness: 0.1 });
    const eyeShine = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.2 });
    const innerEar = new THREE.MeshStandardMaterial({ color: 0xd9a58c, roughness: 0.9 });
    const petal = new THREE.MeshStandardMaterial({ color: 0x4d6ff0, roughness: 0.7, side: THREE.DoubleSide });
    const petalCenter = new THREE.MeshStandardMaterial({ color: 0x1b2a72, roughness: 0.8 });

    const furMats: THREE.MeshStandardMaterial[] = [];
    /** Undercoat mesh + fluffy shell coat for a geometry baked in the parent's space. */
    const coat = (parent: THREE.Object3D, geo: THREE.BufferGeometry, opts: FurShellOpts, withUnder = true) => {
      if (withUnder) {
        const u = new THREE.Mesh(geo, undercoat);
        u.castShadow = true;
        parent.add(u);
      }
      const m = furShells(geo, opts, this.fur);
      furMats.push(m.material);
      parent.add(m);
      return m;
    };
    const sph = (r: number, m: THREE.Material, ws = 18, hs = 14) => new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m);
    const rbox = (w: number, h: number, d: number, m: THREE.Material, r = 0.05) =>
      new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, Math.min(w, h, d) / 2)), m);

    /* ---------------- body ---------------- */
    const body = new THREE.Group();
    body.position.set(0, 0.95, 0);
    this.joint("body", body, this.root);
    const torso = new THREE.Group();
    this.joint("torso", torso, body);

    const bodyGeo = mergeGeometries([
      ellipsoid(0, 0.1, -0.05, 0.6, 0.55, 0.85, 28, 18),
      ellipsoid(0, 0.4, 0.4, 0.5, 0.42, 0.5),
      ellipsoid(0, 0.05, -0.7, 0.5, 0.45, 0.42),
      ellipsoid(0, -0.15, 0.55, 0.42, 0.4, 0.4),
    ]);
    coat(torso, bodyGeo, { layers: 16, length: 0.28, density: 22, droop: 0.5, curl: 0.35, variation: 0.22, color: 0xd9a862 });
    this.belly.position.set(0, -0.2, 0.2);
    torso.add(this.belly);

    /* ---------------- neck & head ---------------- */
    const neck = new THREE.Group();
    neck.position.set(0, 0.28, 0.82);
    neck.rotation.x = 0.25;
    this.joint("neck", neck, body);
    coat(neck, ellipsoid(0, -0.1, 0.1, 0.31, 0.29, 0.36), { layers: 14, length: 0.22, density: 24, droop: 0.5, curl: 0.35, variation: 0.2, color: 0xd7a55e });

    const head = new THREE.Group();
    head.position.set(0, -0.22, 0.4);
    head.rotation.x = -0.1;
    this.joint("head", head, neck);
    // skull: short plush fur, kept short around the eyes / face
    coat(head, ellipsoid(0, 0.02, 0.08, 0.29, 0.32, 0.34), {
      layers: 10,
      length: 0.1,
      density: 30,
      droop: 0.4,
      curl: 0.3,
      variation: 0.18,
      color: 0xdcae6a,
      mask: { n: [0, -0.45, 1], from: 0.18, to: 0.27, min: 0.12 },
    });
    // forehead fringe ("dossan"): long blonde hair swept forward
    coat(head, ellipsoid(0, 0.27, 0.1, 0.26, 0.13, 0.22), {
      layers: 14,
      length: 0.26,
      density: 20,
      droop: 0.5,
      droopDir: [0, -0.35, 1],
      curl: 0.5,
      variation: 0.25,
      color: 0xe6be78,
    });
    // muzzle
    const snoutGeo = new RoundedBoxGeometry(0.34, 0.3, 0.38, 3, 0.12);
    snoutGeo.translate(0, -0.14, 0.4);
    const snout = new THREE.Mesh(snoutGeo, snoutMat);
    snout.castShadow = true;
    head.add(snout);
    coat(head, snoutGeo, { layers: 6, length: 0.03, density: 44, droop: 0.3, curl: 0.2, variation: 0.15, color: 0xd6b078 }, false);
    const nose = sph(0.12, skin, 14, 10);
    nose.scale.set(1.2, 0.72, 0.6);
    nose.position.set(0, -0.06, 0.6);
    nose.castShadow = true;
    head.add(nose);
    for (const sx of [-1, 1]) {
      const nostril = sph(0.03, hoof, 8, 6);
      nostril.scale.set(1, 0.7, 0.6);
      nostril.position.set(sx * 0.065, -0.08, 0.67);
      head.add(nostril);
      const nMark = new THREE.Object3D();
      nMark.position.set(sx * 0.07, -0.1, 0.7);
      head.add(nMark);
      this.nostrils.push(nMark);
      const e = sph(0.065, eye, 12, 10);
      e.position.set(sx * 0.2, 0.05, 0.31);
      head.add(e);
      const shine = sph(0.02, eyeShine, 6, 6);
      shine.position.set(sx * 0.22, 0.085, 0.36);
      head.add(shine);
    }
    const mouth = rbox(0.2, 0.02, 0.05, skin, 0.01);
    mouth.position.set(0, -0.27, 0.56);
    head.add(mouth);
    this.noseTip.position.set(0, -0.05, 0.75);
    head.add(this.noseTip);
    this.hornMid.position.set(0, 0.5, 0.15);
    head.add(this.hornMid);

    // ears (fuzzy backs, bare pink fronts)
    for (const sx of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(sx * 0.3, 0.16, 0.0);
      ear.rotation.z = sx * 0.55;
      this.joint(sx > 0 ? "earL" : "earR", ear, head);
      coat(ear, ellipsoid(sx * 0.14, 0, 0, 0.195, 0.11, 0.052, 16, 10), {
        layers: 6,
        length: 0.035,
        density: 40,
        droop: 0.2,
        curl: 0.2,
        color: 0xd9a862,
        mask: { n: [0, 0, 1], from: 0.0, to: 0.03, min: 0.0 },
      });
      const inner = sph(0.09, innerEar, 10, 8);
      inner.scale.set(1.4, 0.65, 0.2);
      inner.position.set(sx * 0.15, 0, 0.045);
      ear.add(inner);
    }
    // horns
    for (const sx of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(sx * 0.13, 0.08, -0.01),
        new THREE.Vector3(sx * 0.25, 0.22, 0.03),
        new THREE.Vector3(sx * 0.3, 0.42, 0.13),
      ]);
      const h = new THREE.Mesh(taperedTube(curve, 0.07, 0.015), horn);
      h.position.set(sx * 0.14, 0.3, 0.02);
      h.castShadow = true;
      head.add(h);
    }
    // cornflower tucked behind the left ear
    const flower = new THREE.Group();
    flower.position.set(0.34, 0.36, 0.0);
    flower.rotation.set(-0.7, 0.4, 0.6);
    flower.scale.setScalar(1.3);
    const center = sph(0.035, petalCenter, 8, 6);
    flower.add(center);
    const petalGeo = new RoundedBoxGeometry(0.045, 0.012, 0.1, 2, 0.006);
    petalGeo.translate(0, 0, 0.07);
    for (let i = 0; i < 9; i++) {
      const pm = new THREE.Mesh(petalGeo, petal);
      pm.rotation.y = (i / 9) * Math.PI * 2;
      pm.rotation.x = -0.15;
      flower.add(pm);
    }
    head.add(flower);

    /* ---------------- tail ---------------- */
    const tail = new THREE.Group();
    tail.position.set(0, 0.28, -1.05);
    tail.rotation.x = 0.35;
    this.joint("tail", tail, body);
    coat(tail, capsuleDown(0.035, 0.36), { layers: 6, length: 0.035, density: 40, droop: 0.3, color: 0xc9964f });
    const tail2 = new THREE.Group();
    tail2.position.set(0, -0.38, 0);
    tail2.rotation.x = 0.2;
    this.joint("tail2", tail2, tail);
    coat(tail2, capsuleDown(0.03, 0.3), { layers: 6, length: 0.035, density: 40, droop: 0.3, color: 0xc9964f });
    coat(tail2, ellipsoid(0, -0.36, 0, 0.075, 0.09, 0.075, 14, 10), { layers: 12, length: 0.16, density: 30, droop: 0.5, curl: 0.4, variation: 0.25, color: 0xb98644 });

    /* ---------------- legs ---------------- */
    const buildLeg = (name: string, x: number, z: number) => {
      const hip = new THREE.Group();
      hip.position.set(x, -0.15, z);
      this.joint("hip" + name, hip, body);
      coat(hip, capsuleDown(0.12, 0.36), { layers: 10, length: 0.12, density: 30, droop: 0.45, curl: 0.3, variation: 0.2, color: 0xd2a05c });
      const knee = new THREE.Group();
      knee.position.set(0, -0.36, 0);
      this.joint("knee" + name, knee, hip);
      coat(knee, capsuleDown(0.085, 0.34), { layers: 8, length: 0.07, density: 34, droop: 0.4, curl: 0.2, color: 0xcfa05e });
      const hf = rbox(0.2, 0.14, 0.24, hoof, 0.04);
      hf.position.set(0, -0.37, 0.02);
      hf.castShadow = true;
      knee.add(hf);
    };
    buildLeg("FL", 0.36, 0.5);
    buildLeg("FR", -0.36, 0.5);
    buildLeg("BL", 0.36, -0.62);
    buildLeg("BR", -0.36, -0.62);

    this.registerFlash([...furMats, undercoat, snoutMat, skin, hoof, horn]);
    this.defineAnims();
  }

  /* ------------------------------------------------------------------ */

  private defineAnims() {
    const A = this.anims;
    const B = this.blendSpeed;
    const leg = (p: Pose, n: string, hip: number, knee: number, rz = 0) => {
      p["hip" + n] = { rx: hip, rz };
      p["knee" + n] = { rx: knee };
    };
    const ears = (p: Pose, up: number, back = 0) => {
      p.earL = { rz: -up, ry: back };
      p.earR = { rz: up, ry: -back };
    };

    A.idle = (t, p) => {
      const br = Math.sin(t * 2.0);
      const ph = t % 4.6;
      const sh = pulse(ph, 1.0, 1.15, 1.75);
      const flickL = pulse((t + 0.7) % 3.1, 0, 0.06, 0.3);
      const flickR = pulse((t + 1.9) % 3.7, 0, 0.06, 0.3);
      p.torso = { sy: 1 + 0.02 * br, sx: 1 + 0.012 * br };
      p.body = { py: 0.01 * br, px: 0.01 * Math.sin(t * 0.7) };
      p.neck = { ry: 0.22 * Math.sin(t * 0.55), rx: 0.05 * Math.sin(t * 1.3) };
      p.head = { rz: Math.sin(t * 24) * 0.14 * sh, ry: 0.12 * Math.sin(t * 0.55), rx: 0.04 * br };
      p.earL = { rz: -0.12 * br - 0.55 * flickL - 0.3 * sh, ry: 0.1 * sh };
      p.earR = { rz: 0.12 * br + 0.55 * flickR + 0.3 * sh, ry: -0.1 * sh };
      p.tail = { rz: 0.5 * Math.sin(t * 2.6), rx: 0.05 * br };
      p.tail2 = { rz: 0.55 * Math.sin(t * 2.6 - 0.9) };
      leg(p, "FL", 0.03 * br, 0);
      leg(p, "FR", -0.03 * br, 0);
      leg(p, "BL", -0.02 * br, 0);
      leg(p, "BR", 0.02 * br, 0);
      if (sh > 0.5) this.fur.jiggle.value = Math.max(this.fur.jiggle.value, 0.35);
      this.snort = 0;
      this.charge = 0;
    };
    B.idle = 6;

    const trot = (p: Pose, phi: number, back: boolean) => {
      const l = (n: string, ph: number) => {
        const s = Math.sin(ph);
        const c = Math.cos(ph);
        leg(p, n, -0.5 * s, 0.75 * Math.max(0, c));
      };
      l("FL", phi);
      l("BR", phi);
      l("FR", phi + Math.PI);
      l("BL", phi + Math.PI);
      p.body = { py: 0.03 * Math.abs(Math.cos(phi)) - 0.01, rx: (back ? -0.03 : 0.03) + 0.02 * Math.sin(2 * phi) };
      p.neck = { rx: 0.06 * Math.sin(2 * phi) + (back ? -0.1 : 0.05) };
      p.head = { rx: -0.08 * Math.sin(2 * phi + 0.5) };
      ears(p, 0.1 * Math.sin(2 * phi));
      p.tail = { rz: 0.3 * Math.sin(phi) };
      p.tail2 = { rz: 0.35 * Math.sin(phi - 0.8) };
    };
    A.walkF = (t, p) => trot(p, t * 9, false);
    A.walkB = (t, p) => trot(p, -t * 7.5, true);
    B.walkF = 10;
    B.walkB = 10;

    A.jump = (_t, p, c) => {
      const u = smooth((-c.vy + 3) / 7);
      leg(p, "FL", -0.55 * (1 - u) + 0.15 * u, 0.9 * (1 - u) + 0.1 * u);
      leg(p, "FR", -0.55 * (1 - u) + 0.15 * u, 0.9 * (1 - u) + 0.1 * u);
      leg(p, "BL", 0.45 * (1 - u) - 0.1 * u, 0.9 * (1 - u) + 0.2 * u);
      leg(p, "BR", 0.45 * (1 - u) - 0.1 * u, 0.9 * (1 - u) + 0.2 * u);
      p.body = { rx: -0.12 * (1 - u) + 0.12 * u };
      p.neck = { rx: -0.15 * (1 - u) + 0.3 * u };
      ears(p, 0.35 * (1 - u) - 0.2 * u);
      p.tail = { rx: -0.4 };
    };
    B.jump = 12;

    A.block = (t, p) => {
      const b = Math.sin(t * 6) * 0.02;
      p.neck = { rx: 0.6 + b };
      p.head = { rx: 0.25 };
      p.body = { py: -0.07, rx: 0.1 };
      leg(p, "FL", -0.3, 0.4);
      leg(p, "FR", -0.3, 0.4);
      leg(p, "BL", 0.25, 0.1);
      leg(p, "BR", 0.25, 0.1);
      ears(p, -0.2, 0.6);
      p.tail = { rx: -0.4 };
    };
    B.block = 16;

    // Headbutt
    A.light = (t, p) => {
      const w = kf(t, [
        [0, 0],
        [0.1, -0.45],
        [0.16, 0.75],
        [0.26, 0.6],
        [0.45, 0],
      ]);
      p.neck = { rx: w };
      p.head = { rx: 0.4 * w };
      p.body = {
        pz: kf(t, [
          [0, 0],
          [0.1, -0.06],
          [0.16, 0.22],
          [0.45, 0],
        ]),
        rx: kf(t, [
          [0, 0],
          [0.1, -0.08],
          [0.16, 0.14],
          [0.45, 0],
        ]),
      };
      const step = kf(t, [
        [0, 0],
        [0.1, 0.2],
        [0.16, -0.35],
        [0.45, 0],
      ]);
      const br = pulse(t, 0.05, 0.16, 0.42);
      leg(p, "FL", step, 0.25 * br);
      leg(p, "FR", step * 0.6, 0.15 * br);
      leg(p, "BL", 0.25 * br, 0.1 * br);
      leg(p, "BR", 0.25 * br, 0.1 * br);
      ears(p, -0.1 * br, 0.5 * br);
      p.tail = { rx: -0.3 * br };
    };
    B.light = 24;

    // Horn toss
    A.heavy = (t, p) => {
      const down = kf(t, [
        [0, 0],
        [0.22, 1],
        [0.32, 0],
      ]);
      const up = kf(t, [
        [0.22, 0],
        [0.34, 1],
        [0.5, 1],
        [0.85, 0],
      ]);
      p.neck = { rx: 0.85 * down - 0.95 * up };
      p.head = { rx: 0.25 * down - 0.4 * up, rz: 0.2 * up };
      p.body = { rx: 0.12 * down - 0.42 * up, py: -0.1 * down + 0.2 * up, pz: 0.05 * down + 0.15 * up };
      leg(p, "FL", 0.2 * down - 1.0 * up, 0.3 * down + 1.1 * up);
      leg(p, "FR", 0.25 * down - 0.8 * up, 0.3 * down + 1.0 * up);
      leg(p, "BL", -0.15 * down + 0.35 * up, 0.2 * up);
      leg(p, "BR", -0.15 * down + 0.35 * up, 0.2 * up);
      ears(p, -0.2 * down + 0.4 * up, 0.3 * down);
      p.tail = { rx: -0.5 * up };
      p.torso = { sy: 1 + 0.04 * up };
    };
    B.heavy = 18;

    // Stampede
    A.special = (t, p) => {
      const e1 = kf(t, [
        [0, 0],
        [0.05, 1],
        [0.38, 1],
        [0.45, 0],
      ]);
      const e2 = kf(t, [
        [0.4, 0],
        [0.46, 1],
        [0.98, 1],
        [1.06, 0],
      ]);
      const e3 = kf(t, [
        [1.0, 0],
        [1.08, 1],
        [1.3, 1],
        [1.45, 0],
      ]);
      this.charge = e1;
      this.snort = e1 > 0.5 && t > 0.15 ? 1 : 0;
      if (e2 > 0.5) this.fur.jiggle.value = Math.max(this.fur.jiggle.value, 0.5);
      const phi = Math.max(0, t - 0.42) * 24;
      const gs = Math.sin(phi);
      const gc = Math.cos(phi);
      const paw = -0.5 + 0.45 * Math.sin(t * 20);
      leg(p, "FR", paw * e1 + (-0.6 * gs + 0.1) * e2 - 0.55 * e3, 0.6 * e1 * (0.5 + 0.5 * Math.cos(t * 20)) + 0.7 * Math.max(0, gc) * e2 + 0.2 * e3);
      leg(p, "FL", 0.1 * e1 + (-0.6 * gs + 0.1) * e2 - 0.55 * e3, 0.1 * e1 + 0.7 * Math.max(0, gc) * e2 + 0.2 * e3);
      const bs = Math.sin(phi + Math.PI * 0.8);
      const bc = Math.cos(phi + Math.PI * 0.8);
      leg(p, "BL", 0.2 * e1 + (-0.6 * bs - 0.1) * e2 + 0.3 * e3, 0.7 * Math.max(0, bc) * e2 + 0.3 * e3);
      leg(p, "BR", 0.2 * e1 + (-0.6 * bs - 0.1) * e2 + 0.3 * e3, 0.7 * Math.max(0, bc) * e2 + 0.3 * e3);
      p.neck = { rx: 0.65 * e1 + 0.55 * e2 - 0.25 * e3 };
      p.head = { rx: 0.15 * e1 + 0.1 * e2, rz: 0.05 * Math.sin(t * 30) * e1 };
      p.body = { py: -0.08 * e1 + 0.06 * Math.abs(gs) * e2 - 0.06 * e3, rx: 0.08 * e1 + 0.08 * gs * e2 + 0.18 * e3, pz: 0.1 * e3 };
      ears(p, -0.3 * e1 - 0.2 * e2 + 0.3 * e3, 0.6 * e1 + 0.6 * e2);
      p.tail = { rx: -0.5 * e2 - 0.4 * e3, rz: 0.2 * Math.sin(phi) * e2 };
      p.torso = { sz: 1 + 0.03 * e2, sy: 1 - 0.02 * e2 };
    };
    B.special = 16;

    // Body slam
    A.air = (t, p) => {
      const u = smooth(t / 0.12);
      leg(p, "FL", -0.3 * u, 0.5 * u, 0.6 * u);
      leg(p, "FR", -0.3 * u, 0.5 * u, -0.6 * u);
      leg(p, "BL", 0.3 * u, 0.5 * u, 0.6 * u);
      leg(p, "BR", 0.3 * u, 0.5 * u, -0.6 * u);
      p.body = { rx: 0.4 * u };
      p.neck = { rx: -0.35 * u };
      ears(p, 0.4 * u);
      p.tail = { rx: -0.5 * u };
      p.torso = { sy: 1 - 0.05 * u, sx: 1 + 0.04 * u };
    };
    B.air = 18;

    A.hit = (t, p) => {
      const e = Math.exp(-t * 5);
      const s = shiver(t, 26, 8);
      p.neck = { rx: -0.55 * e };
      p.head = { rx: -0.25 * e, rz: 0.15 * s };
      p.body = { rx: -0.15 * e, pz: -0.1 * e, rz: 0.04 * s };
      p.torso = { sx: 1 + 0.07 * e * Math.cos(t * 30), sy: 1 - 0.06 * e * Math.cos(t * 30) };
      ears(p, -0.5 * e);
      p.tail = { rx: 0.4 * e };
      leg(p, "FL", 0.25 * e, 0.2 * e);
      leg(p, "FR", 0.25 * e, 0.2 * e);
      leg(p, "BL", -0.1 * e, 0.3 * e);
      leg(p, "BR", -0.1 * e, 0.3 * e);
    };
    B.hit = 22;

    A.launched = (t, p) => {
      const s = Math.sin(t * 14);
      p.body = { rx: -0.7 };
      leg(p, "FL", -0.5 + 0.4 * s, 0.7);
      leg(p, "FR", -0.3 - 0.4 * s, 0.7);
      leg(p, "BL", 0.4 - 0.3 * s, 0.7);
      leg(p, "BR", 0.5 + 0.3 * s, 0.7);
      p.neck = { rx: -0.5 };
      ears(p, -0.4, 0.4);
      p.tail = { rx: -0.6 };
    };
    B.launched = 9;

    const lying = (t: number, p: Pose, facing: number, limp: number) => {
      const k = 1 - limp;
      p.body = { py: -0.42, rz: -1.35 * facing };
      leg(p, "FL", -0.6 + 0.15 * Math.sin(t * 5) * k, 0.5);
      leg(p, "FR", -0.3 + 0.15 * Math.sin(t * 5 + 1) * k, 0.6);
      leg(p, "BL", 0.4, 0.5);
      leg(p, "BR", 0.6 + 0.15 * Math.sin(t * 5 + 2) * k, 0.6);
      p.neck = { rx: 0.15 + 0.2 * limp, rz: 0.2 * facing };
      p.head = { rz: shiver(t, 18, 3) * 0.12 * limp };
      ears(p, -0.6);
      p.tail = { rx: 0.5, rz: 0.3 * Math.sin(t * 3) * k };
      p.torso = { sy: 1 + 0.02 * Math.sin(t * 3) };
    };
    A.down = (t, p, c) => lying(t, p, c.facing, 0);
    A.ko = (t, p, c) => lying(t, p, c.facing, 1);
    B.down = 9;
    B.ko = 6;

    A.getup = (t, p, c) => {
      const u = smooth(t / 0.5);
      p.body = { py: -0.2 * (1 - u), rz: -0.4 * c.facing * (1 - u), rx: 0.2 * (1 - u) };
      leg(p, "FL", -0.4 * (1 - u), 0.6 * (1 - u));
      leg(p, "FR", -0.4 * (1 - u), 0.6 * (1 - u));
      leg(p, "BL", 0.3 * (1 - u), 0.4 * (1 - u));
      leg(p, "BR", 0.3 * (1 - u), 0.4 * (1 - u));
      p.neck = { rx: 0.3 * (1 - u) };
      ears(p, -0.3 * (1 - u));
    };
    B.getup = 8;

    A.victory = (t, p) => {
      const hop = Math.abs(Math.sin(t * 7));
      const s = Math.sin(t * 7);
      p.body = { py: hop * 0.13, rx: -0.08 };
      p.neck = { rx: -0.3 - 0.25 * Math.sin(t * 7), ry: 0.15 * Math.sin(t * 3.5) };
      p.head = { rz: 0.1 * Math.sin(t * 3.5), rx: -0.1 };
      ears(p, 0.35 + 0.15 * Math.sin(t * 14));
      p.tail = { rz: 0.6 * Math.sin(t * 12), rx: -0.4 };
      p.tail2 = { rz: 0.5 * Math.sin(t * 12 - 0.8) };
      leg(p, "FL", -0.6 * Math.max(0, s), 0.7 * Math.max(0, s));
      leg(p, "FR", -0.6 * Math.max(0, -s), 0.7 * Math.max(0, -s));
      leg(p, "BL", 0.2 * hop, 0.3 * hop);
      leg(p, "BR", 0.2 * hop, 0.3 * hop);
      p.torso = { sy: 1 + 0.03 * s };
      if (hop < 0.15) this.fur.jiggle.value = Math.max(this.fur.jiggle.value, 0.4);
    };
    B.victory = 10;

    A.intro = (t, p) => {
      const pawEnv = kf(t, [
        [0, 0],
        [0.1, 1],
        [0.8, 1],
        [0.95, 0],
      ]);
      const shake = pulse(t, 0.95, 1.15, 1.6);
      const proud = kf(t, [
        [1.4, 0],
        [1.9, 1],
        [2.2, 0.3],
      ]);
      this.snort = t > 1.0 && t < 1.5 ? 1 : 0;
      if (shake > 0.5) this.fur.jiggle.value = Math.max(this.fur.jiggle.value, 0.6);
      leg(p, "FR", (-0.5 + 0.45 * Math.sin(t * 16)) * pawEnv, 0.6 * pawEnv * (0.5 + 0.5 * Math.cos(t * 16)));
      leg(p, "FL", 0.1 * pawEnv, 0.1 * pawEnv);
      p.neck = { rx: 0.55 * pawEnv - 0.45 * proud, ry: 0 };
      p.head = { rz: Math.sin(t * 26) * 0.18 * shake, rx: -0.1 * proud };
      p.body = { py: -0.06 * pawEnv + 0.03 * proud, rx: 0.06 * pawEnv - 0.06 * proud };
      ears(p, -0.3 * pawEnv + 0.35 * proud, 0.5 * pawEnv);
      p.tail = { rz: 0.4 * Math.sin(t * 5), rx: -0.3 * proud };
      p.torso = { sy: 1 + 0.03 * proud };
    };
    B.intro = 7;
  }

  /* ------------------------------------------------------------------ */

  chestWorld(out: THREE.Vector3) {
    return this.belly.getWorldPosition(out);
  }

  strikeWorld(move: string, out: THREE.Vector3) {
    switch (move) {
      case "heavy":
        return this.hornMid.getWorldPosition(out);
      case "air":
        return this.belly.getWorldPosition(out);
      default:
        return this.noseTip.getWorldPosition(out);
    }
  }

  flash(amount = 1) {
    super.flash(amount);
    this.fur.jiggle.value = Math.max(this.fur.jiggle.value, amount);
  }

  impulse(amount: number) {
    this.fur.jiggle.value = Math.max(this.fur.jiggle.value, amount);
  }

  tick(dt: number, time: number, fx: CharacterFXHooks | null, _state: string) {
    this.fur.time.value = time;
    this.fur.jiggle.value *= Math.exp(-dt * 5);
    if (!fx) return;
    if (this.snort > 0) {
      this.snortTimer -= dt;
      if (this.snortTimer <= 0) {
        this.snortTimer = 0.06;
        for (const n of this.nostrils) {
          n.getWorldPosition(tmp);
          fx.steam(tmp, 1, 0xf0e4d8, 0.22);
        }
      }
    }
  }
}
