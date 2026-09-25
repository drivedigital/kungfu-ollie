# Dog, King Croak and Kyoto Coliseum — build handoff

This branch began as an asset and implementation handoff based on `main` at `027c08e4`. A preliminary playable integration now exists for the corrected dog, skinned King Croak and a basic Kyoto Coliseum stage, while retaining the current combat rules and the three existing arenas. See [`../../docs/10-SKINNED-KYOTO-PREVIEW.md`](../../docs/10-SKINNED-KYOTO-PREVIEW.md) for implementation status and unresolved animation work. The A18-or-newer Apple mobile device is the performance target; measure on hardware before calling the work complete.

Read [`../../docs/09-SKINNED-ANIMATION-CONTRACT.md`](../../docs/09-SKINNED-ANIMATION-CONTRACT.md) for the binding model, exact runtime state durations, current King Croak attack timings and GLB/FBX rules. It distinguishes current code from the planned skinned implementation.

## Supplied files

| File | Contents | Status |
| --- | --- | --- |
| `models/dog-chin-corrected.glb` | Skinned dog, corrected chin/head weights, 10 preserved Mixamo clips | RigLab review asset; not a complete 16-state game fighter |
| `models/kingcroak-corrected.glb` | Original 46-bone King Croak skin, 19 transferred FBX clips plus 5 correction variants | RigLab review asset; contact and attack polish remain |
| `models/kyoto-cherry-tree-review.glb` | Meshy 7.1 cherry tree, 28,299 triangles | Foreground review asset; optimize textures and profile before shipping |
| `reference/kyoto-coliseum-gameplay-view.png` | Approved low-camera color/composition reference | Concept only; do not present its painted floor as collision geometry |
| `reference/kyoto-audience-concept-panel.png` | Anthropomorphic kung-fu crowd reference | Concept only; use low-detail panels/cards, not a skinned crowd |

See `asset-manifest.json` for checksums, byte sizes, clip names, and provenance. The GLBs and artwork were provided or generated during this project. The source Mixamo/FBX animations and Meshy exports need the project owner to confirm distribution rights before public release. Do not include API credentials in code or commits.

## Game architecture to adapt

`src/game/Game.ts` currently creates procedural `CharacterRig`s and arenas synchronously. `src/game/Fighter.ts` expects a `CharacterRig`; the frame loop calls pose states by the 16 names below. Add an async asset preparation step before constructing a match, then a skinned adapter with an `AnimationMixer` that implements the same game-facing contract. Let `Fighter` own X/Y world motion and facing. For locomotion, remove or neutralize clip root X/Z translation so the clip does not double-move the character. Use quaternion tracks from the GLBs, blend between states, and keep the imported skeleton, inverse bind matrices and skin weights intact. Scale and ground each character once at import; do not rescale each animation.

The 16 state names are `idle walkF walkB jump block light heavy special air hit launched down ko getup victory intro`. A bound clip is only a preview candidate until it has been checked against hit windows, floor contact, and transitions. Do not fill missing states by silently reusing unrelated attacks or a frozen T-pose. Keep the existing procedural fighter available as fallback until the skinned path works.

`src/game/moves.ts` owns move identities, duration and contact windows; `src/game/arenas/common.ts`, `src/game/Game.ts`, UI selection, and `src/game/audio/catalog.ts` enumerate stage/fighter IDs. Search all `CharId` and `ArenaId` exhaustiveness points before extending them. Existing `toad` moves are Tongue Lash, Gullet Toss, Toxic Croak, and Royal Belly Flop. The frog animation coverage report was prepared against a RigLab draft with different move labels/timings, so **the current game's `moves.ts` is authoritative** unless gameplay design is explicitly changed. In particular, Elbow Punch must not be declared a completed Tongue Lash, and Hook Punch is not a completed Gullet Toss.

## Provisional action candidates

The table is a starting selection for animation review, not a certification of all 16 states.

