import type { SynthId } from "./catalog";

/* ------------------------------------------------------------------ */
/* Tiny DSP toolkit (sample-accurate offline rendering)                 */
/* ------------------------------------------------------------------ */

function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

type FilterType = "lp" | "hp" | "bp";

/** RBJ biquad with cheap coefficient updates for sweeps. */
class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;
  constructor(
    private sr: number,
    private type: FilterType,
    f: number,
    private q: number,
  ) {
    this.set(f, q);
  }
  set(f: number, q = this.q) {
    this.q = q;
    const w0 = (2 * Math.PI * Math.min(Math.max(f, 20), this.sr * 0.45)) / this.sr;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const alpha = sw / (2 * Math.max(0.05, q));
    let b0: number, b1: number, b2: number;
    if (this.type === "lp") {
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = (1 - cw) / 2;
    } else if (this.type === "hp") {
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = (1 + cw) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cw) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  run(x: number) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

class Ctx {
  out: Float32Array;
  n: number;
  rnd: () => number;
  constructor(
    public sr: number,
    dur: number,
    seed: number,
  ) {
    this.n = Math.ceil(dur * sr);
    this.out = new Float32Array(this.n);
    this.rnd = rng(seed);
  }
  noise() {
    return this.rnd() * 2 - 1;
  }
}

const TAU = Math.PI * 2;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const expDecay = (t: number, tau: number) => Math.exp(-t / tau);
/** attack/release envelope in seconds */
const ar = (t: number, dur: number, a: number, r: number) => clamp01(t / a) * clamp01((dur - t) / r);
const soft = (x: number, drive = 1) => Math.tanh(x * drive) / Math.tanh(drive);
/** band-limited-ish saw via first `h` harmonics */
function saw(phase: number, h = 8) {
  let s = 0;
  for (let k = 1; k <= h; k++) s += Math.sin(phase * k) / k;
  return s * 0.6;
}
function sq(phase: number, h = 7) {
  let s = 0;
  for (let k = 1; k <= h; k += 2) s += Math.sin(phase * k) / k;
  return s * 0.8;
}

interface Partial {
  ratio: number;
  amp: number;
  tau: number;
}

/** Sum of exponentially decaying sines (bells, clangs). */
function addPartials(c: Ctx, f0: number, parts: Partial[], amp: number, t0 = 0, detune = 0) {
  const start = Math.floor(t0 * c.sr);
  for (const p of parts) {
    const f = f0 * p.ratio * (1 + (c.rnd() - 0.5) * detune);
    const w = (TAU * f) / c.sr;
    let ph = c.rnd() * TAU;
    for (let i = start; i < c.n; i++) {
      const t = (i - start) / c.sr;
      c.out[i] += Math.sin(ph) * p.amp * amp * expDecay(t, p.tau);
      ph += w;
    }
  }
}

/** Filtered noise with a per-sample callback deciding gain and (optionally) centre frequency. */
function addNoise(c: Ctx, type: FilterType, q: number, t0: number, dur: number, fn: (t: number, u: number) => [gain: number, freq: number]) {
  const f = new Biquad(c.sr, type, 1000, q);
  const start = Math.floor(t0 * c.sr);
  const end = Math.min(c.n, start + Math.ceil(dur * c.sr));
  for (let i = start; i < end; i++) {
    const t = (i - start) / c.sr;
    const [g, fr] = fn(t, t / dur);
    if ((i & 15) === 0) f.set(fr);
    c.out[i] += f.run(c.noise()) * g;
  }
}

/** Tonal voice: harmonic oscillator through up to two formant band-passes. */
function addVoice(
  c: Ctx,
  t0: number,
  dur: number,
  freqFn: (t: number, u: number) => number,
  ampFn: (t: number, u: number) => number,
  opts: { formants?: [number, number][]; timbre?: "saw" | "sq" | "sine" | "pulse"; drive?: number; breath?: number; pulseRateFn?: (t: number) => number },
) {
  const start = Math.floor(t0 * c.sr);
  const end = Math.min(c.n, start + Math.ceil(dur * c.sr));
  const forms = (opts.formants ?? []).map(([f, q]) => new Biquad(c.sr, "bp", f, q));
  let ph = 0;
  let pulsePh = 0;
  for (let i = start; i < end; i++) {
    const t = (i - start) / c.sr;
    const u = t / dur;
    const f = freqFn(t, u);
    ph += (TAU * f) / c.sr;
    let s: number;
    if (opts.timbre === "pulse") {
      // glottal-style pulse train (frog / burp)
      const rate = opts.pulseRateFn ? opts.pulseRateFn(t) : f;
      pulsePh += rate / c.sr;
      if (pulsePh >= 1) {
        pulsePh -= 1;
        s = 1;
      } else s = Math.exp(-pulsePh * 18) * 0.6;
    } else if (opts.timbre === "sq") s = sq(ph);
    else if (opts.timbre === "sine") s = Math.sin(ph);
    else s = saw(ph);
    if (opts.breath) s += c.noise() * opts.breath;
    if (forms.length) {
      let m = 0;
      for (const fm of forms) m += fm.run(s);
      s = s * 0.35 + m * 0.65;
    }
    if (opts.drive) s = soft(s, opts.drive);
    c.out[i] += s * ampFn(t, u);
  }
}

function thump(c: Ctx, t0: number, f1: number, f2: number, tau: number, amp: number, drive = 1) {
  const start = Math.floor(t0 * c.sr);
  let ph = 0;
  for (let i = start; i < c.n; i++) {
    const t = (i - start) / c.sr;
    const f = f2 + (f1 - f2) * Math.exp(-t / 0.045);
    ph += (TAU * f) / c.sr;
    const e = expDecay(t, tau);
    if (e < 0.001) break;
    c.out[i] += soft(Math.sin(ph) * e, drive) * amp;
  }
}

function normalize(buf: Float32Array, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 1e-6) {
    const g = peak / m;
    for (let i = 0; i < buf.length; i++) buf[i] *= g;
  }
  return buf;
}

