import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

/* ==========================================================================
   Snake — a built-in game

   Nothing here is fetched: the whole game is this canvas and a timer, so it
   plays with the network off and answers to arrow keys or WASD. The high
   score lives in this profile's local storage, like an arcade cabinet's.
   ========================================================================== */

const CELL = 22;
const COLS = 20;
const ROWS = 20;
const WIDTH = CELL * COLS;
const HEIGHT = CELL * ROWS;

type Point = { x: number; y: number };

const DIRS: Record<string, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const KEY_DIRS: Record<string, keyof typeof DIRS> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
};

function highScoreKey() {
  return "crescent.builtin.snake.high";
}

function readHigh(): number {
  try {
    return Number(localStorage.getItem(highScoreKey()) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function freshFood(snake: Point[]): Point {
  const taken = new Set(snake.map((part) => `${part.x},${part.y}`));
  const open: Point[] = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (!taken.has(`${x},${y}`)) open.push({ x, y });
    }
  }
  return open[Math.floor(Math.random() * open.length)] ?? { x: 10, y: 10 };
}

export function BuiltinSnake() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snakeRef = useRef<Point[]>([
    { x: 8, y: 10 },
    { x: 7, y: 10 },
    { x: 6, y: 10 },
  ]);
  const dirRef = useRef<Point>(DIRS.right);
  const queuedRef = useRef<Point[]>([]);
  const foodRef = useRef<Point>({ x: 14, y: 10 });
  const aliveRef = useRef(true);
  const scoreRef = useRef(0);
  const [score, setScore] = useState(0);
  const [high, setHigh] = useState(() => readHigh());
  const [alive, setAlive] = useState(true);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue("--accent-primary").trim() || "#4d8dff";
    const surface = styles.getPropertyValue("--surface-2").trim() || "#1b2130";
    const text = styles.getPropertyValue("--text-primary").trim() || "#e8ecf5";

    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Food.
    const food = foodRef.current;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(
      food.x * CELL + CELL / 2,
      food.y * CELL + CELL / 2,
      CELL / 2 - 4,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Snake.
    const snake = snakeRef.current;
    snake.forEach((part, index) => {
      const head = index === 0;
      ctx.fillStyle = head ? text : accent;
      const inset = head ? 2 : 3;
      const radius = head ? 6 : 4;
      const x = part.x * CELL + inset;
      const y = part.y * CELL + inset;
      const size = CELL - inset * 2;
      ctx.beginPath();
      ctx.roundRect(x, y, size, size, radius);
      ctx.fill();
    });

    if (!aliveRef.current) {
      ctx.fillStyle = "rgba(8, 10, 16, 0.72)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = text;
      ctx.font = "600 22px var(--font-ui, system-ui), system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Game over", WIDTH / 2, HEIGHT / 2 - 8);
      ctx.font = "13px var(--font-ui, system-ui), system-ui";
      ctx.fillText("Press Space or Restart to play again", WIDTH / 2, HEIGHT / 2 + 18);
    }
  }, []);

  const restart = useCallback(() => {
    snakeRef.current = [
      { x: 8, y: 10 },
      { x: 7, y: 10 },
      { x: 6, y: 10 },
    ];
    dirRef.current = DIRS.right;
    queuedRef.current = [];
    foodRef.current = freshFood(snakeRef.current);
    aliveRef.current = true;
    scoreRef.current = 0;
    setAlive(true);
    setScore(0);
    draw();
  }, [draw]);

  // Keyboard: arrows or WASD, with the queue absorbing fast taps so a quick
  // Up-Left cannot reverse the snake into itself within one tick.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === " " || key === "Enter") {
        if (!aliveRef.current) {
          event.preventDefault();
          restart();
        }
        return;
      }
      const name = KEY_DIRS[key];
      if (!name) return;
      event.preventDefault();
      const last = queuedRef.current[queuedRef.current.length - 1] ?? dirRef.current;
      const next = DIRS[name];
      if (next.x === -last.x && next.y === -last.y) return;
      if (next.x === last.x && next.y === last.y) return;
      if (queuedRef.current.length < 2) queuedRef.current.push(next);
    };
    window.addEventListener("keydown", onKey, { passive: false });
    return () => window.removeEventListener("keydown", onKey);
  }, [restart]);

  // The tick and the redraw share one interval: at these sizes a repaint per
  // step is indistinguishable from rAF and costs a fraction of the work.
  useEffect(() => {
    let interval: number | undefined;
    const step = () => {
      if (!aliveRef.current) {
        draw();
        return;
      }
      const queued = queuedRef.current.shift();
      if (queued) dirRef.current = queued;

      const snake = snakeRef.current;
      const head = snake[0];
      const next = { x: head.x + dirRef.current.x, y: head.y + dirRef.current.y };

      const hitWall = next.x < 0 || next.y < 0 || next.x >= COLS || next.y >= ROWS;
      const hitSelf = snake.some((part, index) => index < snake.length - 1 && part.x === next.x && part.y === next.y);
      if (hitWall || hitSelf) {
        aliveRef.current = false;
        setAlive(false);
        try {
          if (scoreRef.current > readHigh()) {
            localStorage.setItem(highScoreKey(), String(scoreRef.current));
          }
        } catch {
          /* storage unavailable — the session score still stands */
        }
        setHigh((previous) => Math.max(previous, scoreRef.current));
        draw();
        return;
      }

      snake.unshift(next);
      const food = foodRef.current;
      if (next.x === food.x && next.y === food.y) {
        foodRef.current = freshFood(snake);
        scoreRef.current += 1;
        setScore(scoreRef.current);
      } else {
        snake.pop();
      }

      const speed = Math.max(70, 160 - snake.length * 3);
      if (interval) window.clearInterval(interval);
      interval = window.setInterval(step, speed);
      draw();
    };

    interval = window.setInterval(step, 160);
    draw();
    return () => {
      if (interval) window.clearInterval(interval);
    };
  }, [draw]);

  useEffect(() => {
    draw();
  }, [alive, draw]);

  return (
    <div className="cr-builtin">
      <div className="cr-builtin__hud">
        <span>
          Score <strong>{score}</strong>
        </span>
        <span>
          Best <strong>{Math.max(high, score)}</strong>
        </span>
        {!alive && (
          <Button size="sm" variant="primary" icon="refresh" onClick={restart}>
            Restart
          </Button>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className="cr-builtin__canvas"
        width={WIDTH}
        height={HEIGHT}
        aria-label="Snake board. Arrow keys or WASD steer; Space restarts after a game over."
      />
      <p className="cr-builtin__hint">Arrow keys or WASD to steer · Space to restart</p>
    </div>
  );
}

export default BuiltinSnake;
