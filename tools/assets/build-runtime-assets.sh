#!/usr/bin/env bash
# Rebuild the runtime GLBs for the skinned fighters and the Kyoto foreground tree.
#
# Source of truth: handoff/kyoto-v1/models/*.glb  (intact Blender/Three exports, never re-encoded
# from text).  The Qwen ZIP GLBs were corrupted and are not used anywhere in this pipeline.
#
# Pipeline (pinned tooling):
#   gltf-transform 4.5.0  — install with `npm i -D @gltf-transform/cli@4.5.0`
#   sharp (bundled with the CLI) for texture resize/webp
#
# Commands are chained through a scratch directory (gltf-transform 4.5.0 writes a full GLB per
# step; piping stdout into the next command is not reliable because the CLI logs to stdout).
# Scratch files are deleted on exit.
#   prune    — drop unreferenced properties (verified: all textures are referenced on these files)
#   resize   — cap texture dimensions (download size AND decoded GPU memory)
#   webp     — EXT_texture_webp.  Colour/Roughness are lossy q90; normal maps use
#              near-lossless so tangent-space detail survives.  Three r186 decodes WebP natively.
b" form.|b" form.
#   quantize — KHR_mesh_quantization for POSITION/NORMAL/TEXCOORD/WEIGHTS (skin joints untouched)
#   meshopt  — EXT_meshopt_compression (Three needs MeshoptDecoder, wired in SkinnedRig/assets.ts)
#
# Deliberately NOT used: `optimize` (its flatten/join/simplify passes are unsafe for named
# skinning sockets), `simplify` (the chin/elbow feedback is not reviewed at lower density),
# KTX2/ETC1S (needs KTX-Software `toktx` + a runtime KTX2Loader; tracked as future work).
#
# Usage:  bash tools/assets/build-runtime-assets.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

GT=(npx --no-install gltf-transform)
SRC=handoff/kyoto-v1/models
OUT=public/models
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

quantize_skin() { # $1 in  $2 out
  "${GT[@]}" quantize "$1" "$2" --quantize-position 16 --quantize-normal 10 --quantize-texcoord 12 --quantize-weight 12
}

echo "== dog =="
"${GT[@]}" prune "$SRC/dog-chin-corrected.glb" "$TMP/dog-1.glb"
"${GT[@]}" webp  "$TMP/dog-1.glb" "$TMP/dog-2.glb" --slots "{baseColor,metallicRoughness}*" --quality 90 --effort 70
"${GT[@]}" webp  "$TMP/dog-2.glb" "$TMP/dog-2b.glb" --slots "normal*" --near-lossless --quality 90 --effort 70
mv "$TMP/dog-2b.glb" "$TMP/dog-2.glb"
quantize_skin   "$TMP/dog-2.glb" "$TMP/dog-3.glb"
"${GT[@]}" meshopt "$TMP/dog-3.glb" "$OUT/dog.glb" --level high

echo "== king croak =="
"${GT[@]}" prune  "$SRC/kingcroak-corrected.glb" "$TMP/croak-1.glb"
"${GT[@]}" resize "$TMP/croak-1.glb" "$TMP/croak-2.glb" --width 1024 --height 1024
"${GT[@]}" webp   "$TMP/croak-2.glb" "$TMP/croak-3.glb" --slots "{baseColor,metallicRoughness}*" --quality 90 --effort 70
"${GT[@]}" webp   "$TMP/croak-3.glb" "$TMP/croak-3b.glb" --slots "normal*" --near-lossless --quality 90 --effort 70
mv "$TMP/croak-3b.glb" "$TMP/croak-3.glb"
quantize_skin     "$TMP/croak-3.glb" "$TMP/croak-4.glb"
"${GT[@]}" meshopt "$TMP/croak-4.glb" "$OUT/kingcroak.glb" --level high

echo "== kyoto cherry tree =="
"${GT[@]}" prune  "$SRC/kyoto-cherry-tree-review.glb" "$TMP/tree-1.glb"
"${GT[@]}" resize "$TMP/tree-1.glb" "$TMP/tree-2.glb" --width 1024 --height 1024
"${GT[@]}" webp   "$TMP/tree-2.glb" "$TMP/tree-3.glb" --quality 86 --effort 70
"${GT[@]}" quantize "$TMP/tree-3.glb" "$TMP/tree-4.glb" --quantize-position 16 --quantize-normal 10 --quantize-texcoord 12
"${GT[@]}" meshopt "$TMP/tree-4.glb" "$OUT/kyoto-cherry-tree.glb" --level high

ls -la "$OUT"