/** Cross-fade the tail into the head so the buffer loops seamlessly. */
function makeLoop(buf: Float32Array, fadeSec: number, sr: number) {
  const n = buf.length;
  const f = Math.min(Math.floor(fadeSec * sr), Math.floor(n / 3));
  const out = new Float32Array(n - f);
  for (let i = 0; i < n - f; i++) {
    if (i < f) {
      const k = i / f;
      out[i] = buf[i] * k + buf[n - f + i] * (1 - k);
    } else out[i] = buf[i];
  }
  return out;
}

const CLANG: Partial[] = [
  { ratio: 1, amp: 1, tau: 0.35 },
  { ratio: 1.62, amp: 0.7, tau: 0.28 },
  { ratio: 2.31, amp: 0.55, tau: 0.2 },
  { ratio: 3.05, amp: 0.4, tau: 0.16 },
  { ratio: 4.2, amp: 0.3, tau: 0.12 },
  { ratio: 5.8, amp: 0.2, tau: 0.09 },
];
const BELL: Partial[] = [
  { ratio: 1, amp: 1, tau: 1.6 },
  { ratio: 2.0, amp: 0.6, tau: 1.2 },
  { ratio: 2.4, amp: 0.5, tau: 1.0 },
  { ratio: 3.0, amp: 0.35, tau: 0.8 },
  { ratio: 4.5, amp: 0.25, tau: 0.5 },
  { ratio: 5.33, amp: 0.15, tau: 0.35 },
];

const NOTE = (semi: number, base = 261.63) => base * Math.pow(2, semi / 12);
function fanfare(c: Ctx, notes: [semi: number, start: number, len: number][], lowpass = 3200) {
  const lp = new Biquad(c.sr, "lp", lowpass, 0.7);
  const tmp = new Float32Array(c.n);
  for (const [semi, s, l] of notes) {
    const f = NOTE(semi);
    const start = Math.floor(s * c.sr);
    const end = Math.min(c.n, Math.floor((s + l) * c.sr));
    let ph = 0;
    let ph2 = 0;
    for (let i = start; i < end; i++) {
      const t = (i - start) / c.sr;
      const vib = 1 + 0.004 * Math.sin(TAU * 5.5 * t);
      ph += (TAU * f * vib) / c.sr;
      ph2 += (TAU * f * 0.5) / c.sr;
      const e = ar(t, l, 0.02, Math.min(0.15, l * 0.5));
      tmp[i] += (saw(ph, 10) * 0.7 + sq(ph2, 5) * 0.3) * e;
    }
  }
  for (let i = 0; i < c.n; i++) c.out[i] += soft(lp.run(tmp[i]), 1.4) * 0.5;
}

/* ------------------------------------------------------------------ */
/* Recipes                                                             */
/* ------------------------------------------------------------------ */

type Recipe = (sr: number, seed: number) => Float32Array;

