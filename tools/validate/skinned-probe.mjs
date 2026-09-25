/**
 * Headless asset probe: loads the shipped GLBs through the *real* runtime path
 * (three GLTFLoader + EXT_meshopt_compression decoder + KHR_mesh_quantization + skinning) and
 * measures the skinned result.
 *
 *   node tools/validate/skinned-probe.mjs
 *
 * Because the probe runs in Node there is no WebGL, so textures are stripped from an in-memory
 * copy of each document first (geometry, skins, animations and materials are untouched). Every
 * number below is therefore computed with the same code that runs in the browser: GLTFLoader,
 * Skeleton, SkinnedMesh.applyBoneTransform and AnimationMixer.
 *
 * Reports, per asset:
 *   - bind-pose skinned bounds (source vs runtime)  → proves quantization + IBM correction match
 *   - per clip: duration, animated root X/Z travel, lowest foot/body point over the clip
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptDecoder as NodeMeshopt, MeshoptEncoder as NodeMeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const io = new NodeIO()
  .registerExtensions(KHRONOS_EXTENSIONS)
  .registerExtensions([EXTMeshoptCompression, EXTTextureWebP])
  // decoder for reading the shipped assets, encoder so the texture-free copy can be re-written
  .registerDependencies({ 'meshopt.decoder': NodeMeshopt, 'meshopt.encoder': NodeMeshoptEncoder });
await NodeMeshopt.ready;
await NodeMeshoptEncoder.ready;
await MeshoptDecoder.ready;

/** GLB bytes with every texture removed (keeps Node parsing free of image decoding). */
async function texturelessGlb(path) {
  const doc = await io.read(path);
  const root = doc.getRoot();
  for (const mat of root.listMaterials()) {
    mat.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null)
      .setEmissiveTexture(null).setOcclusionTexture(null);
  }
  for (const tex of root.listTextures()) tex.dispose();
  return Buffer.from(await io.writeBinary(doc));
}

function parseThree(buffer) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise((resolve, reject) => {
    loader.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '', resolve, reject);
  });
}

/** three 的 GLTFLoader sanitises node names ("mixamorig:Hips" -> "mixamorigHips"). */
const sanitize = (name) => name.replace(/[\s.:/]/g, '');

function collect(scene) {
  const skinned = [];
  scene.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  const bones = new Map();
  scene.traverse((o) => {
    if (!o.isBone) return;
    bones.set(o.name, o);
    bones.set(sanitize(o.name), o);
  });
  return { skinned, bones };
}

const v = new THREE.Vector3();

/** World-space skinned position of vertex `i` (the same transform the GPU applies). */
function skinnedWorld(mesh, i, out) {
  mesh.getVertexPosition(i, out);
  return mesh.localToWorld(out);
}

function skinnedBounds(mesh, step = 1) {
  const box = new THREE.Box3();
  mesh.updateMatrixWorld(true);
  const count = mesh.geometry.attributes.position.count;
  for (let i = 0; i < count; i += step) {
    skinnedWorld(mesh, i, v);
    box.expandByPoint(v);
  }
  return box;
}

const ASSETS = [
  ['dog', 'handoff/kyoto-v1/models/dog-chin-corrected.glb', 'public/models/dog.glb'],
  ['kingcroak', 'handoff/kyoto-v1/models/kingcroak-corrected.glb', 'public/models/kingcroak.glb'],
];

