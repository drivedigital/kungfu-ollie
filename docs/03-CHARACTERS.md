# 03 — Characters: Rig System & Authoring Guide

## 1. Character animation: current implementation and supported target

The **currently implemented** fighters use a procedural mesh hierarchy in `src/game/Rig.ts`: named `Object3D` joints, rest-relative pose functions, and exponential blending. This is one implementation of the `CharacterRig` game-facing contract, **not a restriction on future characters**. The dog and imported King Croak are intended to use skinned GLB meshes and keyframed `AnimationClip`s through a compatible adapter. Their runtime integration is specified in [`09-SKINNED-ANIMATION-CONTRACT.md`](09-SKINNED-ANIMATION-CONTRACT.md) and is not yet present in the checked-in game.

The 16 **required state keys** are `idle walkF walkB jump block light heavy special air hit launched down ko getup victory intro`. They are requests made by `Fighter`, not required filenames inside a GLB. `blockstun` uses `block`; `grabbed` uses `launched`; attacks use their slot key. The imported dog and frog GLBs contain source clips with names such as `Boxing`, `Dwarf Walk`, and `Jump`. A per-character binding maps these source clips, trimmed ranges, authored replacements or procedural overlays to the game keys. Every state must have meaningful behavior before the character is called game-ready.

The existing procedural `Rig` still works as follows:

```ts
class Rig {
  root: THREE.Group;                       // placed/rotated/scaled by Fighter
  joints: Record<string, Object3D>;        // registered procedural joints
  rest: Record<string, RestPose>;          // captured position/rotation/scale
  anims: Record<string, AnimFn>;           // state → (t, pose, ctx) => void
  blendSpeed: Record<string, number>;      // exponential blend rate, default 14
  instant: Set<string>;                    // snap selected joints
  play(name, force?)                       // switches state and resets local time
  update(dt, ctx)                          // evaluates and blends pose
  snap(ctx)                                // reset-time instantaneous pose
  flash(amount)                            // transient damage flash
  tintAmount / tintColor                   // persistent status glow
  registerFlash(materials[])               // materials affected by flash/tint
}
type AnimFn = (t: number, p: Pose, c: AnimCtx) => void;
type Pose = Record<jointName, { rx?,ry?,rz?, px?,py?,pz?, s?,sx?,sy?,sz? }>;
interface AnimCtx { vx; vy; grounded; fwd; facing; hpRatio; seed }
```

For procedural poses, values are offsets from rest, `t` is seconds since state entry, and blending uses `k = 1 − e^(−blendSpeed·dt)`. `kf`, `pulse`, `shiver`, `smooth`, `easeIn` and `easeOut` are authoring helpers. This implementation uses Euler offsets because its joints are simple; the skinned path uses quaternion tracks for bone animation.

### `CharacterRig` game-facing contract

```ts
abstract class CharacterRig extends Rig {
  abstract readonly accent: number;
  abstract readonly sparkColor: number;
  abstract chestWorld(out): Vector3;
  abstract strikeWorld(move, out): Vector3;
  abstract tick(dt, time, fx|null, state): void;
  charge = 0;
  impulse(amount) {}
  grabAnchorWorld(out) → chestWorld;
}
```

`Fighter` also calls inherited `play`, `update`, `snap`, `flash`, reads `root`, and sets `tintAmount`. A skinned adapter can extend this class and override the animation methods, or a later refactor can extract a narrower interface. Preserve the game-facing behavior either way. `fx` in `tick` may be `null` in previews.

For exact state durations, event timing, GLB/FBX mapping, root-motion policy and acceptance checks, use [`09-SKINNED-ANIMATION-CONTRACT.md`](09-SKINNED-ANIMATION-CONTRACT.md). Attack duration and contact windows always come from the chosen fighter's `src/game/moves.ts` entry.

## 2. Character reference

These entries describe the **currently implemented procedural models**, including the existing procedural King Croak. They do not describe the imported dog or the handed-off skinned King Croak GLB.

Common: every rig faces **local +Z**; `Fighter` sets `root.rotation.y = ±π/2`. Heights/widths
used for hitboxes are in `moves.ts` (not derived from meshes).

### Robo-Cluck — `characters/RobotChicken.ts` (`id: "chicken"`)
- Look: brushed-metal chassis (`metalTexture` as map+roughness), riveted plates, cyan neon (`neon`, `eyeMat`
  emissive), blade wings/tail, piston legs with 3 toes + spur, red comb/wattle, gold beak, steam vents, chest `PointLight`.
- Joints: `hips body neck head jaw tail wingL wingR hipL/R kneeL/R ankleL/R`.
- Strike markers: light→`beakTip`, heavy→`footR`, special→`eyeCenter`, air→`footL`; chest→`chest`.
- `tick`: pulses neon/eye/chest light (+`charge`), vent steam every 0.14–0.24 s, embers when `ko/down`.
- Accent `0x38e8ff`, sparks `0x5df6ff`.

### Fluffalo — `characters/FluffyBuffalo.ts` (`id: "buffalo"`)
- Look: dark `undercoat` ellipsoids + **shell fur** coats (see `docs/04` §fur) on torso/neck/head/snout/legs/tail,
  swept forehead fringe, tapered `TubeGeometry` horns, floppy ears, cornflower behind left ear.
- Joints: `body torso neck head earL earR tail tail2 hipFL/FR/BL/BR kneeFL/FR/BL/BR`.
  `torso` is scaled for breathing/squash (`sx/sy/sz`).
