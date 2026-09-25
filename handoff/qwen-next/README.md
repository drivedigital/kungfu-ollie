# Qwen 3.8 Max: continue the skinned fighters and Kyoto integration

## Objective and starting point

Continue on `feat/kyoto-skinned-fighters-handoff` in `drivedigital/kungfu-ollie`. The working integration baseline is commit `7e67d07`. Keep the existing Vite/React/Three.js application. Implement the useful parts of your exported work here, fix the defects described below, and commit/push the result to this branch for review. Do not merge into main. No Next.js migration, database, leaderboard, or paid generation is needed.

The user requested this handoff to reduce local token usage. Complete the work in the remote environment, report measured results and unresolved issues, and avoid asking the user to redo the review already captured here.

Read `docs/09-SKINNED-ANIMATION-CONTRACT.md`, `docs/10-SKINNED-KYOTO-PREVIEW.md`, and `handoff/kyoto-v1/README.md`. Current `src/game/moves.ts` is authoritative for gameplay timing. The sources under `reference/` are from your Qwen ZIP, preserved unmodified for selective porting; they are not compiled into the application. `source-manifest.json` records their hashes. `reference/src/game/Dog.ts` originally came from `src/game/characters/Dog.ts`.

## What is already working

- `src/game/characters/SkinnedFighter.ts` loads the corrected dog and frog with independent cloned skeletons and instance materials, preserves textures, and uses AnimationMixer.
- `src/App.tsx` awaits required character assets before constructing Game.
- Dog is selectable as Ollie. Existing frog combat identities remain Tongue Lash, Gullet Toss, Toxic Croak and Royal Belly Flop.
- Kyoto is selectable with a real level stone floor, simple art planes and falling petals. Attract/intro camera motion is constrained.
- Type checking, production build, live dog/frog match construction, and playback of all 16 state names passed. These are runtime checks, not visual animation approval or A18 performance measurements.

## Assets: use the intact originals

Use `handoff/kyoto-v1/models/dog-chin-corrected.glb`, `kingcroak-corrected.glb`, and `kyoto-cherry-tree-review.glb`. Provenance and checksums are in `handoff/kyoto-v1/asset-manifest.json`. Original artwork is in `handoff/kyoto-v1/reference/`.

All three GLBs in the downloaded Qwen ZIP were corrupted: invalid header lengths and hundreds of thousands of UTF-8 replacement sequences (`EF BF BD`). They are intentionally absent from this handoff. Do not reconstruct binary files through text or reuse those copies. Generate new runtime assets directly from the intact originals and preserve their source files.

Surviving Qwen metadata showed dog 155,648 triangles / 33 joints / 10 clips, frog 16,634 triangles / 46 joints / 24 clips, tree 28,185 triangles. It declared Meshopt compression, WebP textures and mesh quantization. This largely reduced transfer size; dog/frog triangle counts were unchanged. Reproduce selective optimization with a pinned glTF-Transform version (4.5.0 was used), record the exact commands, and configure matching Three.js decoders. Avoid the default all-in-one optimize pipeline without evaluating flatten/join/simplify effects on skins and named sockets. WebP reduces download size, not decoded GPU texture memory. KTX2 is a later candidate if its toolchain and runtime decoder are available.

## Implementation order

1. **Kyoto stage and stage hooks.** Port the camera-envelope and `footfall` interface from reference `arenas/common.ts`. Adapt reference `Kyoto.ts`: curved audience tiers, instanced falling petals and movement/landing bursts, petal piles, lanterns, and one optimized tree. Connect Game's movement/landing events; keep combat at Y=0/Z=0 with the current bounds. Use approved artwork where it looks better than procedural canvas art. Do not add 3D crowds. Check camera coverage during intro, attract, KO, jumps and boundary positions.
2. **Reliable asset preparation.** Adapt reference `skinned/assets.ts` to the Vite app. Add the Meshopt decoder if used, async tree loading, visible loading/failure state, and a retryable cache. Do not retain failed promises permanently. Keep cache-owned geometry/textures separate from instance-owned materials/skeletons. Stage disposal must not destroy shared tree assets; match disposal must not destroy cached fighter geometry.
3. **Bindings and animation overlays.** Adapt `skinned/bindings.ts` and the useful parts of `skinned/SkinnedRig.ts` into the current fighter interface. Explicitly identify root bones and axes, clip trim/rate/loop policy, sockets and reviewed versus provisional states. Implement guard/recoil/bow, frog throat charge and tongue/grab envelopes, and optional dog axe props. Use the imported rig unchanged unless a demonstrated defect requires a separate asset edit. Do not overwrite the preserved chin correction or silently remap skins.
4. **Validation and handback.** Run the checks below, document results, commit and push. Provide a concise status for each required animation and the remaining review tasks.

