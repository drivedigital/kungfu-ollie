import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { ArenaId } from "../arenas/common";
import type { CharId } from "../moves";

/**
 * Async asset preparation.
 *
 * The game used to build every rig synchronously. Skinned fighters and the Kyoto foreground tree
 * are GLBs, so a match now has a readiness gate: `prepareMatch()` parses everything a match needs
 * *before* `new Game(...)` runs, and reports progress to the UI.
 *
 * Ownership rules (see docs/09 and docs/10):
 *   - the cache owns parsed geometry, skins and textures; it is shared by every instance and must
 *     outlive a match (`clearAssetCache()` is the only place that drops it),
 *   - a rig instance owns its cloned skeleton, its cloned materials and its mixer,
 *   - the Kyoto stage owns its cloned tree *node graph and materials*, never the cached buffers.
 *
 * A failed load is reported and forgotten: the promise is removed from the cache so a retry
 * (the "Retry" button) starts a fresh request instead of replaying a rejected promise.
 */

export type SkinnedId = "dog" | "toad";

export interface FighterSource {
  id: SkinnedId;
  url: string;
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  bytes: number;
}

export interface StageSource {
  url: string;
  scene: THREE.Group;
  bytes: number;
}

export const FIGHTER_GLB: Record<SkinnedId, string> = {
  // Rebuilt from handoff/kyoto-v1/models/*.glb by tools/assets/build-runtime-assets.sh:
  // EXT_meshopt_compression + EXT_texture_webp + KHR_mesh_quantization.
  dog: "/models/dog.glb",
  toad: "/models/kingcroak.glb",
};

export const STAGE_GLB: Partial<Record<ArenaId, string>> = {
  kyoto: "/models/kyoto-cherry-tree.glb",
};

export type AssetPhase = "idle" | "loading" | "ready" | "error";

export interface AssetStatus {
  key: string;
  label: string;
  phase: AssetPhase;
  bytes: number;
  error?: string;
}

export interface PreparedAssets {
  fighters: Partial<Record<SkinnedId, FighterSource>>;
  stages: Partial<Record<ArenaId, StageSource>>;
  /** assets that failed to load — a match still starts with the procedural fallback */
  missing: string[];
  /** total bytes fetched during this call (for the loading HUD) */
  bytes: number;
}

/* ------------------------------------------------------------------ */
/* Loader + cache                                                      */
/* ------------------------------------------------------------------ */

const loader = new GLTFLoader();
// Required: the shipped GLBs are EXT_meshopt_compression encoded (docs/10).
loader.setMeshoptDecoder(MeshoptDecoder);

const pending = new Map<string, Promise<unknown>>();
const failed = new Map<string, string>();

const statuses = new Map<string, AssetStatus>();
const listeners = new Set<(all: AssetStatus[]) => void>();

function emit() {
  if (!listeners.size) return;
  const all = [...statuses.values()];
  for (const l of listeners) l(all);
}

export function subscribeAssets(listener: (all: AssetStatus[]) => void) {
  listeners.add(listener);
  listener([...statuses.values()]);
  return () => listeners.delete(listener);
}

export function assetSnapshot(): AssetStatus[] {
  return [...statuses.values()];
}

function status(key: string, label: string, phase: AssetPhase, bytes = 0, error?: string) {
  const prev = statuses.get(key);
  statuses.set(key, { key, label, phase, bytes: bytes || prev?.bytes || 0, error });
  emit();
}

/** Forget every cached parse. Only safe while no match is running. */
export function clearAssetCache() {
  pending.clear();
  failed.clear();
  statuses.clear();
  emit();
}

function cached<T>(key: string, label: string, load: () => Promise<T>): Promise<T> {
  const hit = pending.get(key);
  if (hit) return hit as Promise<T>;
  status(key, label, "loading");
  const promise = load()
    .then((value) => {
      const bytes = (value as { bytes?: number }).bytes ?? 0;
      status(key, label, "ready", bytes);
      failed.delete(key);
      return value;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      // do not keep a rejected promise: the next call retries
      pending.delete(key);
      failed.set(key, message);
      status(key, label, "error", 0, message);
      throw error;
    });
  pending.set(key, promise);
  return promise;
}

function parse(buffer: ArrayBuffer): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  return new Promise((resolve, reject) => {
    loader.parse(buffer, "", (gltf) => resolve(gltf as never), (error) => reject(error));
  });
}

async function fetchGlb(url: string) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  return { buffer, bytes: buffer.byteLength };
}

/* ------------------------------------------------------------------ */
/* Public loading API                                                  */
/* ------------------------------------------------------------------ */

export function loadFighter(id: SkinnedId): Promise<FighterSource> {
  const url = FIGHTER_GLB[id];
  return cached(`fighter:${id}`, `${id} fighter`, async () => {
    const { buffer, bytes } = await fetchGlb(url);
    const gltf = await parse(buffer);
    gltf.scene.updateMatrixWorld(true);
    return { id, url, scene: gltf.scene, animations: gltf.animations, bytes } satisfies FighterSource;
  });
}

export function loadStage(id: ArenaId): Promise<StageSource> {
  const url = STAGE_GLB[id];
  if (!url) return Promise.reject(new Error(`No GLB stage asset for ${id}`));
  return cached(`stage:${id}`, `${id} stage props`, async () => {
    const { buffer, bytes } = await fetchGlb(url);
    const gltf = await parse(buffer);
    gltf.scene.updateMatrixWorld(true);
    return { url, scene: gltf.scene, bytes } satisfies StageSource;
  });
}

export function skinnedIdOf(id: CharId): SkinnedId | null {
  return id === "dog" || id === "toad" ? id : null;
}

/**
 * Load everything a match needs. Never rejects: whatever fails lands in `missing`, and the match
 * starts with the procedural fighter / tree-less stage instead.
 */
export async function prepareMatch(chars: CharId[], arena: ArenaId): Promise<PreparedAssets> {
  const needed = [...new Set(chars.map(skinnedIdOf).filter((x): x is SkinnedId => !!x))];
  const out: PreparedAssets = { fighters: {}, stages: {}, missing: [], bytes: 0 };

  const jobs: Promise<void>[] = needed.map((id) =>
    loadFighter(id).then(
      (source) => {
        out.fighters[id] = source;
        out.bytes += source.bytes;
      },
      (error: unknown) => {
        out.missing.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
      },
    ),
  );

  if (STAGE_GLB[arena]) {
    jobs.push(
      loadStage(arena).then(
        (source) => {
          out.stages[arena] = source;
          out.bytes += source.bytes;
        },
        (error: unknown) => {
          out.missing.push(`${arena} stage: ${error instanceof Error ? error.message : String(error)}`);
        },
      ),
    );
  }

  await Promise.all(jobs);
  return out;
}

export function emptyAssets(): PreparedAssets {
  return { fighters: {}, stages: {}, missing: [], bytes: 0 };
}
