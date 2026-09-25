/**
 * Structural report for the runtime GLBs, comparing each optimised runtime asset against the
 * intact handoff original.  Usage:
 *
 *   node tools/validate/asset-report.mjs            # human readable
 *   node tools/validate/asset-report.mjs --json     # machine readable
 *
 * Reads with @gltf-transform/core (the same SDK version used to build the assets), so
 * EXT_meshopt_compression / EXT_texture_webp / KHR_mesh_quantization are decoded here.
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

const PAIRS = [
  ['dog', 'handoff/kyoto-v1/models/dog-chin-corrected.glb', 'public/models/dog.glb'],
  ['kingcroak', 'handoff/kyoto-v1/models/kingcroak-corrected.glb', 'public/models/kingcroak.glb'],
  ['kyoto-cherry-tree', 'handoff/kyoto-v1/models/kyoto-cherry-tree-review.glb', 'public/models/kyoto-cherry-tree.glb'],
];

const io = new NodeIO()
  .registerExtensions(KHRONOS_EXTENSIONS)
  // runtime assets are EXT_meshopt_compression encoded; the reader needs the decoder module
  .registerExtensions([EXTMeshoptCompression, EXTTextureWebP])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
await MeshoptDecoder.ready;

function summarise(doc, path) {
  const root = doc.getRoot();
  let tris = 0;
  let verts = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      tris += idx ? idx.getCount() / 3 : (pos?.getCount() ?? 0) / 3;
      verts += pos?.getCount() ?? 0;
    }
  }
  const textures = root.listTextures().map((t) => {
    const size = t.getSize();
    return { name: t.getName() || '(unnamed)', mime: t.getMimeType(), w: size[0], h: size[1], bytes: t.getImage()?.byteLength ?? 0 };
  });
  const skins = root.listSkins().map((s) => ({ name: s.getName(), joints: s.listJoints().length }));
  const clips = root.listAnimations().map((a) => {
    const last = (s) => {
      const arr = s.getInput().getArray();
      return arr && arr.length ? arr[arr.length - 1] : 0;
    };
    return {
      name: a.getName(),
      duration: +Math.max(...a.listSamplers().map(last), 0).toFixed(3),
      channels: a.listChannels().length,
      samplers: a.listSamplers().length,
    };
  });
  return {
    path,
    bytes: statSync(path).size,
    generator: root.getAsset().generator,
    extensionsUsed: root.listExtensionsUsed().map((e) => e.extensionName).sort(),
    extensionsRequired: root.listExtensionsRequired().map((e) => e.extensionName).sort(),
    meshes: root.listMeshes().length,
    primitives: root.listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0),
    materials: root.listMaterials().map((m) => ({
      name: m.getName(),
      channels: ['baseColor', 'normal', 'metallicRoughness', 'emissive', 'occlusion'].filter((k) =>
        ({ baseColor: m.getBaseColorTexture(), normal: m.getNormalTexture(), metallicRoughness: m.getMetallicRoughnessTexture(), emissive: m.getEmissiveTexture(), occlusion: m.getOcclusionTexture() })[k],
      ),
      doubleSided: m.getDoubleSided(),
    })),
    tris: Math.round(tris),
    verts,
    textures,
    skins,
    clips,
    joints: root.listSkins()[0]?.listJoints().map((j) => j.getName()) ?? [],
    nodeNames: root.listNodes().map((n) => n.getName()).filter(Boolean),
  };
}

const out = [];
for (const [id, source, runtime] of PAIRS) {
  const before = summarise(await io.read(resolve(source)), resolve(source));
  const after = summarise(await io.read(resolve(runtime)), resolve(runtime));
  const clipNamesBefore = before.clips.map((c) => c.name).sort();
  const clipNamesAfter = after.clips.map((c) => c.name).sort();
  out.push({
    id,
    before,
    after,
    checks: {
      clipsPreserved: JSON.stringify(clipNamesBefore) === JSON.stringify(clipNamesAfter),
      jointsPreserved: JSON.stringify(before.joints) === JSON.stringify(after.joints),
      trisPreserved: before.tris === after.tris,
      vertsPreserved: before.verts === after.verts,
      bytesSavedPct: +(((before.bytes - after.bytes) / before.bytes) * 100).toFixed(1),
    },
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out, null, 2));
} else {
  for (const r of out) {
    console.log(`\n=== ${r.id} ===`);
    console.log(` bytes      ${r.before.bytes} -> ${r.after.bytes}  (${r.checks.bytesSavedPct}% smaller)`);
    console.log(` tris/verts ${r.before.tris}/${r.before.verts} -> ${r.after.tris}/${r.after.verts}`);
    console.log(` extensions ${r.after.extensionsUsed.join(', ') || '(none)'}`);
    console.log(` clips      ${r.before.clips.length} -> ${r.after.clips.length}  preserved=${r.checks.clipsPreserved}`);
    console.log(` joints     ${r.before.skins[0]?.joints ?? 0} -> ${r.after.skins[0]?.joints ?? 0}  preserved=${r.checks.jointsPreserved}`);
    console.log(` textures   ${r.before.textures.map((t) => `${t.w}x${t.h} ${(t.bytes / 1024).toFixed(0)}kB`).join(' | ')}`);
    console.log(`            -> ${r.after.textures.map((t) => `${t.w}x${t.h} ${(t.bytes / 1024).toFixed(0)}kB ${t.mime}`).join(' | ')}`);
    console.log(` materials  ${JSON.stringify(r.after.materials)}`);
    console.log(` clips      ${r.after.clips.map((c) => `${c.name}(${c.duration}s)`).join(', ')}`);
  }
}
