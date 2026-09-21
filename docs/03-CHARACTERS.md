# 03 — Characters: Rig System & Authoring Guide

## 1. The rig system (`src/game/Rig.ts`)

A character is a **procedural mesh hierarchy** whose named joints are driven by **pose functions**
evaluated every frame and **blended exponentially** toward the target. There are no keyframe clips or
skinned meshes; everything is code.

```ts
class Rig {
  root: THREE.Group;                       // placed/rotated/scaled by Fighter each frame
  joints: Record<string, Object3D>;        // registered via joint(name, obj, parent)
  rest: Record<string, RestPose>;          // captured at registration (position/rotation/scale)
  anims: Record<string, AnimFn>;           // name → (t, pose, ctx) => void
  blendSpeed: Record<string, number>;      // per-animation blend rate (default 14)
  instant: Set<string>;                    // joints that snap instead of blending
  play(name, force?)                       // switches animation, resets its local time
  update(dt, ctx)                          // evaluates anim → pose, eases joints toward rest+offset
  snap(ctx)                                // apply current pose instantly (used on reset)
  flash(amount)                            // white damage flash on registered materials (decays e^(−12dt))
  tintAmount / tintColor                   // persistent status glow (poison), lerped by Fighter
  registerFlash(materials[])               // which MeshStandardMaterials flash/tint
}
type AnimFn = (t: number, p: Pose, c: AnimCtx) => void;
type Pose = Record<jointName, { rx?,ry?,rz?, px?,py?,pz?, s?,sx?,sy?,sz? }>;   // OFFSETS from rest
interface AnimCtx { vx; vy; grounded; fwd; facing; hpRatio; seed }
```

Key semantics:
- Pose values are **offsets from the rest pose** (rotations add, positions add, scales multiply).
  A joint not mentioned in a pose eases back to rest.
- `t` passed to an `AnimFn` is **seconds since that animation started** (reset by `play`), so attack
  animations line up with `HitWindow.start/end` in `moves.ts` by construction.
