# HANDOFF — Robo-Cluck vs Fluffalo (3D Arena Fighter)

> Entry point for any engineer or AI agent continuing this project.
> Read this file first, then the focused documents in `docs/`.

## What this is

A browser-based 2.5D fighting game (think *Street Fighter* camera on a 3D stage) built with
**React 19 + Vite 7 + Tailwind 4 + three.js r186**, written in TypeScript. There are **no external
art assets**: every character, arena, texture and particle sprite is generated procedurally in code
at runtime. The whole game ships as a **single self-contained `dist/index.html`**
(via `vite-plugin-singlefile`).

Roster (4): **Robo-Cluck** (robot rooster, rushdown), **Fluffalo** (fluffy bison, tank),
**Scrap-Ewe** (sheep mech, zoner w/ homing missiles), **King Croak** (bog toad, grappler w/ poison gas).
Arenas (3): **Wasteland Sunset**, **Scrapyard Foundry**, **Golden Meadow**.
Modes: VS CPU (easy/normal/hard), local 2-player, attract-mode background on menus.

## Documentation map

| Document | Read it when you need to… |
|---|---|
| [`docs/01-ARCHITECTURE.md`](docs/01-ARCHITECTURE.md) | understand module layout, data flow, the frame loop, lifecycle & disposal |
| [`docs/02-COMBAT-SPEC.md`](docs/02-COMBAT-SPEC.md) | change gameplay: state machine, hit detection, move data schema, grabs, poison, projectiles, hazards, rounds, camera |
| [`docs/03-CHARACTERS.md`](docs/03-CHARACTERS.md) | add/modify a fighter: the rig & animation system, per-character reference, a step-by-step checklist |
| [`docs/04-ARENAS-AND-RENDERING.md`](docs/04-ARENAS-AND-RENDERING.md) | add/modify an arena, sky, fog, lights, post-processing, textures, fur shader, FX/particles |
| [`docs/05-UI-INPUT-AI.md`](docs/05-UI-INPUT-AI.md) | change menus/HUD/touch controls, key bindings, HUD state contract, CPU behaviour |
| [`docs/06-TESTING-DEBUGGING.md`](docs/06-TESTING-DEBUGGING.md) | verify changes headlessly, use debug hooks, known gotchas, performance notes |
| [`docs/07-BACKLOG.md`](docs/07-BACKLOG.md) | pick up next features, known limitations and technical debt |
| [`docs/08-AUDIO.md`](docs/08-AUDIO.md) | music/SFX engine, source tiers (CORS vs streaming vs synth), slot catalogue, event→sound map, settings page, asset sourcing |

## 60-second orientation

```
src/
  main.tsx                 React bootstrap (StrictMode)
  App.tsx                  Screen flow: title → select → fight; owns the Game instance
  index.css                Tailwind import + custom HUD/menu animations
  components/              React UI only (no three.js): HUD, Menu (Title+Select), TouchControls, SettingsScreen (audio)
  game/
    Game.ts                THE orchestrator: renderer, composer, loop, round/phase flow, camera, HUD emission
    Fighter.ts             Per-fighter combat state machine, physics, hit resolution (landHit)
    moves.ts               DATA: all fighter configs + move/hit-window definitions (FIGHTERS, BAND_RANGES)
    Rig.ts                 Pose-blending animation rig + CharacterRig contract + curve helpers (kf/pulse/shiver)
    Input.ts               Keyboard/touch input → InputState with edge triggers
    AI.ts                  CPU controller (plans, profiles per difficulty)
    FX.ts                  GPU particle pools + transient mesh effects (rings, beams, slashes, lights)
    Projectiles.ts         MissileSystem (homing rockets)
    Hazards.ts             GasSystem (lingering poison clouds)
    Sky.ts                 Gradient sky dome shader + cloud sprites
    audio/                 AudioEngine (mixer/loader/player), catalog (slots), defaults (Pixabay URLs), synth (fallbacks + procedural music)
    fur.ts                 Shell-fur shader (soft tufted fur via instanced shells)
    geom.ts                Geometry helpers (mergeGeometries, ellipsoid, capsuleDown)
    textures.ts            All procedural canvas textures (cached singletons)
    characters/            One file per fighter rig: RobotChicken, FluffyBuffalo, ScrapEwe, KingCroak
    arenas/                common.ts (Arena contract + helpers) + Wasteland/Foundry/Meadow builders
```

**Core rule of thumb:** *gameplay numbers live in `moves.ts`*, *gameplay rules live in `Fighter.ts`*,
*presentation glue (what FX plays when) lives in `Game.ts`*, *how a character looks and animates lives
in `characters/*.ts`*. Keep it that way.

## Build & run

```bash
npm install            # three + @types/three are already in package.json
npm run dev            # vite dev server
npm run build          # -> dist/index.html (single file, ~1 MB, ~270 kB gzip)
npx tsc --noEmit -p tsconfig.json   # strict type-check (noUnusedLocals/Parameters are ON)
```

Constraints inherited from the environment this was built in:
- **Do not edit `package.json` / `vite.config.ts` by hand**; install packages with `npm install <pkg>`.
- The build must keep succeeding as a single file; avoid assets that require separate URLs
  (fonts are the one exception — Google Fonts are linked from `index.html` and degrade gracefully).
- TypeScript is strict with unused-locals/params errors — a stray variable fails the build.

## Controls

| | P1 | P2 |
|---|---|---|
| Move | `A` / `D` | `←` / `→` |
| Jump | `W` | `↑` |
| Block | `S` (hold) | `↓` (hold) |
| Light / Heavy / Special | `J` / `K` / `L` (also `U`/`I`/`O`) | `,` / `.` / `/` (also Numpad `1`/`2`/`3`) |
| Pause | `Esc` (or on-screen PAUSE) | |

Touch devices (`pointer: coarse`) get on-screen controls for P1 only.

## State of the project (at handoff)

- All four fighters, three arenas, both modes, HUD, menus, touch controls: **complete and verified**
  headlessly (no console errors) — see `docs/06-TESTING-DEBUGGING.md` for the harness.
- `npm run build` and `tsc --noEmit` pass cleanly.
- **Audio is complete**: music per arena + menu, ambience beds, per-fighter fight sounds, announcer/KO/UI
  cues, an in-game Audio Settings page (volumes, mutes, per-sound URL overrides persisted in localStorage).
  Default assets are Pixabay CDN files streamed via media elements; every slot has a synthesized fallback.
- There is **no online play** and **no automated test suite** checked into the repo (tests were run from
  ad-hoc Playwright scripts in `/tmp`; the recipe is documented). Persistence exists only for audio settings.
- Debug hooks exposed on `window`: `__game` (the live `Game` instance), `__cam` (camera override), `__audio` (the audio engine).

## Conventions

- World units ≈ metres. Fighters stand on `y = 0`, fight along the **X axis** (`z = 0`), arena
  half-width `ARENA_BOUNDS = 7.6`. Facing `+1` means looking toward `+X`.
- Rig roots are rotated `yaw = ±π/2`, so **a character's local `+Z` is its forward direction**
  when authoring geometry/animations.
- Time is seconds. Attack timings in `moves.ts` are seconds from `startMove`.
- Colours: `0xRRGGBB` numbers in engine code, `#rrggbb` strings for UI/HUD (`FighterConfig` has both).
- Every character has the same **16 animation names** (see `docs/03-CHARACTERS.md`). `Fighter.setState`
  maps state → animation name 1:1 except `blockstun → "block"`, `grabbed → "launched"`, and attacks → the move slot name.