for (const [id, srcPath, runPath] of ASSETS) {
  const srcGltf = await parseThree(await texturelessGlb(srcPath));
  const runGltf = await parseThree(await texturelessGlb(runPath));
  const src = collect(srcGltf.scene);
  const run = collect(runGltf.scene);

  const srcBounds = skinnedBounds(src.skinned[0], 1);
  const runBounds = skinnedBounds(run.skinned[0], 1);
  const size = (b) => b.getSize(new THREE.Vector3()).toArray().map((n) => +n.toFixed(4));
  const min = (b) => b.min.toArray().map((n) => +n.toFixed(4));

  console.log(`\n===== ${id} =====`);
  console.log(` skinned meshes            : source ${src.skinned.length} / runtime ${run.skinned.length}`);
  console.log(` skeleton bones            : source ${src.bones.size} / runtime ${run.bones.size}`);
  console.log(` bind-pose size  (x,y,z)   : source ${size(srcBounds)}  runtime ${size(runBounds)}`);
  console.log(` bind-pose min   (x,y,z)   : source ${min(srcBounds)}  runtime ${min(runBounds)}`);
  const boneMissing = [...src.bones.keys()].filter((n) => !run.bones.has(n));
  console.log(` bone-name differences     : ${boneMissing.length ? boneMissing.join(', ') : 'none'}`);

  // clip inventory + runtime evaluation
  const srcClips = new Map(srcGltf.animations.map((c) => [c.name, c]));
  const runClips = new Map(runGltf.animations.map((c) => [c.name, c]));
  console.log(` clips                     : source ${srcClips.size} / runtime ${runClips.size}`);
  const missing = [...srcClips.keys()].filter((n) => !runClips.has(n));
  if (missing.length) console.log(` MISSING CLIPS             : ${missing.join(', ')}`);

  const mesh = run.skinned[0];
  const mixer = new THREE.AnimationMixer(runGltf.scene);
  const rootBone = run.bones.get(sanitize(id === 'dog' ? 'mixamorig:Hips' : 'bone_0'));

  const FEET = id === 'dog'
    ? ['mixamorig:LeftFoot', 'mixamorig:RightFoot']
    : ['bone_40', 'bone_41', 'bone_44', 'bone_45'];

  console.log(' clip                        dur   rootX  rootY  rootZ   minFootY  minMeshY');
  for (const [name, clip] of runClips) {
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    const samples = 12;
    let footTrace = '';
    let minFootY = Infinity;
    let minMeshY = Infinity;
    let rootXMin = Infinity;
    let rootXMax = -Infinity;
    let rootYMin = Infinity;
    let rootYMax = -Infinity;
    let rootZMin = Infinity;
    let rootZMax = -Infinity;
    const vertexCount = mesh.geometry.attributes.position.count;
    for (let s = 0; s <= samples; s++) {
      const t = (s / samples) * clip.duration;
      // restart the action on every sample: a finished LoopOnce action is deactivated by the
      // mixer and would otherwise leave the skeleton in its bind pose.
      action.reset().play();
      mixer.setTime(t);
      runGltf.scene.updateMatrixWorld(true);
      rootBone.getWorldPosition(v);
      rootXMin = Math.min(rootXMin, v.x); rootXMax = Math.max(rootXMax, v.x);
      rootYMin = Math.min(rootYMin, v.y); rootYMax = Math.max(rootYMax, v.y);
      rootZMin = Math.min(rootZMin, v.z); rootZMax = Math.max(rootZMax, v.z);
      for (const footName of FEET) {
        const foot = run.bones.get(sanitize(footName));
        if (!foot) continue;
        foot.getWorldPosition(v);
        if (v.y < minFootY) minFootY = v.y;
        if (footName === FEET[0]) footTrace += ` ${v.y.toFixed(3)}`;
      }
      if (!process.env.PROBE_NO_MESH) {
        for (let i = 0; i < vertexCount; i += 37) {
          skinnedWorld(mesh, i, v);
          if (v.y < minMeshY) minMeshY = v.y;
        }
      }
    }
    console.log(
      ` ${name.padEnd(26)} ${clip.duration.toFixed(2).padStart(5)}  ${(rootXMax - rootXMin).toFixed(3).padStart(6)} ${(rootYMax - rootYMin).toFixed(3).padStart(6)} ${(rootZMax - rootZMin).toFixed(3).padStart(6)}   ${minFootY.toFixed(3).padStart(8)}  ${minMeshY.toFixed(3).padStart(8)}`,
    );
    if (process.env.PROBE_TRACE) console.log(`   foot Y trace:${footTrace}`);
    action.stop();
    mixer.uncacheAction(clip);
  }
}
