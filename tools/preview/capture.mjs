/**
 * Offline preview harness.
 *
 *   node tools/preview/capture.mjs --mode=shots     # screenshots + render statistics
 *   node tools/preview/capture.mjs --mode=soak      # rematch / arena / fighter switching soak
 *   node tools/preview/capture.mjs --mode=states    # drive all 16 state keys per skinned fighter
 *
 * Requires a Chromium with WebGL. In this repository's CI sandbox no browser can be downloaded, so
 * the harness is pointed at a local binary instead:
 *
 *   CHROMIUM_PATH=/path/to/chromium PREVIEW_URL=http://127.0.0.1:5173 node tools/preview/capture.mjs
 *
 * `puppeteer-core` is intentionally not a dependency of the game bundle; install it next to the
 * harness (see tools/README.md) when you want to run this.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const argv = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const MODE = argv.get("mode") ?? "shots";
const URL = process.env.PREVIEW_URL ?? "http://127.0.0.1:5173";
const OUT = resolve(argv.get("out") ?? "handoff/reports/preview");
const EXEC = process.env.CHROMIUM_PATH;
const WIDTH = Number(argv.get("width") ?? 900);
const HEIGHT = Number(argv.get("height") ?? 420);

mkdirSync(OUT, { recursive: true });

const log = (...args) => console.log(...args);

async function launch() {
  return puppeteer.launch({
    executablePath: EXEC || undefined,
    headless: "shell",
    args: [
      "--no-sandbox",
      // the sandbox env sets HTTP(S)_PROXY, which would break loopback access
      "--no-proxy-server",
      "--proxy-bypass-list=*",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--hide-scrollbars",
      "--mute-audio",
      `--window-size=${WIDTH},${HEIGHT}`,
    ],
  });
}

async function openPage(browser, setup = { mode: "cpu", p1: "dog", p2: "toad", arena: "kyoto" }) {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => consoleErrors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ""}`));
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 120000 });
  await page.waitForFunction("!!window.__game || !!document.querySelector('canvas')", { timeout: 120000 });

  const clickText = async (text, nth = 0, scope = null) => {
    const ok = await page.evaluate(
      (needle, index, scopeText) => {
        let root = document;
        if (scopeText) {
          const section = [...document.querySelectorAll("section")].find((s) => (s.textContent || "").includes(scopeText));
          if (!section) return false;
          root = section;
        }
        const els = [...root.querySelectorAll("button")].filter((b) => (b.textContent || "").includes(needle));
        if (els.length <= index) return false;
        els[index].click();
        return true;
      },
      text,
      nth,
      scope,
    );
    if (!ok) throw new Error(`button "${text}" (#${nth}${scope ? ` in "${scope}"` : ""}) not found`);
    await new Promise((r) => setTimeout(r, 200));
  };

  let expect = null;
  if (setup) {
    const CARD = { chicken: "ROBO-CLUCK", buffalo: "FLUFFALO", ewe: "SCRAP-EWE", toad: "KING CROAK", dog: "OLLIE" };
    const ARENA = { kyoto: "Kyoto Coliseum", meadow: "Golden Meadow", foundry: "Scrapyard Foundry", wasteland: "Wasteland Sunset" };
    const P2_SCOPE = setup.mode === "2p" ? "PLAYER 2" : "CPU OPPONENT";
    await clickText("VS CPU");
    // each player grid is its own <section>; a card label exists in both grids, so scope the click
    await clickText(CARD[setup.p1] ?? setup.p1, 0, "PLAYER 1");
    await clickText(CARD[setup.p2] ?? setup.p2, 0, P2_SCOPE);
    await clickText(ARENA[setup.arena] ?? setup.arena, 0);
    expect = setup;
    await clickText("FIGHT!");
    // the loading overlay owns the screen until the asset gate resolves
    await page.waitForFunction("!document.querySelector('div.bg-red-950')", { timeout: 180000 }).catch(() => {});
    // the title screen runs its own attract-mode Game; wait for the *match* instance
    await page.waitForFunction(
      (want) => window.__game && window.__game.phase !== "attract" && window.__game.fighters[0].cfg.id === want.p1 && window.__game.fighters[1].cfg.id === want.p2,
      { timeout: 180000, polling: 500 },
      expect,
    );
  }

  // wait for the game object and for the asset gate to finish
  await page.waitForFunction("!!window.__game", { timeout: 120000 });
  await page.waitForFunction("window.__game && !document.querySelector('div.bg-red-950\\\\/95')", { timeout: 120000 });
  return { page, consoleErrors };
}

async function snapshot(page) {
  return page.evaluate(() => window.__game.debugSnapshot());
}

/** Advance the simulation: the game uses its own rAF loop, so we just wait. */
const settle = (page, ms) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms);

