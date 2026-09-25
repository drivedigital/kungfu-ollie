/**
 * Root-motion axis check. For each fighter GLB this prints
 *   1. world bind-pose positions of the semantic bones (hips, head, hands, feet) so the facing
 *      direction and the character's left/right can be read off objectively, and
 *   2. for each locomotion clip, the direction the root bone's *translation* track travels in
 *      local space and in world space (parent bind rotation applied), so the in-place policy in
 *      bindings.ts maps the right axis to "forward".
 *
 *   node tools/validate/root-axes.mjs
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const io = new NodeIO()
  .registerExtensions(KHRONOS_EXTENSIONS)
  .registerExtensions([EXTMeshoptCompression, EXTTextureWebP])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
await MeshoptDecoder.ready;

const CASES = [
  {
    id: 'dog',
    file: 'handoff/kyoto-v1/models/dog-chin-corrected.glb',
    root: 'mixamorig:Hips',
    bones: ['mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Spine1', 'mixamorig:Spine2', 'mixamorig:Neck', 'mixamorig:Head', 'mixamorig:HeadTop_End', 'mixamorig:LeftHand', 'mixamorig:RightHand', 'mixamorig:LeftFoot', 'mixamorig:RightFoot', 'mixamorig:RightToe_End'],
    clips: ['Run Forward', 'Boxing'],
  },
  {
    id: 'kingcroak',
    file: 'handoff/kyoto-v1/models/kingcroak-corrected.glb',
    root: 'bone_0',
    bones: ['bone_0', 'bone_1', 'bone_2', 'bone_3', 'bone_4', 'bone_5', 'bone_9', 'bone_25', 'bone_40', 'bone_44'],
    clips: ['Dwarf Walk'],
  },
];

for (const c of CASES) {
  const doc = await io.read(c.file);
  // strip textures: no image decoding in Node
  for (const mat of doc.getRoot().listMaterials()) {
    mat.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null).setOcclusionTexture(null);
  }
  for (const t of doc.getRoot().listTextures()) t.dispose();
  // the originals are not meshopt-compressed: write them back out untextured
  const buffer = Buffer.from(await io.writeBinary(doc));
  const gltf = await new Promise((res, rej) => {
    const l = new GLTFLoader();
    l.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '', res, rej);
  });
  gltf.scene.updateMatrixWorld(true);

  const sanitize = (n) => n.replace(/[\s.:/]/g, '');
  const find = (n) => gltf.scene.getObjectByName(sanitize(n));

  console.log(`\n===== ${c.id} =====`);
  console.log(' world bind positions (three scene space, Y up, model facing = head-minus-hips sign):');
  for (const name of c.bones) {
    const o = find(name);
    if (!o) { console.log(`   ${name}: MISSING`); continue; }
    const p = o.getWorldPosition(new THREE.Vector3());
    console.log(`   ${name.padEnd(22)} x=${p.x.toFixed(3).padStart(7)} y=${p.y.toFixed(3).padStart(7)} z=${p.z.toFixed(3).padStart(7)}  localT=[${o.position.toArray().map((v) => v.toFixed(3)).join(', ')}]`);
  }
  const hips = find(c.root);
  const head = find(c.id === 'dog' ? 'mixamorig:Head' : 'bone_5');
  if (hips && head) {
    const h = head.getWorldPosition(new THREE.Vector3()).sub(hips.getWorldPosition(new THREE.Vector3()));
    console.log(`   head - root = (${h.x.toFixed(3)}, ${h.y.toFixed(3)}, ${h.z.toFixed(3)}) → facing ${Math.abs(h.z) > Math.abs(h.x) ? (h.z > 0 ? '+Z' : '-Z') : (h.x > 0 ? '+X' : '-X')}`);
  }

  // root translation track analysis
  const parentRot = hips?.parent ? hips.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  for (const clipName of c.clips) {
    const clip = gltf.animations.find((a) => a.name === clipName);
    if (!clip) { console.log(`   clip ${clipName}: MISSING`); continue; }
    const track = clip.tracks.find((t) => t.name === `${sanitize(c.root)}.position`);
    if (!track) { console.log(`   clip ${clipName}: no root translation track`); continue; }
    const n = track.times.length;
    const first = new THREE.Vector3().fromArray(track.values, 0);
    const last = new THREE.Vector3().fromArray(track.values, (n - 1) * 3);
    const delta = last.clone().sub(first);
    const mid = new THREE.Vector3().fromArray(track.values, Math.floor(n / 2) * 3);
    // variation per axis (peak-to-peak) so a "bob" axis is recognisable
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], track.values[i * 3 + k]); hi[k] = Math.max(hi[k], track.values[i * 3 + k]); }
    }
    const world = delta.clone().applyQuaternion(parentRot);
    console.log(
      `   ${clipName}: local Δ=(${delta.toArray().map((v) => v.toFixed(3)).join(', ')}) world Δ=(${world.toArray().map((v) => v.toFixed(3)).join(', ')})` +
        ` mid=(${mid.toArray().map((v) => v.toFixed(3)).join(', ')}) p2p=(${hi.map((v, i) => (v - lo[i]).toFixed(3)).join(', ')})`,
    );
  }
}
