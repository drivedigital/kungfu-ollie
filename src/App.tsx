import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Game, GameMode, HUDState } from "./game/Game";
import { HUD } from "./components/HUD";
import { SelectScreen, Setup, TitleScreen } from "./components/Menu";
import { TouchControls } from "./components/TouchControls";
import { SettingsScreen } from "./components/SettingsScreen";
import { audio } from "./game/audio/AudioEngine";
import { prepareAssets } from "./game/skinned/assets";

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
  const gameRef = useRef<Game | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
    // Preload all required skinned fighter GLBs + stage props before constructing the match
    prepareAssets([setup.p1, setup.p2], setup.arena)
      .then((assets) => {
        if (cancelled) return;
        if (assets.missing.length) console.warn("[app] missing assets:", assets.missing);
        const game = new Game(canvas, {
          mode,
          p1: setup.p1,
          p2: setup.p2,
          arena: setup.arena,
          difficulty: setup.difficulty,
          roundsToWin: setup.roundsToWin,
          onState: setHud,
          assets,
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
  }, [gameKey]);

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

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <canvas key={gameKey} ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {loadError && <div className="absolute left-4 top-4 z-50 rounded bg-red-950/90 p-3 text-sm text-white">Could not load fighter: {loadError}</div>}

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
