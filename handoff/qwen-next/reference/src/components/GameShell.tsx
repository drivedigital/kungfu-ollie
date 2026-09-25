"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Game, GameMode, HUDState, MatchResult } from "@/game/Game";
import { HUD } from "@/components/HUD";
import { SelectScreen, Setup, TitleScreen } from "@/components/Menu";
import { TouchControls } from "@/components/TouchControls";
import { SettingsScreen } from "@/components/SettingsScreen";
import { audio } from "@/game/audio/AudioEngine";
import { PreparedAssets, describeAsset, emptyAssets, prepareAssets } from "@/game/skinned/assets";
import { skinnedBindingFor } from "@/game/skinned/bindings";
import type { CharId } from "@/game/moves";
import type { ArenaId } from "@/game/arenas/common";

type Screen = "title" | "select" | "fight";

const DEFAULT_SETUP: Setup = {
  mode: "cpu",
  p1: "dog",
  p2: "toad",
  arena: "kyoto",
  difficulty: "normal",
  roundsToWin: 2,
};

interface LadderRow {
  id: CharId;
  name: string;
  icon: string;
  color: string;
  wins: number;
  losses: number;
  winRate: number;
  perfects: number;
  skinnedWins: number;
}

interface Leaderboard {
  totalMatches: number;
  skinnedMatches: number;
  ladder: LadderRow[];
  stages: { arena: string; n: number }[];
  empty: boolean;
}

/* ------------------------------------------------------------------ */
/* Server round-trips                                                  */
/* ------------------------------------------------------------------ */

async function postMatch(r: MatchResult) {
  try {
    await fetch("/api/matches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(r),
    });
  } catch (err) {
    console.warn("[shell] could not record match", err);
  }
}

function postAssetTelemetry(entries: { url: string; ok: boolean; bytes: number; ms: number; detail?: string }[]) {
  if (!entries.length) return;
  fetch("/api/assets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entries }),
  }).catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

