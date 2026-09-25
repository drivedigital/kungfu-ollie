/**
 * Semantic bone map: for every skin joint, sum the skin weights it owns and the bind-space
 * centroid of those vertices, so a numbered skeleton (bone_0..bone_45) can be identified without
 * guessing. Also prints each joint's parent, bind translation and world bind position.
 *
 *   node tools/validate/skeleton-map.mjs [glb ...]
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { statSync } from 'node:fs';

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['handoff/kyoto-v1/models/dog-chin-corrected.glb', 'handoff/kyoto-v1/models/kingcroak-corrected.glb'];

for (const file of files) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const prim = root.listMeshes()[0].listPrimitives()[0];
  const pos = prim.getAttribute('POSITION');
  const w = prim.getAttribute('WEIGHTS_0');
  const j = prim.getAttribute('JOINTS_0');
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const parents = new Map();
  for (const node of root.listNodes()) for (const c of node.listChildren()) parents.set(c, node);

  const stats = joints.map(() => ({ weight: 0, sum: [0, 0, 0], count: 0 }));
  const count = pos.getCount();
  const p = [0, 0, 0];
  const wv = [0, 0, 0, 0];
  const jv = [0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
    w.getElement(i, wv);
    j.getElement(i, jv);
    pos.getElement(i, p);
    for (let k = 0; k < 4; k++) {
      const weight = wv[k];
      if (weight <= 1e-4) continue;
      const joint = Math.round(jv[k]);
      const s = stats[joint];
      if (!s) continue;
      s.weight += weight;
      s.sum[0] += p[0] * weight;
      s.sum[1] += p[1] * weight;
      s.sum[2] += p[2] * weight;
      s.count++;
    }
  }

  console.log(`\n===== ${file.split('/').pop()} (${joints.length} joints) =====`);
  console.log(' idx  name                 parent               weight   bind-space centroid (x,y,z)');
  joints.forEach((joint, i) => {
    const s = stats[i];
    const c = s.weight > 0 ? s.sum.map((v) => (v / s.weight).toFixed(3)).join(', ') : '-';
    const t = joint.getTranslation();
    console.log(
      ` ${String(i).padStart(3)}  ${(joint.getName() || '(unnamed)').padEnd(20)} ${(parents.get(joint)?.getName() || '-').padEnd(20)} ${s.weight.toFixed(0).padStart(6)}   ${c}   bindT=[${t.map((v) => v.toFixed(3)).join(',')}]`,
    );
  });
  console.log(` file bytes ${statSync(file).size}`);
}
