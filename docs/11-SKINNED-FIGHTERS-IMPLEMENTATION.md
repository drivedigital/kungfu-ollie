# 11 — Skinned fighters and the Kyoto stage

Status: **implemented, measured, not fully art-reviewed**. This document records what was built, the
defects that were fixed on the way, and exactly which numbers were verified in a browser, which were
verified offline, and which are still open.

## 1. What changed

| Area | File | Change |
| --- | --- | --- |
| Assets | `src/game/skinned/assets.ts` | Vite-resolvable GLB loading with `GLTFLoader` + `MeshoptDecoder`, cached parse, progress subscription, retryable failures |
| Bindings | `src/game/skinned/bindings.ts` | 16 state keys per fighter → clip / trim / fit / reverse / root-Y policy / procedural overlay, all measured against the imported rigs |
| Rig | `src/game/characters/SkinnedFighter.ts` | Replaces the 233-line baseline. Mixer-driven skinned actor implementing the same `CharacterRig` contract as the procedural rigs |
| Stage | `src/game/arenas/Kyoto.ts` | Rebuilt as a stone courtyard + curved crowd tiers + imported cherry tree; the approved art is reused as the deep backdrop |
| Stage API | `src/game/arenas/common.ts` | `Arena.camera` (camera envelope) and `Arena.footfall` hooks |
| Game | `src/game/Game.ts` | Prepared assets instead of ad-hoc loads, camera envelope clamps, landing footfall, diagnostics snapshot |
| App | `src/App.tsx` | Loading progress row, explicit failure panel with RETRY, `key={gameKey}` remount kept |
| Build | `src/index.css` | Tailwind source scoping (see §2) |

Procedural fighters (`chicken`, `buffalo`, `ewe`) and the three other arenas are untouched. King Croak
keeps his procedural rig as a fallback class, but his binding takes over whenever his GLB loaded.

## 2. Build fix that the new assets exposed

Tailwind v4's automatic source detection scans the whole repository. With the tracked review assets
under `handoff/qwen-next/` and `handoff/kyoto-v1/` (≈45 MB of GLB, some of it text-like after
deflate), the scanner read those binaries as source text, grew past 3 GB and the build was killed by
the OOM killer (`vite build` → `Killed`, exit 137). Verified against the untouched baseline commit
`56391d4`, so this was not caused by the port.

`src/index.css` now declares its sources explicitly:

```css
@import "tailwindcss" source(none);
@source "../index.html";
@source "./**/*.{ts,tsx}";
```

Result: `npm run build` completes in ~4 s, `dist/index.html` 1.23 MB (342 kB gzip), and the generated
CSS matches the classes used in the app (spacing/padding/size utilities all present).

