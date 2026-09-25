# 09 — Skinned characters and imported animation contract

**Status:** Target architecture for the next build. The checked-in game still constructs procedural `CharacterRig` instances synchronously. This document specifies the adapter and acceptance criteria; it does not claim that the dog or imported King Croak is playable yet. See [`03-CHARACTERS.md`](03-CHARACTERS.md) for the existing procedural rigs and the character authoring checklist.

## Runtime contract

`Fighter` requests one of 16 animation **state keys**: `idle`, `walkF`, `walkB`, `jump`, `block`, `light`, `heavy`, `special`, `air`, `hit`, `launched`, `down`, `ko`, `getup`, `victory`, `intro`. `blockstun` uses `block`, `grabbed` uses `launched`, and `attack` uses the `MoveDef.slot`. These keys are independent of GLB/FBX clip names. Each skinned fighter needs an explicit per-character binding from state key to source clip, trimmed range and playback policy. A state may use a clip, a procedural pose/overlay, a blend of clips, or an authored replacement. A diagnostic or unrelated clip is not an acceptable final binding merely to satisfy the count.

The adapter must meet the game-facing `CharacterRig` contract: `root`, `play`, `update`, `snap`, `flash`, `tintAmount`/`tintColor`, `charge`, `chestWorld`, `strikeWorld`, `grabAnchorWorld`, `tick` and `impulse`. `Fighter` owns world position, facing, gravity, hit detection, stun and move time. A Three.js `AnimationMixer` owns imported bone animation; optional procedural layers can add face, tongue, prop or recoil motion after mixer evaluation. Use quaternion rotation tracks for bones and preserve imported inverse bind matrices, skeleton hierarchy and skin weights. Prefer per-instance skeleton clones; shared immutable geometry/textures can be reused.

The game currently creates both rigs synchronously in `Game.makeRig`. The build must preload/parse GLBs before match construction (or move match creation behind an async readiness gate), then instantiate skinned adapters. Keep the existing procedural fighters working during migration. Avoid creating an `AnimationMixer` before the model has been cloned for that fighter. Dispose mixer actions, skeleton instances and per-instance materials on replacement; do not dispose shared textures while another fighter uses them.

## Timing authority

All times below are **game seconds after state or move entry**, not source FBX frame numbers. `Fighter.stateTime` and `rig.play(..., true)` reset together. `src/game/moves.ts` is the source of truth for attack duration, hit windows, `fireAt`, cancels and lunge. Imported clips may be trimmed and retimed, but the strike pose/contact point must coincide with each active hit window. Uniform speed change is acceptable only if wind-up, contact and recovery still align; otherwise split and warp segments or author a new clip. When a clip runs longer than the state, state exit wins. When it ends sooner, hold its final pose or transition to a valid loop—do not snap to bind pose.

| State key | Current runtime duration/exit | Required motion and imported-clip policy |
| --- | --- | --- |
| `idle` | Indefinite | Seamless breathing/guard loop. Clear `charge` and transient attack flags on entry. |
| `walkF` | While forward input continues | Seamless in-place forward gait. Cadence follows actual `ctx.fwd`/walk speed; foot contacts should not skate. |
| `walkB` | While backward input continues | Seamless in-place backward gait; may adapt forward source if contact order and body lean are corrected. |
| `jump` | From takeoff until landing; depends on `jumpVel` and gravity 34 units/s² | Takeoff, ascent, apex, descent and landing-aware pose. Prefer velocity/grounded-driven blend or separate phases; do not force a fixed 0.93 s clip to govern physics. |
| `block` | While grounded `down` is held; also through variable `blockstun` | Stable guard loop/held pose with hands protecting the body; react without dropping guard. |
| `light` | `moves[light].duration` | Anticipation, contact during every `hits[]` window, recovery/cancel-compatible pose. |
| `heavy` | `moves[heavy].duration` | Same, with weight and recovery matched to heavy move. |
| `special` | `moves[special].duration` | Character-specific action; align projectile/hazard `fireAt` even if `hits[]` is empty. Drive `charge` during wind-up. |
| `air` | `moves[air].duration`, **or earlier landing** | Air attack contact in its hit window; transition cleanly if landing cancels it. |
| `hit` | Variable `HitWindow.hitstun` | Brief recoil that can be interrupted at any time by state exit; no fixed clip length requirement. |
| `launched` | Until landing; also used for `grabbed` | Airborne flail/held pose, loop or phase blend; must tolerate a grab hold and throw. |
| `down` | **0.85 s** after landing | Grounded living knockdown pose; no repeated falling clip or floor penetration. |
| `ko` | Until round reset | Limp held pose/quiet loop, no repeated fall or twitch. |
| `getup` | **0.55 s** | Complete ground-to-standing recovery in this interval; fighter is invulnerable. |
| `victory` | Usually visible through **3.2 s** round-end phase; may persist at match end | Loop/hold a celebration without floor clipping. |
| `intro` | **2.5 s** round-start phase | One-shot entrance that reaches idle-ready stance by fight start; the cinematic camera may change its framing. |

