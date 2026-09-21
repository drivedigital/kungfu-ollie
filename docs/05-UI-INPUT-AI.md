# 05 — UI, Input & CPU AI

## 1. React layer

### Screen flow (`src/App.tsx`)
`Screen = "title" | "select" | "fight"`. `setup: Setup` is the single source of truth for match options:

```ts
interface Setup { mode: "cpu"|"2p"; p1: CharId; p2: CharId; arena: ArenaId; difficulty: Difficulty; roundsToWin: number }
DEFAULT_SETUP = { mode:"cpu", p1:"chicken", p2:"buffalo", arena:"wasteland", difficulty:"normal", roundsToWin:2 }
```

- Title → `onStart(mode)` sets `setup.mode` and goes to select; a **🔊 AUDIO SETTINGS** button opens the
  settings overlay (`onSettings`).
- Select → mutates `setup`, FIGHT! → `screen="fight"`; BACK → title.
- Fight → HUD callbacks: `onResume` (`game.setPaused(false)`), `onRematch` (`game.restart()`),
  `onReselect` (→ select), `onQuit` (→ title), `onSettings` (opens settings; pauses first). `setHud(null)` on leaving so the HUD unmounts.
- **Settings overlay** — `settingsOpen` state renders `<SettingsScreen>` on top of any screen; opening it from
  a fight pauses the game (and ducks music), opening it from a menu leaves the attract game running.
- `gameKey` = `fight-${mode}-${arena}-${p1}-${p2}-${difficulty}-${roundsToWin}` or `attract-${arena}-${p1}-${p2}`.
  The canvas is keyed by it → a new `Game` (and WebGL context) per distinct configuration; changing
  fighters/arena on the select screen live-updates the attract backdrop.
- Touch detection: `matchMedia("(pointer: coarse)")` → `isTouch` → shows `TouchControls`, hides key hints.
- A floating **PAUSE** button is rendered during fights (top centre) in addition to `Esc`.

**Audio bootstrapping** (`App.tsx`): capture-phase `pointerdown`/`keydown`/`click` listeners call
`audio.unlock()` on the first user gesture (autoplay policy). A delegated `click` listener plays a UI sound
for any `<button>` based on its `data-sfx` attribute (default `ui.click`, `data-sfx="none"` opts out — used
by touch controls), and a delegated `pointerover` plays `ui.hover`. See `docs/08-AUDIO.md`.

### `HUDState` contract (emitted by `Game` ≈30 Hz + on events)
```ts
{ p1, p2: HUDFighter; timer; round; phase; banner: {text, sub?, key, hold?, color?} | null;
  paused; winner: 0|1|2|null; flash; flashKey; mode }
HUDFighter { name; hp; maxHp; meter; rounds; color; hitAge; combo; moveNames; specialCost; poisoned }
```
- `banner.key` increments per banner so React re-triggers the CSS animation; `hold` chooses `banner-hold`
  (stays) vs `banner-pop` (1.6 s pop). Banners are hidden during `matchEnd` (the results overlay replaces them).
- `flashKey`/`flash` drive the full-screen white flash; `hitAge < 0.25` triggers the health bar shake.

### Components
- `components/HUD.tsx` — health bars (skewed, with a white "ghost" bar that lags 350 ms), round pips (max 3
  shown), timer (red + blink ≤10 s), combo popup, banners, meters (gold + shine when ready), key hints
  (desktop only), **pause overlay** (RESUME / 🔊 AUDIO SETTINGS / QUIT, via the `onSettings` prop) and
  **match-end results overlay** (REMATCH / CHANGE FIGHTERS / MENU). Buttons carry `data-sfx` for UI sounds.
- `components/Menu.tsx` — `TitleScreen` (mode buttons + control legend) and `SelectScreen`
  (per-player fighter card grids generated from `Object.keys(FIGHTERS)`, arena cards from `ARENAS`,
  difficulty (cpu only), match length 1 / best-of-3 / best-of-5 → `roundsToWin` 1/2/3, FIGHT!).
  `FighterCard` reads `cfg.stats` for the icon + 3 stat bars and `moveNames`.
