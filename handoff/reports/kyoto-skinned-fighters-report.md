# Skinned fighters + Kyoto stage — implementation report

Branch: `feat/kyoto-skinned-fighters-handoff` · Base commit `56391d4` · Assets commit `197c126` ·
Implementation commit `HEAD` (see the bottom of this file for the exact SHA and how it was pushed).

Everything below is reproducible from the repository: source files are tracked, binary assets are
committed (never passed through text encoding), and every number comes from a script in
`tools/validate/` or `tools/preview/`.

---

## 1. What was asked for, and what is done

| Handoff requirement | Status |
| --- | --- |
| Keep the Vite/React/Three app, no Next.js / DB / leaderboard | done — no new runtime dependencies |
| Rebuild optimized GLBs from the *intact originals* | done — `tools/assets/build-runtime-assets.sh`, originals in `handoff/kyoto-v1/models/` |
| Do not reuse the corrupted ZIP binaries | done — the three ZIP GLBs are ignored entirely |
| Selectively integrate Kyoto environment + skinned animation | done — `src/game/arenas/Kyoto.ts`, `src/game/characters/SkinnedFighter.ts`, `src/game/skinned/*` |
| Preserve the current combat, camera and 16-state contract | done — `moves.ts`, `Fighter.ts` timings untouched; `docs/09` honoured |
| Validate each GLB before/after (bytes, tris, verts, materials, textures, extensions, joints, clips) | done — §3, `tools/validate/asset-report.mjs` |
| Two independent instances; rematch / fighter / arena changes with no missing textures or errors | done — §6, `dog vs dog` soak |
| All 16 states, both facings, exact windows, no root drift, reverse gait, held KO, 0.55 s get-up | done — §4, §5, §8 |
| Preserve frog Elbow Punch feedback and the dog's corrected chin | done — §7 |
| Kyoto readable in landscape mobile aspect ratios at both boundaries and jump apexes | measured at 900 × 420 — §5 |
| Export binaries safely | GLBs committed to git (byte-identical to what the game loads) |
| Report validation, asset stats, animation coverage, unresolved issues | this file + `docs/11-SKINNED-FIGHTERS-IMPLEMENTATION.md` |

## 2. How to preview

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 5173      # dev server (hot reload)
npm run build && npm run preview               # built single-file bundle
```

Then: **VS CPU → OLLIE (player 1) → KING CROAK (CPU) → KYOTO COLISEUM → FIGHT!**

The fight screen shows a small progress row while the fighter GLBs and the stage prop load
(`dog fighter 2291 kB · toad fighter 2371 kB · kyoto stage 1019 kB`). If an asset fails, a red panel
appears with **RETRY** (which clears the cache and re-requests) and **BACK TO TITLE**; the match is
never started with a silently missing fighter.

Automated preview/evidence runs:

```bash
CHROMIUM_PATH=/path/to/chromium PREVIEW_URL=http://127.0.0.1:8099 \
  node tools/preview/capture.mjs --mode=all      # shots, 16-state matrix, contact frames, soak
