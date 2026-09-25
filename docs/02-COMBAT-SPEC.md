# 02 — Combat Specification

All rules below are implemented in `src/game/Fighter.ts` unless noted. All tunables are in
`src/game/moves.ts`.

Animation implementation may be procedural poses or imported skinned/keyframed clips. The state machine and `moves.ts` timing remain authoritative in either case; see [`09-SKINNED-ANIMATION-CONTRACT.md`](09-SKINNED-ANIMATION-CONTRACT.md) for clip binding, retiming and root-motion rules. That adapter is specified but not yet implemented in this branch.

## 1. Fighter state machine

`FighterState`:

| State | Entered by | Exits | Notes |
|---|---|---|---|
| `intro` | `reset()` at round start | `Game.startFight()` → `idle` | uncontrollable; `canBeHit=false` |
| `idle` | default neutral | input | faces opponent every frame |
| `walkF` / `walkB` | horizontal input toward/away from opponent | input | speed `walkSpeed` / `backSpeed`; footstep dust every 0.26 s |
| `jump` | `jUp` edge | landing → `idle` | `vel.y = jumpVel`, `vel.x = dir·walkSpeed·0.95`; light air control (`±5 u/s²`, clamped to walkSpeed) |
| `block` | holding `down` while grounded | release | only grounded blocking exists; no low/high mixups |
| `blockstun` | being hit while blocking | after `window.blockstun` → `block` (if still holding down) or `idle` | animation `"block"` |
| `attack` | `startMove(slot)` | `stateTime ≥ move.duration` → `idle`/`jump`; landing during an **air** move → `idle` | see §3 |
| `hit` | non-launching hit while grounded | after `window.hitstun` → `idle` (or `ko` if dead) | velocity decays `e^(−6dt)` |
| `launched` | launching hit / KO hit / thrown | landing → `down` (or `ko` if dead) | air drag `e^(−0.8dt)`; `canBeHit=true` (juggles allowed) |
| `grabbed` | command grab | grabber releases → `launched` | pinned to grabber's `grabAnchorWorld`; `canBeHit=false`; **skips physics** |
| `down` | landing from `launched` | 0.85 s → `getup` | invulnerable |
| `getup` | after `down` | 0.55 s → `idle` | invulnerable |
| `ko` | dead fighter landing / stun ending / time over | round reset | invulnerable |
| `victory` | round winner during `roundEnd` | round reset | |

