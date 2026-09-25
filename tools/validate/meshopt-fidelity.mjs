/**
 * Runtime-fidelity check of the shipped GLBs.
 *
 * Decodes EXT_meshopt_compression with the *same* decoder module the browser uses
 * (`meshoptimizer`, i.e. the implementation behind three/addons/libs/meshopt_decoder.module.js)
 * and compares every accessor against the intact handoff original:
 *
 *   node tools/validate/meshopt-fidelity.mjs
 *
 * Expectations:
 *   - animation sampler data and JOINTS_0 must survive exactly (float recovery is lossless there
 *     only if the encoder used the EXPONENTIAL/QUATERNION filters — this script measures it),
 *   - WEIGHTS_0/POSITION/NORMAL/TEXCOORD_0 may move by the KHR_mesh_quantization grid only.
 */
import { readFileSync } from 'node:fs';
import { MeshoptDecoder } from 'meshoptimizer';

const COMPONENT = {
  5120: { get: (dv, o) => dv.getInt8(o), size: 1, norm: 127 },
  5121: { get: (dv, o) => dv.getUint8(o), size: 1, norm: 255 },
  5122: { get: (dv, o) => dv.getInt16(o, true), size: 2, norm: 32767 },
  5123: { get: (dv, o) => dv.getUint16(o, true), size: 2, norm: 65535 },
  5125: { get: (dv, o) => dv.getUint32(o, true), size: 4, norm: 4294967295 },
  5126: { get: (dv, o) => dv.getFloat32(o, true), size: 4, norm: 1 },
};
const ELEMENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function parseGlb(path) {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  let off = 12;
  let json = null;
  let bin = null;
  while (off < dv.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
    if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  return { json, bin };
}

/** Decode (if needed) and read one accessor into a plain float array. */
function readAccessor(glb, index) {
  const { json, bin } = glb;
  const acc = json.accessors[index];
  const n = ELEMENTS[acc.type];
  const c = COMPONENT[acc.componentType];
  const bv = json.bufferViews[acc.bufferView];
  const meshopt = bv.extensions?.EXT_meshopt_compression;
  let view;
  if (meshopt) {
    const src = bin.subarray(meshopt.byteOffset, meshopt.byteOffset + meshopt.byteLength);
    const target = new Uint8Array(meshopt.count * meshopt.byteStride);
    // The JS decoder returns undefined on success and throws on failure.
    MeshoptDecoder.decodeGltfBuffer(target, meshopt.count, meshopt.byteStride, src, meshopt.mode, meshopt.filter);
    view = target;
  } else {
    view = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  }
  const dt = new DataView(view.buffer, view.byteOffset, view.byteLength);
  const stride = bv.byteStride ?? n * c.size;
  const base = acc.byteOffset ?? 0;
  const out = new Float32Array(acc.count * n);
  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < n; k++) {
      const raw = c.get(dt, base + i * stride + k * c.size);
      out[i * n + k] = acc.normalized ? raw / c.norm : raw;
    }
  }
  return out;
}

function samplerRefs(glb) {
  const { json } = glb;
  const out = new Map();
  for (const anim of json.animations ?? []) {
    for (const ch of anim.channels) {
      const node = json.nodes[ch.target.node]?.name ?? `#${ch.target.node}`;
      const s = anim.samplers[ch.sampler];
      out.set(`${anim.name}|${node}|${ch.target.path}|input`, s.input);
      out.set(`${anim.name}|${node}|${ch.target.path}|output`, s.output);
    }
  }
  return out;
}

const PAIRS = [
  ['dog', 'handoff/kyoto-v1/models/dog-chin-corrected.glb', 'public/models/dog.glb'],
  ['kingcroak', 'handoff/kyoto-v1/models/kingcroak-corrected.glb', 'public/models/kingcroak.glb'],
];

await MeshoptDecoder.ready;
let failures = 0;
for (const [id, srcPath, runPath] of PAIRS) {
  const src = parseGlb(srcPath);
  const run = parseGlb(runPath);
  const srcCh = samplerRefs(src);
  const runCh = samplerRefs(run);

  let animMax = 0;
  let animWorst = '';
  let compared = 0;
  let rotMaxDeg = 0;
  let rotWorst = '';
  let linearMax = 0;
  let linearWorst = '';
  for (const [key, srcIdx] of srcCh) {
    const runIdx = runCh.get(key);
    if (runIdx === undefined) { console.log(`  MISSING ${key}`); failures++; continue; }
    const a = readAccessor(src, srcIdx);
    const b = readAccessor(run, runIdx);
    if (a.length !== b.length) { console.log(`  LENGTH ${key}: ${a.length} -> ${b.length}`); failures++; continue; }
    compared++;
    if (key.endsWith('rotation|output')) {
      // quaternions are compared up to double cover (|dot|), reported as an angle
      for (let i = 0; i + 3 < a.length; i += 4) {
        const dot = Math.abs(a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3]);
        const deg = (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
        if (deg > rotMaxDeg) { rotMaxDeg = deg; rotWorst = `${key}[${i}]`; }
        if (deg > animMax) { animMax = deg; animWorst = `${key}[${i}] (deg)`; }
      }
    } else {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < a.length; i++) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); }
      const range = Math.max(hi - lo, 1e-6);
      for (let i = 0; i < a.length; i++) {
        const rel = Math.abs(a[i] - b[i]) / range;
        if (rel > linearMax) { linearMax = rel; linearWorst = `${key}[${i}]`; }
      }
    }
  }

  const srcPrim = src.json.meshes[0].primitives[0];
  const runPrim = run.json.meshes[0].primitives[0];
  const attrReport = [];
  for (const name of Object.keys(srcPrim.attributes)) {
    const a = readAccessor(src, srcPrim.attributes[name]);
    const b = readAccessor(run, runPrim.attributes[name]);
    if (a.length !== b.length) { attrReport.push(`${name}: LENGTH MISMATCH`); failures++; continue; }
    // vertex/attribute *order* may change (the meshopt encoder optimises vertex+triangle order);
    // set equality is the meaningful measure of "the same mesh".
    const sa = Array.from(a).sort((x, y) => x - y);
    const sb = Array.from(b).sort((x, y) => x - y);
    let dev = 0;
    for (let i = 0; i < sa.length; i++) dev = Math.max(dev, Math.abs(sa[i] - sb[i]));
    attrReport.push(`${name} sorted max|Δ|=${dev.toExponential(2)}`);
  }
  const idxS = Array.from(readAccessor(src, srcPrim.indices)).sort((x, y) => x - y);
  const idxR = Array.from(readAccessor(run, runPrim.indices)).sort((x, y) => x - y);
  let idxDev = 0;
  for (let i = 0; i < Math.min(idxS.length, idxR.length); i++) idxDev = Math.max(idxDev, Math.abs(idxS[i] - idxR[i]));
  const idxSame = idxS.length === idxR.length && idxDev === 0;

  console.log(`\n=== ${id} ===`);
  console.log(`  animation samplers compared : ${compared} (${srcCh.size} accessor refs)`);
  console.log(`  rotation deviation          : max ${rotMaxDeg.toFixed(4)}° (worst ${rotWorst})`);
  console.log(`  linear channel deviation    : max ${(linearMax * 100).toFixed(4)}% of range (worst ${linearWorst})`);
  console.log(`  mesh attributes (sorted)    : ${attrReport.join(', ')}`);
  console.log(`  index set identical         : ${idxSame}  (${idxS.length} indices)`);
}
console.log(`\nfailures (missing/length/dropped data): ${failures}`);
process.exit(failures ? 1 : 0);
