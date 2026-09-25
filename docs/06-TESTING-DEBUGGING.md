# 06 — Testing, Debugging & Gotchas

There is no committed test suite. Verification during development was done with **headless Chromium via
Playwright** against the built `dist/index.html`, driving the game through debug hooks. This document
records the working recipe so the next agent can reproduce it in minutes.

## 1. Static checks (always run both)

```bash
npx tsc --noEmit -p tsconfig.json   # strict; unused locals/params are errors
npm run build                       # single-file bundle → dist/index.html
```

## 2. Debug hooks

| Hook | Where set | Purpose |
|---|---|---|
| `window.__game` | `Game` constructor | live `Game` instance: `fighters[0/1]`, `phase`, `startFight()`, `startRound()`, `restart()`, `gas`, `missiles`, `world`, `opts`, `phaseTime` (writable — set to 10 to fast-forward a phase) |
| `window.__cam = { pos:[x,y,z], look:[x,y,z] }` | read in `Game.updateCamera` | pins the camera (for renders/screenshots); delete the property to release |
| `window.__audio` | `AudioEngine.ts` | the audio engine: `inventory()` (per-slot tier/status), `play(id)`, `preview(id)`, `settings`, `currentMusic`, `setUrl(id,url)` |

Useful expressions (from `page.evaluate` or the devtools console):
```js
const g = window.__game, [a, b] = g.fighters;
g.startFight();                                 // skip the intro
a.meter = 100;                                  // enable the special
b.pos.x = a.pos.x + 1.5; b.state = 'idle';      // stage the opponent (then press a key)
a.startMove('heavy', g.world); a.stateTime = 0.3; a.checkHits(b, g.world);   // force a connect deterministically
b.hp = 5;                                       // quick KO setup
g.phaseTime = 10;                               // fast-forward ko → roundEnd → next round / matchEnd
g.gas.positions(); g.missiles.activeCount;      // hazard / projectile introspection
```
Private TS members are accessible at runtime (they're plain properties).

## 3. Headless harness (Playwright + SwiftShader)

Setup (once per sandbox; needs `sudo` for system libs):
```bash
cd /tmp && npm i playwright@1.49.1 --no-save && npx playwright install chromium
sudo apt-get update && sudo apt-get install -y libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
  libatspi1.0-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libxkbcommon0 libasound2 libcups2 libpango-1.0-0 libcairo2
```
(If `libatspi1.0-0` fails, the package is `libatspi2.0-0`.)

Launch flags that make WebGL2 work without a GPU (add the autoplay flag when testing audio):
```js
chromium.launch({ headless: true, args: [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage',
  '--autoplay-policy=no-user-gesture-required' ] });
```
Audio smoke test: click any button (unlocks the context), then
`page.evaluate(() => { const a = window.__audio; for (const x of a.inventory()) if (x.slot.kind === 'sfx') a.play(x.slot.id); })`
must produce no page errors; after ~6 s `inventory()` statuses should be `stream`/`buffer` for reachable
URLs and `synth` for the rest (headless Chromium decodes MP3 and loads cross-origin media elements).

Skeleton script (serve `dist/index.html` from a tiny `http` server, drive the UI by visible text):
```js
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs');
const html = fs.readFileSync('/path/to/dist/index.html');
http.createServer((q, r) => { r.writeHead(200, {'Content-Type':'text/html'}); r.end(html); }).listen(8123, async () => {
  const browser = await chromium.launch({ headless: true, args: [/* flags above */] });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });   // keep small: software GL is slow (3–5 fps at 240p)
  const logs = []; page.on('console', m => (m.type()==='error'||m.type()==='warning') && logs.push(m.text()));
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  await page.goto('http://localhost:8123/', { waitUntil: 'domcontentloaded' });
  await page.click('text=VS CPU');                 // or 'text=2 PLAYERS'
  (await page.$$('text=KING CROAK'))[0].click();   // fighter cards appear twice (P1 grid, P2 grid)
  await page.click('text=Golden Meadow'); await page.click('text=1 ROUND');
  await page.click('text=FIGHT!'); await page.waitForTimeout(1500);
  await page.evaluate(() => window.__game.startFight());
  await page.keyboard.press('KeyK');               // real key events work (P1 map)
  await page.waitForTimeout(500);
  console.log(await page.evaluate(() => { const [a,b] = window.__game.fighters; return [a.state, b.state, b.hp]; }));
  await page.screenshot({ path: '/tmp/shot.png' });
  console.log('errors:', logs); await browser.close(); process.exit(0);
});
```
Tips:
- Wrap everything in a global timeout; SwiftShader at 900×620 can take 20 s+ per screenshot.
- Use `page.$$('text=NAME')` for fighter cards (two matches) and index `[0]` for P1, `[1]` for P2.
- For character close-ups: go to the select screen (attract mode, fighters at `x = ∓2.6`), set `__cam`
  e.g. `{ pos:[x + dir*2.4, 1.6, 3.2], look:[x, 1.0, 0] }`, wait ~2.5 s, screenshot.
- For deterministic combat checks, prefer `startMove` + `stateTime` + `checkHits` (see §2) over timing key
  presses against a 3 fps render loop.

Verified end-to-end this way (as of handoff): title → select → fight; KO → roundEnd → next round →
matchEnd → REMATCH; TIME OVER; pause/quit; all three arenas; all four fighters; grab → hold → throw;
gas → hit → poison drain → "POISONED" HUD tag; missiles homing and detonating; zero console errors/warnings.

## 4. Known gotchas (read before debugging)

**Engine / three.js**
- `THREE.Clock` and `PCFSoftShadowMap` are deprecated/removed in r186 — the code uses `THREE.Timer` and
  `PCFShadowMap`. Don't reintroduce them (they log warnings).
- Custom `ShaderMaterial`s must include `<tonemapping_fragment>` + `<colorspace_fragment>`; forgetting
  makes the effect look flat/grey after `OutputPass`.
- `InstancedMesh` + `onBeforeCompile` (wind/fur): when adding uniforms, set `material.customProgramCacheKey`
  or three will reuse a program compiled without your injection.
- The first time a **new light count** appears (e.g. an FX `flash` point light in an arena that never had one)
  three recompiles affected materials → a one-frame hitch; harmless.
- `Rig` pose values are **offsets from rest**. Symptoms of forgetting: limbs double-rotated, ears folded.
- The rest-offset rule above applies to current procedural rigs. For skinned rigs, validate semantic bone maps, quaternion transfer, bind/rest alignment, in-place locomotion, two-instance skeleton isolation, clip interruption, and texture/material lifetime as specified in [`09-SKINNED-ANIMATION-CONTRACT.md`](09-SKINNED-ANIMATION-CONTRACT.md). Imported source clip length never overrides `moves.ts` hit timing.
- `Rig.play(name, true)` resets `time`; `Fighter.setState` always forces, so re-entering `idle` restarts the
  idle cycle (intentional).
- `rig.snap()` is called on `reset()`; if a new character's `idle` depends on `tick`-computed values,
  make sure they have sane defaults before the first frame.

**Combat**
- `checkHits` is attacker-side and only during `phase === "fight"`. Hits during `ko` slow-mo are intentionally impossible.
- Hit-stop pauses **fighter updates entirely** (including animation) but not FX/arena/projectiles.
- Air moves are cancelled by landing: `onLand` sets `move = null` — any per-move state (e.g. `fxDone`)
  must tolerate that.
- `moveHitLanded` is only set by **melee** hits; projectile/gas hits don't enable chain cancels.
- Poison can't kill (clamps at 1 hp) — a poisoned opponent at 1 hp must still be hit to KO.
- Grabs whiff on airborne opponents purely because the window uses the `low` band; if you change
  `BAND_RANGES.low`, re-check Gullet Toss.

**React / lifecycle**
- Never hold a `Game` across a `gameKey` change; the canvas remounts and the old context is force-lost.
- `StrictMode` double-invokes effects in dev: `Game` is constructed, disposed, constructed again on mount.
  Disposal is complete, so this is fine, but expect two "context lost" messages in dev.
- HUD state arrives ≈30 Hz; don't derive per-frame animation from it (use CSS animations keyed by `banner.key`/`flashKey`).

**Build**
- Single-file output: no `public/` assets survive as separate URLs (there is no `public/` dir by design).
- `noUnusedLocals`/`noUnusedParameters` are on — prefix intentionally unused params with `_`.

## 5. Performance sanity

- Target: 60 fps on an integrated GPU at 1080p. Heaviest scene: Golden Meadow + Fluffalo mirror match.
- Quick profile: `renderer.info.render.calls/triangles` via `window.__game.renderer.info` (private but reachable).
- Levers in order of impact: bloom resolution/strength → composer `samples` → pixel-ratio cap (1.5) →
  meadow grass counts (`scatter count` in `Meadow.ts`) → fur `layers`.
