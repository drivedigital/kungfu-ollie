/**
 * Ground-contact audit.
 *
 * For every state key of every skinned fighter this steps the simulation and samples the *posed*
 * silhouette (skinned vertex positions, not bone positions), then reports how far the lowest
 * triangle sits from the stage floor.
 *
 *   CHROMIUM_PATH=/path/to/chromium PREVIEW_URL=http://127.0.0.1:8099 node tools/preview/foot-contact.mjs
 *
 * Output: handoff/reports/preview/foot-contact.json plus a suggested `yOffset` per state in source
 * units (`-minY / importScale`), which is what `bindings.ts` `ClipBinding.yOffset` consumes.
 * Airborne states are reported but never suggest an offset — being off the floor is the point.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const URL = process.env.PREVIEW_URL ?? "http://127.0.0.1:8099";
const OUT = resolve("handoff/reports/preview");
const WIDTH = Number(process.env.WIDTH ?? 900);
const HEIGHT = Number(process.env.HEIGHT ?? 420);
mkdirSync(OUT, { recursive: true });

const STATES = [
  "idle", "walkF", "walkB", "jump", "block", "light", "heavy", "special",
  "air", "hit", "launched", "down", "ko", "getup", "victory", "intro",
];
/** states where the feet are legitimately off the floor */
const AIRBORNE = new Set(["jump", "launched", "air"]);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: "shell",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-proxy-server",
    "--proxy-bypass-list=*",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--mute-audio",
    `--window-size=${WIDTH},${HEIGHT}`,
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120000 });

const click = (text, scope = null) =>
  page.evaluate(
    (needle, scopeText) => {
      let root = document;
      if (scopeText) {
        const section = [...document.querySelectorAll("section")].find((s) => (s.textContent || "").includes(scopeText));
        if (!section) return `MISS-SCOPE ${scopeText}`;
        root = section;
      }
      const el = [...root.querySelectorAll("button")].find((b) => (b.textContent || "").includes(needle));
      if (!el) return `MISS ${needle}`;
      el.click();
      return "ok";
    },
    text,
    scope,
  );

const clicks = [
  await click("VS CPU"),
  await click("OLLIE", "PLAYER 1"),
  await click("KING CROAK", "CPU OPPONENT"),
  await click("Kyoto Coliseum"),
  await click("FIGHT!"),
];
if (clicks.includes("ok") === false) throw new Error(`select flow failed: ${clicks.join(" | ")}`);
await page.waitForFunction(() => window.__game && window.__game.phase === "fight" && window.__game.fighters[0].controllable, {
  timeout: 240000,
  polling: 500,
});

const AIRBORNE_KEYS = AIRBORNE;
const result = await page.evaluate(async (states, airborne) => {
  const AIRBORNE_KEYS = new Set(airborne);
  const g = window.__game;
  const rigFor = (f) => f.rig;
  const idle = { left: false, right: false, up: false, down: false, light: false, heavy: false, special: false, jUp: false, jLight: false, jHeavy: false, jSpecial: false };
  g.ai = null;
  g.input.p1.sample = () => ({ ...idle });
  g.input.p2.sample = () => ({ ...idle });

  const bounds = (rig) => {
    let lo = Infinity;
    let hi = -Infinity;
    rig.root.updateMatrixWorld(true);
    rig.root.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 900));
      const v = new (o.position.constructor)();
      for (let i = 0; i < pos.count; i += step) {
        o.getVertexPosition(i, v);
        o.localToWorld(v);
        if (v.y < lo) lo = v.y;
        if (v.y > hi) hi = v.y;
      }
    });
    return { lo, hi };
  };

  const report = [];
  for (const f of g.fighters) {
    const rig = rigFor(f);
    if (!rig.describe) continue;
    for (const key of states) {
      // locomotion only exists while the stick is held, so hold it for the whole sample window
      const hold = key === "walkF" ? { right: true } : key === "walkB" ? { left: true } : key === "block" ? { down: true } : {};
      const press = () => ({ ...idle, ...hold });
      if (f === g.fighters[0]) g.input.p1.sample = press;
      else g.input.p2.sample = press;
      f.setState("idle");
      g.update(0.02);
      f.setState(key);
      // sample the whole state at ~0.02 s steps, up to 1.5 s of state time
      let lo = Infinity;
      let hi = -Infinity;
      let loAt = 0;
      let early = Infinity;
      // steady-state window: after the ground-offset ease has settled (~0.1 s) and after a
      // one-shot's take-off/landing frames, so the number reflects the held pose
      let late = Infinity;
      for (let t = 0; t < 75; t++) {
        const b = bounds(rig);
        if (b.lo < lo) {
          lo = b.lo;
          loAt = f.stateTime;
        }
        // airborne states are judged on their take-off frames only: the whole clip may legitimately
        // be high off the floor once the fighter is in the air
        if (t < 3) early = Math.min(early, b.lo);
        if (f.stateTime >= 0.3) late = Math.min(late, b.lo);
        hi = Math.max(hi, b.hi);
        if (rig.state !== key && t > 3) break; // one-shot finished / state changed
        g.update(0.02);
      }
      if (f === g.fighters[0]) g.input.p1.sample = () => ({ ...idle });
      else g.input.p2.sample = () => ({ ...idle });
      report.push({
        fighter: f.cfg.id,
        key,
        rigState: rig.state,
        clip: rig.describe().find((d) => d.state === key)?.clip ?? null,
        importScale: +rig.normScale.toFixed(4),
        lowest: +lo.toFixed(4),
        lowestAtStateTime: +loAt.toFixed(2),
        lowestEarly: +early.toFixed(4),
        lowestLate: +(late === Infinity ? lo : late).toFixed(4),
        highest: +hi.toFixed(4),
        // grounded states are lifted by their worst dip, airborne ones by their take-off frame
        suggestedYOffset: +(-(AIRBORNE_KEYS.has(key) ? early : lo) / rig.normScale).toFixed(4),
        suggestedYOffsetLate: +(-(late === Infinity ? lo : late) / rig.normScale).toFixed(4),
      });
    }
  }
  return report;
}, STATES, [...AIRBORNE]);

const table = result.filter((r) => !AIRBORNE.has(r.key));
writeFileSync(resolve(OUT, "foot-contact.json"), JSON.stringify({ all: result, grounded: table }, null, 2));
console.log(`${"fighter".padEnd(6)} ${"state".padEnd(10)} ${"lowest".padStart(8)} ${"steady".padStart(9)} ${"highest".padStart(8)} ${"fix".padStart(8)}  clip`);
for (const r of result) {
  console.log(
    `${r.fighter.padEnd(6)} ${r.key.padEnd(10)} ${String(r.lowest).padStart(8)} ${String(r.lowestLate).padStart(9)} ${String(r.highest).padStart(8)} ${String(r.suggestedYOffsetLate).padStart(8)}  ${r.clip ?? "-"}`,
  );
}
console.log(`\nwrote ${resolve(OUT, "foot-contact.json")}`);
await browser.close();
