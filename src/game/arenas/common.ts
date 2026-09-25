import * as THREE from "three";
import { FX } from "../FX";

export type ArenaId = "wasteland" | "foundry" | "meadow" | "kyoto";

export interface ArenaInfo {
  id: ArenaId;
  name: string;
  subtitle: string;
  gradient: string;
}

export const ARENAS: ArenaInfo[] = [
  { id: "wasteland", name: "Wasteland Sunset", subtitle: "Cracked earth · Storm front · Tumbleweeds", gradient: "linear-gradient(160deg,#1f3540 0%,#c8562a 55%,#ffb347 100%)" },
  { id: "foundry", name: "Scrapyard Foundry", subtitle: "Molten steel · Overhead crane · Sparks", gradient: "linear-gradient(160deg,#04161c 0%,#0f3a44 50%,#e0b520 100%)" },
  { id: "meadow", name: "Golden Meadow", subtitle: "Swaying wheat · Wildflowers · Butterflies", gradient: "linear-gradient(160deg,#8fb0dc 0%,#f6c98f 55%,#8a9a3e 100%)" },
  { id: "kyoto", name: "Kyoto Coliseum", subtitle: "Cherry petals · Stone courtyard · Kung fu crowd", gradient: "linear-gradient(160deg,#352942 0%,#b65f78 55%,#f8bb92 100%)" },
];

export interface Arena {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  exposure: number;
  bloom: { strength: number; threshold: number; radius: number };
  fog: THREE.Fog | THREE.FogExp2;
  background: THREE.Color;
  dustColor: number;
  update(dt: number, time: number, fx: FX): void;
  dispose(): void;
}

export const ARENA_BOUNDS = 7.6;

/** Inject a wind sway + height gradient into a MeshStandardMaterial (works with instancing). */
export function addWind(mat: THREE.Material, time: { value: number }, strength: number, height: number, tint = true) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uWind = { value: strength };
    shader.uniforms.uHeight = { value: height };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uWind; uniform float uHeight; varying float vH;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec4 wpos = instanceMatrix * vec4(transformed, 1.0);
          #else
            vec4 wpos = vec4(transformed, 1.0);
          #endif
          float hh = clamp(transformed.y / uHeight, 0.0, 1.0);
          vH = hh;
          float w = sin(uTime * 1.6 + wpos.x * 0.35 + wpos.z * 0.5) + 0.5 * sin(uTime * 2.7 + wpos.x * 0.9 - wpos.z * 0.4) + 0.25 * sin(uTime * 5.0 + wpos.z * 2.0);
          transformed.x += w * uWind * hh * hh;
          transformed.z += 0.35 * w * uWind * hh * hh;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vH;");
    if (tint) {
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= mix(0.42, 1.18, vH);");
    }
  };
  mat.customProgramCacheKey = () => `wind_${tint ? 1 : 0}`;
}

export function makeGround(tex: THREE.Texture, color: number, repeat: number, size = 700, roughness = 1) {
  tex.repeat.set(repeat, repeat);
  const mat = new THREE.MeshStandardMaterial({ map: tex, color, roughness, metalness: 0 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

/** Whether a point falls inside the fighting strip (kept clear of props). */
export function inArena(x: number, z: number, padX = 1.5, padZ = 2.4) {
  return Math.abs(x) < ARENA_BOUNDS + padX && Math.abs(z) < padZ;
}

export interface ScatterOpts {
  count: number;
  minR: number;
  maxR: number;
  zRange: [number, number];
  xRange: [number, number];
  rng: () => number;
  avoidArena?: boolean;
  padZ?: number;
}

/** Produce random XZ positions in a rectangle, optionally avoiding the arena. */
export function scatter(o: ScatterOpts): { x: number; z: number; r: number; s: number }[] {
  const out: { x: number; z: number; r: number; s: number }[] = [];
  let guard = 0;
  while (out.length < o.count && guard++ < o.count * 20) {
    const x = o.xRange[0] + o.rng() * (o.xRange[1] - o.xRange[0]);
    const z = o.zRange[0] + o.rng() * (o.zRange[1] - o.zRange[0]);
    if (o.avoidArena !== false && inArena(x, z, 1.2, o.padZ ?? 2.4)) continue;
    out.push({ x, z, r: o.rng() * Math.PI * 2, s: o.minR + o.rng() * (o.maxR - o.minR) });
  }
  return out;
}

export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose?.();
  });
}

/** Build a shadow-casting directional light with a shadow frustum covering the arena. */
export function makeSun(color: number, intensity: number, pos: THREE.Vector3, shadowSize = 2048) {
  const sun = new THREE.DirectionalLight(color, intensity);
  sun.position.copy(pos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const cam = sun.shadow.camera;
  cam.left = -16;
  cam.right = 16;
  cam.top = 12;
  cam.bottom = -8;
  cam.near = 1;
  cam.far = 120;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  sun.target.position.set(0, 0, 0);
  return sun;
}
