export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  light: boolean;
  heavy: boolean;
  special: boolean;
  /** edge-triggered (true only on the frame the key went down) */
  jUp: boolean;
  jLight: boolean;
  jHeavy: boolean;
  jSpecial: boolean;
}

export const emptyInput = (): InputState => ({
  left: false,
  right: false,
  up: false,
  down: false,
  light: false,
  heavy: false,
  special: false,
  jUp: false,
  jLight: false,
  jHeavy: false,
  jSpecial: false,
});

type Action = "left" | "right" | "up" | "down" | "light" | "heavy" | "special";

export const P1_KEYS: Record<string, Action> = {
  KeyA: "left",
  KeyD: "right",
  KeyW: "up",
  KeyS: "down",
  KeyJ: "light",
  KeyK: "heavy",
  KeyL: "special",
  KeyU: "light",
  KeyI: "heavy",
  KeyO: "special",
};

export const P2_KEYS: Record<string, Action> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Numpad1: "light",
  Numpad2: "heavy",
  Numpad3: "special",
  Comma: "light",
  Period: "heavy",
  Slash: "special",
};

/** Shared channel written by on-screen touch controls (player 1). */
export const touchInput: Record<Action, boolean> = {
  left: false,
  right: false,
  up: false,
  down: false,
  light: false,
  heavy: false,
  special: false,
};

class PlayerInput {
  held: Record<Action, boolean> = { left: false, right: false, up: false, down: false, light: false, heavy: false, special: false };
  private prev: Record<Action, boolean> = { ...this.held };
  state: InputState = emptyInput();

  constructor(
    private map: Record<string, Action>,
    private useTouch: boolean,
  ) {}

  keyDown(code: string) {
    const a = this.map[code];
    if (a) this.held[a] = true;
    return !!a;
  }
  keyUp(code: string) {
    const a = this.map[code];
    if (a) this.held[a] = false;
  }
  clear() {
    for (const k in this.held) this.held[k as Action] = false;
  }

  /** Build the per-frame state (with edge detection). */
  sample(): InputState {
    const cur: Record<Action, boolean> = { ...this.held };
    if (this.useTouch) {
      for (const k in touchInput) cur[k as Action] = cur[k as Action] || touchInput[k as Action];
    }
    const s = this.state;
    s.left = cur.left;
    s.right = cur.right;
    s.up = cur.up;
    s.down = cur.down;
    s.light = cur.light;
    s.heavy = cur.heavy;
    s.special = cur.special;
    s.jUp = cur.up && !this.prev.up;
    s.jLight = cur.light && !this.prev.light;
    s.jHeavy = cur.heavy && !this.prev.heavy;
    s.jSpecial = cur.special && !this.prev.special;
    this.prev = cur;
    return s;
  }
}

export class InputManager {
  p1 = new PlayerInput(P1_KEYS, true);
  p2 = new PlayerInput(P2_KEYS, false);
  private pauseHandlers: (() => void)[] = [];
  private anyKeyHandlers: (() => void)[] = [];

  private onDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === "Escape") {
      this.pauseHandlers.forEach((h) => h());
      return;
    }
    const a = this.p1.keyDown(e.code);
    const b = this.p2.keyDown(e.code);
    if (a || b) e.preventDefault();
    this.anyKeyHandlers.forEach((h) => h());
  };
  private onUp = (e: KeyboardEvent) => {
    this.p1.keyUp(e.code);
    this.p2.keyUp(e.code);
  };
  private onBlur = () => {
    this.p1.clear();
    this.p2.clear();
  };

  attach() {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
    window.addEventListener("blur", this.onBlur);
  }
  detach() {
    window.removeEventListener("keydown", this.onDown);
    window.removeEventListener("keyup", this.onUp);
    window.removeEventListener("blur", this.onBlur);
  }
  onPause(h: () => void) {
    this.pauseHandlers.push(h);
  }
  onAnyKey(h: () => void) {
    this.anyKeyHandlers.push(h);
  }
}