export function GameShell() {
  const [screen, setScreen] = useState<Screen>("title");
  const [setup, setSetup] = useState<Setup>(DEFAULT_SETUP);
  const [hud, setHud] = useState<HUDState | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assets, setAssets] = useState<PreparedAssets>(emptyAssets());
  const [loading, setLoading] = useState<string | null>(null);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const gameRef = useRef<Game | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const refreshBoard = useCallback(() => {
    fetch("/api/leaderboard")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.ok) setBoard(j as Leaderboard);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setIsTouch(mq.matches);
    const h = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    mq.addEventListener("change", h);
    refreshBoard();
    return () => mq.removeEventListener("change", h);
  }, [refreshBoard]);

  // Audio: unlock on first gesture; delegated UI click/hover sounds via data-sfx.
  useEffect(() => {
    const unlock = () => audio.unlock();
    const onClick = (e: MouseEvent) => {
      audio.unlock();
      const b = (e.target as HTMLElement | null)?.closest?.("button");
      if (!b) return;
      const id = b.dataset.sfx ?? "ui.click";
      if (id !== "none") audio.play(id);
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const t = e.target as HTMLElement | null;
      const b = t?.closest?.("button");
      if (!b || b.dataset.sfx === "none") return;
      const from = (e as PointerEvent & { relatedTarget?: Node | null }).relatedTarget;
      if (from && b.contains(from as Node)) return;
      audio.play("ui.hover");
    };
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerover", onOver, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointerover", onOver, true);
    };
  }, []);

  // A fresh canvas (and WebGL context) per game instance keeps context handling simple.
  const mode: GameMode = screen === "fight" ? setup.mode : "attract";
  const gameKey = useMemo(
    () =>
      screen === "fight"
        ? `fight-${mode}-${setup.arena}-${setup.p1}-${setup.p2}-${setup.difficulty}-${setup.roundsToWin}`
        : `attract-${setup.arena}-${setup.p1}-${setup.p2}`,
    [screen, mode, setup],
  );

  useEffect(() => {
    let cancelled = false;
    let game: Game | null = null;
    const chars: CharId[] = [setup.p1, setup.p2];
    const arena: ArenaId = setup.arena;
    const started = performance.now();

    (async () => {
      // async readiness gate: parse the GLBs before the match is constructed
      setLoading("PREPARING SKINNED FIGHTERS…");
      const prepared = await prepareAssets(chars, arena);
      if (cancelled) return;
      setLoading(null);
      setAssets(prepared);

      const telemetry = chars
        .map((c) => {
          const b = skinnedBindingFor(c);
          if (!b) return null;
          const gltf = prepared.fighters[c];
          return {
            url: b.url,
            ok: !!gltf,
            bytes: prepared.bytes,
            ms: Math.round(performance.now() - started),
            detail: gltf ? describeAsset(gltf) : "fallback: procedural rig",
          };
        })
        .filter(Boolean) as { url: string; ok: boolean; bytes: number; ms: number; detail?: string }[];
      postAssetTelemetry(telemetry);

      const canvas = canvasRef.current;
      if (!canvas) return;
      game = new Game(canvas, {
        mode,
        p1: setup.p1,
        p2: setup.p2,
        arena,
        difficulty: setup.difficulty,
        roundsToWin: setup.roundsToWin,
        assets: prepared,
        onState: setHud,
        onMatchEnd: (r) => {
          postMatch(r);
          refreshBoard();
        },
      });
      gameRef.current = game;
    })();

    return () => {
      cancelled = true;
      game?.dispose();
      if (gameRef.current === game) gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameKey]);

  const quit = useCallback(() => {
    setHud(null);
    setScreen("title");
    refreshBoard();
  }, [refreshBoard]);
  const reselect = useCallback(() => {
    setHud(null);
    setScreen("select");
  }, []);
  const resume = useCallback(() => gameRef.current?.setPaused(false), []);
  const rematch = useCallback(() => gameRef.current?.restart(), []);
  const openSettings = useCallback(() => {
    if (screen === "fight") gameRef.current?.setPaused(true);
    audio.play("ui.transition");
    setSettingsOpen(true);
  }, [screen]);

  const skinnedTag = (id: CharId) => (skinnedBindingFor(id) ? (assets.fighters[id] ? "SKINNED GLB" : "PROCEDURAL FALLBACK") : "PROCEDURAL");

  const ladder = (
    <div className="card-glass w-full max-w-2xl rounded-2xl px-5 py-3 fade-up" style={{ animationDelay: "0.45s" }}>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="font-bold tracking-[0.3em] text-white/70 text-[11px]">COLOSSEUM LADDER · 30 DAYS</div>
        <div className="text-[10px] tracking-[0.2em] text-white/40">
          {board ? `${board.totalMatches} MATCHES · ${board.skinnedMatches} SKINNED` : "LOADING…"}
        </div>
      </div>
      {board && !board.empty ? (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {board.ladder.slice(0, 6).map((r, i) => (
            <div key={r.id} className="flex items-center gap-2 text-xs">
              <span className="w-4 text-white/35">{i + 1}</span>
              <span className="text-base leading-none">{r.icon}</span>
              <span className="font-semibold" style={{ color: r.color }}>
                {r.name}
              </span>
              <span className="ml-auto tabular-nums text-white/70">
                {r.wins}W · {r.losses}L
              </span>
              <span className="w-10 text-right tabular-nums text-white/45">{r.winRate}%</span>
              {r.perfects > 0 && <span className="text-amber-300/80">★{r.perfects}</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-white/45">
          {board?.empty ? "No recorded matches yet — win one and the ladder populates from PostgreSQL." : "Fetching ladder…"}
        </div>
      )}
    </div>
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <canvas key={gameKey} ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {loading && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/70">
          <div className="text-center">
            <div className="font-display text-3xl tracking-wider text-amber-300 text-stroke-thin animate-pulse">{loading}</div>
            <div className="mt-2 text-[10px] tracking-[0.3em] text-white/45">PARSING GLB · MESHOPT · WEBP</div>
          </div>
        </div>
      )}

      {screen === "title" && (
        <TitleScreen
          onStart={(m) => {
            setSetup((s) => ({ ...s, mode: m }));
            setScreen("select");
          }}
          onSettings={openSettings}
          extra={ladder}
        />
      )}
      {screen === "select" && <SelectScreen setup={setup} onChange={setSetup} onFight={() => setScreen("fight")} onBack={() => setScreen("title")} />}

      {screen === "fight" && hud && <HUD hud={hud} onResume={resume} onQuit={quit} onRematch={rematch} onReselect={reselect} onSettings={openSettings} showControls={!isTouch} />}

      {settingsOpen && <SettingsScreen onClose={() => setSettingsOpen(false)} />}
      {screen === "fight" && isTouch && hud && !hud.paused && hud.phase !== "matchEnd" && <TouchControls />}

      {screen === "fight" && hud && !hud.paused && hud.phase !== "matchEnd" && (
        <button
          onClick={() => gameRef.current?.setPaused(true)}
          className="pointer-events-auto absolute left-1/2 top-[74px] -translate-x-1/2 rounded-full border border-white/15 bg-black/40 px-3 py-1 text-[10px] font-bold tracking-[0.3em] text-white/60 hover:bg-black/60 sm:top-[86px]"
        >
          PAUSE
        </button>
      )}

      {/* rig path readout: which presentation is actually running */}
      <div className="pointer-events-none absolute bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] tracking-[0.22em] text-white/30">
        {skinnedTag(setup.p1)} · {setup.p1.toUpperCase()} vs {setup.p2.toUpperCase()} · {skinnedTag(setup.p2)} · {setup.arena.toUpperCase()}
        {assets.missing.length > 0 ? ` · MISSING ${assets.missing.length}` : ""}
      </div>
    </div>
  );
}
