import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Game, GameMode, HUDState } from "./game/Game";
import { HUD } from "./components/HUD";
import { SelectScreen, Setup, TitleScreen } from "./components/Menu";
import { TouchControls } from "./components/TouchControls";
import { SettingsScreen } from "./components/SettingsScreen";
import { audio } from "./game/audio/AudioEngine";
import { AssetStatus, clearAssetCache, prepareMatch, subscribeAssets } from "./game/skinned/assets";

type Screen = "title" | "select" | "fight";

const DEFAULT_SETUP: Setup = {
  mode: "cpu",
  p1: "chicken",
  p2: "buffalo",
  arena: "wasteland",
  difficulty: "normal",
  roundsToWin: 2,
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("title");
  const [setup, setSetup] = useState<Setup>(DEFAULT_SETUP);
  const [hud, setHud] = useState<HUDState | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetStatus[]>([]);
  const [assetRetry, setAssetRetry] = useState(0);
  const gameRef = useRef<Game | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Asset progress for the loading HUD (fighter GLBs and the Kyoto stage props).
  useEffect(() => {
    const unsubscribe = subscribeAssets(setAssets);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setIsTouch(mq.matches);
    const h = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  // Audio: unlock the context on the first gesture; delegated UI click/hover sounds via data-sfx.
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
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    setLoadError(null);
    // load everything this match needs (fighters + stage props) behind an explicit readiness gate
    prepareMatch([setup.p1, setup.p2], setup.arena)
      .then((prepared) => {
        if (cancelled) return;
        if (prepared.missing.length) {
          // report but do not hide: the stage falls back to procedural props, a missing fighter is fatal
          console.warn("[assets] missing:", prepared.missing.join("; "));
        }
        const game = new Game(canvas, {
          mode,
          p1: setup.p1,
          p2: setup.p2,
          arena: setup.arena,
          difficulty: setup.difficulty,
          roundsToWin: setup.roundsToWin,
          onState: setHud,
          assets: prepared,
        });
        gameRef.current = game;
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
      gameRef.current?.dispose();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameKey, assetRetry]);

  const quit = useCallback(() => {
    setHud(null);
    setScreen("title");
  }, []);
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

  const loadingRow = assets.filter((a) => a.phase !== "idle");

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <canvas key={gameKey} ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {loadingRow && !loadError && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-50 -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-white/80">
          {loadingRow.map((a) => (
            <span key={a.key} className="mx-2">
              {a.label}
              <span className={a.phase === "error" ? " text-red-300" : " text-emerald-300"}>
                {" "}
                {a.phase === "error" ? "failed" : `${Math.max(1, Math.round(a.bytes / 1024))} kB`}
              </span>
            </span>
          ))}
        </div>
      )}
      {loadError && (
        <div className="absolute left-1/2 top-1/2 z-50 w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-red-500/30 bg-red-950/95 p-4 text-sm text-white shadow-xl">
          <div className="mb-1 font-bold tracking-wide">Fighter asset failed to load</div>
          <div className="mb-3 text-red-100/90">{loadError}</div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                // the cache drops failed promises, so this really retries the request
                clearAssetCache();
                setAssetRetry((n) => n + 1);
              }}
              className="rounded bg-white/90 px-3 py-1 text-xs font-bold text-red-950 hover:bg-white"
            >
              RETRY
            </button>
            <button onClick={quit} className="rounded border border-white/25 px-3 py-1 text-xs font-bold text-white/90 hover:bg-white/10">
              BACK TO TITLE
            </button>
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
    </div>
  );
}