## 3. Browser preview

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 5173     # dev server, hot reload
npm run build && npm run preview              # or the built single file
```

`vite.config.ts` now sets `server.allowedHosts: true` so hosted previews (a proxied host name) can
load the dev server. Open the URL, pick **OLLIE** vs **KING CROAK** on **Kyoto Coliseum**, and the
progress row at the top of the fight screen reports each asset as it resolves.

## 4. Asset statistics (before → after)

Both fighters and the stage prop are rebuilt from the intact originals in `handoff/kyoto-v1/models/`
with `tools/assets/build-runtime-assets.sh`. Nothing was re-exported from the corrupted ZIP binaries.

| Asset | Source bytes | Runtime bytes | Reduction | Triangles | Joints | Clips |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dog fighter | 10,636,004 | 2,291,376 | 78.5 % | 155,648 → 155,648 | 33 → 33 | 10 → 10 |
| toad fighter | 20,585,104 | 2,371,116 | 88.5 % | 16,634 → 16,634 | 46 → 46 | 24 → 24 |
| kyoto tree | 25,269,452 | 1,019,132 | 96.0 % | 28,299 → 28,299 | – | 0 |

Measurements of the shipping bytes (offline, `tools/validate/asset-report.mjs`):

| Asset | Extensions | Textures | Animation payload |
| --- | --- | --- | --- |
| dog | `EXT_meshopt_compression`, `EXT_texture_webp`, `KHR_mesh_quantization` | baseColor + normal, 1024² WebP | 739,516 B → preserved clip names and durations |
| toad | same | baseColor + metallicRoughness + normal, 1024² WebP | 3,035,136 B → preserved |
| tree | same | baseColor 1024² + metallicRoughness 1024² WebP | – |

Geometry, skin joints, clip names and clip durations are **identical** to the source; only encodings
changed. Rotations deviate ≤ 0.83° and linear channels ≤ 2 % of their range
(`tools/validate/meshopt-fidelity.mjs`, 0 failures). The review sets under `handoff/qwen-next/assets/`
keep the full-quality timeline (including the source FLAC/WAV audio tracks on the dog, 12.4 MB, which
the shipping GLB drops deliberately).

## 5. Animation coverage

Which *rig* state a state key plays is in `src/game/skinned/bindings.ts` (`DOG_BINDING`,
`CROAK_BINDING`). Reachability was verified in the browser for all 16 keys on both rigs
(`state-matrix.json`: 32/32 rows reachable, 0 unplayable clips) and photographed at the exact pose for
the 14 frames below.

| State | Ollie (dog) clip | King Croak clip | Source | Provisional |
| --- | --- | --- | --- | --- |
| idle | Boxing (0–0.55 s, 0.4×) | Idle · softened | verified | no |
| walkF | Run Forward (in place) | Dwarf Walk (in place) | verified | no |
| walkB | Run Forward reversed | Dwarf Walk reversed | verified | no |
| jump | Front Twist Flip (0–0.85 s) | Jump | verified | no |
| block | Boxing guard hold | Idle · softened + guard overlay | verified | no |
| light | Punching Bag → 0.42 s | Elbow Punch · open hands + authored tongue lash | verified | **yes** (frog) |
| heavy | Martelo 2 → 0.82 s | Hook Punch · open hands + authored tongue grab | verified | **yes** (frog) |
| special | Dual Weapon Combo → 1.1 s (+ axes) | Idle · softened + throat charge, gas at 0.55 s | verified | **yes** (frog) |
| air | Hurricane Kick → 0.7 s | Capoeira · floor corrected + belly-flop overlay | verified | **yes** (frog) |
| hit | Boxing (recoil overlay) | Idle · softened (recoil overlay) | verified | **yes** (frog) |
| launched | Front Twist Flip (mid) | Jump Backward | verified | no |
| down | Run To Rolling (end pose) | Dying (end pose) | verified | no |
| ko | Run To Rolling (limp hold) | Dying (limp hold) | verified | no |
| getup | Run To Rolling reversed → 0.55 s | Dying reversed → 0.55 s | verified | **yes** (both) |
| victory | Thriller Part 3 loop | Victory · floor corrected | verified | **yes** (dog) |
| intro | Boxing → authored bow | Joyful Jump | verified | **yes** (frog) |

Provisional means: the clip plays, holds its last pose, and was photographed, but the *choice* of that
clip for that gameplay state has not had an art pass. Nothing in this table is a substitute for a
missing clip — a state whose clip is absent from the GLB is reported in `SkinnedFighter.missingStates`
and logged, never silently swapped (all 16 keys resolve on both rigs today).

### Timing contract

`fit` values are read from `src/game/moves.ts` at module load, so a gameplay retune cannot desync the
animation: `light` 0.42 s (dog) / 0.42 s (frog), `heavy` 0.82 s / 1.15 s, `special` 1.1 s / 1.35 s,
`air` 0.7 s / 0.7 s. Get-up is a fixed 0.55 s, intro 2.5 s, down 0.85 s.

Tongue envelopes follow the same source: light extends over 0.05→0.12 s, holds through the 0.12–0.22 s
hit window and retracts by 0.42 s; the gullet toss extends 0.22→0.30 s, holds through the
`grab.hold` of 0.5 s and releases by 1.15 s. The throat charge releases at `moves.ts` `fireAt` (0.55 s).

## 6. Defects fixed during the port

Every item from the handoff's defect list, and how it is fixed:

1. **Reverse gait used `Math.abs`** — the speed is now `|baseSpeed| × rate × (reverse ? −1 : 1)`, and
   action time is seeded to the clip duration, so the walk genuinely plays backwards.
2. **Tongue mixed local and world space** — the mouth point and direction are converted from model
   space into bone-local space once at startup, then re-expressed in `root` space each frame with
   explicit `localToWorld` / `worldToLocal` pairs.
3. **Overlay quaternions accumulated** — each frame copies the mixer pose into a snapshot array before
   applying overlays, so a procedural offset can never stack on an unkeyed or clamped channel.
4. **Clip doubles-up between states** — each state gets a distinct `AnimationClip` (trim, or clone),
   so two states that share a source clip can never share one `AnimationAction`.
5. **`dispose` ownership** — `disposeRig()` is idempotent, frees only instance-owned materials and
   geometries (glow *texture*, GLB geometry and shared textures stay in the cache), and is reachable
   through `isSkinnedFighter()` in `Game.dispose`.
6. **Bounded vertical root motion** — `strip` freezes Y, `keep` preserves floor interaction for
   down/ko/getup, and `bob` is a real moving-average high pass (±0.12 units) rather than mean removal,
   so a sprint clip cannot inject a second jump.
7. **Exact endpoint trim** — trim bounds are sampled through the track's own interpolant; no frame
   filtering, so the strike pose is not shifted off its hit window.
8. **Missing clips reported** — `console.warn` plus `missingStates`, surfaced in the diagnostics
   snapshot; the baseline's frog state table pointed at clips the file no longer contains.
9. **Frog head/chest bones** — `bone_5` is the head *and* gullet, `bone_3` the chest, `bone_9`/`bone_25`
   her left/right hands, `bone_41`/`bone_45` her feet. Derived from skin weights and bind centroids
   (`tools/validate/skeleton-map.mjs`), not from the reference's placeholder names.
10. **Dog timings preserved** — `Snap Strike` 0.42 s, `Martelo Kick` 0.82 s, `Twin Fang Rush` 1.1 s,
    `Pounce Slam` 0.7 s; the reference's "Paw Jab / Whirlwind Axes" variant was not adopted.
11. **Root axes are measured, not assumed** — the dog's armature carries a +90° X rotation, so
    `Run Forward` travels `Hips.position.y` and rises along `−z`; the frog travels `bone_0.position.z`
    with up as `+y` (`tools/validate/root-axes.mjs`).
12. **Authored tongue pitch clamp** — the imported punch clips pitch the head far enough that a 2.5 m
    lash would spear the floor (measured tip Y −0.11 before the clamp, +0.52 after). The lash keeps
    its length and stays above the stage.

## 7. Browser measurements

Captured with `tools/preview/capture.mjs` against the production build, 900 × 420 (a 2.14:1 landscape
phone aspect), Chromium 123 + ANGLE/SwiftShader on a 2-core sandbox. **Software rasterizer** — the
frame times below say nothing about A18 hardware, which was not available.

| Observation | Value |
| --- | --- |
| Draw calls, fight phase | 57–62 |
| Triangles, fight phase | ≈405,700 (dog 155,648 + frog 16,634 + Kyoto) |
| Textures / geometries in memory | see `browser-measurements.json` |
| Camera inside envelope (intro, fight, boundaries, apex) | true in all four shots |
| Fighter framing at ±7.6 boundary | NDC x −0.50 … 0.42 |
| Simultaneous jump apexes | NDC x −0.44 … 0.39 |
| Console errors / failed asset requests (excluding blocked external audio CDN) | 0 |

Contact-window evidence (`state-frames.json`, each pose frozen by stepping the simulation, not by
poking the rig):

| Frame | Attacker pose | Result on the other fighter |
| --- | --- | --- |
| light-contact | dog `attack` slot light @0.20 s | toad `hit` @0.06 s |
| heavy-contact | dog `attack` slot heavy @0.36 s | toad `launched` @0.06 s |
| special-charge | dog `attack` slot special @0.50 s | toad `launched` @0.10 s |
| frog-light-contact | toad `attack` slot light @0.18 s, tongue 2.45 | dog `hit` @0.06 s |
| frog-heavy-grab | toad `attack` slot heavy @0.36 s, tongue 2.50 | dog `grabbed` @0.06 s |
| frog-air | toad `attack` slot air @0.32 s | dog `launched` @0.20 s |
| knockdown / ko-hold / getup-mid | both rigs, state clocks 0.6 s / 1.0 s / 0.3 s | held poses, no bind-pose snap |

During the soak run both fighters were built from the *same* GLB (`dog` vs `dog`): separate roots,
separate material arrays, separate mixers, and a flash on one rig leaves the other's emissive
intensity untouched. Repeated rematches and arena swaps show no missing textures and no console
errors.

## 8. Ground contact (feet vs the stage floor)

The imported clips were authored for their own rigs, so their absolute root height does not match a
stage floor at Y=0, and a clip's lowest vertex can sit well below the model origin. Rather than
hand-tuning by eye, each state carries an explicit `ClipBinding.yOffset` in *source* units, measured
in a browser pass (`tools/preview/foot-contact.mjs`) that steps the simulation, samples the posed
skinned silhouette (real `getVertexPosition`, not bone centres) and reports the lowest point. The
offset is eased over ~0.1 s in `SkinnedFighter.update` so a state change settles instead of popping.

Steady-state result, world metres above/below the floor (negative = penetration):

| Fighter | worst steady state | typical | worst transient frame |
| --- | ---: | ---: | ---: |
| Ollie | 0.009 (get-up) | ≤ 0.002 | −0.10 (KO / get-up entry frames) |
| King Croak | −0.031 (walk back) | ≤ 0.003 | −0.14 (guard entry) |

Airborne states (`jump`, `air`, `launched`) keep the offset measured from their *take-off* frames, so
they cannot hover at take-off. The remaining transient dips are the imported clips' own crouch
phases passing through the floor for a few frames while the fighter is still on the ground; the
proper fix is a time-varying ground offset (a crouch aware clamp) and it is listed as an open issue.

Two wrong assumptions were caught by this pass and fixed, rather than papered over with offsets:

1. **Height normalisation used the head bone.** The dog's head bone sits 0.44 m below the top of its
   head, so scaling "head-bone-to-ground" to the configured height inflated the dog to 2.73 m and the
   frog to 2.55 m, breaking the size relationship between them. Height now comes from the mesh
   bounding box (`box.max.y`), with the head bone only as a fallback; measured silhouettes are now
   2.06–2.14 m for the dog and 1.53–1.66 m for the frog against configured heights 2.15 / 1.6.
2. **Socket points were converted to bone space at the wrong scale.** The holder carries the import
   scale, so `bone.worldToLocal(point)` divided the model-space point by that scale as well; the
   tongue's mouth anchor and every strike/grab socket were off by 18 % on the frog (measured mouth
   anchor sat 0.35 m below the snout). Model-space points are now pre-scaled before the inverse.

## 9. Known issues

Artistic / unresolved (all visible in the evidence shots):

- The keyed audience panels still tile visibly at 12–14 instances per band; the approved art is a
  single wall of faces, so repeats read as a pattern at the widest camera clamp.
- The dog's `Boxing` clip is used for idle, block, hit and intro; the poses are distinct but the
  motion vocabulary is small until dedicated clips exist.
- King Croak's imported punch arcs still cross his chin (preserved feedback — §9), and the tongue
  passes close to the right hand on the light lash.
- The tree GLB is placed as a single edge prop; there is no shadow-catcher, so its contact shadow is
  faked by petal piles rather than a real shadow.
- No hardware performance data. Draw calls are healthy, but the dog alone is 155 k triangles with a
  33-joint skin and three 1024² WebP textures; a mid-range phone needs a real profile pass.
- Airborne entries can dip through the floor for a few frames (worst −0.34 m on the frog's
  `Jump`-sourced take-off crouch) because the imported crouch is authored below the model origin; a
  crouch-aware, time-varying ground offset is the correct fix.
- Ollie's `special` (`Dual Weapon Combo`) has no trim, so the 3.63 s combo is squeezed into the
  1.1 s Twin Fang Rush at 3.3× speed — legible in the evidence frame but frantic as motion.

## 10. Preserved feedback (do not "fix" silently)

- King Croak's right hand still clips the chin/gullet during Elbow Punch, and the elbow skin stretch
  remains. The authored tongue is presentation only: `strikeWorld` returns the tongue tip while the
  lash is out, so the hit window matches what the player sees, but the elbow/chin overlap is not
  hidden by it.
- The dog's corrected chin/head weights were carried through the asset rebuild unchanged; the ten
  original clips were verified by name and duration after compression, so the correction is intact
  across all of them.

## 11. Reproducing the measurements

```bash
node tools/validate/asset-report.mjs           # per-GLB structure, textures, clips, extensions
node tools/validate/meshopt-fidelity.mjs       # decode fidelity against the source
node tools/validate/skinned-probe.mjs          # bind bounds, per-clip root travel, foot clearance
node tools/validate/skeleton-map.mjs           # semantic bone map from skin weights
node tools/validate/root-axes.mjs              # which axis carries travel and facing
node tools/validate/head-bounds.mjs <glb> <bones...>   # weighted head/mouth bounds
node tools/validate/clip-ground-profile.mjs <glb> [clip]  # per-clip floor contact over time
node tools/validate/binding-clips.mjs          # every binding row resolves to a real clip + sane retime
node tools/preview/capture.mjs --mode=all      # browser shots, state matrix, soak, contact frames
node tools/preview/foot-contact.mjs            # per-state foot/floor audit + yOffset suggestions
```

`capture.mjs` needs a Chromium with WebGL; `tools/README.md` explains how to point it at one and why
this sandbox cannot download a browser. Results land in `handoff/reports/preview/`.
