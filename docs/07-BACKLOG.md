# 07 — Backlog, Known Limitations & Technical Debt

Prioritised suggestions for whoever continues. Each item names the files involved so an agent can
scope the work quickly.

## A. High-value features

| # | Feature | Where | Notes |
|---|---|---|---|
| A1 | ~~Audio~~ **Done** — see `docs/08-AUDIO.md`. Follow-ups: self-host the default assets on a CORS host (upgrades every slot to the Web Audio tier), per-character victory/taunt lines, import/export of the URL table as JSON | `src/game/audio/*`, `SettingsScreen.tsx` | |
| A2 | **Gamepad support** | `Input.ts` (`navigator.getGamepads()` polled inside `PlayerInput.sample`) | Map d-pad/left stick + 3 face buttons; P1/P2 = pad index 0/1. |
| A3 | **Rebindable keys + settings screen** | `Input.ts` maps, `Menu.tsx`, `localStorage` | The legend text in `HUD.tsx`/`Menu.tsx` is hard-coded — derive it from the maps. |
| A4 | **Arcade ladder / win streak & records** | `App.tsx` flow, `localStorage` | Sequence of CPU opponents with rising difficulty; persist best streaks. |
| A5 | **Training mode** | `Game` (`opts.mode`), HUD | Infinite HP/meter toggle, input display, hitbox overlay (draw `reach`/band boxes as wireframe planes). |
| A6 | **More fighters / arenas** | follow `docs/03` §3 and `docs/04` §3 | Candidate archetypes still missing: a fast teleporting trickster, a charge-attack heavy hitter, a stance switcher. Select grid needs a 3-column layout past 4 fighters. |
| A7 | **Round intro voice/banner per character** | `Game.startRound`, `characters/*` `intro` anims already exist | Add per-fighter intro quotes to `FighterConfig`. |

## B. Gameplay depth

| # | Item | Where |
|---|---|---|
| B1 | Throws for every character (universal grab on light+heavy) | `Fighter.tryAttack`, reuse `HitWindow.grab` + `grabAnchorWorld` |
| B2 | Low/high blocking & crouching | `Fighter` states (`crouch`), `Band` already exists; blocking currently ignores bands |
| B3 | Dashes / back-dash (double-tap) | `Input.ts` edge history, `Fighter` state `dash` |
| B4 | Combo scaling (damage falls off with `combo`) | `Fighter.landHit` |
| B5 | Meter burst / EX moves (spend 25 for enhanced light/heavy) | `moves.ts` (`meterCost` on non-special), `Fighter.tryAttack` |
| B6 | Wall bounce / ground bounce on heavy launches | `Fighter.update` wall clamp & `onLand` |
| B7 | Smarter AI: per-character playbooks, punish windows, meter management | `AI.ts` (`decide`) |

## C. Presentation polish

| # | Item | Where |
|---|---|---|
| C1 | Hit-freeze zoom / dramatic camera on KO (dolly toward loser, slight roll) | `Game.updateCamera` ko branch |
| C2 | Character shadows on fur shells (currently only undercoat casts) | `fur.ts` (`castShadow` with `customDepthMaterial`) |
| C3 | Ground decals for gas / missile craters | `FX.ts` transient planes |
| C4 | Weather variants (night wasteland, rain foundry) | new `Arena` builders reusing props |
| C5 | Victory camera orbit + name card | `Game.endRound`, HUD |
| C6 | Mobile layout pass for the select screen (cards scroll; fine but dense) | `Menu.tsx` |

## D. Technical debt / cleanup

| # | Item | Detail |
|---|---|---|
| D1 | `Game.ts` is the largest file (≈800 lines) mixing render setup, round flow, FX glue and camera | Split into `Renderer.ts` (composer/resize), `RoundFlow.ts`, `CombatFX.ts` (onHit/moveFx tables), `CameraRig.ts`. Keep `World` implementation in Game. |
| D2 | Move-FX tables are `switch` statements on `fx` ids | Convert to a `Record<MoveFxId, {onWindow?, onStart?, onFire?}>` map so adding a fighter doesn't touch `Game`. |
| D3 | `MISSILE_WINDOW` and gas `GAS_BASE` live in `Game.ts` / `Hazards.ts` rather than `moves.ts` | Move projectile/hazard hit windows into `MoveDef.projectile.hit` / `MoveDef.hazard.hit`. |
| D4 | Hard-coded UI copy for controls | Generate from `P1_KEYS`/`P2_KEYS`. |
| D5 | No automated tests | Turn the Playwright recipe (`docs/06`) into `scripts/smoke.cjs` + a pure-logic Vitest suite for `Fighter.landHit`/`checkHits` (they don't need WebGL if `rig` is stubbed: `strikeWorld/chestWorld/flash/impulse/play/update/snap/tick`). |
| D6 | `HUDFighter.rounds` pips render max 3; `roundsToWin` up to 3 fits, but a "first to 5" option would overflow | `HUD.tsx` map `[0..roundsToWin-1]` (needs `roundsToWin` in `HUDState`). |
| D7 | Attract-mode `setTimeout` in `Game.update` (taunt reset) is the only wall-clock timer in the engine | Replace with a phase-time check to keep the loop deterministic. |
| D8 | `Sky` cloud sprites and `Motes` use `Math.random()` (non-deterministic layouts) | Thread a `makeRng` seed through if reproducible screenshots matter. |
| D9 | `InputManager.onAnyKey` unused | Remove or use for "press any key" on the title screen. |
| D10 | Type-only import cycles (`Projectiles`/`Hazards` ↔ `Fighter`) | Fine today (`import type`), but keep them type-only. |

## E. Known limitations (by design, document if changed)

- No online/netplay; the simulation is real-time and frame-rate dependent (`dt`-based, capped at 50 ms).
  A fixed-timestep accumulator would be required for rollback/netcode or for deterministic replays.
- Only one AI opponent (P2). Both-CPU "demo fights" would need a second `AIController` and P1 routing.
- Poison never kills; chip damage never kills (both clamp at 1 hp).
- Blocking is a single guard (no high/low), and there are no throws except King Croak's command grab.
- Fur shells are not shadow casters; bloom is global (no per-object selective bloom).
- The title claims "Robo-Cluck vs Fluffalo" — the game has grown to four fighters; rename if a marketing pass happens.
