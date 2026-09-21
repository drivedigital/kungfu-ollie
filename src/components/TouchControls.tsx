import { touchInput } from "../game/Input";
import { cn } from "../utils/cn";

type Action = keyof typeof touchInput;

function Btn({ action, label, className }: { action: Action; label: string; className?: string }) {
  const press = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    touchInput[action] = true;
  };
  const release = () => {
    touchInput[action] = false;
  };
  return (
    <button
      data-sfx="none"
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        "touch-btn pointer-events-auto flex items-center justify-center rounded-full border-2 border-white/30 bg-black/40 font-display text-2xl text-white/90 backdrop-blur-sm active:bg-white/30",
        className,
      )}
    >
      {label}
    </button>
  );
}

export function TouchControls() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {/* movement cluster */}
      <div className="absolute bottom-24 left-4 grid grid-cols-3 gap-1.5">
        <div />
        <Btn action="up" label="▲" className="h-14 w-14" />
        <div />
        <Btn action="left" label="◀" className="h-14 w-14" />
        <Btn action="down" label="▼" className="h-14 w-14" />
        <Btn action="right" label="▶" className="h-14 w-14" />
      </div>
      {/* attack cluster */}
      <div className="absolute bottom-24 right-4 flex items-end gap-2">
        <Btn action="light" label="L" className="h-14 w-14 border-cyan-300/60 text-cyan-200" />
        <Btn action="heavy" label="H" className="h-16 w-16 border-amber-300/60 text-amber-200" />
        <Btn action="special" label="S" className="h-14 w-14 border-yellow-200/70 text-yellow-100" />
      </div>
    </div>
  );
}
