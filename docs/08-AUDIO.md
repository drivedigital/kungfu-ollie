# 08 — Audio: Engine, Assets & Settings

## 1. Overview

```
src/game/audio/
  AudioEngine.ts   singleton mixer + loader + player (exported as `audio`, also window.__audio)
  catalog.ts       every sound *slot*: id, label, group, kind, synth recipe, base gain, retrigger guard, `cut`
  defaults.ts      AUTO-GENERATED default URLs (Pixabay CDN) + attribution per slot
  synth.ts         procedural fallback: offline sample renderer (48 recipes) + realtime ProceduralMusic
src/components/SettingsScreen.tsx   mixer, per-slot URL editor, previews, status badges
```

Signal graph (Web Audio):
```
buffer/synth voices ─┐
ambient loops        ─┼─► sfxGain ────────────────┐
                                                   ├─► masterGain ─► DynamicsCompressor ─► destination
music (buffer / MediaElementSource) ─► musicGain ─► duckGain ┘
```
`musicGain` and `sfxGain` are the two user-facing buses (volume + mute); `duckGain` is used for
pause / KO ducking; the compressor prevents clipping when many hits overlap.

## 2. Source tiers (how a slot is resolved)

For each slot the engine resolves `url = settings.urls[id] ?? DEFAULTS[id].url ?? ""` (or `""` when
*Prefer synth* is on), then tries in order:

| Tier | Status badge | Mechanism | When |
|---|---|---|---|
| 1 buffer | `WEB AUDIO` | `fetch(url, {mode:"cors"})` → `decodeAudioData` → `AudioBufferSourceNode` (sample-accurate, pan/rate/delay) | host sends CORS headers (self-hosted, GitHub Pages, S3 w/ CORS, jsDelivr…) |
| 2 stream | `STREAMING` | `HTMLAudioElement` pool (≤4 per slot). If the host is CORS-capable the element is bridged with `createMediaElementSource` into the bus; otherwise it plays directly and `el.volume` **mirrors** `master × bus × slotGain` (mute → 0) | hosts without CORS — **this is the path all default Pixabay files take** |
| 3 synth | `SYNTH` | `renderSynth(recipe)` → cached `AudioBuffer` | empty URL, HTTP/decode error, media `error`, `NotAllowedError` (iOS gesture rule), or while a tier-1 buffer is still loading |

Host policy is learned per session (`hostPolicy` map): a CORS `TypeError` marks the host `nocors`
so later slots skip straight to tier 2 (avoids console spam). `cdn.pixabay.com` is pre-seeded as `nocors`.
Long assets (`kind: "music" | "ambient"`) never use tier 1 — they're always streamed (`loop = true`);
CORS capability is probed with a `HEAD` request to decide whether to bridge them into the graph.

**Why:** Pixabay's CDN (`https://cdn.pixabay.com/audio/YYYY/MM/DD/audio_<hash>.mp3`) serves files with
Range support but **no `Access-Control-Allow-Origin`**, so `fetch`/`decodeAudioData` and
`createMediaElementSource` cannot be used with it (the latter would output silence). The
`/download/audio/...?filename=` links shown on the site are additionally bot-protected (403 for non-browsers).

## 3. Public API (`audio`)

```ts
audio.unlock()                          // call from a gesture; creates/resumes the context, starts pending music
audio.play(id, { gain, rate, vary, pan, delay })   // one-shot SFX (respects slot.minInterval)
audio.playMusic(id) / stopMusic(fade)   // idempotent per id; crossfades
audio.playAmbient(id) / stopAmbient()
audio.duckMusic(amount, seconds)        // pause = duckMusic(0.35, 3600), resume = duckMusic(1, 0.1)
audio.setMusicRate(rate)                // KO slow-mo drama (0.72), reset to 1 at round start / end
audio.preload(ids) / preloadFor(chars, arena)
audio.setLevel("master"|"music"|"sfx", v) / setMute(ch, bool) / setPreferSynth(bool)
audio.setUrl(id, url) / resetUrl(id) / resetAll() / resolveUrl(id) / defaultUrl(id)
audio.status(id) → { status, note, url } ; audio.inventory() → rows for the settings table
audio.preview(id)                       // settings: sfx once; music/ambient for 8 s then restore
audio.subscribe(cb) / audio.version     // React: useSyncExternalStore
```
Settings persist in `localStorage["rcvf.audio.v1"]` (`{ master, music, sfx, muteMusic, muteSfx, preferSynth, urls }`).

## 4. Slot catalogue (81 slots)

- **Per fighter (14 × 4)** — `<char>.{whoosh,punch,clang,knock,thud,hiya}.{soft,hard}`, `<char>.intro`, `<char>.special`.
  For organic fighters "clang" = body block (slap synth), for robots = metal ring. "hiya" = species cry
  (cluck/crow, snort/bellow, bleat, croak) and doubles as the hurt voice on hard hits.
- **Interface & Transitions** — `ui.click`, `ui.hover`, `ui.back`, `ui.select`, `ui.transition`, `ui.start`, `music.menu`.
- **Announcer & Intros** — `announce.round`, `announce.fight`, `announce.win`, `announce.match`, `timer.tick`, `crowd.cheer`, `crowd.gasp`.
- **Knockout** — `ko.impact`, `announce.ko`, `ko.slowmo`, `ko.fall`, `ko.bell`.
- **Per arena (2 × 3)** — `arena.<id>.music`, `arena.<id>.ambient`.

Adding a slot: append to `CATALOG` (pick a `SynthId`, or add a recipe in `synth.ts` `R` table), optionally add a
default in `defaults.ts`, then trigger it from `Game.ts`. The settings screen picks it up automatically.

## 5. Event → sound map (all in `Game.ts` unless noted)

