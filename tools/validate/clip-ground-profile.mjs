/**
 * Per-clip ground profile.
 *
 * For each animation clip in a fighter GLB this samples the clip every 0.05 s through the real
 * skinning path (`SkinnedMesh.getVertexPosition`) and prints, in source units:
 *
 *   rootY   — the root bone's height above its bind height, i.e. what root-motion keeps/strips
 *   lowest  — the lowest skinned vertex of the whole body
 *   hipsY   — the root bone's absolute height (reads like a spine height)
 *
 * It answers "which part of this clip is the character actually on the floor?" so trim ranges for
 * knockdown / KO / get-up come from measurement instead of from a guess.
 *
 *   node tools/validate/clip-ground-profile.mjs handoff/kyoto-v1/models/dog-chin-corrected.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const file = process.argv[2] ?? 'handoff/kyoto-v1/models/dog-chin-corrected.glb';
const only = process.argv[3];

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const doc = await io.read(file);
for (const mat of doc.getRoot().listMaterials()) {
  mat.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null).setOcclusionTexture(null);
}
for (const t of doc.getRoot().listTextures()) t.dispose();
const buffer = Buffer.from(await io.writeBinary(doc));
const gltf = await new Promise((res, rej) => {
  const loader = new GLTFLoader();
  loader.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '', res, rej);
});

const sanitize = (n) => n.replace(/[\s.:/]/g, '');
const rootName = sanitize(process.env.ROOT_BONE ?? (file.includes('dog') ? 'mixamorig:Hips' : 'bone_0'));
const root = gltf.scene.getObjectByName(rootName);
if (!root) throw new Error(`root bone ${rootName} not found`);
const bindRootY = root.getWorldPosition(new THREE.Vector3()).y;
const meshes = [];
gltf.scene.traverse((o) => {
  if (o.isSkinnedMesh) meshes.push(o);
});

const mixer = new THREE.AnimationMixer(gltf.scene);
const v = new THREE.Vector3();
const clips = gltf.animations.filter((c) => !only || c.name.includes(only));
console.log(`# ${file.split('/').pop()} — root ${rootName}, bind world Y ${bindRootY.toFixed(3)}, ${clips.length} clips`);

for (const clip of clips) {
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  const rows = [];
  for (let t = 0; t <= clip.duration + 1e-6; t += 0.05) {
    action.reset().play();
    mixer.setTime(Math.min(t, clip.duration));
    gltf.scene.updateMatrixWorld(true);
    let lowest = Infinity;
    for (const m of meshes) {
      const pos = m.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 800));
      for (let i = 0; i < pos.count; i += step) {
        m.getVertexPosition(i, v);
        m.localToWorld(v);
        if (v.y < lowest) lowest = v.y;
      }
    }
    const rootY = root.getWorldPosition(new THREE.Vector3()).y;
    rows.push({ t: +t.toFixed(2), lowest: +lowest.toFixed(3), rootY: +rootY.toFixed(3), delta: +(rootY - bindRootY).toFixed(3) });
  }
  const lowestRow = rows.reduce((a, b) => (b.lowest < a.lowest ? b : a));
  const grounded = rows.filter((r) => r.lowest < 0.08);
  const span = grounded.length ? `${grounded[0].t}–${grounded[grounded.length - 1].t}` : 'never';
  console.log(
    `\n${clip.name}  (${clip.duration.toFixed(2)}s)  ground contact: ${span}   lowest ${lowestRow.lowest} @${lowestRow.t}s`,
  );
  console.log('  t: ' + rows.filter((_, i) => i % 2 === 0).map((r) => r.t.toFixed(2).padStart(5)).join(''));
  console.log('  L: ' + rows.filter((_, i) => i % 2 === 0).map((r) => r.lowest.toFixed(2).padStart(5)).join(''));
  console.log('  Δ: ' + rows.filter((_, i) => i % 2 === 0).map((r) => r.delta.toFixed(2).padStart(5)).join(''));
}
