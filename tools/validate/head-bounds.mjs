/**
 * Weighted geometry bounds for a joint (or a joint pair), used to place head/mouth/tongue
 * sockets from the mesh instead of assuming an offset.
 *
 *   node tools/validate/head-bounds.mjs handoff/kyoto-v1/models/kingcroak-corrected.glb bone_4 bone_5
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const [file, ...names] = process.argv.slice(2);
const doc = await io.read(file);
const root = doc.getRoot();
const prim = root.listMeshes()[0].listPrimitives()[0];
const pos = prim.getAttribute('POSITION');
const w = prim.getAttribute('WEIGHTS_0');
const j = prim.getAttribute('JOINTS_0');
const joints = root.listSkins()[0].listJoints();
const idx = new Set(names.map((n) => joints.findIndex((x) => x.getName() === n)).filter((i) => i >= 0));

const lo = [Infinity, Infinity, Infinity];
const hi = [-Infinity, -Infinity, -Infinity];
const p = [0, 0, 0];
const wv = [0, 0, 0, 0];
const jv = [0, 0, 0, 0];
let n = 0;
const front = { z: -Infinity, p: null };
const low = { y: Infinity, p: null };
const high = { y: -Infinity, p: null };
for (let i = 0; i < pos.getCount(); i++) {
  w.getElement(i, wv);
  j.getElement(i, jv);
  pos.getElement(i, p);
  let weight = 0;
  for (let k = 0; k < 4; k++) if (idx.has(Math.round(jv[k]))) weight += wv[k];
  if (weight < 0.5) continue;
  n++;
  for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], p[k]);
    hi[k] = Math.max(hi[k], p[k]);
  }
  if (p[2] > front.z) { front.z = p[2]; front.p = [...p]; }
  if (p[1] < low.y) { low.y = p[1]; low.p = [...p]; }
  if (p[1] > high.y) { high.y = p[1]; high.p = [...p]; }
}
const f = (v) => v.map((x) => x.toFixed(3)).join(', ');
console.log(`${file.split('/').pop()} joints [${names.join(', ')}]  vertices(w>0.5)=${n}`);
console.log(`  min [${f(lo)}]`);
console.log(`  max [${f(hi)}]`);
console.log(`  centre [${f(lo.map((v, i) => (v + hi[i]) / 2))}]`);
console.log(`  furthest +Z vertex: [${f(front.p)}]`);
console.log(`  lowest vertex:      [${f(low.p)}]`);
console.log(`  highest vertex:     [${f(high.p)}]`);