| Event | Sounds |
|---|---|
| `Game` constructor | preload fighters + arena; `music.menu` (attract) or `arena.X.music`; `arena.X.ambient` |
| `startRound` | `announce.round`, `p1.intro` @0.55 s, `p2.intro` @1.45 s, music rate 1 |
| `startFight` | `announce.fight` |
| `onMoveStart` | light: `whoosh.soft` (+30 % `hiya.soft`); heavy: `whoosh.hard` + `hiya.soft`; air: `whoosh.hard` ×1.15; special: `hiya.hard`; `__fire`: `<char>.special` |
| `onHit` blocked | defender `clang.{soft|hard}` (hard ≥ 10 dmg), panned by x |
| `onHit` grab | attacker `knock.soft`, defender `hiya.soft` |
| `onHit` clean | attacker `punch.{soft|hard}`; launcher → `knock.hard`; hard → defender `hiya.soft` |
| `onLand` | impact > 9: `thud.hard` (+ `ko.fall` when launched/dead); > 3: `thud.soft` |
| `World.cue` (Fighter) | jump: `whoosh.soft` (quiet, fast); throw: victim `hiya.soft` + grabber `whoosh.hard`; getup: quiet `thud.soft` |
| `triggerKO` | `ko.impact`, `ko.slowmo`, `crowd.gasp`, `announce.ko`, loser `hiya.hard` (slow), duck 0.3 for 3.2 s, music rate 0.72; time-over: `ko.bell` |
| `endRound` | `announce.win`, `crowd.cheer`, winner `hiya.hard`; draw: `ko.bell`; music rate 1 |
| `afterRound` (match end) | `announce.match`, `crowd.cheer`, duck |
| fight timer ≤ 10 s | `timer.tick` each second (faster pitch ≤ 3 s) |
| pause / resume | duck 0.35 / restore |
| UI buttons (`App.tsx` delegated listener) | `data-sfx` attribute or `ui.click`; hover → `ui.hover`; `data-sfx="none"` opts out (touch controls) |

## 6. Procedural fallback (`synth.ts`)

Offline renderer (`renderSynth(id, sampleRate, variant)`): a tiny DSP toolkit — RBJ biquads with sweepable
cutoff, decaying inharmonic partials (clangs/bells/gongs), filtered noise with per-sample gain/frequency
callbacks (whooshes, crowds, wind), harmonic/pulse voices through formant band-passes (animal cries,
belch), thumps with pitch drops (punches/thuds), `tanh` soft clipping, normalisation, and `makeLoop` for
seamless 6-second ambience beds. Results are memoised per `(recipe, sampleRate, variant)`; SFX alternate
two variants and ±4–8 % rate jitter to avoid machine-gun repetition.

Music fallback (`ProceduralMusic`): a 25 ms-interval lookahead scheduler playing a 32-step chip loop
(bass + lead oscillators through a low-pass, kick + noise hats) with per-theme BPM/scale/swing for
`menu`, `wasteland` (bluesy, slow), `foundry` (industrial 140 bpm), `meadow` (major pentatonic).
`setRate()` supports slow-motion.

## 7. Default asset sourcing (reproducible)

Pixabay HTML is Cloudflare-protected (403 to curl/headless). The working pipeline (scripts lived in
`/tmp/pb/`, not committed):
1. `https://r.jina.ai/https://pixabay.com/sound-effects/search/<term>/` (markdown) → list of sound pages with title/author/duration.
2. `https://r.jina.ai/<sound page>` with headers `X-Return-Format: html`, `X-Wait-For-Selector: audio` → page HTML containing
   `https://cdn.pixabay.com/download/audio/YYYY/MM/DD/audio_<hash>.mp3?filename=…`.
3. Rewrite to `https://cdn.pixabay.com/audio/YYYY/MM/DD/audio_<hash>.mp3` and `curl -I` verify `200 audio/mpeg`.
4. Generate `defaults.ts` (`{ url, title, author, page, seconds }` per slot).
Pace requests (~3.5 s apart, retry on "Just a moment" challenge pages). Music lives under `/music/search/`.

License: Pixabay Content License (free for commercial use, no attribution required); attribution is shown
in the settings table anyway. Hot-linking is convenient for a single-file build but not guaranteed stable —
self-hosting the files on a CORS-enabled host (and pasting the URLs into Settings, or editing `defaults.ts`)
upgrades every slot to tier 1.

## 8. Gotchas

- Autoplay: nothing plays until `audio.unlock()` runs inside a user gesture (App installs capture-phase
  `pointerdown`/`keydown`/`click` listeners). `playMusic/playAmbient` before unlock are queued (`pendingMusic`).
- iOS Safari may reject `HTMLAudioElement.play()` outside a gesture → slot is marked `blocked` → synth.
- `preservesPitch = false` is set on elements so `rate` produces real pitch shifts (tape-style slow-mo).
- Media elements can't be panned; only tier-1/synth voices use `StereoPannerNode`.
- Changing a URL invalidates the slot immediately (and restarts the track if it's the current music/ambient).
- `slot.minInterval` (default 30 ms) suppresses double triggers within one frame; long-tail slots use bigger values.
- `slot.cut` (seconds, SFX only) fades a one-shot out early so a long remote file matches the on-screen
  action — e.g. a 5 s "cinematic boom" used for a punch is cut to ~1.2 s. Applied to both buffer voices
  (gain ramp + `stop`) and pooled media elements (timed volume fade, cancellable by a per-element token).
  The built-in synths are already the right length, so `cut` mainly guards against over-long user URLs.
- Headless verification: Chromium with `--autoplay-policy=no-user-gesture-required`; `window.__audio.inventory()`
  shows per-slot tiers (all 81 default URLs verified reachable; 76 `stream` immediately, the remaining arena tracks load lazily — see `docs/06`).
