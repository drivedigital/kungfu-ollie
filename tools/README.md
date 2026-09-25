# Tools

Offline tooling. Nothing here is part of the shipped bundle.

## `tools/assets/build-runtime-assets.sh`

Rebuilds the runtime GLBs in `public/models/` from the intact originals in
`handoff/kyoto-v1/models/` using a pinned glTF-Transform 4.5.0:

```bash
bash tools/assets/build-runtime-assets.sh
```

Steps per asset: `prune` → (`resize`) → `webp` (colour/roughness lossy q90, normal maps
near-lossless) → `quantize` (KHR_mesh_quantization) → `meshopt` (EXT_meshopt_compression).
The `optimize` command is deliberately not used: its flatten/join/simplify passes are unsafe for
named skinning sockets, and simplification has not been visually reviewed.

## `tools/validate/`

All three checks run in Node with no browser and no WebGL.

| script | what it proves |
| --- | --- |
| `asset-report.mjs` | before/after structure: bytes, triangles, vertices, materials, texture dims/format, extensions, skin joints, clip names + durations |
| `meshopt-fidelity.mjs` | decodes `EXT_meshopt_compression` with the same decoder the browser uses and compares every animation sampler and mesh attribute against the original |
| `skinned-probe.mjs` | loads the shipped GLBs through the real runtime path (three `GLTFLoader` + meshopt decoder + quantization + skinning), then measures bind-pose bounds and, per clip, root-bone travel and the lowest foot/body point |

```bash
node tools/validate/asset-report.mjs
node tools/validate/meshopt-fidelity.mjs
node tools/validate/skinned-probe.mjs
```

`skinned-probe.mjs` strips textures from an in-memory copy of each document (there is no image
decoder in Node); geometry, skins, animations and materials are untouched, and every pose is
evaluated with `AnimationMixer`, `Skeleton` and `SkinnedMesh.getVertexPosition()`.