const R: Record<SynthId, Recipe> = {
  "whoosh.soft": (sr, seed) => {
    const c = new Ctx(sr, 0.32, seed);
    addNoise(c, "bp", 1.1, 0, 0.32, (_t, u) => [Math.pow(Math.sin(u * Math.PI), 1.6) * 0.5, 2600 - 1700 * u]);
    return c.out;
  },
  "whoosh.hard": (sr, seed) => {
    const c = new Ctx(sr, 0.55, seed);
    addNoise(c, "bp", 0.9, 0, 0.55, (_t, u) => [Math.pow(Math.sin(u * Math.PI), 1.3) * 0.7, 1500 - 1150 * u]);
    addNoise(c, "lp", 0.7, 0.05, 0.4, (_t, u) => [Math.sin(u * Math.PI) * 0.25, 300]);
    return c.out;
  },
  "punch.soft": (sr, seed) => {
    const c = new Ctx(sr, 0.22, seed);
    thump(c, 0, 170, 52, 0.055, 0.8, 1.6);
    addNoise(c, "bp", 0.8, 0, 0.05, (t) => [expDecay(t, 0.012) * 0.7, 1600]);
    return c.out;
  },
  "punch.hard": (sr, seed) => {
    const c = new Ctx(sr, 0.4, seed);
    thump(c, 0, 140, 40, 0.1, 1, 2.6);
    thump(c, 0.004, 60, 30, 0.16, 0.5, 1.2);
    addNoise(c, "bp", 0.7, 0, 0.08, (t) => [expDecay(t, 0.02) * 0.9, 1200]);
    addNoise(c, "lp", 0.7, 0, 0.2, (t) => [expDecay(t, 0.06) * 0.5, 500]);
    return c.out;
  },
  "clang.soft": (sr, seed) => {
    const c = new Ctx(sr, 0.5, seed);
    addPartials(c, 640, CLANG, 0.5, 0, 0.01);
    addNoise(c, "bp", 1, 0, 0.03, (t) => [expDecay(t, 0.008) * 0.8, 3200]);
    for (let i = 0; i < c.n; i++) c.out[i] = soft(c.out[i], 1.3);
    return c.out;
  },
  "clang.hard": (sr, seed) => {
    const c = new Ctx(sr, 0.9, seed);
    addPartials(c, 390, CLANG.map((p) => ({ ...p, tau: p.tau * 1.8 })), 0.7, 0, 0.012);
    thump(c, 0, 120, 45, 0.08, 0.6, 1.5);
    addNoise(c, "bp", 0.9, 0, 0.05, (t) => [expDecay(t, 0.012) * 1, 2600]);
    for (let i = 0; i < c.n; i++) c.out[i] = soft(c.out[i], 1.6);
    return c.out;
  },
  "knock.soft": (sr, seed) => {
    const c = new Ctx(sr, 0.2, seed);
    addNoise(c, "bp", 4, 0, 0.18, (t) => [expDecay(t, 0.04) * 0.8, 260]);
    thump(c, 0, 95, 60, 0.05, 0.5);
    return c.out;
  },
  "knock.hard": (sr, seed) => {
    const c = new Ctx(sr, 0.4, seed);
    addNoise(c, "bp", 3.5, 0, 0.25, (t) => [expDecay(t, 0.05) * 1, 190]);
    thump(c, 0, 110, 45, 0.09, 0.8, 1.8);
    addNoise(c, "bp", 3.5, 0.07, 0.2, (t) => [expDecay(t, 0.04) * 0.6, 220]);
    thump(c, 0.07, 90, 40, 0.07, 0.5, 1.5);
    return c.out;
  },
  "thud.soft": (sr, seed) => {
    const c = new Ctx(sr, 0.32, seed);
    thump(c, 0, 90, 32, 0.11, 0.8, 1.3);
    addNoise(c, "lp", 0.7, 0, 0.15, (t) => [expDecay(t, 0.05) * 0.5, 400]);
    return c.out;
  },
  "thud.hard": (sr, seed) => {
    const c = new Ctx(sr, 0.7, seed);
    thump(c, 0, 70, 26, 0.24, 1, 2.2);
    addNoise(c, "lp", 0.7, 0, 0.2, (t) => [expDecay(t, 0.06) * 0.6, 350]);
    addNoise(c, "lp", 0.7, 0, 0.6, (t) => [expDecay(t, 0.25) * 0.35, 110]);
    return c.out;
  },
  "slap.soft": (sr, seed) => {
    const c = new Ctx(sr, 0.15, seed);
    addNoise(c, "bp", 1, 0, 0.12, (t) => [expDecay(t, 0.025) * 0.9, 1300]);
    thump(c, 0, 300, 140, 0.03, 0.4);
    return c.out;
  },
  "slap.hard": (sr, seed) => {
    const c = new Ctx(sr, 0.28, seed);
    addNoise(c, "bp", 0.9, 0, 0.18, (t) => [expDecay(t, 0.035) * 1, 1000]);
    thump(c, 0, 180, 60, 0.07, 0.7, 1.6);
    return c.out;
  },
  "squelch.soft": (sr, seed) => {
    const c = new Ctx(sr, 0.3, seed);
    let f = 900;
    addNoise(c, "bp", 6, 0, 0.28, (t) => {
      f += (c.rnd() - 0.5) * 140;
      f = Math.max(350, Math.min(1400, f));
      return [expDecay(t, 0.08) * (0.7 + 0.3 * Math.sin(t * 90)), f];
    });
    thump(c, 0, 140, 70, 0.05, 0.35);
    return c.out;
  },
  "squelch.hard": (sr, seed) => {
    const c = new Ctx(sr, 0.5, seed);
    let f = 700;
    addNoise(c, "bp", 5, 0, 0.45, (t) => {
      f += (c.rnd() - 0.5) * 160;
      f = Math.max(250, Math.min(1300, f));
      return [expDecay(t, 0.13) * (0.7 + 0.3 * Math.sin(t * 60)), f];
    });
    thump(c, 0, 120, 45, 0.1, 0.7, 1.6);
    return c.out;
  },
  "voice.chicken.soft": (sr, seed) => {
    const c = new Ctx(sr, 0.42, seed);
    for (let k = 0; k < 4; k++) {
      const t0 = k * 0.095;
      addVoice(c, t0, 0.05, (_t, u) => 1100 - 350 * u, (t) => ar(t, 0.05, 0.004, 0.02) * 0.6, { timbre: "sq", formants: [[1500, 3]], breath: 0.25 });
    }
    return c.out;
  },
  "voice.chicken.hard": (sr, seed) => {
    const c = new Ctx(sr, 0.95, seed);
    addVoice(
      c,
      0,
      0.9,
      (t, u) => {
        const base = u < 0.3 ? 650 + (1250 - 650) * (u / 0.3) : u < 0.75 ? 1250 : 1250 - 420 * ((u - 0.75) / 0.25);
        return base * (1 + 0.025 * Math.sin(TAU * 6.5 * t));
      },
      (t) => ar(t, 0.9, 0.05, 0.22) * 0.55,
      { timbre: "saw", formants: [[1800, 2.5], [900, 2]], breath: 0.12, drive: 1.4 },
    );
    return c.out;
  },
  "voice.buffalo.soft": (sr, seed) => {
    const c = new Ctx(sr, 0.32, seed);
    addNoise(c, "lp", 0.8, 0, 0.3, (t) => [ar(t, 0.3, 0.01, 0.2) * 0.8, 900]);
    addVoice(c, 0.02, 0.16, () => 105, (t) => ar(t, 0.16, 0.02, 0.08) * 0.5, { timbre: "saw", formants: [[420, 3]], drive: 1.8 });
    return c.out;
  },
  "voice.buffalo.hard": (sr, seed) => {
    const c = new Ctx(sr, 0.85, seed);
    addVoice(
      c,
      0,
      0.82,
      (t, u) => (98 - 30 * u) * (1 + 0.02 * Math.sin(TAU * 5 * t)),
      (t) => ar(t, 0.82, 0.08, 0.3) * 0.7,
      { timbre: "saw", formants: [[450, 3], [1100, 2.5]], breath: 0.06, drive: 2 },
    );
    return c.out;
  },
  "voice.ewe.soft": (sr, seed) => {
    const c = new Ctx(sr, 0.36, seed);
    addVoice(c, 0, 0.34, (_t, u) => 250 - 30 * u, (t) => ar(t, 0.34, 0.02, 0.1) * (0.4 + 0.6 * Math.abs(Math.sin(TAU * 7 * t))) * 0.55, {
      timbre: "saw",
      formants: [[800, 4], [1600, 3]],
      breath: 0.05,
      drive: 1.3,
    });
    return c.out;
  },
  "voice.ewe.hard": (sr, seed) => {
    const c = new Ctx(sr, 0.72, seed);
    addVoice(
      c,
      0,
      0.7,
      (_t, u) => (u < 0.4 ? 210 + 60 * (u / 0.4) : 270 - 80 * ((u - 0.4) / 0.6)),
      (t) => ar(t, 0.7, 0.03, 0.15) * (0.35 + 0.65 * Math.abs(Math.sin(TAU * 6 * t))) * 0.65,
      { timbre: "saw", formants: [[750, 4], [1700, 3]], breath: 0.06, drive: 1.5 },
    );
    return c.out;
  },
  "voice.toad.soft": (sr, seed) => {
    const c = new Ctx(sr, 0.32, seed);
    addVoice(c, 0, 0.3, () => 36, (t) => ar(t, 0.3, 0.02, 0.1) * 0.9, { timbre: "pulse", pulseRateFn: () => 38, formants: [[190, 5], [520, 3]], drive: 1.6 });
    return c.out;
  },
  "voice.toad.hard": (sr, seed) => {
    const c = new Ctx(sr, 0.7, seed);
    addVoice(c, 0, 0.55, () => 30, (t) => ar(t, 0.55, 0.03, 0.15) * 1, { timbre: "pulse", pulseRateFn: (t) => 26 + 16 * (t / 0.55), formants: [[150, 5], [480, 3]], drive: 2 });
    addVoice(c, 0.52, 0.16, (_t, u) => 320 + 300 * u, (t) => ar(t, 0.16, 0.01, 0.06) * 0.35, { timbre: "sine" });
    return c.out;
  },
  "special.laser": (sr, seed) => {
    const c = new Ctx(sr, 0.65, seed);
    addVoice(c, 0, 0.6, (_t, u) => 2200 * Math.pow(180 / 2200, u), (t, u) => ar(t, 0.6, 0.005, 0.2) * (0.6 + 0.4 * Math.sin(TAU * 60 * t)) * (1 - u * 0.3) * 0.7, { timbre: "sq" });
    addNoise(c, "bp", 2, 0, 0.5, (t) => [expDecay(t, 0.12) * 0.35, 6000]);
    return c.out;
  },
  "special.stampede": (sr, seed) => {
    const c = new Ctx(sr, 1.3, seed);
    addNoise(c, "lp", 0.7, 0, 1.3, (t, u) => [Math.pow(Math.sin(u * Math.PI), 0.7) * 0.7, 90 + 40 * Math.sin(t * 9)]);
    for (let k = 0; k < 9; k++) thump(c, 0.1 + k * 0.125, 75, 38, 0.09, 0.6 * (0.7 + 0.3 * Math.sin(k)), 1.6);
    return c.out;
  },
  "special.missiles": (sr, seed) => {
    const c = new Ctx(sr, 0.95, seed);
    for (let k = 0; k < 4; k++) {
      const t0 = k * 0.09;
      addNoise(c, "bp", 1.2, t0, 0.45, (t, u) => [ar(t, 0.45, 0.02, 0.25) * 0.55, 700 + 2200 * u]);
      thump(c, t0, 130, 60, 0.06, 0.35, 1.2);
    }
    addNoise(c, "hp", 0.7, 0.3, 0.6, (t) => [expDecay(t, 0.25) * 0.15, 3000]);
    return c.out;
  },
  "special.belch": (sr, seed) => {
    const c = new Ctx(sr, 0.75, seed);
    let jit = 0;
    addVoice(
      c,
      0,
      0.7,
      (t, u) => {
        if (Math.floor(t * 25) !== jit) {
          jit = Math.floor(t * 25);
        }
        return (72 - 20 * u) * (1 + 0.08 * Math.sin(TAU * 25 * t + Math.sin(t * 40)));
      },
      (t) => ar(t, 0.7, 0.05, 0.25) * 0.85,
      { timbre: "saw", formants: [[300, 2], [700, 2.5]], breath: 0.15, drive: 2.2 },
    );
    return c.out;
  },
  "ui.click": (sr, seed) => {
    const c = new Ctx(sr, 0.07, seed);
    addVoice(c, 0, 0.06, () => 1800, (t) => expDecay(t, 0.012) * 0.5, { timbre: "sine" });
    addNoise(c, "hp", 0.7, 0, 0.01, (t) => [expDecay(t, 0.003) * 0.5, 2500]);
    return c.out;
  },
  "ui.hover": (sr, seed) => {
    const c = new Ctx(sr, 0.05, seed);
    addVoice(c, 0, 0.045, () => 2400, (t) => expDecay(t, 0.008) * 0.3, { timbre: "sine" });
    return c.out;
  },
  "ui.back": (sr, seed) => {
    const c = new Ctx(sr, 0.16, seed);
    addVoice(c, 0, 0.05, () => 900, (t) => ar(t, 0.05, 0.003, 0.02) * 0.4, { timbre: "sq" });
    addVoice(c, 0.07, 0.07, () => 600, (t) => ar(t, 0.07, 0.003, 0.03) * 0.4, { timbre: "sq" });
    return c.out;
  },
  "ui.select": (sr, seed) => {
    const c = new Ctx(sr, 0.22, seed);
    addVoice(c, 0, 0.07, () => 660, (t) => ar(t, 0.07, 0.003, 0.03) * 0.4, { timbre: "sine" });
    addVoice(c, 0.07, 0.14, () => 990, (t) => ar(t, 0.14, 0.003, 0.08) * 0.45, { timbre: "sine" });
    addVoice(c, 0.07, 0.14, () => 1980, (t) => ar(t, 0.14, 0.003, 0.08) * 0.12, { timbre: "sine" });
    return c.out;
  },
  "ui.transition": (sr, seed) => {
    const c = new Ctx(sr, 0.45, seed);
    addNoise(c, "bp", 1.3, 0, 0.45, (_t, u) => [Math.pow(Math.sin(u * Math.PI), 1.2) * 0.55, u < 0.5 ? 400 + 3600 * (u / 0.5) : 4000 - 3000 * ((u - 0.5) / 0.5)]);
    return c.out;
  },
  "ui.start": (sr, seed) => {
    const c = new Ctx(sr, 0.9, seed);
    thump(c, 0, 150, 34, 0.22, 1, 2.6);
    addPartials(c, 260, CLANG.map((p) => ({ ...p, tau: p.tau * 1.5 })), 0.35, 0, 0.01);
    addNoise(c, "lp", 0.7, 0, 0.5, (t) => [expDecay(t, 0.12) * 0.6, 600]);
    addNoise(c, "lp", 0.7, 0, 0.85, (t) => [expDecay(t, 0.3) * 0.3, 120]);
    for (let i = 0; i < c.n; i++) c.out[i] = soft(c.out[i], 1.8);
    return c.out;
  },
  bell: (sr, seed) => {
    const c = new Ctx(sr, 1.8, seed);
    addPartials(c, 520, BELL, 0.6, 0, 0.004);
    addPartials(c, 520, BELL, 0.5, 0.32, 0.004);
    return c.out;
  },
  gong: (sr, seed) => {
    const c = new Ctx(sr, 2.6, seed);
    addPartials(
      c,
      132,
      [
        { ratio: 1, amp: 1, tau: 2.2 },
        { ratio: 1.48, amp: 0.7, tau: 1.8 },
        { ratio: 2.1, amp: 0.55, tau: 1.5 },
        { ratio: 2.9, amp: 0.4, tau: 1.1 },
        { ratio: 3.8, amp: 0.3, tau: 0.8 },
        { ratio: 5.1, amp: 0.2, tau: 0.5 },
      ],
      0.75,
      0,
      0.01,
    );
    addNoise(c, "bp", 1.5, 0, 0.35, (t) => [expDecay(t, 0.08) * 0.5, 2400]);
    for (let i = 0; i < c.n; i++) c.out[i] = soft(c.out[i], 1.6) * clamp01((i / c.sr) / 0.04);
    return c.out;
  },
  "fanfare.short": (sr, seed) => {
    const c = new Ctx(sr, 1.3, seed);
    fanfare(c, [
      [0, 0, 0.16],
      [4, 0.17, 0.16],
      [7, 0.34, 0.16],
      [12, 0.51, 0.7],
      [7, 0.51, 0.7],
    ]);
    return c.out;
  },
  "fanfare.long": (sr, seed) => {
    const c = new Ctx(sr, 2.8, seed);
    fanfare(c, [
      [0, 0, 0.14],
      [4, 0.15, 0.14],
      [7, 0.3, 0.14],
      [12, 0.45, 0.3],
      [11, 0.8, 0.14],
      [7, 0.95, 0.14],
      [2, 1.1, 0.14],
      [7, 1.25, 0.3],
      [12, 1.6, 1.1],
      [7, 1.6, 1.1],
      [4, 1.6, 1.1],
      [-12, 1.6, 1.1],
    ]);
    return c.out;
  },
  tick: (sr, seed) => {
    const c = new Ctx(sr, 0.06, seed);
    addNoise(c, "bp", 2, 0, 0.03, (t) => [expDecay(t, 0.006) * 0.8, 3000]);
    addVoice(c, 0, 0.05, () => 1200, (t) => expDecay(t, 0.01) * 0.4, { timbre: "sine" });
    return c.out;
  },
  "crowd.cheer": (sr, seed) => {
    const c = new Ctx(sr, 2.6, seed);
    for (const [f, lfo] of [
      [520, 5.3],
      [880, 7.1],
      [1400, 6.2],
      [2200, 4.4],
    ]) addNoise(c, "bp", 2.5, 0, 2.6, (t) => [ar(t, 2.6, 0.35, 0.9) * (0.35 + 0.25 * Math.sin(TAU * lfo * t + f)) * 0.4, f * (1 + 0.05 * Math.sin(t * 3))]);
    return c.out;
  },
  "crowd.gasp": (sr, seed) => {
    const c = new Ctx(sr, 0.85, seed);
    addNoise(c, "bp", 2, 0, 0.8, (t, u) => [ar(t, 0.8, 0.3, 0.3) * 0.6, 600 + 1400 * u]);
    return c.out;
  },
  "ko.impact": (sr, seed) => {
    const c = new Ctx(sr, 1.1, seed);
    thump(c, 0, 150, 30, 0.3, 1, 3);
    thump(c, 0.01, 55, 26, 0.5, 0.6, 1.5);
    addPartials(c, 300, CLANG.map((p) => ({ ...p, tau: p.tau * 1.6 })), 0.4, 0, 0.01);
    addNoise(c, "bp", 0.8, 0, 0.1, (t) => [expDecay(t, 0.03) * 1, 1000]);
    addNoise(c, "lp", 0.7, 0, 0.9, (t) => [expDecay(t, 0.3) * 0.4, 200]);
    for (let i = 0; i < c.n; i++) c.out[i] = soft(c.out[i], 2);
    return c.out;
  },
  "ko.slowmo": (sr, seed) => {
    const c = new Ctx(sr, 1.7, seed);
    addNoise(c, "bp", 1.4, 0, 1.7, (_t, u) => [Math.pow(Math.sin(u * Math.PI), 0.8) * 0.55, 3000 * Math.pow(120 / 3000, u)]);
    addVoice(c, 0, 1.5, (_t, u) => 420 * Math.pow(55 / 420, u), (t) => ar(t, 1.5, 0.2, 0.6) * 0.3, { timbre: "sine" });
    return c.out;
  },
  "ambient.wasteland": (sr, seed) => {
    const c = new Ctx(sr, 7, seed);
    addNoise(c, "lp", 0.7, 0, 7, (t) => [0.5 + 0.2 * Math.sin(TAU * 0.13 * t) + 0.1 * Math.sin(TAU * 0.31 * t), 260 + 120 * Math.sin(TAU * 0.11 * t)]);
    addNoise(c, "bp", 1.2, 0, 7, (t) => [Math.max(0, Math.sin(TAU * 0.09 * t + 1)) * 0.22, 900 + 300 * Math.sin(TAU * 0.2 * t)]);
    return makeLoop(normalize(c.out, 0.6), 0.6, sr);
  },
  "ambient.foundry": (sr, seed) => {
    const c = new Ctx(sr, 7, seed);
    addVoice(c, 0, 7, () => 50, () => 0.18, { timbre: "sine" });
    addVoice(c, 0, 7, () => 100, (t) => 0.08 + 0.03 * Math.sin(TAU * 0.5 * t), { timbre: "sine" });
    addNoise(c, "lp", 0.7, 0, 7, (t) => [0.25 + 0.05 * Math.sin(TAU * 0.3 * t), 220]);
    for (let k = 0; k < 6; k++) addPartials(c, 900 + c.rnd() * 900, CLANG.map((p) => ({ ...p, tau: p.tau * 0.5 })), 0.06 + c.rnd() * 0.05, 0.4 + c.rnd() * 5.8, 0.01);
    for (let k = 0; k < 2; k++) addNoise(c, "hp", 0.7, 1 + k * 3.2 + c.rnd(), 1.1, (t) => [ar(t, 1.1, 0.3, 0.6) * 0.12, 3500]);
    return makeLoop(normalize(c.out, 0.6), 0.6, sr);
  },
  "ambient.meadow": (sr, seed) => {
    const c = new Ctx(sr, 7, seed);
    addNoise(c, "hp", 0.7, 0, 7, (t) => [0.05 + 0.03 * Math.sin(TAU * 0.17 * t), 2500]);
    // birds: clusters of short chirps
    for (let k = 0; k < 5; k++) {
      const t0 = c.rnd() * 6;
      const n = 2 + Math.floor(c.rnd() * 4);
      const base = 2400 + c.rnd() * 1600;
      for (let j = 0; j < n; j++) {
        const dir = c.rnd() > 0.5 ? 1 : -1;
        addVoice(c, t0 + j * (0.07 + c.rnd() * 0.05), 0.06, (_t, u) => base * (1 + dir * 0.25 * u), (t) => ar(t, 0.06, 0.01, 0.03) * 0.09, { timbre: "sine" });
      }
    }
    // crickets
    for (let k = 0; k < 40; k++) addVoice(c, c.rnd() * 6.9, 0.02, () => 4600, (t) => ar(t, 0.02, 0.003, 0.01) * 0.04, { timbre: "sine" });
    return makeLoop(normalize(c.out, 0.5), 0.6, sr);
  },
  "ambient.kyoto": (sr, seed) => R["ambient.meadow"](sr, seed),
  // music slots are handled by the realtime sequencer; these short jingles are only used by "test"
  "music.menu": (sr, seed) => R["fanfare.short"](sr, seed),
  "music.wasteland": (sr, seed) => R["fanfare.short"](sr, seed),
  "music.foundry": (sr, seed) => R["fanfare.short"](sr, seed),
  "music.meadow": (sr, seed) => R["fanfare.short"](sr, seed),
  "music.kyoto": (sr, seed) => R["fanfare.short"](sr, seed),
};

