import * as THREE from "three";
import { cloudTexture, glowTexture } from "./textures";

export interface SkyOptions {
  top: string;
  mid: string;
  bottom: string;
  sunColor: string;
  sunDir: THREE.Vector3;
  sunSize?: number;
  haze?: number;
  clouds?: { count: number; colorA: string; colorB: string; height: [number, number]; scale: number; opacity: number };
  sunGlow?: number;
}

const vert = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const frag = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 midColor;
  uniform vec3 bottomColor;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  uniform float sunSize;
  uniform float haze;
  varying vec3 vWorldPos;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec3 dir = normalize(vWorldPos - cameraPosition);
    float h = dir.y;
    vec3 col = mix(midColor, topColor, smoothstep(0.02, 0.55, h));
    col = mix(bottomColor, col, smoothstep(-0.25, 0.04, h));
    float sd = max(dot(dir, normalize(sunDir)), 0.0);
    float disc = smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.35, sd);
    float glow = pow(sd, 6.0) * haze * 0.9 + pow(sd, 32.0) * 0.6;
    col += sunColor * (disc * 2.2 + glow);
    // subtle horizon band
    col += midColor * 0.12 * (1.0 - smoothstep(0.0, 0.18, abs(h)));
    // dithering to avoid banding
    col += (hash(gl_FragCoord.xy) - 0.5) * 0.008;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Sky {
  group = new THREE.Group();
  private clouds: { sprite: THREE.Sprite; speed: number }[] = [];
  private material: THREE.ShaderMaterial;

  constructor(opts: SkyOptions) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        topColor: { value: new THREE.Color(opts.top) },
        midColor: { value: new THREE.Color(opts.mid) },
        bottomColor: { value: new THREE.Color(opts.bottom) },
        sunColor: { value: new THREE.Color(opts.sunColor) },
        sunDir: { value: opts.sunDir.clone().normalize() },
        sunSize: { value: opts.sunSize ?? 0.004 },
        haze: { value: opts.haze ?? 0.6 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), this.material);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);

    if (opts.sunGlow) {
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture(),
          color: new THREE.Color(opts.sunColor),
          transparent: true,
          opacity: opts.sunGlow,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      );
      glow.position.copy(opts.sunDir).normalize().multiplyScalar(820);
      glow.scale.setScalar(420);
      this.group.add(glow);
    }

    if (opts.clouds) {
      const c = opts.clouds;
      const ca = new THREE.Color(c.colorA);
      const cb = new THREE.Color(c.colorB);
      for (let i = 0; i < c.count; i++) {
        const t = i / Math.max(1, c.count - 1);
        const mat = new THREE.SpriteMaterial({
          map: cloudTexture(1 + (i % 4)),
          color: ca.clone().lerp(cb, t + (Math.random() - 0.5) * 0.3),
          transparent: true,
          opacity: c.opacity * (0.7 + Math.random() * 0.3),
          depthWrite: false,
          fog: false,
        });
        const s = new THREE.Sprite(mat);
        const ang = -Math.PI * 0.05 - Math.PI * 0.9 * t + (Math.random() - 0.5) * 0.35;
        const r = 560 + Math.random() * 200;
        s.position.set(Math.cos(ang) * r, c.height[0] + Math.random() * (c.height[1] - c.height[0]), Math.sin(ang) * r - 100);
        const sc = c.scale * (0.7 + Math.random() * 0.7);
        s.scale.set(sc * 2.2, sc, 1);
        this.group.add(s);
        this.clouds.push({ sprite: s, speed: 1.5 + Math.random() * 2.5 });
      }
    }
  }

  update(dt: number) {
    for (const c of this.clouds) {
      c.sprite.position.x += c.speed * dt;
      if (c.sprite.position.x > 800) c.sprite.position.x = -800;
    }
  }
}
