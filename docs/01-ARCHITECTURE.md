# 01 — Architecture

## Layering

```
┌──────────────────────────────────────────────────────────────────┐
│ React (src/App.tsx, src/components/*)                            │
│  - screens, HUD, menus, touch buttons                            │
│  - owns exactly one <canvas> + one Game instance at a time       │
└───────────────▲───────────────────────────────┬──────────────────┘
                │ HUDState (≈30 Hz callback)     │ constructor opts, setPaused/restart
┌───────────────┴───────────────────────────────▼──────────────────┐
│ Game (src/game/Game.ts) — orchestrator                           │
│  renderer/composer/camera · phase & round flow · FX + audio glue  │
│  owns: Arena, FX, MissileSystem, GasSystem, InputManager, AI      │
│  owns: fighters[2] (Fighter ⇄ CharacterRig)                       │
│  uses: audio singleton (src/game/audio/AudioEngine.ts)            │
└──────┬─────────────┬──────────────┬──────────────┬───────────────┘
       │             │              │              │
   Fighter.ts     arenas/*        FX.ts        Projectiles.ts / Hazards.ts
   (rules)        (stages)       (particles)   (owner-attributed damage sources)
       │
   Rig.ts + characters/*.ts  (pose blending, procedural meshes)
       │
   moves.ts (pure data)      textures.ts / fur.ts / geom.ts / Sky.ts (shared rendering helpers)
```

The React layer never touches three.js. The game layer never touches React; it reports through the
`onState(HUDState)` callback only. Both layers talk to the **audio singleton** (`audio`): React for UI
clicks/settings, `Game`/`Fighter` (via `World.cue`) for gameplay cues — see `docs/08-AUDIO.md`.

## Lifecycle

1. `App` renders `<canvas key={gameKey}>`. `gameKey` encodes screen + setup. **Changing the key
   remounts the canvas**, which guarantees a fresh WebGL context per `Game` instance.
2. `useEffect([gameKey])` constructs `new Game(canvas, opts)` and disposes it on cleanup
   (`game.dispose()` cancels RAF, detaches input, disposes arena/missiles/gas/geometries/composer and
   **forces context loss**).
3. On the title/select screens the game runs in `mode: "attract"` (both fighters idle/taunt while the
   camera orbits). On the fight screen the mode is `"cpu"` or `"2p"`.
4. `Game` writes itself to `window.__game` for debugging.

`GameOptions`:
```ts
{ mode: "attract"|"cpu"|"2p"; p1: CharId; p2: CharId; arena: ArenaId;
  difficulty: "easy"|"normal"|"hard"; roundsToWin: number; onState(s: HUDState): void }
```

## Frame loop (`Game.loop`)

```
requestAnimationFrame
 ├─ frameTimer.update(); raw = min(0.05, delta)          // clamp avoids spiral after tab switch
 ├─ if (!paused) update(raw)
 ├─ updateCamera(raw)                                    // runs even when paused (smooth camera)
 └─ composer.render()                                    // RenderPass → UnrealBloomPass → OutputPass
```

`update(raw)` in order:
1. **Slow-motion**: during `ko` phase `timeScale` starts at 0.18 and ramps back to 1 after 1.1 s.
   `dt = raw * timeScale`; `time += dt`; `phaseTime += raw` (phase timers are real-time).
2. **Input routing**: P1 from keyboard(+touch); P2 from `AIController.update(dt)` or keyboard. The AI
   is fed `threat` (missiles in flight) and `hazards` (gas cloud x positions) first.