| State | Dog | King Croak |
| --- | --- | --- |
| idle | Boxing guard segment; author quieter loop | `Idle · softened` or Jumping Rope at 0.55×; reduce residual bounce |
| walkF | `Run Forward`, slowed and in place | `Dwarf Walk`, approved; make in place |
| walkB | Adapt forward locomotion with backward travel and lean | Adapt `Dwarf Walk`, slower |
| jump | `Front Twist Flip` is an acrobatic alternative; author plain jump | `Jump` (0.93 s) preferred |
| block | Boxing guard segment, held/looped | Author guard pose |
| light | `Boxing` or `Punching Bag`, select a single punch and retime | Author Tongue Lash; Elbow Punch is only a body-motion reference |
| heavy | `Martelo 2` / `Hurricane Kick`, inspect silhouette and contact | Author Gullet Toss; Hook Punch is only a motion reference |
| special | `Dual Weapon Combo` is optional if axes are equipped; author unarmed special otherwise | Author Toxic Croak with throat/charge response |
| air | `Hurricane Kick` / `Front Twist Flip`, retime to hit window | Author belly-flop pose; Capoeira only a movement reference |
| hit | Author recoil | Author recoil |
| launched | `Front Twist Flip` segment, inspect landing | Author flail |
| down | `Run To Rolling` ending pose candidate | `Dying` ending pose candidate; correct floor |
| ko | Limp held pose, no motion loop | Limp held `Dying` final pose, no fall loop |
| getup | `Run To Rolling` recovery candidate | Author 0.55 s recovery |
| victory | `Thriller Part 3` segment candidate | `Victory · floor corrected`; inspect loop |
| intro | `Skinning Test` is diagnostic only; author intro | `Joyful Jump` candidate, unreviewed |

Dog movement is normally bipedal. A quadrupedal pounce/recovery is optional for a specific action. Axes are optional props, not permanent attachments. On King Croak, the right hand still clips the chin/gullet during Elbow Punch and the elbow skin stretches; preserve this feedback for the later polish pass. `Skinning Test`, Boxing and Hurricane Kick on the frog are diagnostics, not approved combat actions. Validate every attack at its actual contact interval from `moves.ts`, including anchor reach and blend-in/out.

## Kyoto Coliseum, first playable pass

Use a real, level 3D stone courtyard at Y=0, a low central medallion or stone pattern, and cosmetic petal kick-up at footfalls/landings. Keep the existing horizontal fighting boundary `±7.6` game units and Z=0 gameplay plane. Do not let edge props obstruct the fighters. Use depth-separated background planes for temple/mountain/sky and curved audience tiers; the supplied audience panel is a visual guide. Small UV-animated or swapped crowd patches are enough to imply cheering. Use one cherry tree as a foreground edge prop, with distant trees represented by cards or artwork. Falling petals, ground piles, warm sunset lighting and modest lantern glow complete this first pass. Keep the fighter silhouettes readable against the crowd.

The current camera tracks fighters and changes distance; attract mode can orbit. A plane-based arena needs a constrained side/front camera envelope, including intro and KO, or its cards will show edges. Test both fighters at each boundary, simultaneous jump apexes, intro, KO, shake, and landscape mobile aspect ratios. Avoid real-time reflective floors and a large stack of transparent full-screen planes. Keep the stone ground and nearby props lit in 3D; use baked art for distant details.

The tree review model is 25 MB with a 2K color map and 4K metallic/roughness map, one double-sided material, and no normal map. Before shipping, test a smaller material map (1K or 2K) and texture compression, verify alpha/overdraw, preserve the original as a review source, and profile the result on an A18-class device. A single prominent tree is reasonable pending measurement; repeated copies are not yet justified.

## Rendering and validation

Load GLBs with `GLTFLoader`; clone skinned actors with `SkeletonUtils.clone` when spawning two instances. Preserve embedded PBR textures, color-space settings, and material channels. Avoid cloning textures for every fighter instance. Keep the current renderer's pixel-ratio cap as an initial setting, then profile frame time, draw calls, GPU memory and texture upload stalls on target hardware. Build must pass `npm run build`; no missing textures or WebGL errors should appear. Verify dog chin across all 10 source clips, frog floor contact and known arm issue, every required gameplay state, Kyoto camera coverage, stage transitions and disposal on match restart.

RigLab's separate local review app now has a shared animation browser. It can preview same-skeleton transfers directly and preliminary dog↔frog retargets through the documented humanoid map. Snake cross-rig transfer remains explicitly unavailable until its distinct skeleton is mapped; do not treat library visibility as approval of motion quality.