CHROMIUM_PATH=… PREVIEW_URL=… node tools/preview/foot-contact.mjs   # per-state foot/floor audit
```

## 3. Asset statistics (before → after)

Source: `handoff/kyoto-v1/models/*.glb` (the intact originals). Rebuilt with pinned glTF-Transform
4.5.0: `prune → resize → webp → quantize → meshopt`, never `optimize` on a skinned mesh.

| Asset | Bytes before | Bytes after | Δ | Triangles | Vertices | Joints | Clips |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `dog.glb` (Ollie) | 10,636,004 | 2,346,344 | −77.9 % | 155,648 → 155,648 | 88,962 → 88,962 | 33 → 33 | 10 → 10 |
| `kingcroak.glb` | 20,585,104 | 2,427,652 | −88.2 % | 16,634 → 16,634 | 10,274 → 10,274 | 46 → 46 | 24 → 24 |
| `kyoto-cherry-tree.glb` | 25,269,452 | 1,043,108 | −95.9 % | 28,299 → 28,299 | 67,229 → 67,229 | – | 0 |

Per-file detail:

| Asset | Extensions | Materials | Textures before → after |
| --- | --- | --- | --- |
| dog | `EXT_meshopt_compression`, `EXT_texture_webp`, `KHR_mesh_quantization` | `Material_0` (baseColor, normal) | 1024² png/jpeg 1.07 MB + 2.10 MB → 1024² webp 638 kB + 171 kB |
| kingcroak | same | `model` (baseColor, normal, metallicRoughness) | 3 × 2048² 3.01/5.82/5.99 MB → 3 × 1024² webp 94/198/765 kB |
| tree | same | `BakedMaterial` (baseColor, metallicRoughness) | 2048² + 4096² 7.17 + 15.08 MB → 2 × 1024² webp 248 + 73 kB |

Clip names and durations are **identical** to the source for all three files (verified by
`asset-report.mjs`), e.g. the dog keeps `Boxing(1.733s) … Thriller Part 3(25.567s)` and King Croak
keeps all 24 clips including the five `·`-suffixed corrections. The review set
(`handoff/qwen-next/assets/`) additionally keeps the dog's original FLAC/WAV audio tracks
(12.4 MB) with the full-quality timeline; the shipping bundle drops audio deliberately.

Fidelity: `tools/validate/meshopt-fidelity.mjs` decodes the shipped files with the same decoder the
browser uses and compares every animation sampler and mesh attribute against the originals —
**0 failures**, rotation deviation ≤ 0.83°, linear channels ≤ 2 % of their range.
`tools/validate/skinned-probe.mjs` reproduces the bind-pose bounds to 1e-4
(dog 1.4773 × 2.0842 × 1.2263, frog 1.6847 × 1.8951 × 1.4579).

## 4. Animation coverage

Complete table with clips, trims, retimes and notes: `docs/11-SKINNED-FIGHTERS-IMPLEMENTATION.md` §5.
Static audit: `node tools/validate/binding-clips.mjs` → *16/16 rows for both fighters resolve to a
clip that exists; every retime factor inside the rig's clamp*. Runtime audit: all 16 state keys were
requested on both rigs in the browser (32 rows, `state-matrix.json`).

Provisional rows (clip plays and holds correctly, but the *choice* of clip for that gameplay state
still needs an art pass — the game will report these as provisional, they are not silently passed off
as final):

| Fighter | Provisional states |
| --- | --- |
| Ollie | `getup`, `victory` |
| King Croak | `light`, `heavy`, `special`, `air`, `hit`, `getup`, `intro` |

Timing authority is `src/game/moves.ts`; `fit` values are read from it at module load, so
`light` 0.42 s / `heavy` 0.82 s / `special` 1.1 s / `air` 0.7 s (dog) and 0.42 / 1.15 / 1.35 / 0.7
(frog) cannot silently drift. Get-up is the fixed 0.55 s, down 0.85 s, intro 2.5 s.

## 5. Browser measurements

900 × 420 (2.14:1, a landscape phone aspect), production build, Chromium + ANGLE/SwiftShader on a
2-core sandbox **without a GPU**. Frame times from this environment are meaningless for hardware and
are deliberately not quoted; draw calls and triangle counts are real. Raw JSON:
`handoff/reports/preview/browser-measurements.json`.

| Observation | Result |
| --- | --- |
| Draw calls (fight / intro) | 57 / 62 |
| Triangles per frame | ≈ 405,600 |
| Fighter framing at ±7.6 boundaries | NDC x −0.49 … 0.42 (both fighters fully inside the frame) |
| Simultaneous jump apexes | NDC x −0.46 … 0.40 |
| Camera inside the Kyoto envelope | true in all four shots |
| Console errors / failed requests (excluding the blocked external audio CDN) | 0 |
| Textures / geometries in memory after 3 rematches | stable, see JSON |

Contact-window frames (`state-frames.json`) are produced by driving the real input sampler and
stepping the game's own update loop until the move's state clock reaches the `moves.ts` contact time,
then freezing `timeScale` — the screenshot shows the pose the hit test used:

| Frame | Attacker | Result on the opponent |
| --- | --- | --- |
| light-contact | dog `attack` slot light @0.20 s | toad `hit` |
| heavy-contact | dog `attack` slot heavy @0.36 s | toad `launched` |
| special-charge | dog `attack` slot special @0.50 s (axes out) | toad `launched` |
| frog-light-contact | toad `attack` slot light @0.18 s, tongue 2.49 m | dog `hit` |
| frog-heavy-grab | toad `attack` slot heavy @0.36 s, tongue 2.50 m | dog `grabbed` |
| frog-air | toad `attack` slot air @0.18 s | dog `hit` |
| walk-backward / guard-block | both rigs, reverse gait / held guard | – |
| knockdown / ko-hold / getup-mid / victory / intro | both rigs at 0.6 / 1.0 / 0.3 / 1.2 / 1.6 s | held poses, no bind-pose snap |

## 6. Independence and disposal

- Two instances of the same file (`dog` vs `dog`) run simultaneously: separate `SkeletonUtils.clone`
  skeletons, separate material clones, separate mixers. A flash applied to fighter 1 leaves fighter
  2's emissive intensity at zero (`browser-measurements.json → flash`).
- Three consecutive rematches plus an arena/fighter swap: draw calls, texture and geometry counts
  return to the same values, no missing textures, no console errors.
- `SkinnedFighter.disposeRig()` is idempotent and only frees instance-owned materials, glow sprites
  and procedural geometry; GLB geometry and textures stay in the asset cache for the next match
  (that ownership boundary is documented in the source and in `docs/11`).
- `Game.dispose()` reaches it through `isSkinnedFighter()`.

## 7. Preserved feedback and known issues

Preserved on purpose (do **not** treat these as regressions):

- King Croak's right hand still clips the chin/gullet during Elbow Punch and the elbow skin still
  stretches. The authored tongue is presentation: `strikeWorld` returns the tongue tip while the
  lash is out so the hit window matches what is drawn, but nothing hides the hand/chin overlap.
- The dog's corrected chin/head weights were carried through compression unchanged; all ten original
  clips were verified by name and duration after the rebuild.

Unresolved (all visible in `handoff/reports/preview/`):

1. The audience art tiles across 12–14 panels per band; at the widest camera clamp the repeats are
   visible as a pattern.
2. Airborne entries can dip below the floor for a few frames (worst −0.34 m on the frog's take-off
   crouch, from the imported `Jump` clip being authored below the model origin). A crouch-aware,
   time-varying ground offset is the proper fix; the current per-state offset is static.
3. Ollie's `special` has no trim: a 3.63 s combo is retimed into the 1.1 s Twin Fang Rush at 3.3×,
   which reads as frantic motion.
4. No hardware performance evidence. 57 draw calls and ≈406 k triangles per frame on a 2-core
   software rasterizer say nothing about a phone; an A18/Adreno profile pass is still required.
5. The dog's imported clip vocabulary is small (idle, block, hit and intro share `Boxing`), so the
   motion variety is limited until dedicated clips exist.

## 8. Two defects found by measurement (fixed)

- **Height normalisation used the head bone.** The dog's head bone sits 0.44 m below the top of its
  head: scaling head-height to the configured height inflated the dog to 2.73 m and the frog to
  2.55 m. Height now comes from the mesh bounding box; measured silhouettes are 2.06–2.14 m (dog)
  and 1.53–1.66 m (frog) against configured 2.15 m / 1.6 m.
- **Sockets were converted to bone space at the wrong scale.** Because the import holder carries the
  scale, `bone.worldToLocal(point)` also divided by it — every socket was 18 % short on the frog
  (the tongue's mouth anchor sat 0.35 m below the snout). Model-space points are now pre-scaled
  before the inverse.

Both were caught by the browser probes in `tools/preview/` and are described in `docs/11` §8, along
with the ground-contact numbers that the per-state `yOffset` values were derived from.

## 9. Commit / branch / how this was pushed

- Branch: `feat/kyoto-skinned-fighters-handoff`
- Assets commit: `197c126` — *Rebuild runtime GLBs from the intact originals with a pinned
  glTF-Transform pipeline* (binary GLBs in `public/models/`, pipeline in `tools/assets/`)
- Implementation commit: see `git log -1 --format=%H` on this branch (`HEAD`), message
  *Skinned dog/King Croak rigs, Kyoto stage rebuild, browser evidence harness*
- Pushed with `git push origin arena/01a0d74b-kungfu-ollie` (this working session is pinned to that
  remote branch); `feat/kyoto-skinned-fighters-handoff` is the intended merge target and is **not**
  merged into `main`.

Binary safety: every GLB was committed through Git (which stores bytes verbatim). No BLB/GLB was
opened, edited or transported as text at any point.