3. **Missile queue**: spawns any queued rockets whose scheduled time has passed (fight/ko phases only).
4. **Arena ambience** `arena.update(dt, time, fx)` then **`fx.update(dt)`**.
5. **Phase switch** (see *Round flow*).
6. **Fighters** — skipped entirely while `hitstop > 0` (hit-stop counts down in real time):
   `a.update`, `b.update`, `separate(a,b)`, `a.checkHits(b)`, `b.checkHits(a)` (fight phase only),
   `moveFx(a)`, `moveFx(b)`, combo bookkeeping (a fighter's combo resets when the *opponent* returns to neutral/down).
7. **Projectiles & hazards** update (fight/ko), homing/contact only in `fight`.
8. Screen flash decay; **HUD emission** throttled to ~30 Hz (plus immediate emits on important events).

## Phase / round flow

`Phase = "attract" | "intro" | "fight" | "ko" | "roundEnd" | "matchEnd"`

```
startRound()  → phase=intro  (banner "ROUND n" / "FINAL ROUND"; fighters reset to x=∓3.2, state "intro",
                              uncontrollable; cinematic low camera)
   ↓ phaseTime > 2.5
startFight()  → phase=fight  (controllable; banner "FIGHT!")
   ↓ KO hit (onHit e.ko) → triggerKO(loser)         ↓ timer hits 0 → triggerKO(lower hp %) or draw
phase=ko      (timeScale 0.18, white flash, camera focuses the loser; TIME OVER variant has no slow-mo)
   ↓ phaseTime > 2.6
endRound()    → phase=roundEnd (winner.roundsWon++, winner plays "victory", banner "<NAME> WINS" / "PERFECT!" / "DRAW")
   ↓ phaseTime > 3.2
afterRound()  → champion? phase=matchEnd (banner "<NAME> WINS THE MATCH", HUD shows results overlay)
              : startRound()
restart()     → resets roundsWon/round/winner and calls startRound()   (REMATCH button)
```

Round timer `ROUND_TIME = 99` s, decremented by scaled `dt`.
Time-over winner = higher `hp / maxHp`; exact tie → draw (no round awarded).

## Coordinate system & camera

- Fighters move on the X axis at `z = 0`, ground at `y = 0`. `ARENA_BOUNDS = 7.6` (fighter x is clamped
  to `±(7.6 − width·0.6)`).
- Camera (`updateCamera`): follows the midpoint; distance `clamp(5.6 + sep·0.9, 7.6, 13.5)`; height rises
  with separation and average fighter height. Smoothing `k = 1 − e^(−5·raw)`; slower during intro
  (cinematic ease-in), orbiting in attract, loser-focused during KO. Shake is additive random jitter
  decaying with `e^(−6·raw)`.
- **Debug override**: `window.__cam = { pos:[x,y,z], look:[x,y,z] }` pins the camera (used for screenshots).

## Renderer settings (in `Game` constructor)

- `WebGLRenderer({ antialias: true, powerPreference: "high-performance" })`, pixel ratio capped at **1.5**.
- Shadows on, `PCFShadowMap` (`PCFSoftShadowMap` was removed in r186 — using it logs a warning).
- `ACESFilmicToneMapping`; exposure per arena.
- `EffectComposer` on a `HalfFloatType` render target with **MSAA samples: 4**; passes:
  `RenderPass → UnrealBloomPass(strength/radius/threshold per arena) → OutputPass`.
- Camera: `PerspectiveCamera(38°, aspect, 0.1, 1500)`.
- `THREE.Timer` is used for frame deltas (`THREE.Clock` is deprecated in r186).

## Ownership & disposal rules

- `Game` owns and disposes: arena (`arena.dispose()` traverses/dispose geometries+materials),
  `MissileSystem`, `GasSystem`, all scene geometries (traverse), composer, renderer.
- Textures from `textures.ts` are **module-level cached singletons** and intentionally never disposed
  (they're reused across Game instances; the WebGL context loss frees GPU copies).
- Transient FX objects dispose their own materials when they expire.

## Key shared interfaces

```ts
// Fighter.ts — the "world" a fighter can see
interface World {
  bounds: number; fx: FX; time: number; dustColor: number;
  onHit(e: HitEvent): void; onMoveStart(f: Fighter, m: MoveDef): void;
  onLand(f: Fighter, impact: number): void; shake(amount: number): void;
  cue(kind: "jump" | "throw" | "getup", f: Fighter, other?: Fighter | null): void;  // audio-only presentation cues
}
interface HitEvent { attacker; defender; window: HitWindow; move: MoveDef; point: Vector3; blocked; ko; combo }
```

`Game` implements `World` inline in its constructor. `onMoveStart` is invoked twice per special-type
move: once at move start with the real `MoveDef`, and again at `fireAt` with a shallow clone whose
`name === "__fire"` (this is how beams/missiles/gas are triggered mid-animation).

## Dependency graph (imports)

```
App → Game, HUD, Menu, TouchControls
Game → Fighter, Rig(helpers), characters/*, moves, FX, Projectiles, Hazards, Input, AI, arenas/*
Fighter → Rig(types), moves, Input(types), FX(type)
characters/* → Rig, textures, fur, geom, RoundedBoxGeometry
arenas/* → common, Sky, FX(Motes), textures, geom
Projectiles / Hazards → Fighter(types), moves(types), textures
Menu → arenas/common (ARENAS), moves (FIGHTERS), AI(type), Game(type)
TouchControls → Input (touchInput)
```
No circular runtime imports; type-only cycles (`Projectiles ↔ Fighter`) are import-type safe.