## Defects to fix during porting

- Reference backward-walk bindings use negative `speed`, but `SkinnedRig.play/update` applies `Math.abs` and only honors `reverse`. Reverse the gait correctly and test wraparound.
- Reference `updateTongue` stores root-local positions while `strikeWorld`/`grabAnchorWorld` return them as world positions. Its quaternion/offset calculations also mix spaces. Use explicit local-to-world transformations. Test both facings, arbitrary fighter X, jump height, and root squash. Grabbed fighters must remain at the visible tongue tip throughout the hold.
- Reference `overlayBase` snapshots are never restored. Restore the previous base before advancing the mixer so overlays cannot accumulate on unkeyed or clamped bones. Verify long holds and repeated transitions.
- Reference `Game.dispose()` traverses and disposes shared geometry. Define ownership and dispose instance materials, skeleton resources, props, glow textures and stage effects exactly once. Test restart and switching away/back to Kyoto and both fighters.
- Reference `RootYPolicy.bob` merely subtracts a mean; it is not a high-pass filter and does not inherently remove drift. Define a bounded bob policy, preserve vertical motion where required for down/getup, and let Fighter own jump height and stage travel. Handle LINEAR/STEP/CUBICSPLINE tracks correctly; do not assume all sampler values are packed VEC3 keys.
- Clip trimming by frame filtering can omit exact endpoints. Sample exact boundaries, validate ranges against actual duration, and retime contact deliberately. Do not certify hit timing from duration fitting alone.
- Action sharing: Three.js caches actions by clip/root. Ensure states with distinct loop/hold/rate policies do not accidentally share and mutate the same AnimationAction.
- Missing clips must be reported as missing/provisional rather than quietly counted as complete because idle played instead. Distinguish playable placeholders from approved moves.
- Existing baseline needs correction too: frog binding durations currently use 0.48/0.86 for light/heavy, while gameplay uses 0.42/1.15. Derive durations from current move definitions. Verify the actual frog head/mouth bone rather than assuming baseline bone_4 or reference bone_5. Baseline block/reaction/intro/down mappings remain rough placeholders.
- Qwen's dog move timing differs from the current branch. Preserve current branch values unless explicitly proposing a gameplay change; update any copied binding notes accordingly.
- `GameShell.tsx` is UI reference only. Keep `src/App.tsx`; do not import API/database reporting or the Next.js shell. The referenced `/art/kyoto-coliseum.jpg` is absent from the ZIP; use an existing served asset.

## Acceptance checks

- `npx tsc --noEmit`, `npm run build`, and `git diff --check` pass. The local build previously took about 70–80 seconds; let it finish.
- Validate each generated GLB; record byte size, triangles, vertices, materials, texture dimensions/formats, extensions, skin joints, and clip names before/after. Preserve all source clips in review assets even if the shipping bundle is smaller.
- Two instances of the same model animate and flash independently. Repeat rematch, character changes and arena changes without missing textures, animation errors, or disposed shared resources.
- All 16 states are explicitly accounted for: idle, walkF, walkB, jump, block, light, heavy, special, air, hit, launched, down, ko, getup, victory, intro. Review both facings and exact attack contact windows. Check feet, floor penetration, root drift, reverse gait, held KO and 0.55-second getup.
- Preserve feedback: frog Elbow Punch's right hand clips its chin/gullet and the elbow skin stretches. Do not claim this is repaired by adding a tongue overlay. Dog chin must retain its correction across the ten original clips.
- Kyoto remains readable in landscape mobile aspect ratios, at both fight boundaries and simultaneous jump apexes. Report draw calls/triangles and browser measurements; do not claim A18 device performance without hardware evidence.
- Export binary assets safely. Prefer a Git commit or byte-preserving ZIP; do not pass GLBs through text encoding. State what was visually inspected and what was only checked structurally.

## Final report requested

Include commit SHA and branch, working preview instructions, asset before/after statistics, animation coverage with provisional rows clearly marked, test results, and a short list of remaining artistic/performance issues. Keep code and documentation centered on the final implementation.
