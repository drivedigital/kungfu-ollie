import * as THREE from "three";

/**
 * Shell fur: the surface is rendered N times, each "shell" pushed out along the
 * normal. A 3D noise field decides where hair exists; the threshold rises with
 * shell height so tufts taper into soft rounded tips instead of spikes.
 */
export interface FurShellOpts {
  layers: number;
  /** hair length in local units */
  length: number;
  /** tufts per unit */
  density: number;
  /** gravity sag amount (keep <= 0.5 for the surface-normal component) */
  droop?: number;
  /** direction hair sags toward, in the part's local space */
  droopDir?: [number, number, number];
  /** clumping / wave amount */
  curl?: number;
  color: number;
  /** colour mottling 0..1 */
  variation?: number;
  /** idle sway multiplier */
  sway?: number;
  /** shorten hair where dot(position, n) rises from `from` to `to` (multiplier -> `min`) */
  mask?: { n: [number, number, number]; from: number; to: number; min: number };
}

export interface FurShared {
  time: { value: number };
  jiggle: { value: number };
}

const NOISE_GLSL = /* glsl */ `
  float furHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float furNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(furHash(i), furHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(furHash(i + vec3(0.0, 1.0, 0.0)), furHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(furHash(i + vec3(0.0, 0.0, 1.0)), furHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(furHash(i + vec3(0.0, 1.0, 1.0)), furHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
`;

export function furShells(source: THREE.BufferGeometry, o: FurShellOpts, shared: FurShared): THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  const layers = o.layers;
  const geo = source.clone();
  const layerAttr = new THREE.InstancedBufferAttribute(new Float32Array(layers), 1);
  for (let i = 0; i < layers; i++) layerAttr.setX(i, (i + 1) / layers);
  geo.setAttribute("aLayer", layerAttr);

  const mat = new THREE.MeshStandardMaterial({ color: o.color, roughness: 1, metalness: 0 });
  const mask = o.mask;
  const uniforms: Record<string, THREE.IUniform> = {
    uLength: { value: o.length },
    uDensity: { value: o.density },
    uDroop: { value: Math.min(0.5, o.droop ?? 0.45) },
    uDroopDir: { value: new THREE.Vector3(...(o.droopDir ?? [0, -1, 0])).normalize() },
    uCurl: { value: o.curl ?? 0.3 },
    uVariation: { value: o.variation ?? 0.2 },
    uSway: { value: o.sway ?? 1 },
    uMaskN: { value: new THREE.Vector3(...(mask?.n ?? [0, 1, 0])) },
    uMaskFrom: { value: mask ? mask.from : 1e6 },
    uMaskTo: { value: mask ? mask.to : 1e6 + 1 },
    uMaskMin: { value: mask ? mask.min : 1 },
    uTime: shared.time,
    uJiggle: shared.jiggle,
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aLayer;
        uniform float uLength, uDensity, uDroop, uCurl, uSway, uTime, uJiggle, uMaskFrom, uMaskTo, uMaskMin;
        uniform vec3 uDroopDir, uMaskN;
        varying float vLayer, vLenVar, vTint;
        varying vec3 vBasePos;
        ${NOISE_GLSL}`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          vLayer = aLayer;
          vBasePos = position;
          vLenVar = mix(0.5, 1.0, furNoise(position * uDensity * 0.28 + 5.0));
          vTint = furNoise(position * 4.0 + 2.0);
          float dm = 1.0 - (1.0 - uMaskMin) * smoothstep(uMaskFrom, uMaskTo, dot(position, uMaskN));
          float L = uLength * dm;
          float h = aLayer;
          vec3 d = normal * (L * h);
          d += uDroopDir * (uDroop * L * h * h);
          vec3 c = vec3(sin(position.y * 9.0 + position.z * 7.0), 0.0, cos(position.x * 8.0 + position.y * 6.0));
          d += c * (uCurl * L * h * h);
          float sway = sin(uTime * 2.2 + position.x * 3.0 + position.y * 2.0) * 0.06 * uSway
                     + uJiggle * sin(uTime * 38.0 + position.y * 12.0 + position.x * 5.0) * 0.4;
          d.x += sway * L * h * h;
          d.z += sway * 0.5 * L * h * h;
          transformed += d;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uDensity, uVariation;
        varying float vLayer, vLenVar, vTint;
        varying vec3 vBasePos;
        ${NOISE_GLSL}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec3 p = vBasePos * uDensity;
          float n = furNoise(p) * 0.62 + furNoise(p * 2.3 + 11.7) * 0.38;
          float cov = clamp((n - 0.25) * 2.4, 0.0, 1.0);
          float h = vLayer / vLenVar;
          if (cov < h) discard;
          // darker roots, lighter tips + soft rim so the silhouette reads as fuzz
          float ao = mix(0.4, 1.12, vLayer);
          float rim = 1.0 - abs(dot(normalize(vViewPosition), normalize(vNormal)));
          diffuseColor.rgb *= ao * mix(1.0 - uVariation, 1.0 + uVariation * 0.5, vTint) * (1.0 + 0.3 * rim * rim);
        }`,
      );
  };
  mat.customProgramCacheKey = () => "fur-shells";

  const mesh = new THREE.InstancedMesh(geo, mat, layers);
  const id = new THREE.Matrix4();
  for (let i = 0; i < layers; i++) mesh.setMatrixAt(i, id);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  return mesh;
}
