# 04 — Arenas, Rendering, FX & Procedural Assets

## 1. Arena contract (`src/game/arenas/common.ts`)

```ts
type ArenaId = "wasteland" | "foundry" | "meadow";
const ARENAS: ArenaInfo[]        // { id, name, subtitle, gradient } — drives the select-screen cards
interface Arena {
  group: THREE.Group;            // everything the arena adds to the scene
  sun: THREE.DirectionalLight;   // main shadow caster (from makeSun)
  exposure: number;              // renderer.toneMappingExposure
  bloom: { strength; threshold; radius };   // UnrealBloomPass params
  fog: THREE.Fog | THREE.FogExp2; background: THREE.Color;
  dustColor: number;             // colour used for footstep/landing dust (World.dustColor)
  update(dt, time, fx): void;    // ambience: wind uniforms, animated props, motes, ambient particles
  dispose(): void;               // disposeGroup(group)
}
const ARENA_BOUNDS = 7.6;        // half-width of the playable strip
```

Builders are plain functions: `buildWasteland()`, `buildFoundry()`, `buildMeadow()`; `Game.buildArena(id)`
switches on the id (default → wasteland).

Helpers in `common.ts`:
- `makeSun(color, intensity, pos, shadowSize=2048)` — directional light with an ortho shadow frustum
  covering the arena (`left/right ±16, top 12, bottom −8`, bias −0.0006, normalBias 0.03, radius 3).
- `makeGround(texture, color, repeat, size=700, roughness=1)` — receives shadows.
- `scatter({count, minR, maxR, zRange, xRange, rng, avoidArena?, padZ?})` → `{x,z,r,s}[]` random placements
  that avoid the fighting strip (`inArena(x, z, padX, padZ)`).
- `addWind(material, timeUniform, strength, height, tint=true)` — `onBeforeCompile` injection: sways vertices
  by height² with layered sines (works with `InstancedMesh`), optional root-to-tip darkening. Requires the
  arena to set `windTime.value = time` in `update`. Uses `customProgramCacheKey` so materials share programs.
- `disposeGroup(group)` — disposes geometries and materials recursively.

## 2. Existing arenas

| | Wasteland Sunset | Scrapyard Foundry | Golden Meadow |
|---|---|---|---|
| Sky | `Sky` dome: teal storm top → orange horizon, sun glow, 14 drifting cloud sprites | none (enclosed hall: walls, ceiling, girders) | `Sky` dome: blue → peach, big low sun, 10 soft clouds |
| Ground | `crackedEarthTexture` ×55 | `concreteTexture` ×40 + steel centre plate + hazard stripes | `grassTexture` ×60 |
| Lights | sun 0xffb478 ×3.4, hemi, teal rim | key 0xbdf3f8 ×2.6, hemi, **flickering furnace** point light, teal & warm points, camera fill, welding light | sun 0xffd7a0 ×2.9, hemi, warm fill |
| Props | 8 mesas, instanced rocks, 1400 wind tufts + near scrub, rotating windmill, wrecked pickup, power poles + catenary lines, shack, rolling tumbleweed | columns/girders/truss lines, moving crane trolley with swinging hook, catenary cables, 4 lamps, furnace + stacks, machines with emissive screens/LEDs, pipes/valves, barrels, gears, instanced scrap | 9000 far + 1400 near instanced grass blades, 2600 wheat, 700 wildflowers (+green stems), hills, trees (1 casting shadow), hay bales, fence, 8 butterflies |
| Ambient | dust motes + low haze, gust puffs | ember motes, smog, welding sparks (random bursts), steam vents (4 s cycle), stack smoke | pollen (additive) + floating seeds |
| exposure / bloom | 1.02 / 0.55, thr 0.9, r 0.5 | 1.0 / 0.75, thr 0.85, r 0.55 | 1.12 / 0.6, thr 0.85, r 0.7 |
| fog / bg | `Fog(0xe0925c, 40, 320)` | `Fog(0x07141a, 10, 70)` | `Fog(0xf3cfa0, 30, 260)` |
| dustColor | 0xd8b68a | 0x8a8f94 | 0xd9c98a |

## 3. Checklist: adding an arena

1. `arenas/common.ts`: extend `ArenaId`, add an `ARENAS` entry (name/subtitle/CSS gradient for the card).
2. Create `arenas/<Name>.ts` exporting `build<Name>(): Arena`. Pattern:
   `group`, deterministic `makeRng(seed)`, optional `new Sky({...})` (add `sky.group`), ground, `makeSun`,
   fills, props (prefer `InstancedMesh` for anything > ~50 copies), `Motes` for ambience, return the contract.
   Keep the strip `|z| < 2.4, |x| < 9` free of props (use `scatter` with `avoidArena`).
3. `Game.buildArena`: add a case. Nothing else — the select screen maps `ARENAS`.
4. Tune `exposure/bloom/fog` so fighters stay readable; `dustColor` should match the ground.
5. Budget: aim for ≤ ~300 draw calls; the meadow's grass is 3 instanced draws total.

## 4. Sky (`src/game/Sky.ts`)

`new Sky({ top, mid, bottom, sunColor, sunDir, sunSize?, haze?, sunGlow?, clouds? })` builds a 900-unit
`BackSide` sphere with a custom `ShaderMaterial` (gradient by view-direction `y`, sun disc + glow along
`sunDir`, horizon band, dithering; includes three's tonemapping/colorspace chunks; `fog: false`,
`renderOrder −10`). Optional additive sun-glow sprite and drifting cloud sprites (`update(dt)` scrolls them).

