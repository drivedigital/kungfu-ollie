import { CATALOG, SLOT_BY_ID, SoundSlot, CORE_SLOT_IDS, slotsForArena, slotsForFighter } from "./catalog";
import { DEFAULTS } from "./defaults";
import { MusicTheme, ProceduralMusic, renderSynth } from "./synth";
import type { CharId } from "../moves";
import type { ArenaId } from "../arenas/common";

/**
 * AudioEngine — single mixer for the whole game.
 *
 *   buffer voices ─┐
 *   synth voices  ─┼─► sfxGain ───┐
 *   ambient       ─┘              ├─► masterGain ─► compressor ─► destination
 *   music (buffer / media source) ─► musicGain ─► duck ┘
 *
 * Every slot resolves to one of three source tiers, tried in order:
 *   1. "buffer"  — fetch() + decodeAudioData → AudioBufferSourceNode (needs a CORS-enabled host)
 *   2. "stream"  — HTMLAudioElement (works for hosts without CORS such as cdn.pixabay.com). If the host
 *                  is CORS-capable the element is bridged into the graph with createMediaElementSource;
 *                  otherwise it plays directly and its .volume mirrors the mixer (volume/mute still apply).
 *   3. "synth"   — procedurally rendered fallback (also used while a remote asset is still loading)
 */

export type SourceStatus = "idle" | "loading" | "buffer" | "stream" | "synth" | "error";

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  muteMusic: boolean;
  muteSfx: boolean;
  /** ignore all URLs and use the built-in synthesizer */
  preferSynth: boolean;
  /** per-slot URL overrides; "" forces the synth for that slot */
  urls: Record<string, string>;
}

export interface PlayOpts {
  gain?: number;
  rate?: number;
  /** random pitch variation, e.g. 0.06 = ±6 % */
  vary?: number;
  pan?: number;
  delay?: number;
}

interface Asset {
  id: string;
  url: string;
  status: SourceStatus;
  note?: string;
  buffer?: AudioBuffer;
  template?: HTMLAudioElement;
  pool: HTMLAudioElement[];
  corsOk?: boolean;
  blocked?: boolean;
  /** an element can be bridged into the graph only once — keep the node for restarts */
  mediaSrc?: MediaElementAudioSourceNode;
}

interface Playing {
  id: string;
  el?: HTMLAudioElement;
  src?: MediaElementAudioSourceNode;
  node?: AudioBufferSourceNode;
  gain?: GainNode;
  proc?: ProceduralMusic;
  slotGain: number;
  channel: "music" | "sfx";
}

const LS_KEY = "rcvf.audio.v1";
const DEFAULT_SETTINGS: AudioSettings = { master: 0.9, music: 0.7, sfx: 1, muteMusic: false, muteSfx: false, preferSynth: false, urls: {} };
/** hosts known to serve audio without CORS headers → go straight to the media-element tier */
const NO_CORS_HOSTS = new Set(["cdn.pixabay.com", "pixabay.com"]);
const MAX_VOICES = 28;
/** per-element play tokens so a re-triggered pooled element cancels the previous cut-fade */
let elementTokens = 0;
const elementToken = new WeakMap<HTMLAudioElement, number>();

type Listener = () => void;

export class AudioEngine {
  private static inst: AudioEngine | null = null;
  static get() {
    if (!AudioEngine.inst) AudioEngine.inst = new AudioEngine();
    return AudioEngine.inst;
  }

  settings: AudioSettings;
  private ctx: AudioContext | null = null;
  private masterGain!: GainNode;
  private musicGain!: GainNode;
  private sfxGain!: GainNode;
  private duckGain!: GainNode;
  private assets = new Map<string, Asset>();
  private synthBuffers = new Map<string, AudioBuffer>();
  private hostPolicy = new Map<string, "cors" | "nocors">();
  private listeners = new Set<Listener>();
  private lastPlay = new Map<string, number>();
  private voices = 0;
  private music: Playing | null = null;
  private ambient: Playing | null = null;
  private pendingMusic: string | null = null;
  private pendingAmbient: string | null = null;
  private duck = 1;
  private duckTimer: number | null = null;
  private musicRate = 1;
  private previewRestore: { music: string | null; ambient: string | null; timer: number } | null = null;
  version = 0;