const cache = new Map<string, Float32Array>();

/** Render (and memoise) a procedural sound as a mono Float32Array at the given sample rate. */
export function renderSynth(id: SynthId, sr: number, variant = 0): Float32Array {
  const key = `${id}@${sr}#${variant}`;
  let b = cache.get(key);
  if (!b) {
    const raw = R[id](sr, 1234 + variant * 7919 + id.length * 31);
    b = id.startsWith("ambient.") ? raw : normalize(raw, 0.85);
    cache.set(key, b);
  }
  return b;
}

/* ------------------------------------------------------------------ */
/* Realtime procedural music                                            */
/* ------------------------------------------------------------------ */

export type MusicTheme = "menu" | "wasteland" | "foundry" | "meadow";

interface Theme {
  bpm: number;
  /** semitone offsets relative to root, per 16th step (null = rest) */
  bass: (number | null)[];
  lead: (number | null)[];
  root: number; // Hz
  bassType: OscillatorType;
  leadType: OscillatorType;
  kick: number[]; // step indices
  hat: number[];
  swing?: number;
  leadGain: number;
  bassGain: number;
  lp: number;
}

const THEMES: Record<MusicTheme, Theme> = {
  menu: {
    bpm: 124,
    root: 110,
    bassType: "sawtooth",
    leadType: "square",
    bass: [0, null, 0, 0, null, 0, null, 0, 3, null, 3, 3, null, 5, null, 5, 0, null, 0, 0, null, 0, null, 0, -2, null, -2, -2, null, -4, null, -4],
    lead: [12, 15, 19, 24, 19, 15, 12, 15, 15, 19, 22, 27, 22, 19, 15, 19, 12, 15, 19, 24, 19, 15, 12, 15, 10, 14, 17, 22, 17, 14, 10, 14],
    kick: [0, 4, 8, 12, 16, 20, 24, 28],
    hat: [2, 6, 10, 14, 18, 22, 26, 30],
    leadGain: 0.16,
    bassGain: 0.28,
    lp: 2200,
  },
  wasteland: {
    bpm: 92,
    root: 82.41,
    bassType: "triangle",
    leadType: "square",
    bass: [0, null, null, 0, null, null, 3, null, 0, null, null, 0, null, 5, null, 3, 0, null, null, 0, null, null, 3, null, -2, null, null, -2, null, -4, null, -2],
    lead: [12, null, null, 15, null, 17, null, 15, 12, null, null, 10, null, null, null, null, 12, null, null, 15, null, 19, null, 17, 15, null, null, 12, null, null, null, null],
    kick: [0, 10, 16, 26],
    hat: [4, 12, 20, 28],
    swing: 0.12,
    leadGain: 0.14,
    bassGain: 0.3,
    lp: 1600,
  },
  foundry: {
    bpm: 140,
    root: 55,
    bassType: "sawtooth",
    leadType: "sawtooth",
    bass: [0, 0, null, 0, 0, null, 1, null, 0, 0, null, 0, 0, null, -1, null, 0, 0, null, 0, 0, null, 6, null, 0, 0, null, 0, 0, null, 1, 0],
    lead: [null, null, 12, null, null, null, 13, null, null, null, 12, null, null, 18, null, 13, null, null, 12, null, null, null, 13, null, null, null, 15, null, 13, null, 12, null],
    kick: [0, 3, 8, 11, 16, 19, 24, 27, 30],
    hat: [2, 6, 10, 14, 18, 22, 26, 30],
    leadGain: 0.12,
    bassGain: 0.34,
    lp: 1400,
  },
  meadow: {
    bpm: 104,
    root: 130.81,
    bassType: "triangle",
    leadType: "triangle",
    bass: [0, null, 7, null, 0, null, 7, null, 5, null, 12, null, 5, null, 12, null, 9, null, 16, null, 9, null, 16, null, 7, null, 14, null, 7, null, 14, null],
    lead: [12, 14, 16, 19, null, 16, 14, 12, 9, null, 12, null, 14, null, null, null, 16, 19, 21, 24, null, 21, 19, 16, 14, null, 12, null, 16, null, null, null],
    kick: [0, 8, 16, 24],
    hat: [4, 12, 20, 28],
    swing: 0.08,
    leadGain: 0.15,
    bassGain: 0.22,
    lp: 2800,
  },
};