- Blend: `k = 1 − e^(−blendSpeed·dt)`. Attack anims use high speeds (18–26) for snap, idles low (6–7).
  Joints in `instant` (e.g. King Croak's tongue/jaw/sac) apply the pose with `k = 1`.
- Curve helpers for authoring: `kf(t, [[time,value],...], ease?)` piecewise smooth keyframes,
  `pulse(t, start, peak, end)` impulse envelope, `shiver(t, freq, decay)` decaying oscillation,
  `smooth/easeIn/easeOut`.

### `CharacterRig` contract (what `Fighter`/`Game` call)

```ts
abstract class CharacterRig extends Rig {
  abstract readonly accent: number;      // UI/FX colour (hit light, KO ring)
  abstract readonly sparkColor: number;  // hit spark colour
  abstract chestWorld(out): Vector3;     // centre of mass (KO embers, poison bubbles, missile target uses pos instead)
  abstract strikeWorld(move, out): Vector3;   // contact point for a move slot ("light"|"heavy"|"special"|"air")
  abstract tick(dt, time, fx|null, state): void; // per-frame secondary motion: glow pulses, vents, blinking, fur uniforms
  charge = 0;                            // set by the special animation (0..1) → eyes/core flare in tick
  impulse(amount) {}                     // landings / swings → fur jiggle (override if you have secondary motion)
  grabAnchorWorld(out) → chestWorld      // where a grabbed victim is held (override for grapplers)
}
```

`fx` in `tick` may be `null` (rig previews); always guard.

### Required animation names (all 16 must exist)

`idle walkF walkB jump block light heavy special air hit launched down ko getup victory intro`

| Anim | Driven how | Authoring notes |
|---|---|---|
| `idle` | looping | breathing, fidgets; **must reset `this.charge = 0`** (and other per-anim flags) |
| `walkF` / `walkB` | looping, `t` continuous | cycles use `t·frequency`; back-walk is slower & leans back |
| `jump` | uses `ctx.vy` | `u = smooth((−vy + 3)/7)` = 0 rising → 1 falling |
| `block` | looping | also used for `blockstun` |
| `light/heavy/special/air` | one-shot, `t` aligned with `moves.ts` | anticipation → strike at `hits[0].start` → recovery to `duration`; `special` should set `this.charge` during wind-up |
| `hit` | one-shot | recoil with `e^(−5t)` + `shiver` |
| `launched` | looping while airborne | flailing; also used for `grabbed` |
| `down` / `ko` | looping | lying poses; `ko` is limp (no twitch) |
| `getup` | one-shot 0.55 s | `u = smooth(t/0.5)` from lying to standing |
| `victory` | looping | hops/taunts |
| `intro` | one-shot ≈2.5 s | round start; camera is cinematic during this |

## 2. Character reference

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

1. **Data** — `src/game/moves.ts`
   - add the id to `CharId`; create a `FighterConfig` (copy the closest archetype); add to `FIGHTERS`.
   - if a move needs a new visual, add a new literal to `MoveDef.fx` (a union — TypeScript will then force you
     to handle it, or it falls to `default` in `Game.moveFx`).
   - fill `stats {speed,power,tough,icon}` (used by the select cards) and `moveNames`.
2. **Rig** — `src/game/characters/<Name>.ts`
   - `export class X extends CharacterRig`; build meshes in the constructor; register joints with `this.joint(...)`.
   - define all **16** anims in a `defineAnims()`; set `blendSpeed` per anim; set `instant` joints if needed.
   - implement `accent`, `sparkColor`, `chestWorld`, `strikeWorld` (cover every slot), `tick`.
   - `registerFlash([...])` with the materials that should flash white on hit (skip additive/glow materials).
   - `root.traverse` to set `castShadow` on meshes (disable for glow shells / transparent bits).
   - shared helpers: `geom.ts` (`ellipsoid`, `capsuleDown`, `mergeGeometries`), `fur.ts` (`furShells`), `textures.ts`.
3. **Factory** — `Game.makeRig(id)` (`src/game/Game.ts`): add a branch.
4. **Presentation** — `Game.moveFx` (hit-window visual) and `Game.onMoveStart` (start / `__fire`) if new `fx` ids.
5. **Engine features** (only if the archetype needs them): new `HitWindow`/`MoveDef` fields → handle in
   `Fighter.landHit`/`update`; new systems follow the `MissileSystem`/`GasSystem` pattern (own `group`,
   `update(dt, fighters, world, active)`, `clear()`, `dispose()`, wired in `Game` constructor/`startRound`/`update`/`dispose`).
6. **UI** — nothing to do: `Menu.tsx` maps `Object.keys(FIGHTERS)`; card grids are 2 columns per player, so a
   5th fighter will wrap (consider 3 columns at that point). Update copy on the title screen if desired.
7. **AI** — no per-character logic exists; if the fighter has a unique threat (unblockable, hazard), extend
   `AIController.update` like the `hop`/`evade` plans.
8. **Verify** — `npx tsc --noEmit`, `npm run build`, then run the headless recipes in `docs/06`
   (close-up render + a scripted hit/KO run) and check for console errors.

### Design guidance
- Keep hitbox `reach` ≈ visual reach of the `strikeWorld` marker at `hits[0].start`; the contact point is
  clamped into the defender, so overshoot looks fine but undershoot looks like whiffing.
- Light: 5–7 dmg, ~0.4 s, cancelable; Heavy: 13–15 dmg with `launch`; Special: 50 meter, 20–22 dmg equivalent;
  Air: 9–11 dmg with a downward impulse.
- Anim blend speeds: attacks 18–26, hit 22, idle 6–7, walk 10–11, launched/down 9, ko 6.
- Rest-pose gotcha: pose values are offsets — if you set a rest rotation on a joint (e.g. ears at `rz = ±0.9`),
  **don't** re-add that value in the idle pose (it will double).

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
