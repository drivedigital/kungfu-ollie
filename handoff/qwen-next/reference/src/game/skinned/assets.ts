import * as THREE from "three";
import { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { CharId } from "../moves";
import type { ArenaId } from "../arenas/common";
import { skinnedBindingFor } from "./bindings";

/**
 * Async asset preparation.
 *
 * `Game` used to build both rigs synchronously in `makeRig`. The skinned path needs the GLBs
 * parsed *before* a match is constructed, so this module is the readiness gate: the UI awaits
 * `prepareAssets`, then hands the result to `new Game(canvas, { ...opts, assets })`.
 *
 * Everything degrades: a failed/absent GLB is reported in `missing` and the procedural
 * `CharacterRig` fallback is used instead, so a match always starts.
 */

export interface PreparedAssets {
  fighters: Partial<Record<CharId, GLTF>>;
  stages: Partial<Record<ArenaId, GLTF>>;
  /** urls that failed to load — the caller falls back to procedural content */
  missing: string[];
  /** bytes downloaded, surfaced in the loading HUD */
  bytes: number;
}

/** Stage props that ship as GLBs (foreground cherry tree for Kyoto). */
export const STAGE_MODELS: Partial<Record<ArenaId, string>> = {
  kyoto: "/models/kyoto-cherry-tree.glb",
};

const cache = new Map<string, Promise<GLTF | null>>();
const loader = new GLTFLoader();
// The optimised handoff GLBs use EXT_meshopt_compression + EXT_texture_webp + KHR_mesh_quantization.
loader.setMeshoptDecoder(MeshoptDecoder);

let bytesLoaded = 0;

function parse(url: string, buf: ArrayBuffer): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    loader.parse(
      buf,
      "",
      (gltf) => resolve(gltf),
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
}

function loadOnce(url: string): Promise<GLTF | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = (async () => {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    bytesLoaded += buf.byteLength;
    const gltf = await parse(url, buf);
    // shared, immutable source data: per-instance skeletons are cloned at rig construction
    gltf.scene.updateMatrixWorld(true);
    return gltf;
  })().catch((err) => {
    console.warn("[assets] failed to load", url, err);
    return null;
  });
  cache.set(url, p);
  return p;
}

/** Preload + parse every GLB a match needs. Never rejects. */
export async function prepareAssets(chars: CharId[], arena: ArenaId): Promise<PreparedAssets> {
  const urls = new Map<string, { kind: "fighter"; id: CharId } | { kind: "stage"; id: ArenaId }>();
  for (const c of chars) {
    const b = skinnedBindingFor(c);
    if (b) urls.set(b.url, { kind: "fighter", id: c });
  }
  const stageUrl = STAGE_MODELS[arena];
  if (stageUrl) urls.set(stageUrl, { kind: "stage", id: arena });

  const out: PreparedAssets = { fighters: {}, stages: {}, missing: [], bytes: 0 };
  const entries = [...urls.entries()];
  const results = await Promise.all(entries.map(([url]) => loadOnce(url)));
  entries.forEach(([url, meta], i) => {
    const gltf = results[i];
    if (!gltf) {
      out.missing.push(url);
      return;
    }
    if (meta.kind === "fighter") out.fighters[meta.id] = gltf;
    else out.stages[meta.id] = gltf;
  });
  out.bytes = bytesLoaded;
  return out;
}

export function emptyAssets(): PreparedAssets {
  return { fighters: {}, stages: {}, missing: [], bytes: 0 };
}

export function assetsReady(a: PreparedAssets | undefined, chars: CharId[], arena: ArenaId): boolean {
  if (!a) return false;
  for (const c of chars) {
    const b = skinnedBindingFor(c);
    if (b && !a.fighters[c]) return false;
  }
  if (STAGE_MODELS[arena] && !a.stages[arena]) return false;
  return true;
}

/** Debug helper: how many animations/skins a parsed asset carries. */
export function describeAsset(gltf: GLTF): string {
  let skinned = 0;
  let tris = 0;
  gltf.scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) skinned++;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const g = mesh.geometry;
      tris += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
    }
  });
  return `${gltf.animations.length} clips · ${skinned} skinned · ${Math.round(tris)} tris`;
}

/** Drop cached parses (used when the roster/stage changes on a memory-constrained device). */
export function clearAssetCache() {
  cache.clear();
}
