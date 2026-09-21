import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { audio, SourceStatus } from "../game/audio/AudioEngine";
import { GROUPS } from "../game/audio/catalog";
import { cn } from "../utils/cn";

function useAudioVersion() {
  return useSyncExternalStore(
    (cb) => audio.subscribe(cb),
    () => audio.version,
    () => audio.version,
  );
}

const STATUS_STYLE: Record<SourceStatus, { label: string; cls: string }> = {
  idle: { label: "NOT LOADED", cls: "bg-white/10 text-white/50" },
  loading: { label: "LOADING…", cls: "bg-sky-400/20 text-sky-200" },
  buffer: { label: "WEB AUDIO", cls: "bg-emerald-400/20 text-emerald-200" },
  stream: { label: "STREAMING", cls: "bg-cyan-400/20 text-cyan-200" },
  synth: { label: "SYNTH", cls: "bg-amber-400/20 text-amber-200" },
  error: { label: "ERROR", cls: "bg-red-400/20 text-red-200" },
};

function Slider({ label, value, onChange, muted, onMute, accent }: { label: string; value: number; onChange(v: number): void; muted?: boolean; onMute?(m: boolean): void; accent: string }) {
  return (
    <div className="card-glass flex items-center gap-3 rounded-xl px-4 py-3">
      <div className="w-24 font-display text-xl tracking-wider" style={{ color: accent }}>
        {label}
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(+e.target.value / 100)}
        className="h-2 flex-1 cursor-pointer accent-cyan-300"
        aria-label={`${label} volume`}
      />
      <div className="w-10 text-right text-xs font-bold text-white/70">{Math.round(value * 100)}</div>
      {onMute && (
        <button
          data-sfx="ui.click"
          onClick={() => onMute(!muted)}
          className={cn("rounded-md border px-2 py-1 text-[10px] font-bold tracking-widest", muted ? "border-red-300/60 bg-red-400/20 text-red-200" : "border-white/20 text-white/70 hover:bg-white/10")}
        >
          {muted ? "MUTED" : "MUTE"}
        </button>
      )}
    </div>
  );
}