- Strike markers: heavy→`hornMid`, air→`belly`, default→`noseTip`; chest→`belly`.
- Overrides `flash`/`impulse` to bump `fur.jiggle`; `tick` writes `fur.time`, decays jiggle (`e^(−5dt)`), nostril steam while `snort`.
- `lying()` uses `ctx.facing` to roll onto the correct side.

### Scrap-Ewe — `characters/ScrapEwe.ts` (`id: "ewe"`)
- Look: rust-red mech (`red/cream/steel/dark` materials on `metalTexture`), glass cockpit with a shell-fur sheep head,
  pink neon strips, shoulder missile pods (`podL/podR`, rotate open), piston arms with cream fists, jet-boot markers (`feet`), back exhausts.
- Joints: `hips body head earL earR shoulderL/R elbowL/R podL podR hipL/R kneeL/R ankleL/R`.
- Strike markers: heavy & air→`fistR`, special→`podCenter`, default→`fistL`; chest→`cockpit`.
- `tick`: neon/chest light pulse (+`charge`), exhaust steam, jet embers while airborne, sparks+smoke when `ko/down`.
- Missile spawn position is computed in `Game.spawnMissile` (not from a marker).

### King Croak — `characters/KingCroak.ts` (`id: "toad"`)
- Look: `MeshPhysicalMaterial` clearcoat skin (`toadSkinTexture`), additive glow shells (`toadGlowTexture`, colour
  pulsed in `tick`), warty instanced bumps, golden eyes with slit pupils and **blinking eyelids** (`lids`, driven by
  `lidOpen` set per-anim + blink timer), throat `sac` (scaled), `jaw`, crown, pet fly (`fly`, orbiting).
- Joints: `hips body head jaw sac tongue armL/R elbowL/R thighL/R kneeL/R ankleL/R`; `tongue/jaw/sac` are **instant**.
- **Tongue mechanism**: `tongue` group rest scale `z = TONGUE_REST (0.03)`; anims set `sz = len / TONGUE_REST` to extend
  along +Z; `tick` counter-scales `tongueTipMesh` so the tip stays round. `tongueTip` marker = strike point for
  light & heavy **and** the `grabAnchorWorld` (victim hangs from the tongue).
- Strike markers: light/heavy→`tongueTip`, special→`mouth`, default→`chest`.
- Locomotion is **hops** (`hopCycle`) rather than a walk; `legsExt(k)` extends the folded hind legs.
- Accent `0x8dff5a`, sparks `0xb8ff80`.

## 3. Checklist: adding a new fighter

1. **Combat data** — Add an id and `FighterConfig` in `src/game/moves.ts`. Define each move's duration, hit/fire windows, reach, FX, meter and cancel rules before final animation timing. Update audio catalog and any other exhaustive `CharId` handling.
2. **Choose a rig path** — Existing procedural fighters subclass `CharacterRig`, register `Object3D` joints, author 16 pose functions, and use `blendSpeed`/`instant`. Imported fighters use a reviewed skinned GLB plus the adapter and state bindings in [`09-SKINNED-ANIMATION-CONTRACT.md`](09-SKINNED-ANIMATION-CONTRACT.md). A source clip name alone does not satisfy a state.
3. **Game-facing sockets and materials** — Implement `accent`, `sparkColor`, `chestWorld`, all four `strikeWorld` slots, `grabAnchorWorld` if needed, and `tick`. Register or otherwise support damage flash and poison tint on appropriate instance materials; avoid flashing additive/glow materials. Set sensible shadow behavior for opaque and transparent parts.
4. **Loading and factory** — Existing `Game.makeRig` is synchronous. Preload imported assets and gate match start before constructing skinned rig instances; keep procedural construction available. Clone skeletons per fighter.
5. **Presentation and engine features** — Add new `MoveDef.fx` visuals, audio slots and any unique move systems in `Game`, `Fighter` and FX as needed. Attach optional weapons to sockets only for their corresponding moves.
6. **UI/AI** — `Menu.tsx` maps `FIGHTERS`, but roster growth may need layout changes. Extend AI for unique threats such as grabs or hazards. Update character and stage copy.
7. **Verify** — Build and type-check, then run the headless recipes in `docs/06`. Review all 16 states, attack event timing, contacts, two-instance behavior, resets, material/texture loading and A18-class mobile performance.

### Design guidance

Keep hitbox `reach` close to the visual reach of the `strikeWorld` socket during `hits[0].start..end`; the game clamps the reported contact point into the defender. Existing move values are character-specific; do not impose a universal 0.4-second light or 0.8-second heavy on imported fighters. For procedural rigs, attack blend speeds around 18–26, idle 6–7 and walk 10–11 are useful starting points; imported clips use crossfade duration and per-state playback rate instead. Rest-pose offsets apply only to the procedural pose path—do not add a bone's rest rotation twice during retargeting.

## 4. Shell fur (`src/game/fur.ts`) quick reference

`furShells(sourceGeometry, opts, shared)` → `InstancedMesh` with `layers` instances of the same geometry;
a vertex shader pushes each shell out along the normal by `length · layer`, adds gravity droop (`droopDir`,
quadratic in layer), curl, idle sway and `jiggle`; the fragment shader thresholds a 3D value noise
(`density` = spatial frequency) against layer height (`if (cov < h) discard`) so tufts taper to soft tips,
darkens roots (`mix(0.4, 1.12, layer)`), mottles colour (`variation`) and adds a rim term.
`mask {n, from, to, min}` shortens hair where `dot(position, n)` crosses `[from,to]` (keeps faces/eyes clean).
`shared = { time:{value}, jiggle:{value} }` uniforms are owned by the character and updated in `tick`.
Cost ≈ `layers × triangles` per part; the buffalo uses 6–16 layers per part. Shells don't cast shadows
(the undercoat mesh does).