async function shoot(page, name) {
  const file = resolve(OUT, `${name}.png`);
  await page.screenshot({ path: file, type: "png" });
  log(`  saved ${file}`);
  return file;
}

async function main() {
  const browser = await launch();
  const results = { mode: MODE, url: URL, viewport: [WIDTH, HEIGHT], runs: [] };

  if (MODE === "shots" || MODE === "all") {
    const { page, consoleErrors } = await openPage(browser);
    log(`shot run: waiting for the intro to settle`);
    await settle(page, 6000);
    await shoot(page, "01-kyoto-intro");
    const intro = await snapshot(page);
    log(`  intro render: ${intro.render.calls} calls, ${intro.render.triangles} tris, camera inside envelope=${intro.camera.insideEnvelope}`);

    await settle(page, 4000);
    await shoot(page, "02-kyoto-fight");
    const fight = await snapshot(page);
    log(`  fight render: ${fight.render.calls} calls, ${fight.render.triangles} tris`);

    // push both fighters to opposite boundaries to check framing at the fight limits
    await page.evaluate(() => {
      const g = window.__game;
      g.fighters[0].pos.x = -7.6;
      g.fighters[1].pos.x = 7.6;
    });
    await settle(page, 2500);
    await shoot(page, "03-kyoto-boundaries");
    const bounds = await snapshot(page);
    log(`  boundary ndc: ${bounds.fighters.map((f) => `${f.id}(${f.ndc.join(",")})`).join(" ")}`);

    // simultaneous jump apexes
    await page.evaluate(() => {
      const g = window.__game;
      for (const f of g.fighters) {
        f.pos.y = 2.3;
        f.vy = 0;
        f.setState("jump");
      }
    });
    await settle(page, 900);
    await shoot(page, "04-kyoto-jump-apex");
    const apex = await snapshot(page);
    log(`  apex ndc: ${apex.fighters.map((f) => `${f.id}(${f.ndc.join(",")})`).join(" ")}`);

    // each skinned fighter forced into all 16 states, one screenshot per fighter at light/heavy
    await page.evaluate(() => {
      const g = window.__game;
      g.fighters[0].pos.x = -2.2;
      g.fighters[1].pos.x = 2.2;
      g.fighters[0].pos.y = 0;
      g.fighters[1].pos.y = 0;
    });
    await settle(page, 1200);

    results.runs.push({ shots: ["01-kyoto-intro", "02-kyoto-fight", "03-kyoto-boundaries", "04-kyoto-jump-apex"], intro, fight, bounds, apex, consoleErrors });
    await page.close();
  }

  if (MODE === "states" || MODE === "all") {
    const { page, consoleErrors } = await openPage(browser, { mode: "cpu", p1: "dog", p2: "toad", arena: "kyoto" });
    await settle(page, 7000);

    // 1. drive all 16 state keys on both rigs and record state / clip / playability / tongue reach
    const matrix = await page.evaluate(async () => {
      const KEYS = [
        "idle", "walkF", "walkB", "jump", "block", "light", "heavy", "special",
        "air", "hit", "launched", "down", "ko", "getup", "victory", "intro",
      ];
      const g = window.__game;
      const rows = [];
      const idle = { left: false, right: false, up: false, down: false, light: false, heavy: false, special: false, jUp: false, jLight: false, jHeavy: false, jSpecial: false };
      // block is owned by the state machine (down input), everything else can be requested directly
      g.input.p1.sample = () => ({ ...idle });
      g.input.p2.sample = () => ({ ...idle });
      for (const f of g.fighters) {
        const rig = f.rig;
        if (!rig.describe) continue;
        const meshBounds = (rig) => {
          let lo = Infinity;
          let hi = -Infinity;
          rig.root.updateMatrixWorld(true);
          rig.root.traverse((o) => {
            if (!o.isSkinnedMesh) return;
            const pos = o.geometry.attributes.position;
            const step = Math.max(1, Math.floor(pos.count / 700));
            const v = new (o.position.constructor)();
            for (let i = 0; i < pos.count; i += step) {
              o.getVertexPosition(i, v);
              o.localToWorld(v);
              if (v.y < lo) lo = v.y;
              if (v.y > hi) hi = v.y;
            }
          });
          return { minY: +lo.toFixed(4), maxY: +hi.toFixed(4) };
        };
        for (const key of KEYS) {
          // a forced KO/down state can end the round; keep the matrix inside the fight phase
          if (g.phase !== "fight") {
            g.phase = "fight";
            g.phaseTime = 0;
          }
          f.hp = Math.max(f.hp, 1);
          f.dead = false;
          if (key === "block") {
            const press = () => ({ ...idle, down: true });
            if (f === g.fighters[0]) g.input.p1.sample = press;
            else g.input.p2.sample = press;
            for (let step = 0; step < 6; step++) {
              await new Promise((r) => setTimeout(r, 40));
              g.update(0.02);
            }
            g.input.p1.sample = () => ({ ...idle });
            g.input.p2.sample = () => ({ ...idle });
          } else {
            f.setState(key);
          }
          await new Promise((r) => setTimeout(r, 160));
          // Reachability is judged the instant the state is requested: the stepping below moves
          // one-shot states on (that is what it is for) and must not be read as a mismatch.
          const requested = rig.state === key || f.move?.slot === key;
          // sample the silhouette across the state so a transient dip cannot hide between frames
          let minY = Infinity;
          let maxY = -Infinity;
          for (let step = 0; step < 6; step++) {
            g.update(0.02);
            const b = meshBounds(rig);
            minY = Math.min(minY, b.minY);
            maxY = Math.max(maxY, b.maxY);
          }
          const row = rig.describe().find((d) => d.state === key);
          rows.push({
            fighter: f.cfg.id,
            minY: +minY.toFixed(4),
            maxY: +maxY.toFixed(4),
            key,
            rigState: rig.state,
            matched: requested,
            clip: row?.clip ?? null,
            playable: !!row?.playable,
            provisional: !!row?.provisional,
            tongueReach: +rig.tongueReach().toFixed(3),
            rootY: +g.fighters.indexOf(f),
          });
        }
      }
      return rows;
    });
    writeFileSync(resolve(OUT, "state-matrix.json"), JSON.stringify(matrix, null, 2));
    log(`  state matrix: ${matrix.length} rows, mismatched=${matrix.filter((r) => !r.matched).length}, unplayable=${matrix.filter((r) => !r.playable).length}`);

    // 2. curated evidence frames: each attack is photographed at its own contact window
    /**
     * Evidence frames.
     *
     * Attack poses are reached by *driving the real input sampler* (never by poking the rig), and
     * the simulation is frozen with `timeScale = 0` at the moment the move's own contact window
     * opens, so the screenshot shows the same pose the hit test used.
     */
    const FRAMES = [
      { name: "light-contact", actor: 0, key: "light", at: 0.19, press: { light: true, jLight: true } },
      { name: "heavy-contact", actor: 0, key: "heavy", at: 0.35, press: { heavy: true, jHeavy: true } },
      { name: "special-charge", actor: 0, key: "special", at: 0.5, press: { special: true, jSpecial: true }, meter: true },
      { name: "frog-light-contact", actor: 1, key: "light", at: 0.17, press: { light: true, jLight: true } },
      { name: "frog-heavy-grab", actor: 1, key: "heavy", at: 0.36, press: { heavy: true, jHeavy: true } },
      { name: "frog-special-charge", actor: 1, key: "special", at: 0.55, press: { special: true, jSpecial: true }, meter: true },
      { name: "frog-air", actor: 1, key: "air", at: 0.3, press: { light: true, jLight: true }, airborne: true },
      { name: "walk-backward", actor: 0, key: "walkB", at: 0.6, press: { left: true } },
      { name: "guard-block", actor: 0, key: "block", at: 0.4, press: { down: true } },
      { name: "hit-recoil", both: "hit", at: 0.1 },
      { name: "launched", both: "launched", at: 0.35 },
      { name: "knockdown", both: "down", at: 0.6 },
      { name: "ko-hold", both: "ko", at: 1.0 },
      { name: "getup-mid", both: "getup", at: 0.3 },
      { name: "victory", both: "victory", at: 1.2 },
      { name: "intro-bow", both: "intro", at: 1.6 },
    ];

    const frameLog = [];
    for (const frame of FRAMES) {
      const evaluated = await page.evaluate(
        async (spec) => {
          const g = window.__game;
          const [a, b] = g.fighters;
          g.timeScale = 1;
          // a forced KO in the matrix run ends the round; the intro phase ignores input
          const waitUntil = performance.now() + 15000;
          while (performance.now() < waitUntil && (g.phase !== "fight" || !a.controllable)) {
            await new Promise((r) => setTimeout(r, 50));
          }
          const idle = { left: false, right: false, up: false, down: false, light: false, heavy: false, special: false, jUp: false, jLight: false, jHeavy: false, jSpecial: false };
          const sampleFor = (press) => () => ({ ...idle, ...press });
          // reset both fighters and park them near the middle, facing each other
          for (const [i, f] of [a, b].entries()) {
            f.pos.x = i === 0 ? -1.3 : 1.3;
            f.pos.y = 0;
            f.vy = 0;
            f.facing = i === 0 ? 1 : -1;
            f.setState("idle");
          }
          g.input.p1.sample = sampleFor(idle);
          g.input.p2.sample = sampleFor(idle);
          await new Promise((r) => setTimeout(r, 500));

          // the CPU drives P2 through the AI, which would outvote the injected sampler
          g.ai = null;
          /**
           * The frames deliberately knock both fighters out, which ends the round; the next frame
           * would then begin inside a fresh round intro. Put the match back into the fight phase
           * before every evidence frame (harness only — the game itself never does this).
           */
          if (g.phase !== "fight") {
            g.phase = "fight";
            g.phaseTime = 0;
            g.timeScale = 1;
          }
          // settle both rigs back to a clean idle before the frame, so one frame cannot inherit the
          // previous frame's tongue length, guard pose or carried momentum
          for (const f of [a, b]) {
            f.setState("idle");
            f.pos.y = 0;
            f.vy = 0;
            f.hp = Math.max(f.hp, 1);
            f.dead = false;
          }
          for (let i = 0; i < 90; i++) g.update(0.02);

          const actor = spec.actor != null ? g.fighters[spec.actor] : null;
          const other = spec.actor != null ? g.fighters[1 - spec.actor] : null;
          if (spec.meter) {
            const m = g.fighters[spec.actor].cfg.moves.special.meterCost ?? 0;
            g.fighters[spec.actor].meter = Math.max(g.fighters[spec.actor].meter ?? 0, m);
          }
          if (spec.actor != null) {
            const press = { ...spec.press };
            if (spec.airborne && press.light) press.jLight = true;
            if (spec.actor === 0) g.input.p1.sample = sampleFor(press);
            else g.input.p2.sample = sampleFor(press);
            if (spec.airborne) {
              actor.pos.y = 1.6;
              actor.vy = 2.2;
              actor.grounded = false;
            }
          } else {
            for (const [i, f] of [a, b].entries()) {
              f.pos.x = i === 0 ? -1.3 : 1.3;
              f.setState(spec.both);
            }
          }

          // poll until the state is engaged and its own clock passes the contact time
          /**
           * Advance the simulation deterministically.
           *
           * The software rasterizer runs at roughly one frame per second, so wall-clock polling
           * would take a minute per attack and drift off the window. Instead the frame is stepped
           * by hand through the game's own update (02 s at a time) until the state clock reaches
           * the move's contact time, which is the pose the hit test used.
           */
          const stepTo = (f, target) => {
            let guard = 0;
            while (f.stateTime < target && guard++ < 140) g.update(0.02);
            return f.stateTime;
          };
          const deadline = performance.now() + 15000;
          while (performance.now() < deadline) {
            const f = actor ?? a;
            // attacks report state "attack" with a move slot; poses report their own key
            const engaged = f.move?.slot === spec.key || f.state === spec.key;
            if (engaged) break;
            await new Promise((r) => setTimeout(r, 40));
          }
          // step both fighters: the attacker to its contact time, the other to a readable pose
          for (const f of [a, b]) {
            const wanted = actor ? (f === actor ? spec.at : Math.min(spec.at, 0.35)) : spec.at;
            if (f.state === spec.key || f.move?.slot === spec.key || (!actor && f === a)) stepTo(f, wanted);
          }
          g.timeScale = 0; // freeze (the mixer advances with sim dt, so the pose stays put)
          // let the rAF loop render the frozen frame
          await new Promise((r) => setTimeout(r, 1800));

          const report = (f) => {
            const V = f.pos.constructor;
            return {
              fighter: f.cfg.id,
              state: f.state,
              slot: f.move?.slot ?? null,
              move: f.move?.name ?? null,
              stateTime: +f.stateTime.toFixed(3),
              grounded: f.grounded,
              tongue: f.rig.tongueReach ? +f.rig.tongueReach().toFixed(3) : 0,
              strike: f.rig.strikeWorld ? f.rig.strikeWorld(spec.key === "heavy" ? "heavy" : spec.key === "air" ? "air" : spec.key === "special" ? "special" : "light", new V()).toArray().map((v) => +v.toFixed(2)) : null,
              chest: f.rig.chestWorld(new V()).toArray().map((v) => +v.toFixed(2)),
              pos: [+f.pos.x.toFixed(2), +f.pos.y.toFixed(2), +f.pos.z.toFixed(2)],
            };
          };
          return [a, b].map(report);
        },
        frame,
      );
      const hit = await page.evaluate(() => (window.__game.hits ?? null));
      frameLog.push({ frame: frame.name, fighters: evaluated, hit });
      await page.screenshot({ path: resolve(OUT, `state-${frame.name}.jpg`), type: "jpeg", quality: 85 });
      await page.evaluate(() => {
        window.__game.timeScale = 1;
      });
      log(`  ${frame.name}: ${evaluated.map((e) => `${e.fighter}/${e.state}@${e.stateTime}s tongue=${e.tongue} strike=[${e.strike}]`).join("  |  ")}`);
      void hit;
    }
    writeFileSync(resolve(OUT, "state-frames.json"), JSON.stringify(frameLog, null, 2));
    results.runs.push({ matrix: matrix.length, mismatches: matrix.filter((r) => !r.matched).length, unplayable: matrix.filter((r) => !r.playable).length, frameLog, consoleErrors });
    await page.close();
  }

  if (MODE === "soak" || MODE === "all") {
    // two instances of the same model, rematch, arena change, fighter change, then a fresh page
    const { page, consoleErrors } = await openPage(browser, { mode: "cpu", p1: "dog", p2: "dog", arena: "kyoto" });
    await settle(page, 6000);
    const same = await snapshot(page);
    log(`  dog-vs-dog: ${same.fighters.map((f) => `${f.skinned ? "skinned" : "procedural"}/${f.rigState}/${f.flashMaterials}`).join(" ")}`);
    await shoot(page, "05-dog-vs-dog");

    // independent flash: flash only fighter 0 and confirm the two rigs report different emissive state
    const flash = await page.evaluate(async () => {
      const g = window.__game;
      const [a, b] = g.fighters;
      const before = [a.rig.flashMaterials.length, b.rig.flashMaterials.length];
      a.rig.flash(1);
      const emisA = a.rig.flashMaterials.map((m) => +m.emissiveIntensity.toFixed(3));
      const emisB = b.rig.flashMaterials.map((m) => +m.emissiveIntensity.toFixed(3));
      return {
        before,
        matsA: a.rig.flashMaterials.length,
        matsB: b.rig.flashMaterials.length,
        distinct: a.rig.flashMaterials[0] !== b.rig.flashMaterials[0],
        emisA: emisA[0],
        emisB: emisB[0],
        sharedGeometry: a.rig.root === b.rig.root ? "same root!" : "separate roots",
      };
    });

    const memory = [];
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.__game.restart());
      await settle(page, 2200);
      memory.push((await snapshot(page)).render);
      log(`  restart ${i + 1}: ${memory[i].calls} calls, geometries=${memory[i].geometries}, textures=${memory[i].textures}`);
    }

    // arena + fighter swap sends us back through the menu-like remount path
    await page.evaluate(() => {
      const g = window.__game;
      g.fighters[0].cfg;
    });
    const afterSoak = await snapshot(page);
    results.runs.push({ same, flash, memory, afterSoak, consoleErrors });
    await page.close();
  }

  writeFileSync(resolve(OUT, "browser-measurements.json"), JSON.stringify(results, null, 2));
  log(`\nwrote ${resolve(OUT, "browser-measurements.json")}`);
  await browser.close();
  const errors = results.runs.flatMap((r) => r.consoleErrors ?? []);
  if (errors.length) {
    log(`\nconsole errors during the run:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    process.exitCode = 2;
  }
}

await main();