The previous `03-CHARACTERS.md` gave `getup ≈0.5 s` and `intro ≈2.5 s` as pose-authoring examples. The current state machine fixes getup at **0.55 s** and intro at **2.5 s**. There is no universal fixed duration for idle, walk, jump, block, hit, launched, down/KO loops or victory source clips; their **runtime state behavior** is specified above.

### Current King Croak move timings

These values are the checked-in `toad` config in `src/game/moves.ts`. The imported frog must animate the *same* moves unless combat design is explicitly changed. The earlier RigLab coverage sheet used different draft attack labels and timing, so it is not authoritative for this game.

| Slot / current move | Move ends | Contact / fire event | Animation consequence |
| --- | ---: | --- | --- |
| `light` — Tongue Lash | **0.42 s** | hit **0.12–0.22 s** | Tongue extends and reaches target during this window; Elbow Punch alone does not satisfy it. |
| `heavy` — Gullet Toss | **1.15 s** | grab hit **0.30–0.42 s**; hold **0.50 s** after connection | Tongue/grab anchor must plausibly hold the victim; Hook Punch alone does not satisfy it. |
| `special` — Toxic Croak | **1.35 s** | gas `fireAt` **0.55 s** | Charge and throat/gas release at 0.55 s; no melee `hits[]` window. |
| `air` — Royal Belly Flop | **0.70 s**, or landing | hit **0.12–0.50 s** | Belly-led downward action; landing cancels the move. |

The dog has **no `FighterConfig` in this branch**. Its four attack durations, hit windows and FX cannot be called required values yet. Define them in `moves.ts` first, then retime selected clips to those values. Existing fighters' move durations are character-specific, not a global animation specification.

## GLB / FBX workflow

Use GLB for runtime delivery: it can contain a skinned mesh, skeleton, PBR materials/textures and multiple `AnimationClip`s. FBX is an authoring/import source. Convert/retarget it in RigLab or a DCC tool and export a reviewed GLB (or a companion clip GLB with the same skeleton). Do not load arbitrary FBX at match start on mobile. Source clips are *candidates*; the binding table records which candidate was trimmed/retimed and who approved it.

For same-skeleton clips, verify bone names, hierarchy, rest transforms and coordinate axes before copying tracks. For cross-skeleton motion, use an explicit semantic bone map and rest-pose-relative **quaternion** transfer, then review deformation and contacts. The dog uses a Mixamo humanoid hierarchy; King Croak's 46 bones are numbered but mapped semantically in the handoff work. The snake has a distinct body/arm/tail hierarchy and cannot simply inherit humanoid leg motion. Euler angles remain useful for authoring simple procedural offsets, but interpolate and export skeletal rotations as quaternions to avoid axis-order discontinuities.

Keep fighter locomotion **in place**: neutralize clip X/Z root translation and let `Fighter` own travel, lunge, knockback and wall clamping. Treat imported root Y motion carefully as visual bob, not a second jump. Keep facing local **+Z**, game ground at **Y=0**, and align foot contact after model normalization. Use socket objects parented to the correct bones for `chestWorld`, all four `strikeWorld` slots and `grabAnchorWorld`; test them at the active event time. Cosmetic weapons may attach to hand sockets only for actions that use them. Dog axes need not be permanently equipped.

For a skinned actor, the material flash/tint path must work without mutating textures shared between fighters. `charge` and special effects can be driven by clip-time cues and small procedural overlays. Blend between clips with controlled crossfades; ensure loop transitions, one-shot end holds, interruption by hit/KO, pause, hit-stop and reset all leave the skeleton in a valid pose. Advance the mixer by the game simulation `dt`, not wall-clock time.

## Minimum acceptance checks

1. All 16 state keys resolve to a meaningful motion or documented authored overlay; no silent bind-pose or unrelated diagnostic placeholder.
2. Every attack's visible contact and socket agrees with its actual `moves.ts` hit/fire window; canceled air attacks and chain cancels transition cleanly.
3. Neutral, walk, jump, landing, down/getup and victory keep feet above the floor; no root-motion double travel, skating or obvious chin/gullet clipping.
4. Two instances of the same GLB can fight without sharing mutable skeleton pose or accidentally disposing shared materials/textures.
5. Model import, match start/restart, pause/hit-stop and arena change work; `npx tsc --noEmit` and `npm run build` pass; profile on an A18-class Apple device.