`neutral` = idle/walkF/walkB/block/jump (used to reset the opponent's combo counter).
`canBeHit` = not dead and not in {down, getup, ko, victory, intro, grabbed}.

State → animation mapping (`setState(s, anim?)`): identical names, except `blockstun → "block"`,
`grabbed → "launched"`, and attacks play the **slot name** (`"light" | "heavy" | "special" | "air"`).
These are game state keys. An imported GLB may use different clip names; its binding table translates them. A clip's original duration does not change `stateTime`, hit windows or move exit.

### Input → action priority (grounded neutral states)
1. attacks (`tryAttack`: special (if meter) > heavy > light) — edge-triggered
2. jump (`jUp`)
3. block (`down` held)
4. walk / idle

In `jump`, any attack edge triggers the **air** move once per airborne period (`airMoveUsed`).

## 2. Physics

- `GRAVITY = 34 u/s²`, applied while airborne or moving upward.
- Ground friction on x: `vel.x *= e^(−14dt)` in idle/attack(non-lunge)/intro/etc.
- Arena walls: x clamped to `±(bounds − width·0.6)`; horizontal velocity into the wall is reflected at `−0.2×`.
- **Landing** (`onLand(impact)` where `impact = −vel.y`):
  - from `launched`: big dust, `world.onLand(impact+6)`, → `down`/`ko`, `vel.x *= 0.3`
  - otherwise if `impact > 3`: dust + squash; `jump`/`hit` → `idle`; air attack → cancelled to `idle`
  - always calls `rig.impulse(min(1, impact/12))` (fur jiggle etc.)
- **Squash & stretch**: a scalar spring (`k=220`, `c=16`) applied to the rig root as
  `scale = (1+s, 1−s, 1+s)`; set by jumps (`−0.14`), landings (`≤0.22`), hits (`0.12`), throws (`−0.15`).
- **Facing** only re-evaluates in grounded neutral states (idle/walk/block); yaw eases with `e^(−14dt)`.
- **Separation** (`Game.separate`): pushes fighters apart so `|dx| ≥ widthA + widthB`, respecting walls;
  skipped when vertical gap `> 1.3`, either is `ko`/`grabbed`, or either is `launched` while rising
  (lets thrown fighters sail over the thrower).

## 3. Moves & hit windows

```ts
interface MoveDef {
  slot: "light"|"heavy"|"special"|"air"; name; duration;
  hits: HitWindow[];            // may be empty (pure "fire" specials: missiles, gas)
  meterCost?; meterGain;        // special costs 50 for every fighter
  lunge?: { start, end, speed, stopOnHit? };   // forced forward velocity window
  cancel?: { start, end };      // after a successful hit, another attack may be started in this window
  fx: MoveFxId;                 // presentation key consumed by Game.moveFx / onMoveStart
  impulse?: { x, y };           // initial velocity (air moves)
  fireAt?;                      // emits onMoveStart(f, {...m, name:"__fire"}) once at this time
  projectile?: { fireAt, count, interval, speed, arc, homing };   // Scrap-Ewe missiles
  hazard?: { speed, travel, linger, radius, damage, poison:{duration,dps} };  // King Croak gas
}
interface HitWindow {
  start, end;                    // active frames (seconds into the move)
  damage; reach;                 // reach = hitbox length in front of the attacker (x)
  band: "high"|"mid"|"low";      // vertical hitbox, see BAND_RANGES
  knockback;                     // horizontal impulse (÷ defender.weight); NEGATIVE pulls the victim in
  launch?;                       // vertical impulse → "launched" state if > 0
  hitstun; blockstun; shake; hitstop;
  unblockable?;
  grab?: { hold, throwX, throwY };   // command grab (see §5)
}
BAND_RANGES = { high: [0.9, 2.4], mid: [0.3, 1.8], low: [0, 0.9] }   // relative to attacker.pos.y
```

### Hit detection (`checkHits`, attacker-side, once per window per move)
A window connects when **all** hold:
1. `start ≤ stateTime ≤ end` and this window hasn't hit yet (`hitFlags[i]`).
2. `opp.canBeHit`.
3. X overlap: `[attacker.x, attacker.x + facing·reach]` overlaps `[opp.x − opp.width, opp.x + opp.width]`.
4. Y overlap: `[attacker.y + band0, attacker.y + band1]` overlaps `[opp.y, opp.y + opp.height]`.

Note the "low" band `[0, 0.9]` is what makes King Croak's grab whiff on airborne opponents.
Air moves keep their window open while airborne (`start..end` wide) and are cancelled on landing.

### Hit resolution (`landHit(opp, w, m, point|null, world, melee)`)
Shared by melee, missiles and gas. `point` (world contact) is derived from `rig.strikeWorld(slot)` for
melee, then pulled toward the defender's near edge and clamped inside their silhouette.

**Blocked** (`opp.blocking && opp.grounded && !w.unblockable`):
- chip damage `= damage · 0.12` (cannot reduce hp below 1)
- defender → `blockstun` for `w.blockstun`, pushed back `knockback·0.7/weight`
- melee grounded non-special attacker is pushed back `1.5` (pushback on block)
- meter: defender `+damage·0.35`, attacker `+meterGain·0.4`
- `onHit({blocked:true})` → block sparks, small shake, 0.03 s hit-stop

**Clean hit**:
- combo: `attacker.combo = (opp in hit/launched) ? combo+1 : 1`
- `opp.hp −= damage`; `opp.perfect=false`; flash; squash; `moveHitLanded=true` (melee only, enables cancels & stops `stopOnHit` lunges)
- meter: attacker `+meterGain`, defender `+damage·0.5` (both capped at 100)
- KO if `hp ≤ 0` → `dead=true`, always launched (`vel = (facing·max(kb,5), max(launch,6))`)
- else if `w.grab && melee` → **grabbed** (§5)
- else if `launch>0 || !opp.grounded` → `launched` with `(facing·kb, max(launch,4))` — *any* hit on an airborne opponent juggles
- else → `hit` for `w.hitstun` with `vel.x = facing·kb`
- `onHit({blocked:false, ko, combo})` → sparks/light/shock disc, screen shake, **hit-stop** (`w.hitstop`), combo popup at ≥2, KO handling

### Meter
0–100. Gained by dealing damage (`meterGain` per move), by taking damage (`0.5×dmg`), and by
blocking/being blocked (see above). `special.meterCost = 50` for all fighters; the HUD shows
"SPECIAL READY" at ≥ cost. Meter persists across rounds (not reset in `reset()`).

## 4. Per-fighter data (current values)

| | Robo-Cluck | Fluffalo | Scrap-Ewe | King Croak |
|---|---|---|---|---|
| id | `chicken` | `buffalo` | `ewe` | `toad` |
| maxHp | 100 | 120 | 105 | 115 |
| walk / back | 3.8 / 2.9 | 3.1 / 2.4 | 3.4 / 2.7 | 2.9 / 2.3 |
| jumpVel | 11.5 | 10.2 | 11.0 | 12.5 |
| weight | 0.9 | 1.35 | 1.12 | 1.25 |
| width / height | 0.55 / 2.2 | 0.95 / 1.9 | 0.72 / 2.15 | 0.9 / 1.6 |
| light | Piston Peck 6dmg r1.55 high, cancel | Headbutt 7 r1.75 mid, cancel | Piston Jab 5 r1.7 mid, cancel | Tongue Lash 6 r2.6 mid, **kb −1.6 (pull)**, cancel |
| heavy | Talon Kick 13 r1.9 launch 7.5 | Horn Toss 14 r1.8 launch 9.5 | Rocket Uppercut 13 r1.85 launch 10.5 | Gullet Toss 15 r2.0 **low band, unblockable grab** hold .5 → throw (−5.5, 11.5) |
| special (50) | Laser Gaze: beam hit 20dmg r7.5 high, fires @0.39 | Stampede: lunge 13u/s 0.42–1.0s, 22dmg, stopOnHit | Ewe-Pod Barrage: 4 homing missiles @0.4 (8dmg each, launch 5) | Toxic Croak: gas cloud @0.55 (9dmg + poison 4s×3dps) |
| air | Dive Talon 9, impulse (5.5,−5) | Fluff Slam 11, impulse (2.5,−8) | Meteor Knuckle 10, impulse (2.5,−9) | Royal Belly Flop 11, impulse (2.5,−9) |

(Exact timings: see `moves.ts`; every `hits[]` entry lists `start/end` — light hits open ≈0.10–0.14 s,
heavies ≈0.26–0.30 s, air moves 0.10–0.12 s and stay open to ≈0.5 s.)

Move `fx` ids and what `Game` does with them:

| fx | at hit-window start (`moveFx`) | at start / `__fire` (`onMoveStart`) |
|---|---|---|
| peck, kick, dive, jab, uppercut, meteor, horn | `fx.slash` arc (uppercut adds sparks; meteor adds an ember trail each 0.045 s while airborne) | — |
| headbutt, slam, flop, tongue | `fx.shockDisc` | — |
| laser | — | start: small eye flash; `__fire`: 8-unit beam + flash + sparks + shake |
| stampede | per-frame dust behind the charger while lunging, pawing dust before | `__fire`: ground ring + big dust |
| missiles | — | `__fire`: flash/sparks, queues `count` missiles at `interval` spacing (`missileQueue`) |
| belch | — | `__fire`: spawns gas cloud at `x + facing·1.1`, flash, ring, green steam burst |
| grab | — (grab feedback lives in `onHit`) | — |

## 5. Command grabs (King Croak's Gullet Toss)

Defined by `HitWindow.grab = { hold, throwX, throwY }` + `unblockable: true`.
On a clean **melee** connect (`landHit` with `melee=true`, not a KO):
1. victim: `grabbedBy = attacker`, `grabTimer = hold`, throw vector stored, `vel = 0`, `setState("grabbed","launched")`.
2. each frame while `grabber.state === "attack" && grabTimer > 0`: victim position is **set** to
   `grabber.rig.grabAnchorWorld()` (King Croak returns the tongue tip; base class returns the chest),
   clamped to walls; `y = max(0, anchor.y − height/2)`.
3. when the timer expires or the grabber leaves `attack`: victim gets `vel = (grabber.facing·throwX, throwY)`
   and becomes `launched` (ring + dust + shake). `throwX < 0` throws **backwards over the grabber's head**
   (side switch). Separation is suspended while rising so the victim can pass over the grabber.
Throw damage is applied at grab time (`damage` field). Grabs whiff on airborne targets via the `low` band.

## 6. Poison status

`Fighter.applyPoison(duration, dps, refreshOnly=false)`: `poison = max(poison, duration)`;
`poisonDps` set unless refreshing. Each frame while `poison > 0`: `hp = max(1, hp − dps·dt)`
(**never lethal**), green bubble FX every 0.11 s from the chest, and the rig's `tintAmount` eases toward
0.75 (green emissive tint through `Rig.tintColor`). Cleared on `reset()`. HUD shows "☠ POISONED".

## 7. Projectiles — `MissileSystem` (`Projectiles.ts`)

- Spawned by `Game.spawnMissile` from `missileQueue` entries: position `(x + facing·0.28, y + 1.82, ±z)`,
  velocity `(facing·speed, arc − (i%2)·0.9, −z·1.6)`; alternating z offsets fan the salvo.
- Each frame: after 0.12 s, steers toward `(target.x, clamp(target.y+1, 0.4, 2), 0)` with
  `vel.lerp(want, 1−e^(−turn·dt))` at constant speed; gravity `1.0`; orients along velocity; smoke+ember trail
  every 0.035 s.
- Collision with a fighter (`≠ owner`, `canBeHit`, `|dx| ≤ width·0.85+0.25`, `y` within body) →
  `owner.landHit(t, MISSILE_WINDOW, ownerSpecialMove, point, world, false)` + `boom`.
  `MISSILE_WINDOW` (in `Game.ts`): 8 dmg, mid, kb 7, launch 5, hitstun .5, blockstun .3.
- Ground (`y ≤ 0.12` while falling) → smaller `boom`; timeout `ttl = 3.6 s` → fizzle.
- `homing` flag is false outside the `fight` phase (rockets fly straight during KO slow-mo).
- `activeCount` feeds `AIController.threat`.

## 8. Area hazards — `GasSystem` (`Hazards.ts`)

`GasSpec = { x, dir, speed, travel, linger, radius, damage, poison:{duration,dps} }`.
A `GasCloud` travels `dir·speed` for `travel` seconds, then lingers `linger` seconds (life = travel+linger),
growing from 55 % to 100 % of `radius`, fading in over 0.25 s and out over 0.7 s.
Contact (only while `active` i.e. fight phase, `t > 0.1`, alpha > 0.3): fighters other than the owner,
`canBeHit`, `|dx| ≤ r + width/2`, `y ≤ 1.6`. First contact → `owner.landHit(GAS window: damage, mid, kb 3.5,
hitstun .42, blockstun .28)` + `applyPoison(duration, dps)`; subsequent frames inside → `applyPoison(1.2, dps, true)`
(refresh only). `positions()` feeds `AIController.hazards`.

## 9. Presentation hooks fired from combat

Visuals (particles/camera) **and** audio are driven from the same `Game` callbacks. Audio goes through the
`audio` singleton — see `docs/08-AUDIO.md` for the full event→sound map; the last column summarises it.

| Event | Where | Visual effect | Audio |
|---|---|---|---|
| any clean hit | `Game.onHit` | sparks (count scales with damage), point light flash, shake, hit-stop; ≥12 dmg adds shock disc + 0.35 screen flash | attacker `punch.{soft\|hard}` (hard ≥10 dmg, panned by x); launcher adds `knock.hard`; hard hit adds defender `hiya.soft` |
| grab connect | `Game.onHit` (`window.grab`) | green ring, pink sparks, small flash, 0.06 hit-stop | attacker `knock.soft` + defender `hiya.soft` |
| block | `Game.onHit` | `blockSparks`, 35 % shake, 0.03 hit-stop | defender `clang.{soft\|hard}` |
| KO | `Game.onHit` → `triggerKO` | 60 white sparks, big ring, shake 1.2, hit-stop 0.16, slow-mo, white screen flash | `ko.impact` + `ko.slowmo` + `crowd.gasp` + `announce.ko` + loser `hiya.hard`; music ducked & slowed to 0.72× (time-over: `ko.bell` instead) |
| landing | `Game.onLand` | impact > 9: white ground ring + shake | impact > 9: `thud.hard` (+`ko.fall` if launched/dead); > 3: `thud.soft` |
| jump / footsteps | `Fighter` | `dustPuff` using `world.dustColor` (per arena) | `world.cue("jump")` → quiet fast `whoosh.soft` |
| throw release | `Fighter` (`grabbed`→thrown) | ring + dust + shake | `world.cue("throw")` → victim `hiya.soft` + grabber `whoosh.hard` |
| get-up | `Fighter` (`down`→`getup`) | — | `world.cue("getup")` → quiet `thud.soft` |
| move start | `Fighter.startMove` | `rig.impulse(0.25 light / 0.5 other)` | `Game.onMoveStart`: swing `whoosh.*` + battle cry; `__fire` (specials) plays `<char>.special` |
| round / fight / win / match / timer ≤10 s | `Game` round-flow | banners | `announce.round` (+staggered `intro` cries), `announce.fight`, `announce.win`+`crowd.cheer`, `announce.match`, per-second `timer.tick` |

The `World.cue(kind, f, other?)` hook exists specifically so `Fighter` can request audio-only cues
(jump/throw/get-up) that have no other presentation owner; `Game` implements it. Adding a new cue = extend
the union in `Fighter.ts` and handle it in `Game`'s `world.cue`.

## 10. Invariants to preserve

- `checkHits` runs **only in the fight phase**, after both fighters updated and were separated.
- Hit-stop freezes fighters, projectiles keep updating only in fight/ko; the arena and FX never freeze.
- `landHit` must stay the single damage path (AI threat logic, combo counting, KO, meter all live there).
- A KO always results in `launched` → landing → `ko`; `endRound` waits on a fixed 2.6 s phase timer, not on landing.
- `reset()` never touches `meter` or `roundsWon` (both persist across rounds by design).
- `perfect` round = winner never took a clean hit **and** has full HP (chip damage spoils it).
