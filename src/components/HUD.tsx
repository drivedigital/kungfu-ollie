import { useEffect, useState } from "react";
import type { HUDFighter, HUDState } from "../game/Game";
import { cn } from "../utils/cn";

interface Props {
  hud: HUDState;
  onResume(): void;
  onQuit(): void;
  onRematch(): void;
  onReselect(): void;
  onSettings(): void;
  showControls: boolean;
}

function HealthBar({ f, side }: { f: HUDFighter; side: "left" | "right" }) {
  const pct = Math.max(0, (f.hp / f.maxHp) * 100);
  const [ghost, setGhost] = useState(pct);
  const recentHit = f.hitAge < 0.25;
  useEffect(() => {
    const t = setTimeout(() => setGhost(pct), 350);
    return () => clearTimeout(t);
  }, [pct]);
  const left = side === "left";
  return (
    <div className={cn("flex flex-col gap-1", left ? "items-start" : "items-end")}>
      <div className={cn("flex items-center gap-2", !left && "flex-row-reverse")}>
        <span className="font-display text-2xl text-stroke-thin leading-none" style={{ color: f.color }}>
          {f.name}
        </span>
        <span className="text-[10px] tracking-[0.3em] text-white/50 font-bold">{left ? "P1" : "P2"}</span>
      </div>
      <div
        className={cn(
          "relative h-6 w-full overflow-hidden border-2 border-black/80 bg-[#1a0b0b]/85 shadow-[0_3px_0_rgba(0,0,0,0.6)]",
          left ? "skew-x-[-18deg] rounded-l-sm" : "skew-x-[18deg] rounded-r-sm",
          recentHit && "hp-shake",
        )}
      >
        <div className={cn("absolute inset-y-0 bg-white/85", left ? "right-0" : "left-0")} style={{ width: `${ghost}%`, transition: "width 0.55s ease-out" }} />
        <div
          className={cn("absolute inset-y-0", left ? "right-0" : "left-0")}
          style={{
            width: `${pct}%`,
            transition: "width 0.08s linear",
            background: `linear-gradient(180deg, #ffffff 0%, ${f.color} 35%, ${f.color} 70%, rgba(0,0,0,0.35) 100%)`,
            boxShadow: `0 0 14px ${f.color}88`,
          }}
        />
        <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent_0,transparent_28px,rgba(0,0,0,0.35)_28px,rgba(0,0,0,0.35)_30px)]" />
      </div>
      <div className={cn("flex items-center gap-1.5 px-1", !left && "flex-row-reverse")}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn("h-3 w-3 rotate-45 border border-black/70", i < f.rounds ? "" : "bg-black/50")}
            style={i < f.rounds ? { background: f.color, boxShadow: `0 0 10px ${f.color}` } : undefined}
          />
        ))}
        {f.poisoned && (
          <span className="mx-2 text-[10px] font-bold tracking-[0.25em] text-lime-300 blink" style={{ textShadow: "0 0 8px #8dff5a" }}>
            ☠ POISONED
          </span>
        )}
      </div>
    </div>
  );
}

function Meter({ f, side }: { f: HUDFighter; side: "left" | "right" }) {
  const pct = Math.min(100, f.meter);
  const ready = f.meter >= f.specialCost;
  const left = side === "left";
  return (
    <div className={cn("flex w-[min(34vw,320px)] flex-col gap-1", left ? "items-start" : "items-end")}>
      <span className={cn("text-[11px] font-bold tracking-[0.25em]", ready ? "text-yellow-300 blink" : "text-white/50")}>
        {ready ? `SPECIAL READY · ${f.moveNames.special.toUpperCase()}` : "SPECIAL"}
      </span>
      <div className={cn("relative h-3 w-full overflow-hidden border border-black/80 bg-black/60", left ? "skew-x-[-18deg]" : "skew-x-[18deg]")}>
        <div
          className={cn("absolute inset-y-0", left ? "left-0" : "right-0", ready && "meter-full")}
          style={{
            width: `${pct}%`,
            transition: "width 0.15s ease-out",
            backgroundColor: ready ? "#ffd23f" : f.color,
            boxShadow: ready ? "0 0 12px #ffd23f" : "none",
          }}
        />
        <div className="absolute inset-y-0 left-1/2 w-px bg-black/70" />
      </div>
    </div>
  );
}

function Key({ k }: { k: string }) {
  return <span className="key">{k}</span>;
}