  private constructor() {
    this.settings = { ...DEFAULT_SETTINGS, urls: {} };
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<AudioSettings>;
        this.settings = { ...DEFAULT_SETTINGS, ...s, urls: { ...(s.urls ?? {}) } };
      }
    } catch {
      /* ignore */
    }
    for (const h of NO_CORS_HOSTS) this.hostPolicy.set(h, "nocors");
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (!this.ctx) return;
        if (document.hidden) {
          void this.ctx.suspend();
          this.music?.el?.pause();
          this.ambient?.el?.pause();
        } else {
          void this.ctx.resume();
          void this.music?.el?.play().catch(() => {});
          void this.ambient?.el?.play().catch(() => {});
        }
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Context & mixer                                                      */
  /* ------------------------------------------------------------------ */

  get ready() {
    return !!this.ctx && this.ctx.state === "running";
  }

  /** Must be called from a user gesture at least once (autoplay policy). Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const ctx = this.ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 20;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      comp.connect(ctx.destination);
      this.masterGain = ctx.createGain();
      this.masterGain.connect(comp);
      this.musicGain = ctx.createGain();
      this.duckGain = ctx.createGain();
      this.musicGain.connect(this.duckGain).connect(this.masterGain);
      this.sfxGain = ctx.createGain();
      this.sfxGain.connect(this.masterGain);
      this.applyMixer();
      this.preload(CORE_SLOT_IDS);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (this.pendingMusic) {
      const id = this.pendingMusic;
      this.pendingMusic = null;
      this.playMusic(id);
    }
    if (this.pendingAmbient) {
      const id = this.pendingAmbient;
      this.pendingAmbient = null;
      this.playAmbient(id);
    }
  }

  private applyMixer() {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(s.master, t, 0.02);
    this.musicGain.gain.setTargetAtTime(s.muteMusic ? 0 : s.music, t, 0.02);
    this.sfxGain.gain.setTargetAtTime(s.muteSfx ? 0 : s.sfx, t, 0.02);
    for (const p of [this.music, this.ambient]) if (p?.el && !p.src) p.el.volume = this.elementVolume(p.channel, p.slotGain);
  }

  /** Volume for media elements that could not be routed through the graph (mirrors the mixer). */
  private elementVolume(channel: "music" | "sfx", slotGain: number, extra = 1) {
    const s = this.settings;
    const ch = channel === "music" ? (s.muteMusic ? 0 : s.music * this.duck) : s.muteSfx ? 0 : s.sfx;
    return Math.max(0, Math.min(1, s.master * ch * slotGain * extra));
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                             */
  /* ------------------------------------------------------------------ */

  private save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore quota / privacy errors */
    }
    this.emit();
  }

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  setLevel(key: "master" | "music" | "sfx", v: number) {
    this.settings[key] = Math.max(0, Math.min(1, v));
    this.applyMixer();
    this.save();
  }

  setMute(channel: "music" | "sfx", muted: boolean) {
    if (channel === "music") this.settings.muteMusic = muted;
    else this.settings.muteSfx = muted;
    this.applyMixer();
    this.save();
  }

  setPreferSynth(v: boolean) {
    this.settings.preferSynth = v;
    this.invalidateAll();
    this.save();
  }

  /** Default URL for a slot (sourced from Pixabay, see defaults.ts). */
  defaultUrl(id: string) {
    return DEFAULTS[id]?.url ?? "";
  }

  /** Effective URL after overrides ("" = synth). */
  resolveUrl(id: string) {
    if (this.settings.preferSynth) return "";
    const o = this.settings.urls[id];
    return o !== undefined ? o.trim() : this.defaultUrl(id);
  }

  isOverridden(id: string) {
    return this.settings.urls[id] !== undefined;
  }

  setUrl(id: string, url: string) {
    if (url.trim() === this.defaultUrl(id)) delete this.settings.urls[id];
    else this.settings.urls[id] = url.trim();
    this.invalidate(id);
    if (this.ctx) this.ensure(id);
    this.save();
  }

  resetUrl(id: string) {
    delete this.settings.urls[id];
    this.invalidate(id);
    if (this.ctx) this.ensure(id);
    this.save();
  }

  resetAll() {
    this.settings = { ...DEFAULT_SETTINGS, urls: {} };
    this.invalidateAll();
    this.applyMixer();
    this.save();
  }

  private invalidate(id: string) {
    const a = this.assets.get(id);
    if (a) {
      a.pool.forEach((el) => {
        el.pause();
        el.src = "";
      });
      this.assets.delete(id);
    }
    if (this.music?.id === id) {
      this.stopPlaying(this.music, 0.2);
      this.music = null;
      this.playMusic(id);
    }
    if (this.ambient?.id === id) {
      this.stopPlaying(this.ambient, 0.2);
      this.ambient = null;
      this.playAmbient(id);
    }
  }

  private invalidateAll() {
    for (const id of [...this.assets.keys()]) this.invalidate(id);
    if (this.ctx) this.preload(CORE_SLOT_IDS);
  }

  status(id: string): { status: SourceStatus; note?: string; url: string } {
    const a = this.assets.get(id);
    return { status: a?.status ?? "idle", note: a?.note, url: this.resolveUrl(id) };
  }

  /* ------------------------------------------------------------------ */
  /* Loading                                                              */
  /* ------------------------------------------------------------------ */

  preload(ids: string[]) {
    if (!this.ctx) return;
    for (const id of ids) this.ensure(id);
  }

  preloadFor(chars: CharId[], arena?: ArenaId) {
    const ids = chars.flatMap((c) => slotsForFighter(c).map((s) => s.id));
    if (arena) ids.push(...slotsForArena(arena).map((s) => s.id));
    this.preload(ids);
  }

  private hostOf(url: string) {
    try {
      return new URL(url, location.href).host;
    } catch {
      return "";
    }
  }

  private ensure(id: string): Asset {
    let a = this.assets.get(id);
    if (a) return a;
    const slot = SLOT_BY_ID[id];
    const url = slot ? this.resolveUrl(id) : "";
    a = { id, url, status: "idle", pool: [] };
    this.assets.set(id, a);
    if (!slot) {
      a.status = "error";
      a.note = "Unknown sound id";
      return a;
    }
    if (!url) {
      a.status = "synth";
      a.note = this.settings.preferSynth ? "Built-in synth (preferred)" : "No URL — built-in synth";
      this.emit();
      return a;
    }
    a.status = "loading";
    if (slot.kind === "sfx") void this.loadSfx(a);
    else void this.loadLong(a, slot);
    this.emit();
    return a;
  }

  private policy(url: string) {
    return this.hostPolicy.get(this.hostOf(url));
  }

  private async loadSfx(a: Asset) {
    const url = a.url;
    if (this.policy(url) !== "nocors") {
      // Tier 1: CORS fetch + decode
      try {
        const res = await fetch(url, { mode: "cors" });
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { http: true });
        const data = await res.arrayBuffer();
        if (!this.ctx) return;
        a.buffer = await this.ctx.decodeAudioData(data.slice(0));
        this.hostPolicy.set(this.hostOf(url), "cors");
        a.status = "buffer";
        a.note = "Loaded into Web Audio (sample-accurate)";
        this.emit();
        return;
      } catch (e) {
        const err = e as Error & { http?: boolean };
        if (err.http || (err.name !== "TypeError" && !/fetch|network/i.test(err.message))) {
          a.status = "synth";
          a.note = `Could not load (${err.message}) — using synth`;
          this.emit();
          return;
        }
        // network / CORS failure → remember and fall through to the media element tier
        this.hostPolicy.set(this.hostOf(url), "nocors");
      }
    }
    // Tier 2: media element
    this.attachElement(a, false);
  }

  private attachElement(a: Asset, loop: boolean) {
    const el = new Audio();
    el.preload = "auto";
    el.loop = loop;
    el.src = a.url;
    a.template = el;
    a.pool = [el];
    a.status = "loading";
    const ok = () => {
      if (a.status === "loading") {
        a.status = "stream";
        a.note = a.corsOk ? "Streaming via media element (routed through mixer)" : "Streaming via media element (host has no CORS; volume mirrored)";
        this.emit();
      }
    };
    el.addEventListener("canplaythrough", ok, { once: true });
    el.addEventListener("loadeddata", ok, { once: true });
    el.addEventListener(
      "error",
      () => {
        a.status = "synth";
        a.note = "Media element could not load the URL — using synth";
        a.pool = [];
        a.template = undefined;
        this.emit();
      },
      { once: true },
    );
    el.load();
    this.emit();
  }

  /** Long assets (music / ambience): always streamed; bridged into the graph only when CORS allows it. */
  private async loadLong(a: Asset, slot: SoundSlot) {
    let pol = this.policy(a.url);
    if (!pol) {
      try {
        const res = await fetch(a.url, { method: "HEAD", mode: "cors" });
        pol = res.ok || res.status === 405 ? "cors" : "nocors";
      } catch {
        pol = "nocors";
      }
      this.hostPolicy.set(this.hostOf(a.url), pol);
    }
    a.corsOk = pol === "cors";
    this.attachElement(a, slot.kind !== "sfx");
    if (a.template && a.corsOk) a.template.crossOrigin = "anonymous";
  }

  private synthBuffer(slot: SoundSlot, variant = 0) {
    if (!this.ctx) return null;
    const key = `${slot.synth}#${variant}`;
    let b = this.synthBuffers.get(key);
    if (!b) {
      const data = renderSynth(slot.synth, this.ctx.sampleRate, variant);
      b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      b.getChannelData(0).set(data);
      this.synthBuffers.set(key, b);
    }
    return b;
  }

  /* ------------------------------------------------------------------ */
  /* One-shot playback                                                    */
  /* ------------------------------------------------------------------ */

  play(id: string, opts: PlayOpts = {}) {
    const ctx = this.ctx;
    const slot = SLOT_BY_ID[id];
    if (!ctx || !slot || slot.kind !== "sfx") return;
    if (this.settings.muteSfx || this.settings.sfx <= 0) return;
    const now = ctx.currentTime;
    const minI = slot.minInterval ?? 0.03;
    const last = this.lastPlay.get(id) ?? -1;
    if (now - last < minI) return;
    this.lastPlay.set(id, now);

    const a = this.ensure(id);
    const rate = (opts.rate ?? 1) * (opts.vary ? 1 + (Math.random() * 2 - 1) * opts.vary : 1);
    const gain = slot.gain * (opts.gain ?? 1);

    if (a.buffer) return this.playBuffer(a.buffer, gain, rate, opts, slot.cut);
    if (a.template && !a.blocked && (a.status === "stream" || a.status === "loading")) return this.playElement(a, gain, rate, opts, slot.cut);
    // synth fallback (also covers "still loading" buffers so timing never slips)
    const variant = Math.random() < 0.5 ? 0 : 1;
    const b = this.synthBuffer(slot, variant);
    if (b) this.playBuffer(b, gain, rate * (opts.vary === undefined ? 1 + (Math.random() - 0.5) * 0.08 : 1), opts);
  }

  private playBuffer(buffer: AudioBuffer, gain: number, rate: number, opts: PlayOpts, cut?: number) {
    const ctx = this.ctx!;
    if (this.voices >= MAX_VOICES) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    let head: AudioNode = g;
    if (opts.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      g.connect(p);
      head = p;
    }
    src.connect(g);
    head.connect(this.sfxGain);
    this.voices++;
    src.onended = () => {
      this.voices--;
      src.disconnect();
      g.disconnect();
    };
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    src.start(t0);
    if (cut && buffer.duration / rate > cut) {
      g.gain.setValueAtTime(gain, t0 + cut - 0.12);
      g.gain.linearRampToValueAtTime(0, t0 + cut);
      src.stop(t0 + cut + 0.01);
    }
  }

  private playElement(a: Asset, gain: number, rate: number, opts: PlayOpts, cut?: number) {
    let el = a.pool.find((e) => e.paused || e.ended);
    if (!el) {
      if (a.pool.length >= 4) el = a.pool[0];
      else {
        el = a.template!.cloneNode() as HTMLAudioElement;
        a.pool.push(el);
      }
    }
    const e = el;
    const fire = () => {
      e.volume = this.elementVolume("sfx", gain);
      (e as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = false;
      e.playbackRate = Math.max(0.5, Math.min(2, rate));
      try {
        e.currentTime = 0;
      } catch {
        /* not seekable yet */
      }
      e.play().catch((err: DOMException) => {
        if (err?.name === "NotAllowedError") {
          a.blocked = true;
          a.status = "synth";
          a.note = "Browser blocked media playback outside a gesture — using synth";
          this.emit();
        }
      });
      if (cut) {
        const token = ++elementTokens;
        elementToken.set(e, token);
        window.setTimeout(() => {
          if (elementToken.get(e) !== token || e.paused) return;
          const v0 = e.volume;
          const t0 = performance.now();
          const step = () => {
            if (elementToken.get(e) !== token) return;
            const k = Math.min(1, (performance.now() - t0) / 120);
            e.volume = v0 * (1 - k);
            if (k < 1) requestAnimationFrame(step);
            else e.pause();
          };
          requestAnimationFrame(step);
        }, Math.max(0, cut * 1000 - 120));
      }
    };
    if (opts.delay) window.setTimeout(fire, opts.delay * 1000);
    else fire();
  }

  /* ------------------------------------------------------------------ */
  /* Music & ambience                                                     */
  /* ------------------------------------------------------------------ */

  private themeFor(slot: SoundSlot): MusicTheme {
    const t = slot.synth.replace("music.", "");
    return (["menu", "wasteland", "foundry", "meadow"].includes(t) ? t : t === "kyoto" ? "meadow" : "menu") as MusicTheme;
  }

  playMusic(id: string) {
    if (!this.ctx) {
      this.pendingMusic = id;
      return;
    }
    if (this.music?.id === id) return;
    this.startLong(id, "music");
  }

  stopMusic(fade = 0.6) {
    this.pendingMusic = null;
    if (this.music) this.stopPlaying(this.music, fade);
    this.music = null;
  }

  playAmbient(id: string) {
    if (!this.ctx) {
      this.pendingAmbient = id;
      return;
    }
    if (this.ambient?.id === id) return;
    this.startLong(id, "ambient");
  }

  stopAmbient(fade = 0.8) {
    this.pendingAmbient = null;
    if (this.ambient) this.stopPlaying(this.ambient, fade);
    this.ambient = null;
  }

  get currentMusic() {
    return this.music?.id ?? null;
  }
  get currentAmbient() {
    return this.ambient?.id ?? null;
  }

  private startLong(id: string, which: "music" | "ambient") {
    const ctx = this.ctx!;
    const slot = SLOT_BY_ID[id];
    if (!slot) return;
    const prev = which === "music" ? this.music : this.ambient;
    if (prev) this.stopPlaying(prev, 0.6);
    const channel: "music" | "sfx" = slot.kind === "music" ? "music" : "sfx";
    const bus = channel === "music" ? this.musicGain : this.sfxGain;
    const a = this.ensure(id);
    const p: Playing = { id, slotGain: slot.gain, channel };

    const startSynth = () => {
      if (slot.kind === "music") {
        const g = ctx.createGain();
        g.gain.value = slot.gain;
        g.connect(bus);
        p.gain = g;
        p.proc = new ProceduralMusic(ctx, g, this.themeFor(slot));
        p.proc.setRate(this.musicRate);
        p.proc.start();
      } else {
        const b = this.synthBuffer(slot);
        if (!b) return;
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.loop = true;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, ctx.currentTime);
        g.gain.linearRampToValueAtTime(slot.gain, ctx.currentTime + 1.2);
        src.connect(g).connect(bus);
        src.start();
        p.node = src;
        p.gain = g;
      }
    };

    if (a.status === "synth" || a.status === "error" || !a.template) {
      startSynth();
    } else {
      const el = a.template;
      el.loop = true;
      if (a.corsOk) {
        try {
          if (!a.mediaSrc) a.mediaSrc = ctx.createMediaElementSource(el);
          const src = a.mediaSrc;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, ctx.currentTime);
          g.gain.linearRampToValueAtTime(slot.gain, ctx.currentTime + 1.0);
          src.connect(g).connect(bus);
          p.src = src;
          p.gain = g;
          el.volume = 1;
        } catch {
          a.corsOk = false;
        }
      }
      if (!p.src) el.volume = this.elementVolume(channel, slot.gain);
      (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = false;
      el.playbackRate = which === "music" ? this.musicRate : 1;
      p.el = el;
      el.play().catch(() => {
        // autoplay blocked or bad source → procedural fallback
        p.el = undefined;
        startSynth();
      });
      el.addEventListener(
        "error",
        () => {
          if ((which === "music" ? this.music : this.ambient) !== p) return;
          p.el = undefined;
          startSynth();
        },
        { once: true },
      );
    }
    if (which === "music") this.music = p;
    else this.ambient = p;
    this.emit();
  }

  private stopPlaying(p: Playing, fade: number) {
    const ctx = this.ctx!;
    if (p.proc) p.proc.stop(fade);
    if (p.gain && !p.proc) {
      p.gain.gain.setValueAtTime(p.gain.gain.value, ctx.currentTime);
      p.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
    }
    const el = p.el;
    const node = p.node;
    window.setTimeout(() => {
      try {
        node?.stop();
      } catch {
        /* already stopped */
      }
      node?.disconnect();
      p.gain?.disconnect();
      p.src?.disconnect();
    }, fade * 1000 + 60);
    if (el) {
      if (p.src) {
        window.setTimeout(() => el.pause(), fade * 1000 + 60);
      } else {
        const v0 = el.volume;
        const t0 = performance.now();
        const step = () => {
          const k = Math.min(1, (performance.now() - t0) / (fade * 1000));
          el.volume = v0 * (1 - k);
          if (k < 1 && !el.paused) requestAnimationFrame(step);
          else el.pause();
        };
        requestAnimationFrame(step);
      }
    }
  }

  /** Temporarily lower the music (e.g. during KO slow-motion). */
  duckMusic(amount: number, seconds: number) {
    if (!this.ctx) return;
    this.duck = amount;
    this.duckGain.gain.setTargetAtTime(amount, this.ctx.currentTime, 0.05);
    if (this.music?.el && !this.music.src) this.music.el.volume = this.elementVolume("music", this.music.slotGain);
    if (this.duckTimer) clearTimeout(this.duckTimer);
    this.duckTimer = window.setTimeout(() => {
      this.duck = 1;
      if (!this.ctx) return;
      this.duckGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.4);
      if (this.music?.el && !this.music.src) this.music.el.volume = this.elementVolume("music", this.music.slotGain);
    }, seconds * 1000);
  }

  /** Playback-rate for the music bed (slow-motion drama). */
  setMusicRate(rate: number) {
    this.musicRate = rate;
    const m = this.music;
    if (!m) return;
    if (m.el) m.el.playbackRate = rate;
    m.proc?.setRate(rate);
    if (m.node) m.node.playbackRate.value = rate;
  }

  /* ------------------------------------------------------------------ */
  /* Settings-page helpers                                                */
  /* ------------------------------------------------------------------ */

  /** Play a slot once (sfx) or switch to it for ~8 s (music/ambience), then restore. */
  preview(id: string) {
    this.unlock();
    const slot = SLOT_BY_ID[id];
    if (!slot || !this.ctx) return;
    if (slot.kind === "sfx") {
      this.lastPlay.delete(id);
      this.play(id);
      return;
    }
    // already audible → nothing to preview
    if ((slot.kind === "music" ? this.music?.id : this.ambient?.id) === id) return;
    if (!this.previewRestore) this.previewRestore = { music: this.music?.id ?? null, ambient: this.ambient?.id ?? null, timer: 0 };
    else clearTimeout(this.previewRestore.timer);
    if (slot.kind === "music") this.startLong(id, "music");
    else this.startLong(id, "ambient");
    this.previewRestore.timer = window.setTimeout(() => this.endPreview(), 8000);
  }

  endPreview() {
    const r = this.previewRestore;
    if (!r) return;
    clearTimeout(r.timer);
    this.previewRestore = null;
    if (r.music) this.playMusic(r.music);
    else this.stopMusic();
    if (r.ambient) this.playAmbient(r.ambient);
    else this.stopAmbient();
  }

  /** All slots with their current resolution — for the settings table. */
  inventory() {
    return CATALOG.map((s) => ({ slot: s, ...this.status(s.id), overridden: this.isOverridden(s.id), source: DEFAULTS[s.id] }));
  }
}

export const audio = AudioEngine.get();
if (typeof window !== "undefined") (window as unknown as { __audio?: AudioEngine }).__audio = audio;