function UrlRow({ id }: { id: string }) {
  useAudioVersion();
  const inv = useMemo(() => audio.inventory().find((x) => x.slot.id === id)!, [id, audio.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState(inv.url);
  useEffect(() => setDraft(inv.url), [inv.url]);
  const st = STATUS_STYLE[inv.status];
  const dirty = draft.trim() !== inv.url;
  const commit = () => {
    if (dirty) audio.setUrl(id, draft);
  };
  return (
    <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_auto] items-center gap-2 border-b border-white/5 py-1.5 text-xs last:border-0 max-[720px]:grid-cols-1">
      <div className="min-w-0">
        <div className="truncate font-semibold text-white/90" title={inv.slot.label}>
          {inv.slot.label}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-white/45">
          <span className={cn("rounded px-1.5 py-0.5 font-bold tracking-widest", st.cls)} title={inv.note}>
            {st.label}
          </span>
          {inv.source && !inv.overridden && (
            <a href={inv.source.page} target="_blank" rel="noreferrer" className="truncate underline decoration-white/30 hover:text-white/80" title={`${inv.source.title} by ${inv.source.author} on Pixabay`}>
              {inv.source.title} · {inv.source.author}
            </a>
          )}
          {inv.overridden && <span className="text-cyan-200">custom URL</span>}
        </div>
      </div>
      <input
        type="url"
        value={draft}
        spellCheck={false}
        placeholder="empty = built-in synthesized sound"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={cn(
          "w-full min-w-0 rounded-md border bg-black/40 px-2 py-1 font-mono text-[11px] text-white/85 outline-none focus:border-cyan-300/70",
          dirty ? "border-amber-300/70" : "border-white/15",
        )}
      />
      <div className="flex items-center gap-1">
        <button data-sfx="none" onClick={() => audio.preview(id)} className="rounded-md border border-white/20 px-2 py-1 font-bold text-white/80 hover:bg-white/10" title="Preview">
          ▶
        </button>
        <button
          data-sfx="ui.back"
          onClick={() => audio.resetUrl(id)}
          disabled={!inv.overridden}
          className="rounded-md border border-white/20 px-2 py-1 font-bold text-white/60 hover:bg-white/10 disabled:opacity-30"
          title="Reset to default URL"
        >
          ↺
        </button>
      </div>
    </div>
  );
}

export function SettingsScreen({ onClose }: { onClose(): void }) {
  useAudioVersion();
  const s = audio.settings;
  const [open, setOpen] = useState<string>(GROUPS[0]);
  const inv = audio.inventory();
  const counts = useMemo(() => {
    const c = { buffer: 0, stream: 0, synth: 0, loading: 0, idle: 0, error: 0 } as Record<SourceStatus, number>;
    for (const x of inv) c[x.status]++;
    return c;
  }, [inv]);

  useEffect(() => {
    audio.unlock();
    return () => audio.endPreview();
  }, []);

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex flex-col bg-[linear-gradient(180deg,rgba(0,0,0,0.88),rgba(0,0,0,0.78))] backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3 px-5 pt-4 sm:px-8">
        <button data-sfx="ui.back" onClick={onClose} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold tracking-widest text-white/70 hover:bg-white/10">
          ← BACK
        </button>
        <div className="font-display text-3xl text-white text-stroke-thin sm:text-4xl">AUDIO SETTINGS</div>
        <div className="text-[10px] font-bold tracking-widest text-white/50">
          {counts.buffer + counts.stream} REMOTE · {counts.synth} SYNTH · {counts.loading} LOADING
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <section className="grid gap-2 md:grid-cols-3">
            <Slider label="MASTER" value={s.master} onChange={(v) => audio.setLevel("master", v)} accent="#ffffff" />
            <Slider label="MUSIC" value={s.music} onChange={(v) => audio.setLevel("music", v)} muted={s.muteMusic} onMute={(m) => audio.setMute("music", m)} accent="#ffb347" />
            <Slider label="SFX" value={s.sfx} onChange={(v) => audio.setLevel("sfx", v)} muted={s.muteSfx} onMute={(m) => audio.setMute("sfx", m)} accent="#38e8ff" />
          </section>

          <section className="card-glass flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-xs text-white/70">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.preferSynth} onChange={(e) => audio.setPreferSynth(e.target.checked)} className="accent-amber-300" />
              <span>
                <b className="text-white">Prefer built-in synthesized sounds</b> (ignore all URLs, zero network)
              </span>
            </label>
            <div className="ml-auto flex gap-2">
              <button data-sfx="ui.click" onClick={() => audio.preview("ui.start")} className="rounded-md border border-white/20 px-3 py-1 font-bold text-white/80 hover:bg-white/10">
                TEST SFX
              </button>
              <button data-sfx="ui.click" onClick={() => audio.preview(audio.currentMusic ?? "music.menu")} className="rounded-md border border-white/20 px-3 py-1 font-bold text-white/80 hover:bg-white/10">
                TEST MUSIC
              </button>
              <button
                data-sfx="ui.back"
                onClick={() => {
                  if (confirm("Reset all volumes and sound URLs to defaults?")) audio.resetAll();
                }}
                className="rounded-md border border-red-300/40 px-3 py-1 font-bold text-red-200 hover:bg-red-400/10"
              >
                RESET ALL
              </button>
            </div>
          </section>

          <section className="text-[11px] leading-relaxed text-white/55">
            Paste any direct <b className="text-white/80">MP3 / OGG / WAV URL</b> (or a stream URL for music) into a field — changes apply immediately and are saved in this browser.
            Files hosted with CORS headers are decoded into <span className="text-emerald-200">Web Audio</span> (sample-accurate); hosts without CORS (e.g. <code>cdn.pixabay.com</code>) are
            <span className="text-cyan-200"> streamed</span> through an audio element that mirrors the mixer volume. If a URL is empty or fails to load, the built-in
            <span className="text-amber-200"> synthesizer</span> takes over. Defaults are royalty-free sounds from{" "}
            <a href="https://pixabay.com/sound-effects/" target="_blank" rel="noreferrer" className="underline">
              pixabay.com
            </a>
            .
          </section>

          <section className="flex flex-col gap-2">
            {GROUPS.map((g) => {
              const rows = inv.filter((x) => x.slot.group === g);
              const isOpen = open === g;
              const custom = rows.filter((r) => r.overridden).length;
              return (
                <div key={g} className="card-glass rounded-xl">
                  <button data-sfx="ui.click" onClick={() => setOpen(isOpen ? "" : g)} className="flex w-full items-center justify-between px-4 py-2.5 text-left">
                    <span className="font-display text-2xl tracking-wider text-white">{g}</span>
                    <span className="text-[10px] font-bold tracking-widest text-white/50">
                      {rows.length} SOUNDS{custom ? ` · ${custom} CUSTOM` : ""} {isOpen ? "▲" : "▼"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-white/10 px-4 pb-3 pt-1">
                      {rows.map((r) => (
                        <UrlRow key={r.slot.id} id={r.slot.id} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}
