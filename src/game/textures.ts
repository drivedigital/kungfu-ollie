import * as THREE from "three";

/** Deterministic PRNG (mulberry32) so textures look the same every load. */
export function makeRng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h = w) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Soft multi-octave noise layered onto a context with a blend mode. */
function noise(
  ctx: CanvasRenderingContext2D,
  size: number,
  rng: () => number,
  octaves: number[],
  alpha: number,
  mode: GlobalCompositeOperation = "overlay",
) {
  for (const cells of octaves) {
    const small = canvas(cells);
    const sctx = small.getContext("2d")!;
    const img = sctx.createImageData(cells, cells);
    for (let i = 0; i < cells * cells; i++) {
      const v = Math.floor(rng() * 255);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = mode;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, 0, 0, size, size);
    ctx.restore();
  }
}

function finish(c: HTMLCanvasElement, repeat = 1, srgb = true) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture) {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/* ------------------------------------------------------------------ */
/* Ground textures                                                     */
/* ------------------------------------------------------------------ */

export function crackedEarthTexture() {
  return cached("earth", () => {
    const size = 1024;
    const c = canvas(size);
    const ctx = c.getContext("2d")!;
    const rng = makeRng(11);
    ctx.fillStyle = "#c48a56";
    ctx.fillRect(0, 0, size, size);
    noise(ctx, size, rng, [4, 8, 16, 64, 256], 0.35);
    // warm/dark patches
    for (let i = 0; i < 40; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const r = 60 + rng() * 160;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rng() > 0.5 ? "rgba(120,70,40,0.25)" : "rgba(230,190,140,0.2)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // cracks: branching polylines
    ctx.lineCap = "round";
    const crack = (x: number, y: number, ang: number, len: number, w: number, depth: number) => {
      if (depth <= 0 || w < 0.4) return;
      ctx.beginPath();
      ctx.moveTo(x, y);
      let cx = x;
      let cy = y;
      let a = ang;
      const steps = 6 + Math.floor(rng() * 6);
      for (let s = 0; s < steps; s++) {
        a += (rng() - 0.5) * 0.9;
        const l = len / steps;
        cx += Math.cos(a) * l;
        cy += Math.sin(a) * l;
        ctx.lineTo(cx, cy);
        if (rng() < 0.25) crack(cx, cy, a + (rng() > 0.5 ? 1 : -1) * (0.6 + rng() * 0.8), len * 0.5, w * 0.6, depth - 1);
      }
      ctx.strokeStyle = "rgba(60,30,15,0.85)";
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,220,180,0.25)";
      ctx.lineWidth = w * 0.5;
      ctx.stroke();
    };
    for (let i = 0; i < 70; i++) crack(rng() * size, rng() * size, rng() * Math.PI * 2, 120 + rng() * 260, 2.5 + rng() * 2.5, 3);
    // pebbles
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = rng() > 0.5 ? "rgba(90,55,30,0.35)" : "rgba(240,210,170,0.3)";
      ctx.beginPath();
      ctx.arc(rng() * size, rng() * size, 1 + rng() * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(c);
  });
}

export function concreteTexture() {
  return cached("concrete", () => {
    const size = 1024;
    const c = canvas(size);
    const ctx = c.getContext("2d")!;
    const rng = makeRng(23);
    ctx.fillStyle = "#6e7378";
    ctx.fillRect(0, 0, size, size);
    noise(ctx, size, rng, [4, 8, 32, 128, 512], 0.32);
    // slab seams
    ctx.strokeStyle = "rgba(20,22,25,0.7)";
    ctx.lineWidth = 6;
    for (let i = 0; i <= 2; i++) {
      const p = (i * size) / 2;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }
    // oil stains & rust
    for (let i = 0; i < 26; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const r = 40 + rng() * 140;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const rust = rng() > 0.6;
      g.addColorStop(0, rust ? "rgba(120,60,25,0.45)" : "rgba(10,12,14,0.55)");
      g.addColorStop(0.6, rust ? "rgba(120,60,25,0.15)" : "rgba(10,12,14,0.2)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // scratches
    ctx.strokeStyle = "rgba(200,205,210,0.18)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 160; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const a = rng() * Math.PI;
      const l = 20 + rng() * 120;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    return finish(c);
  });
}

export function hazardStripeTexture() {
  return cached("hazard", () => {
    const c = canvas(256, 64);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#e0b520";
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = "#15171a";
    for (let x = -64; x < 320; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 32, 0);
      ctx.lineTo(x + 64, 64);
      ctx.lineTo(x + 32, 64);
      ctx.closePath();
      ctx.fill();
    }
    const rng = makeRng(5);
    noise(ctx, 256, rng, [8, 32], 0.4, "multiply");
    const tex = finish(c);
    tex.repeat.set(8, 1);
    return tex;
  });
}

export function grassTexture() {
  return cached("grass", () => {
    const size = 1024;
    const c = canvas(size);
    const ctx = c.getContext("2d")!;
    const rng = makeRng(37);
    ctx.fillStyle = "#8a9a3e";
    ctx.fillRect(0, 0, size, size);
    noise(ctx, size, rng, [4, 8, 16, 64], 0.4);
    for (let i = 0; i < 30; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const r = 80 + rng() * 200;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rng() > 0.5 ? "rgba(200,170,70,0.35)" : "rgba(70,100,40,0.35)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // blade strokes
    ctx.lineCap = "round";
    for (let i = 0; i < 5000; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const l = 6 + rng() * 14;
      const a = -Math.PI / 2 + (rng() - 0.5) * 1.2;
      const light = rng() > 0.5;
      ctx.strokeStyle = light ? `rgba(${190 + rng() * 40},${180 + rng() * 40},${70 + rng() * 40},0.35)` : `rgba(${40 + rng() * 30},${70 + rng() * 40},${25 + rng() * 20},0.4)`;
      ctx.lineWidth = 1 + rng() * 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    return finish(c);
  });
}

/* ------------------------------------------------------------------ */
/* Character textures                                                  */
/* ------------------------------------------------------------------ */

/** Scratched, grimy brushed metal. Used as color map + roughness map. */
export function metalTexture() {
  return cached("metal", () => {
    const size = 512;
    const c = canvas(size);
    const ctx = c.getContext("2d")!;
    const rng = makeRng(77);
    ctx.fillStyle = "#b9c2c9";
    ctx.fillRect(0, 0, size, size);
    noise(ctx, size, rng, [4, 16, 128], 0.28);
    // brushed streaks
    for (let i = 0; i < 400; i++) {
      const y = rng() * size;
      ctx.strokeStyle = rng() > 0.5 ? "rgba(255,255,255,0.12)" : "rgba(40,45,50,0.16)";
      ctx.lineWidth = 0.5 + rng() * 1.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y + (rng() - 0.5) * 6);
      ctx.stroke();
    }
    // grime spots
    for (let i = 0; i < 24; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const r = 20 + rng() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(50,40,30,0.45)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // scratches
    ctx.lineCap = "round";
    for (let i = 0; i < 90; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const a = rng() * Math.PI;
      const l = 10 + rng() * 60;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
      ctx.strokeStyle = "rgba(30,30,30,0.35)";
      ctx.beginPath();
      ctx.moveTo(x + 1, y + 1);
      ctx.lineTo(x + Math.cos(a) * l + 1, y + Math.sin(a) * l + 1);
      ctx.stroke();
    }
    const tex = finish(c);
    tex.repeat.set(1, 1);
    return tex;
  });
}

/** Shaggy golden fur strands. */
export function furTexture() {
  return cached("fur", () => {
    const size = 512;
    const c = canvas(size);
    const ctx = c.getContext("2d")!;
    const rng = makeRng(101);
    ctx.fillStyle = "#b07a3a";
    ctx.fillRect(0, 0, size, size);
    noise(ctx, size, rng, [4, 8, 32], 0.35);
    ctx.lineCap = "round";
    for (let i = 0; i < 9000; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const l = 8 + rng() * 22;
      const a = Math.PI / 2 + (rng() - 0.5) * 0.9;
      const shade = rng();
      ctx.strokeStyle =
        shade > 0.66
          ? `rgba(${225 + rng() * 30},${180 + rng() * 40},${110 + rng() * 40},0.5)`
          : shade > 0.33
            ? `rgba(${160 + rng() * 40},${105 + rng() * 40},${50 + rng() * 30},0.5)`
            : `rgba(${90 + rng() * 40},${55 + rng() * 30},${25 + rng() * 20},0.55)`;
      ctx.lineWidth = 0.8 + rng() * 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + (rng() - 0.5) * 8, y + l * 0.5, x + Math.cos(a) * l * 0.4, y + Math.sin(a) * l);
      ctx.stroke();
    }
    return finish(c);
  });
}

/** Mottled olive toad skin with light warts. */
export function toadSkinTexture() {
  return cached("toadskin", () => {
    const size = 512;
    const c = canvas(size);
    const ctx = c.getContext("2d")!;
    const rng = makeRng(313);
    ctx.fillStyle = "#5e7a2c";
    ctx.fillRect(0, 0, size, size);
    noise(ctx, size, rng, [4, 8, 32, 128], 0.3);
    for (let i = 0; i < 46; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const r = 14 + rng() * 40;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(40,62,22,0.55)");
      g.addColorStop(0.7, "rgba(40,62,22,0.25)");
      g.addColorStop(1, "rgba(40,62,22,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 26; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const r = 20 + rng() * 50;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(150,170,70,0.35)");
      g.addColorStop(1, "rgba(150,170,70,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 220; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const r = 2 + rng() * 5;
      ctx.fillStyle = "rgba(30,45,15,0.45)";
      ctx.beginPath();
      ctx.arc(x + 1, y + 1.5, r * 1.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${150 + rng() * 40},${175 + rng() * 30},${70 + rng() * 30},0.7)`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(c);
  });
}

/** Black map with soft glowing dots, concentrated on the back (top of the UV sphere). */
export function toadGlowTexture() {
  return cached("toadglow", () => {
    const size = 512;
    const c = canvas(size);
    const ctx = c.getContext("2d")!;
    const rng = makeRng(919);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 90; i++) {
      const x = rng() * size;
      const y = rng() * size * 0.55;
      const r = 4 + rng() * 10;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.35, "rgba(200,255,160,0.7)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return finish(c);
  });
}

export function strawTexture() {
  return cached("straw", () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext("2d")!;
    const rng = makeRng(59);
    ctx.fillStyle = "#c9a24d";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 1600; i++) {
      ctx.strokeStyle = rng() > 0.5 ? "rgba(255,230,150,0.5)" : "rgba(120,80,30,0.45)";
      ctx.lineWidth = 1 + rng();
      const x = rng() * size;
      const y = rng() * size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 30, y + (rng() - 0.5) * 6);
      ctx.stroke();
    }
    return finish(c);
  });
}

/* ------------------------------------------------------------------ */
/* Sprites                                                             */
/* ------------------------------------------------------------------ */

export function softCircleTexture() {
  return cached("soft", () => {
    const size = 128;
    const c = canvas(size);
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.7)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

export function sparkTexture() {
  return cached("spark", () => {
    const size = 64;
    const c = canvas(size);
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.2, "rgba(255,255,255,0.9)");
    g.addColorStop(0.5, "rgba(255,255,255,0.25)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

export function smokeTexture() {
  return cached("smoke", () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext("2d")!;
    const rng = makeRng(3);
    for (let i = 0; i < 26; i++) {
      const x = size / 2 + (rng() - 0.5) * size * 0.5;
      const y = size / 2 + (rng() - 0.5) * size * 0.5;
      const r = size * (0.15 + rng() * 0.22);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.22)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

export function cloudTexture(seed = 1) {
  return cached("cloud" + seed, () => {
    const w = 512;
    const h = 256;
    const c = canvas(w, h);
    const ctx = c.getContext("2d")!;
    const rng = makeRng(seed * 13 + 7);
    for (let i = 0; i < 40; i++) {
      const x = w * (0.2 + rng() * 0.6);
      const y = h * (0.35 + rng() * 0.4);
      const r = 30 + rng() * 90;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.28)");
      g.addColorStop(0.6, "rgba(255,255,255,0.12)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

export function glowTexture() {
  return cached("glow", () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.15, "rgba(255,255,255,0.5)");
    g.addColorStop(0.45, "rgba(255,255,255,0.12)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

export function butterflyWingTexture(color: string) {
  return cached("wing" + color, () => {
    const size = 128;
    const c = canvas(size);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(4, 64);
    ctx.bezierCurveTo(10, 0, 110, 0, 124, 40);
    ctx.bezierCurveTo(110, 60, 110, 70, 124, 90);
    ctx.bezierCurveTo(100, 128, 20, 120, 4, 64);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.arc(84, 40, 9, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}
