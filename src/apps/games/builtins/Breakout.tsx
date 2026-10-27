import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

/* ==========================================================================
   Breakout — a built-in game

   Paddle follows the pointer or the arrow keys; clearing a board serves the
   next a little faster. Lives, level and score are real state, and the high
   score persists with the profile like Snake's does.
   ========================================================================== */

const WIDTH = 460;
const HEIGHT = 540;
const PADDLE_W = 84;
const PADDLE_H = 12;
const PADDLE_Y = HEIGHT - 34;
const BALL_R = 6;
const BRICK_COLS = 7;
const BRICK_ROWS = 4;
const BRICK_W = WIDTH / BRICK_COLS;
const BRICK_H = 20;

type Ball = { x: number; y: number; vx: number; vy: number };

function highScoreKey() {
  return "crescent.builtin.breakout.high";
}

function readHigh(): number {
  try {
    return Number(localStorage.getItem(highScoreKey()) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function serve(level: number): Ball {
  const speed = 3.4 + (level - 1) * 0.6;
  const angle = (-Math.PI / 4 + Math.random() * -Math.PI / 4) * (Math.random() < 0.5 ? 1 : -1);
  return {
    x: WIDTH / 2,
    y: HEIGHT / 2 + 40,
    vx: Math.cos(angle) * speed,
    vy: Math.abs(Math.sin(angle) * speed),
  };
}

export function BuiltinBreakout() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paddleRef = useRef({ x: WIDTH / 2 - PADDLE_W / 2 });
  const ballRef = useRef<Ball>(serve(1));
  const bricksRef = useRef<boolean[][]>([]);
  const levelRef = useRef(1);
  const livesRef = useRef(3);
  const scoreRef = useRef(0);
  const [score, setScore] = useState(0);
  const [high, setHigh] = useState(() => readHigh());
  const [lives, setLives] = useState(3);
  const [level, setLevel] = useState(1);
  const [over, setOver] = useState(false);

  const resetBricks = useCallback((levelIndex: number) => {
    bricksRef.current = Array.from({ length: BRICK_ROWS }, (_, row) =>
      Array.from({ length: BRICK_COLS }, () => row < Math.min(BRICK_ROWS, 2 + levelIndex)),
    );
  }, []);

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue("--accent-primary").trim() || "#4d8dff";
    const surface = styles.getPropertyValue("--surface-2").trim() || "#1b2130";
    const text = styles.getPropertyValue("--text-primary").trim() || "#e8ecf5";
    const muted = styles.getPropertyValue("--text-muted").trim() || "#8a93a6";

    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    bricksRef.current.forEach((row, rowIndex) =>
      row.forEach((aliveBrick, colIndex) => {
        if (!aliveBrick) return;
        ctx.fillStyle = accent;
        ctx.globalAlpha = 1 - rowIndex * 0.16;
        ctx.beginPath();
        ctx.roundRect(
          colIndex * BRICK_W + 3,
          rowIndex * BRICK_H + 34,
          BRICK_W - 6,
          BRICK_H - 6,
          4,
        );
        ctx.fill();
        ctx.globalAlpha = 1;
      }),
    );

    ctx.fillStyle = text;
    ctx.beginPath();
    ctx.roundRect(paddleRef.current.x, PADDLE_Y, PADDLE_W, PADDLE_H, 6);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(ballRef.current.x, ballRef.current.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = muted;
    ctx.font = "12px var(--font-ui, system-ui), system-ui";
    ctx.textAlign = "left";
    ctx.fillText(`Level ${levelRef.current}`, 12, 20);
    ctx.textAlign = "right";
    ctx.fillText(`Lives ${livesRef.current}`, WIDTH - 12, 20);

    if (over) {
      ctx.fillStyle = "rgba(8, 10, 16, 0.72)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = text;
      ctx.textAlign = "center";
      ctx.font = "600 22px var(--font-ui, system-ui), system-ui";
      ctx.fillText("Game over", WIDTH / 2, HEIGHT / 2 - 8);
      ctx.font = "13px var(--font-ui, system-ui), system-ui";
      ctx.fillText("Press Space or Restart to try again", WIDTH / 2, HEIGHT / 2 + 18);
    }
  }, [over]);

  const restart = useCallback(() => {
    levelRef.current = 1;
    livesRef.current = 3;
    ballRef.current = serve(1);
    resetBricks(1);
    paddleRef.current.x = WIDTH / 2 - PADDLE_W / 2;
    scoreRef.current = 0;
    setScore(0);
    setLives(3);
    setLevel(1);
    setOver(false);
    draw();
  }, [draw, resetBricks]);

  // Pointer and keyboard both steer the paddle; keys are held-tracked so a
  // held arrow keeps moving after the first press.
  useEffect(() => {
    const held = new Set<string>();
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key === " " || event.key === "Enter") && over) {
        event.preventDefault();
        restart();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "a") {
        event.preventDefault();
        held.add("left");
      }
      if (event.key === "ArrowRight" || event.key === "d") {
        event.preventDefault();
        held.add("right");
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "a") held.delete("left");
      if (event.key === "ArrowRight" || event.key === "d") held.delete("right");
    };
    const onMove = (event: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return;
      const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
      paddleRef.current.x = Math.max(0, Math.min(WIDTH - PADDLE_W, x - PADDLE_W / 2));
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointermove", onMove);

    let raf = 0;
    const tick = () => {
      const step = () => {
        if (held.has("left")) paddleRef.current.x = Math.max(0, paddleRef.current.x - 9);
        if (held.has("right")) paddleRef.current.x = Math.min(WIDTH - PADDLE_W, paddleRef.current.x + 9);
        if (over) return;

        const ball = ballRef.current;
        ball.x += ball.vx;
        ball.y += ball.vy;
        if (ball.x < BALL_R || ball.x > WIDTH - BALL_R) ball.vx *= -1;
        if (ball.y < BALL_R + 28) ball.vy = Math.abs(ball.vy);

        // Paddle bounce, angled by where the ball lands on it.
        if (
          ball.vy > 0 &&
          ball.y + BALL_R >= PADDLE_Y &&
          ball.y + BALL_R <= PADDLE_Y + PADDLE_H + 8 &&
          ball.x >= paddleRef.current.x - BALL_R &&
          ball.x <= paddleRef.current.x + PADDLE_W + BALL_R
        ) {
          const offset = (ball.x - (paddleRef.current.x + PADDLE_W / 2)) / (PADDLE_W / 2);
          const speed = Math.hypot(ball.vx, ball.vy);
          const angle = (offset * Math.PI) / 3.2;
          ball.vx = Math.sin(angle) * speed;
          ball.vy = -Math.abs(Math.cos(angle) * speed);
        }

        // Bricks.
        const bricks = bricksRef.current;
        for (let row = 0; row < bricks.length; row += 1) {
          for (let col = 0; col < BRICK_COLS; col += 1) {
            if (!bricks[row][col]) continue;
            const bx = col * BRICK_W;
            const by = row * BRICK_H + 34;
            if (ball.x > bx && ball.x < bx + BRICK_W && ball.y > by - BALL_R && ball.y < by + BRICK_H + BALL_R) {
              bricks[row][col] = false;
              ball.vy *= -1;
              scoreRef.current += 10;
              setScore(scoreRef.current);
              const cleared = bricks.every((r) => r.every((brick) => !brick));
              if (cleared) {
                levelRef.current += 1;
                setLevel(levelRef.current);
                resetBricks(Math.min(3, levelRef.current - 1));
                ballRef.current = serve(levelRef.current);
              }
              return;
            }
          }
        }

        // Missed: a life gone, or the run is over.
        if (ball.y > HEIGHT + BALL_R) {
          livesRef.current -= 1;
          setLives(livesRef.current);
          if (livesRef.current <= 0) {
            setOver(true);
            try {
              if (scoreRef.current > readHigh()) {
                localStorage.setItem(highScoreKey(), String(scoreRef.current));
              }
            } catch {
              /* storage unavailable — the session score still stands */
            }
            setHigh((previous) => Math.max(previous, scoreRef.current));
          } else {
            ballRef.current = serve(levelRef.current);
          }
        }
      };

      let last = performance.now();
      const loop = (now: number) => {
        // Fixed-ish cadence regardless of refresh rate.
        if (now - last >= 1000 / 90) {
          step();
          last = now;
        }
        draw();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(() => tick());
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [draw, over, restart, resetBricks]);

  useEffect(() => {
    resetBricks(1);
    draw();
  }, [draw, resetBricks]);

  return (
    <div className="cr-builtin">
      <div className="cr-builtin__hud">
        <span>
          Score <strong>{score}</strong>
        </span>
        <span>
          Level <strong>{level}</strong>
        </span>
        <span>
          Lives <strong>{lives}</strong>
        </span>
        <span>
          Best <strong>{Math.max(high, score)}</strong>
        </span>
        {over && (
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
        aria-label="Breakout board. Move the paddle with the pointer or arrow keys; Space restarts after a game over."
      />
      <p className="cr-builtin__hint">Pointer or ← → to move the paddle · Space to restart</p>
    </div>
  );
}

export default BuiltinBreakout;