/** Lookahead scheduler playing a chip-style loop into `dest`. */
export class ProceduralMusic {
  private timer: number | null = null;
  private nextStep = 0;
  private nextTime = 0;
  private theme: Theme;
  private out: GainNode;
  private filter: BiquadFilterNode;
  private noiseBuf: AudioBuffer;
  private rate = 1;

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    theme: MusicTheme,
  ) {
    this.theme = THEMES[theme];
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = this.theme.lp;
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.filter.connect(this.out).connect(dest);
    const n = Math.floor(ctx.sampleRate * 0.2);
    this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  setRate(r: number) {
    this.rate = r;
  }

  start() {
    if (this.timer !== null) return;
    this.nextStep = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  stop(fade = 0.4) {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const t = this.ctx.currentTime;
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => this.out.disconnect(), fade * 1000 + 50);
  }

  private tick() {
    const th = this.theme;
    const stepDur = 60 / th.bpm / 4 / this.rate;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      const s = this.nextStep % 32;
      const swing = th.swing && s % 2 === 1 ? stepDur * th.swing : 0;
      const t = this.nextTime + swing;
      const b = th.bass[s];
      if (b !== null) this.note(th.root * Math.pow(2, b / 12), t, stepDur * 0.9, th.bassType, th.bassGain, 0.01, 0.08);
      const l = th.lead[s];
      if (l !== null) this.note(th.root * Math.pow(2, l / 12), t, stepDur * 1.6, th.leadType, th.leadGain, 0.005, 0.12);
      if (th.kick.includes(s)) this.kick(t);
      if (th.hat.includes(s)) this.hat(t, s % 8 === 6 ? 0.09 : 0.05);
      this.nextTime += stepDur;
      this.nextStep++;
    }
  }

  private note(freq: number, t: number, dur: number, type: OscillatorType, gain: number, a: number, r: number) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + a);
    g.gain.setValueAtTime(gain, t + Math.max(a, dur - r));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.filter);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private kick(t: number) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.25);
  }

  private hat(t: number, gain: number) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 6000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    s.connect(f).connect(g).connect(this.out);
    s.start(t);
    s.stop(t + 0.06);
  }
}