export function HUD({ hud, onResume, onQuit, onRematch, onReselect, onSettings, showControls }: Props) {
  const banner = hud.banner;
  const isMatchEnd = hud.phase === "matchEnd";
  const combo = hud.p1.combo ? { side: "left", n: hud.p1.combo, color: hud.p1.color } : hud.p2.combo ? { side: "right", n: hud.p2.combo, color: hud.p2.color } : null;
  const timerDanger = hud.timer <= 10 && hud.phase === "fight";

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* screen flash */}
      {hud.flash > 0.01 && <div key={hud.flashKey} className="absolute inset-0 bg-white flash-in" style={{ opacity: hud.flash }} />}
      {/* vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.45)_100%)]" />

      {/* top bar */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 px-4 pt-3 sm:px-8 sm:pt-5">
        <div className="w-[38%]">
          <HealthBar f={hud.p1} side="left" />
        </div>
        <div className="flex flex-col items-center">
          <div
            className={cn(
              "font-display text-4xl leading-none text-stroke sm:text-5xl",
              timerDanger ? "text-red-400 blink" : "text-white",
            )}
          >
            {hud.phase === "attract" ? "" : String(hud.timer).padStart(2, "0")}
          </div>
          {hud.round > 0 && <div className="mt-1 text-[10px] font-bold tracking-[0.35em] text-white/60">ROUND {hud.round}</div>}
        </div>
        <div className="w-[38%]">
          <HealthBar f={hud.p2} side="right" />
        </div>
      </div>

      {/* combo counter */}
      {combo && (
        <div key={combo.n + combo.side} className={cn("absolute top-[26%] combo-pop", combo.side === "left" ? "left-[8%]" : "right-[8%] text-right")}>
          <div className="font-display text-6xl text-stroke leading-none sm:text-7xl" style={{ color: combo.color }}>
            {combo.n}
          </div>
          <div className="font-display text-2xl text-stroke-thin text-white">HIT COMBO!</div>
        </div>
      )}

      {/* banner */}
      {banner && !isMatchEnd && (
        <div key={banner.key} className={cn("absolute inset-x-0 top-[34%] flex flex-col items-center text-center", banner.hold ? "banner-hold" : "banner-pop")}>
          <div className="font-display text-[clamp(3rem,11vw,8.5rem)] leading-none text-stroke" style={{ color: banner.color ?? "#ffffff" }}>
            {banner.text}
          </div>
          {banner.sub && <div className="mt-2 font-display text-2xl tracking-widest text-yellow-200 text-stroke-thin sm:text-3xl">{banner.sub}</div>}
        </div>
      )}

      {/* bottom: meters + controls */}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-4 pb-3 sm:px-8 sm:pb-5">
        <Meter f={hud.p1} side="left" />
        {showControls && (
          <div className="hidden flex-col items-center gap-1 text-[11px] text-white/70 md:flex">
            <div className="flex items-center gap-2">
              <Key k="A" />
              <Key k="D" /> move · <Key k="W" /> jump · <Key k="S" /> block
            </div>
            <div className="flex items-center gap-2">
              <Key k="J" /> {hud.p1.moveNames.light} · <Key k="K" /> {hud.p1.moveNames.heavy} · <Key k="L" /> {hud.p1.moveNames.special}
            </div>
            {hud.mode === "2p" && (
              <div className="flex items-center gap-2 text-white/50">
                P2: <Key k="◀ ▶ ▲ ▼" /> · <Key k="," /> <Key k="." /> <Key k="/" />
              </div>
            )}
          </div>
        )}
        <Meter f={hud.p2} side="right" />
      </div>

      {/* pause */}
      {hud.paused && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="card-glass fade-up flex w-72 flex-col items-center gap-4 rounded-2xl p-8">
            <div className="font-display text-5xl text-white text-stroke">PAUSED</div>
            <button onClick={onResume} className="w-full rounded-lg bg-cyan-400 py-2.5 font-display text-2xl tracking-wider text-black hover:bg-cyan-300">
              RESUME
            </button>
            <button data-sfx="none" onClick={onSettings} className="w-full rounded-lg border border-white/20 py-2.5 font-display text-2xl tracking-wider text-white hover:bg-white/10">
              🔊 AUDIO SETTINGS
            </button>
            <button data-sfx="ui.back" onClick={onQuit} className="w-full rounded-lg border border-white/20 py-2.5 font-display text-2xl tracking-wider text-white hover:bg-white/10">
              QUIT TO MENU
            </button>
            <span className="text-xs text-white/40">
              Press <span className="key">ESC</span> to resume
            </span>
          </div>
        </div>
      )}

      {/* match end */}
      {isMatchEnd && banner && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
          <div className="card-glass fade-up flex w-[min(92vw,520px)] flex-col items-center gap-5 rounded-3xl p-8 text-center">
            <div className="text-xs font-bold tracking-[0.4em] text-white/50">MATCH OVER</div>
            <div className="font-display text-[clamp(2.4rem,7vw,4.5rem)] leading-none text-stroke" style={{ color: banner.color ?? "#fff" }}>
              {banner.text}
            </div>
            <div className="flex items-center gap-6 text-sm text-white/70">
              <span>
                <b style={{ color: hud.p1.color }}>{hud.p1.name}</b> {hud.p1.rounds}
              </span>
              <span className="font-display text-2xl text-white/40">—</span>
              <span>
                {hud.p2.rounds} <b style={{ color: hud.p2.color }}>{hud.p2.name}</b>
              </span>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <button data-sfx="ui.start" onClick={onRematch} className="flex-1 rounded-lg bg-yellow-400 py-3 font-display text-2xl tracking-wider text-black hover:bg-yellow-300">
                REMATCH
              </button>
              <button data-sfx="ui.transition" onClick={onReselect} className="flex-1 rounded-lg bg-cyan-400 py-3 font-display text-2xl tracking-wider text-black hover:bg-cyan-300">
                CHANGE FIGHTERS
              </button>
              <button data-sfx="ui.back" onClick={onQuit} className="flex-1 rounded-lg border border-white/20 py-3 font-display text-2xl tracking-wider text-white hover:bg-white/10">
                MENU
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
