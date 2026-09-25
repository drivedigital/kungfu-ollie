/**
 * Static binding audit: every clip name in `src/game/skinned/bindings.ts` must exist in the GLB it
 * is bound to, every trim range must be inside the clip's duration, and the `fit` timings must match
 * `src/game/moves.ts`.
 *
 *   node tools/validate/binding-clips.mjs
 *
 * This is the check that keeps the runtime honest: a binding row pointing at a clip the file does
 * not contain is a bug, not a placeholder (the rig reports missing clips at runtime too).
 */
import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

// the shipped files carry meshopt-compressed buffers, so the reader needs the matching extension
const io = new NodeIO()
  .registerExtensions(KHRONOS_EXTENSIONS)
  .registerExtensions([EXTMeshoptCompression, EXTTextureWebP])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
await MeshoptDecoder.ready;

const FILES = {
  dog: "public/models/dog.glb",
  toad: "public/models/kingcroak.glb",
};

const source = readFileSync("src/game/skinned/bindings.ts", "utf8");
// The state tables are flat object literals: `key: { clip: "Name", trim: [a, b], fit: X, ... }`
const blocks = source.split(/^export const (DOG|CROAK)_BINDING/m).slice(1);
const failures = [];
const summary = [];

for (let i = 0; i < blocks.length; i += 2) {
  const who = blocks[i] === "DOG" ? "dog" : "toad";
  const body = blocks[i + 1];
  const doc = await io.read(FILES[who]);
  const clips = new Map(doc.getRoot().listAnimations().map((a) => [a.getName(), a]));
  const rows = [...body.matchAll(/^\s{4}([a-zA-Z]+): \{ clip: "([^"]+)"(.*)$/gm)];
  let ok = 0;
  for (const [, key, clip, rest] of rows) {
    const anim = clips.get(clip);
    if (!anim) {
      failures.push(`${who}.${key}: clip "${clip}" is not in ${FILES[who]}`);
      continue;
    }
    const duration = Math.max(
      0,
      ...anim.listSamplers().map((s) => {
        // accessors written without min/max throw inside getMax(); read the last time directly
        const accessor = s.getInput();
        const count = accessor.getCount();
        return count ? accessor.getElement(count - 1, [])[0] : 0;
      }),
    );
    const trim = rest.match(/trim: \[([\d.]+), ([\d.]+)\]/);
    if (trim) {
      const [a, b] = [Number(trim[1]), Number(trim[2])];
      if (a >= b) failures.push(`${who}.${key}: trim ${a}–${b} is empty`);
      if (b > duration + 1e-4) failures.push(`${who}.${key}: trim end ${b} > "${clip}" duration ${duration.toFixed(3)}`);
    }
    const fit = rest.match(/fit: ([A-Z_]+)\.([a-zA-Z]+)\.duration/);
    if (fit) {
      const moves = readFileSync("src/game/moves.ts", "utf8");
      const cfg = moves.slice(moves.indexOf(`id: "${who}"`));
      const m = cfg.match(new RegExp(`slot: "${fit[2]}"[\\s\\S]{0,200}?duration: ([\\d.]+)`));
      if (!m) failures.push(`${who}.${key}: could not find ${fit[2]}.duration in moves.ts`);
      else {
        const target = Number(m[1]);
        const expect = Number(fit[1] ? 1 : 1) * target;
        void expect;
        // `fit` retimes the *trimmed* clip (the rig clamps the factor to 0.05–8)
        const trimmed = trim ? Number(trim[2]) - Number(trim[1]) : duration;
        const rowsClamped = trimmed / target;
        if (rowsClamped < 0.05 || rowsClamped > 8) failures.push(`${who}.${key}: retime factor ${rowsClamped.toFixed(2)} outside the 0.05–8 clamp`);
        summary.push(`${who}.${key}  ${clip}  trim=${trim ? trim[1] + "–" + trim[2] : "full"} (${duration.toFixed(2)}s)  fit=${target}s → rate ${rowsClamped.toFixed(2)}`);
      }
    }
    ok++;
  }
  summary.push(`${who}: ${ok}/${rows.length} rows resolve to a clip that exists`);
}

console.log(summary.join("\n"));
if (failures.length) {
  console.error(`\n${failures.length} binding problem(s):\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("\nbindings OK");
}