- `components/TouchControls.tsx` — pointer-captured buttons writing directly into the shared `touchInput`
  object (`Input.ts`); movement cluster bottom-left, L/H/S bottom-right. P1 only (buttons carry `data-sfx="none"`).
- `components/SettingsScreen.tsx` — the Audio Settings overlay: master/music/sfx sliders + mutes,
  a *Prefer built-in synth* toggle, and a per-slot URL editor grouped by category (fighters, arenas, UI,
  announcer, KO) with a live status badge (`WEB AUDIO` / `STREAMING` / `SYNTH` / …), preview ▶ and reset ↺
  per row, and TEST / RESET-ALL actions. Reads the engine reactively via `useSyncExternalStore(audio.subscribe, () => audio.version)`. Full spec in `docs/08-AUDIO.md`.
- `utils/cn.ts` — `clsx` + `tailwind-merge`.

### Styling
Tailwind 4 via `@tailwindcss/vite`; `src/index.css` holds custom keyframes/classes:
`banner-pop banner-hold combo-pop flash-in fade-up pulse-glow meter-full blink hp-shake card-glass
card-selected card-selected-gold key touch-btn text-stroke text-stroke-thin font-display font-ui`.
Fonts: **Bangers** (display) and **Rajdhani** (UI) from Google Fonts (linked in `index.html`; fall back to Impact/system).

## 2. Input (`src/game/Input.ts`)

```ts
interface InputState { left right up down light heavy special: boolean;   // held
                       jUp jLight jHeavy jSpecial: boolean }               // edge (this frame only)
```
- `InputManager` attaches `keydown/keyup/blur` on `window` (blur clears all held keys), routes codes through
  `P1_KEYS` / `P2_KEYS` maps, `preventDefault`s mapped keys, and calls `onPause` handlers on `Escape`.
- `PlayerInput.sample()` is called **once per frame per player** by `Game.update` and computes edges
  against the previous sample — do not call it twice in a frame or edges are lost.
- P1's sampler ORs in `touchInput` (the touch channel); P2 has no touch.
- Bindings are listed in `HANDOFF.md`. To rebind, edit the maps; the HUD/title legends are hard-coded text.
- `onAnyKey` exists but is currently unused.

The AI produces an `InputState` too (`AIController.update(dt)`), so the fighter code is agnostic to the
input source.

## 3. CPU AI (`src/game/AI.ts`)

A **plan-based** controller ticked every frame; it holds a `plan` for `timer` seconds then `decide()`s again.

Profiles (`easy / normal / hard`):
`reaction 0.42/0.24/0.12 s · blockChance 0.2/0.5/0.8 · aggression 0.45/0.65/0.85 · specialChance 0.25/0.5/0.75 ·
jumpInChance 0.1/0.2/0.3 · mistake 0.35/0.18/0.06`.

Plans: `idle approach retreat block jumpIn light heavy special air hop evade`.

Reactive overrides (checked every frame before the timer):
1. **Block** when the opponent's hit window is imminent within 3.2 units (subject to `reaction`) **or**
   `threat` (missiles in flight) — probability `blockChance`.
2. **Hop** away when the opponent is winding up an `unblockable` window within 2.8 units (grabs).
3. **Evade** (walk out) when within 2.0 units of any `hazards[]` x (gas clouds).

`decide(dist)` priorities: opponent down → give space; meter ready & `dist < 6` → `special`
(×1.5 chance when opponent is vulnerable); close (`< 2.3`) → mistake/idle, else attack (60 % light / 40 % heavy),
block or retreat by `aggression`; mid-range → `jumpIn` by `jumpInChance` (jumps toward and presses light near the
apex → air move); otherwise approach (mostly), with small retreat/idle chances.
While attacking, if the light hit landed and a cancel window exists, it may chain a heavy (`aggression·0.1` per frame).

Inputs from `Game` each frame: `ai.threat = missiles.activeCount > 0`, `ai.hazards = gas.positions()`.
The AI only ever controls **P2** (`fighters[1]`), constructed in `Game` when `mode === "cpu"`.

Extending: add a `Plan` literal, set it in `decide()` or a reactive block, and emit the corresponding
`InputState` bits in the `switch`. Remember attacks must be **edge** presses (`jLight` etc.) and the
`pressed` flag prevents re-pressing within a plan.
