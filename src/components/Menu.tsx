import { ARENAS, ArenaId } from "../game/arenas/common";
import { CharId, FighterConfig, FIGHTERS } from "../game/moves";
import type { Difficulty } from "../game/AI";
import type { GameMode } from "../game/Game";
import { cn } from "../utils/cn";

export interface Setup {
  mode: Exclude<GameMode, "attract">;
  p1: CharId;
  p2: CharId;
  arena: ArenaId;
  difficulty: Difficulty;
  roundsToWin: number;
}

/* ------------------------------------------------------------------ */

export function TitleScreen({ onStart }: { onStart(mode: Setup["mode"]): void }) {
  return (
    <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-between bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.15)_0%,rgba(0,0,0,0.7)_100%)] px-6 py-8">
      <div className="mt-2 text-[11px] font-bold tracking-[0.5em] text-white/60 fade-up">PROCEDURAL 3D ARENA FIGHTER</div>
      <div className="flex flex-col items-center text-center">
        <div className="font-display text-[clamp(3rem,10vw,7.5rem)] leading-[0.9] text-cyan-300 text-stroke pulse-glow fade-up">ROBO-CLUCK</div>
        <div className="font-display text-[clamp(1.4rem,4vw,2.6rem)] leading-none text-white/85 text-stroke-thin fade-up" style={{ animationDelay: "0.1s" }}>
          — VS —
        </div>
        <div className="font-display text-[clamp(3rem,10vw,7.5rem)] leading-[0.9] text-amber-300 text-stroke fade-up" style={{ animationDelay: "0.2s" }}>
          FLUFFALO
        </div>
        <p className="mt-4 max-w-md text-sm text-white/70 fade-up" style={{ animationDelay: "0.3s" }}>
          Pick from four brawlers — a laser-eyed steel rooster, the fluffiest bison in the meadow, a sheep pilot in a missile-toting scrap mech, and a
          bog toad king with a sticky tongue and a toxic croak. Three arenas, best-of-N rounds, super moves and slow-motion knockouts.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row fade-up" style={{ animationDelay: "0.4s" }}>
          <button
            onClick={() => onStart("cpu")}
            className="rounded-xl bg-cyan-400 px-10 py-3 font-display text-3xl tracking-wider text-black shadow-[0_6px_0_#0a7c8c] transition hover:-translate-y-0.5 hover:bg-cyan-300 active:translate-y-1 active:shadow-none"
          >
            VS CPU
          </button>
          <button
            onClick={() => onStart("2p")}
            className="rounded-xl bg-amber-400 px-10 py-3 font-display text-3xl tracking-wider text-black shadow-[0_6px_0_#9a5b00] transition hover:-translate-y-0.5 hover:bg-amber-300 active:translate-y-1 active:shadow-none"
          >
            2 PLAYERS
          </button>
        </div>
      </div>
      <div className="card-glass grid w-full max-w-2xl grid-cols-1 gap-3 rounded-2xl px-5 py-3 text-xs text-white/70 sm:grid-cols-2 fade-up" style={{ animationDelay: "0.5s" }}>
        <div>
          <div className="mb-1 font-bold tracking-[0.25em] text-cyan-300">PLAYER 1</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="key">A</span>
            <span className="key">D</span> move <span className="key">W</span> jump <span className="key">S</span> block <span className="key">J</span> light{" "}
            <span className="key">K</span> heavy <span className="key">L</span> special
          </div>
        </div>
        <div>
          <div className="mb-1 font-bold tracking-[0.25em] text-amber-300">PLAYER 2</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="key">◀</span>
            <span className="key">▶</span> move <span className="key">▲</span> jump <span className="key">▼</span> block <span className="key">,</span> light{" "}
            <span className="key">.</span> heavy <span className="key">/</span> special
          </div>
        </div>
        <div className="sm:col-span-2 text-white/45">
          Attack in the air for a dive move · Land a light hit and chain into another attack · Fill the meter to unleash your special · <span className="key">ESC</span>{" "}
          pauses
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function FighterCard({ id, selected, gold, onClick }: { id: CharId; selected: boolean; gold?: boolean; onClick(): void }) {
  const f: FighterConfig = FIGHTERS[id];
  const stats = f.stats;
  return (
    <button
      onClick={onClick}
      className={cn(
        "card-glass group relative flex w-full flex-col items-start gap-2 overflow-hidden rounded-2xl p-4 text-left transition hover:bg-white/10",
        selected && (gold ? "card-selected-gold" : "card-selected"),
      )}
    >
      <div
        className="absolute -right-6 -top-6 h-28 w-28 rounded-full opacity-30 blur-2xl"
        style={{ background: f.color }}
      />
      <div className="flex w-full items-center justify-between">
        <span className="text-4xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">{stats.icon}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold tracking-widest", selected ? "bg-white text-black" : "bg-white/10 text-white/60")}>
          {selected ? "SELECTED" : "SELECT"}
        </span>
      </div>
      <div>
        <div className="font-display text-3xl leading-none text-stroke-thin" style={{ color: f.color }}>
          {f.name}
        </div>
        <div className="text-[11px] text-white/55">{f.title}</div>
      </div>
      <div className="grid w-full grid-cols-3 gap-2 text-[10px] font-bold tracking-widest text-white/60">
        {(["speed", "power", "tough"] as const).map((k) => (
          <div key={k}>
            <div className="mb-1">{k.toUpperCase()}</div>
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} className="h-1.5 flex-1 rounded-sm" style={{ background: i <= stats[k] ? f.color : "rgba(255,255,255,0.12)" }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 grid w-full grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-white/70">
        <span>
          <b className="text-white/40">L</b> {f.moveNames.light}
        </span>
        <span>
          <b className="text-white/40">H</b> {f.moveNames.heavy}
        </span>
        <span>
          <b className="text-white/40">S</b> {f.moveNames.special}
        </span>
        <span>
          <b className="text-white/40">AIR</b> {f.moveNames.air}
        </span>
      </div>
    </button>
  );
}

export function SelectScreen({ setup, onChange, onFight, onBack }: { setup: Setup; onChange(s: Setup): void; onFight(): void; onBack(): void }) {
  const set = (patch: Partial<Setup>) => onChange({ ...setup, ...patch });
  return (
    <div className="pointer-events-auto absolute inset-0 flex flex-col bg-[linear-gradient(180deg,rgba(0,0,0,0.75)_0%,rgba(0,0,0,0.35)_40%,rgba(0,0,0,0.75)_100%)]">
      <div className="flex items-center justify-between px-5 pt-4 sm:px-8">
        <button onClick={onBack} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold tracking-widest text-white/70 hover:bg-white/10">
          ← BACK
        </button>
        <div className="font-display text-3xl text-white text-stroke-thin sm:text-4xl">CHOOSE YOUR FIGHTER</div>
        <div className="text-xs font-bold tracking-widest text-white/50">{setup.mode === "cpu" ? "VS CPU" : "2 PLAYERS"}</div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-8">
        <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1fr_1fr]">
          <section>
            <div className="mb-2 text-[11px] font-bold tracking-[0.35em] text-cyan-300">PLAYER 1</div>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(FIGHTERS) as CharId[]).map((id) => (
                <FighterCard key={id} id={id} selected={setup.p1 === id} onClick={() => set({ p1: id })} />
              ))}
            </div>
          </section>
          <section>
            <div className="mb-2 text-[11px] font-bold tracking-[0.35em] text-amber-300">{setup.mode === "cpu" ? "CPU OPPONENT" : "PLAYER 2"}</div>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(FIGHTERS) as CharId[]).map((id) => (
                <FighterCard key={id} id={id} gold selected={setup.p2 === id} onClick={() => set({ p2: id })} />
              ))}
            </div>
          </section>

          <section className="lg:col-span-2">
            <div className="mb-2 text-[11px] font-bold tracking-[0.35em] text-white/70">ARENA</div>
            <div className="grid gap-3 sm:grid-cols-3">
              {ARENAS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => set({ arena: a.id })}
                  className={cn("card-glass overflow-hidden rounded-2xl text-left transition hover:bg-white/10", setup.arena === a.id && "card-selected")}
                >
                  <div className="relative h-20 w-full" style={{ background: a.gradient }}>
                    <div className="absolute inset-x-0 bottom-0 h-8 bg-[linear-gradient(0deg,rgba(0,0,0,0.55),transparent)]" />
                    {setup.arena === a.id && <span className="absolute right-2 top-2 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold tracking-widest text-black">SELECTED</span>}
                  </div>
                  <div className="p-3">
                    <div className="font-display text-2xl leading-none text-white">{a.name}</div>
                    <div className="text-[11px] text-white/55">{a.subtitle}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-wrap items-end gap-6 lg:col-span-2">
            {setup.mode === "cpu" && (
              <div>
                <div className="mb-2 text-[11px] font-bold tracking-[0.35em] text-white/70">CPU DIFFICULTY</div>
                <div className="flex overflow-hidden rounded-lg border border-white/15">
                  {(["easy", "normal", "hard"] as Difficulty[]).map((d) => (
                    <button
                      key={d}
                      onClick={() => set({ difficulty: d })}
                      className={cn("px-4 py-2 font-display text-xl tracking-wider transition", setup.difficulty === d ? "bg-white text-black" : "text-white/70 hover:bg-white/10")}
                    >
                      {d.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="mb-2 text-[11px] font-bold tracking-[0.35em] text-white/70">MATCH LENGTH</div>
              <div className="flex overflow-hidden rounded-lg border border-white/15">
                {[1, 2, 3].map((r) => (
                  <button
                    key={r}
                    onClick={() => set({ roundsToWin: r })}
                    className={cn("px-4 py-2 font-display text-xl tracking-wider transition", setup.roundsToWin === r ? "bg-white text-black" : "text-white/70 hover:bg-white/10")}
                  >
                    {r === 1 ? "1 ROUND" : `BEST OF ${r * 2 - 1}`}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={onFight}
              className="ml-auto rounded-xl bg-gradient-to-r from-cyan-400 to-amber-400 px-12 py-3 font-display text-4xl tracking-wider text-black shadow-[0_6px_0_rgba(0,0,0,0.5)] transition hover:-translate-y-0.5 hover:brightness-110 active:translate-y-1 active:shadow-none"
            >
              FIGHT!
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
