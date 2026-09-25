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

## `tools/validate/` (rig mapping helpers)

These were written while porting the imported rigs and are the source of the socket / axis / bone
numbers in `src/game/skinned/bindings.ts`:

| script | what it proves |
| --- | --- |
| `skeleton-map.mjs` | for every joint: skin-weight sum, bind-space centroid, parent, bind translation — how a numbered skeleton (`bone_0…bone_45`) gets a semantic map without guessing |
| `root-axes.mjs` | world bind positions of the key bones plus, per locomotion clip, the direction the root translation track travels, in local and world space — this is how "which axis is forward / up" is decided |
| `head-bounds.mjs` | weighted geometry bounds for a joint (or joint pair), used to place head and mouth sockets from the mesh instead of assuming an offset |

```bash
node tools/validate/skeleton-map.mjs
node tools/validate/root-axes.mjs
node tools/validate/head-bounds.mjs handoff/kyoto-v1/models/kingcroak-corrected.glb bone_5
```

## `tools/preview/capture.mjs`

Browser evidence harness (screenshots, render statistics, the 16-state matrix, the rematch soak, and
contact-window frames frozen by stepping the simulation).

```bash
CHROMIUM_PATH=/path/to/chromium PREVIEW_URL=http://127.0.0.1:8099 \
  node tools/preview/capture.mjs --mode=all --width=900 --height=420
```

Modes: `shots` (intro / fight / both boundaries / jump apex with draw calls and NDC framing),
`states` (32-row state matrix + 16 pose frames), `soak` (dog vs dog in one match, independent flash,
three rematches), `all`.

Notes for reviewers:

- `puppeteer-core` is **not** a dependency of the game. Install it next to the harness
  (`npm i puppeteer-core@23`) or point `NODE_PATH` at an existing copy; the game bundle is unaffected.
- The harness drives the *real* input sampler and the real state machine — it never pokes the rig to
  fake a pose. Contact frames are produced by stepping the game's own update loop until the move's
  state clock reaches its `moves.ts` contact time, then freezing.
- Under a software rasterizer (no GPU) the page renders at roughly 1 fps and the simulation clamps
  `dt` to 0.05 s per frame, so wall-clock waits do not advance the fight. That is why the harness
  steps the simulation by hand; frame times measured there must not be quoted as device performance.
- Chromium in this repository's CI sandbox came from the `@sparticuz/chromium` npm package plus its
  bundled NSS libraries (`bin/al2023.tar.br`, `LD_LIBRARY_PATH` pointed at the unpacked `lib/`).
  No CDN download is possible in that sandbox, and none is needed at runtime by the game itself.