## 5. Post-processing & colour

- Pipeline: `RenderPass → UnrealBloomPass → OutputPass`, HalfFloat RT with MSAA 4, ACES tonemapping.
- Emissive materials with `emissiveIntensity` > ~1.5 bloom; that's how neon, eyes, lamps and gas glow.
- Custom shaders that write `gl_FragColor` directly must include `#include <tonemapping_fragment>` and
  `#include <colorspace_fragment>` (Sky, particle shader do) or they'll look washed out.
- All canvas textures are `SRGBColorSpace`; data-like uses (roughness maps) reuse the same texture — acceptable
  approximation, not physically exact.

## 6. FX system (`src/game/FX.ts`)

Three pooled GPU `ParticleSystem`s (ring buffers, custom points shader with per-particle size/colour/alpha,
size attenuated by `uScale = viewportHeight·pixelRatio·0.9` — call `fx.setViewport` on resize):

| Pool | capacity | blending | used for |
|---|---|---|---|
| `sparks` | 1500 | additive | hit sparks, embers, core flashes |
| `dust` | 900 | normal | ground dust puffs |
| `smoke` | 600 | normal | steam, gas turbulence, stack smoke, missile trails |

`emit({x,y,z, vx,vy,vz, life, size, color, alpha?, gravity?, drag?, grow?, fadeIn?})`.

High-level helpers (all take world positions):

| Method | What it draws |
|---|---|
| `hitSparks(p, color, count=26, power=1, dir=0)` | radial sparks with gravity + white/colour core flash |
| `blockSparks(p, dir)` | blue-white spray away from the block |
| `dustPuff(p, count, size, color, spread, up)` | expanding smoke puffs that rise slowly |
| `steam(p, count, color, size)` | slow rising, growing puff (fadeIn) |
| `embers(p, count, color)` | tiny hot sparks with gravity |
| `ring(p, color, maxRadius, duration, y)` | expanding additive ground ring (`RingGeometry`) |
| `flash(p, color, intensity, duration, distance)` | temporary `PointLight` |
| `beam(from, dir, length, color, duration, radius)` | cylinder beam + white core (laser) |
| `slash(p, dir, color, size, duration, tilt)` | rotating partial-ring arc in the XY plane |
| `shockDisc(p, color, radius, duration)` | expanding flat disc |

Transient meshes are tracked in `transients[]` with an `update(dt) → alive` closure and disposed on expiry.
`Motes` (in the same file) is the ambient drifting-points class used by arenas (wrapping box, jitter).

## 7. Procedural textures (`src/game/textures.ts`)

All generated on `<canvas>` at first use and **cached by key** (`cached(key, make)`), returned as
`CanvasTexture` with repeat wrapping, anisotropy 8, sRGB. Deterministic via `makeRng(seed)` (mulberry32).

| Function | Size | Use |
|---|---|---|
| `crackedEarthTexture` | 1024 | wasteland ground (noise, patches, branching cracks, pebbles) |
| `concreteTexture` | 1024 | foundry floor (slab seams, oil/rust stains, scratches) |
| `hazardStripeTexture` | 256×64 | yellow/black stripes (repeat 8×1) |
| `grassTexture` | 1024 | meadow ground |
| `metalTexture` | 512 | brushed, scratched, grimy metal — colour **and** roughness map for robots |
| `furTexture` | 512 | hair-stroke texture for buffalo undercoat / snout |
| `toadSkinTexture` / `toadGlowTexture` | 512 | mottled warty skin / glow spot map (spots on the UV "top") |
| `strawTexture` | 256 | hay bales |
| `softCircleTexture`, `sparkTexture`, `smokeTexture`, `glowTexture`, `cloudTexture(seed)`, `butterflyWingTexture(color)` | sprites | particles, sky, butterflies |

Add new textures following the same `cached()` pattern; keep sizes ≤ 1024 (first-use generation is synchronous).

## 8. Geometry helpers (`src/game/geom.ts`)

- `ellipsoid(cx,cy,cz, rx,ry,rz, ws=24, hs=16)` — sphere with radii and centre **baked into vertices**
  (so it can be used as a fur shell source in the parent joint's space).
- `capsuleDown(r, len)` — capsule hanging from the origin along −Y (limb segments).
- `mergeGeometries(geos)` — non-indexed merge of position/normal/uv (used for instanced wheat/flowers and the buffalo body shell).

## 9. Performance notes

- Pixel ratio cap 1.5; MSAA 4 on the composer target; bloom at full res — the biggest GPU costs are bloom
  and (on the meadow) instanced grass fill. On weak GPUs lower `samples` or bloom resolution first.
- Shell fur: buffalo ≈ 90 shell draws total (several parts × layers), each an instanced draw of a low-poly
  ellipsoid — cheap on draw calls, moderate on fill/discard.
- Point lights: chicken/ewe/toad each carry one; the foundry has 5; FX flashes add temporary ones. Three's
  forward renderer recompiles materials when the light count changes — expect a hitch the first time a
  transient light appears in a new arena (it's cached afterward).
- Shadows: one 2048² directional shadow map; fur shells and glow shells don't cast.
