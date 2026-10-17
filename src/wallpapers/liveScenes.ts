import type { LiveSceneId } from "@/types";

/* ==========================================================================
   Live wallpaper scenes

   These are procedural canvas drawings, not video files. Everything is
   deliberately slow and low-contrast: a live wallpaper should read as a
   surface behind the desktop, never as a thing to watch. Each renderer is a
   pure function of (context, size, elapsedSeconds) so the frame can be drawn
   once for reduced-motion users and still look composed.
   ========================================================================== */

export interface SceneContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** Seconds since the scene started. */
  t: number;
  /** Pointer offset in the range -1..1, when interaction is enabled. */
  pointerX: number;
  pointerY: number;
}

type SceneRenderer = (scene: SceneContext) => void;

function clear(ctx: CanvasRenderingContext2D, width: number, height: number, top: string, bottom: string) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

const aurora: SceneRenderer = ({ ctx, width, height, t, pointerX }) => {
  clear(ctx, width, height, "#0b1220", "#07090d");

  const bands = [
    { hue: "84, 190, 160", y: 0.28, speed: 0.021, alpha: 0.1 },
    { hue: "90, 140, 220", y: 0.42, speed: 0.014, alpha: 0.09 },
    { hue: "140, 110, 200", y: 0.58, speed: 0.009, alpha: 0.07 },
  ];

  for (const band of bands) {
    const drift = Math.sin(t * band.speed) * width * 0.06 + pointerX * width * 0.02;
    const y = height * band.y + Math.sin(t * band.speed * 0.7) * height * 0.02;
    const gradient = ctx.createRadialGradient(
      width * 0.5 + drift,
      y,
      0,
      width * 0.5 + drift,
      y,
      Math.max(width, height) * 0.55,
    );
    gradient.addColorStop(0, `rgba(${band.hue}, ${band.alpha})`);
    gradient.addColorStop(0.55, `rgba(${band.hue}, ${band.alpha * 0.35})`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
};

const drift: SceneRenderer = ({ ctx, width, height, t, pointerX, pointerY }) => {
  clear(ctx, width, height, "#12161d", "#080a0d");

  const blobs = [
    { x: 0.24, y: 0.32, r: 0.46, color: "38, 52, 74", speed: 0.016, alpha: 0.5 },
    { x: 0.72, y: 0.28, r: 0.4, color: "28, 46, 58", speed: 0.011, alpha: 0.42 },
    { x: 0.58, y: 0.76, r: 0.52, color: "24, 30, 44", speed: 0.008, alpha: 0.46 },
    { x: 0.16, y: 0.82, r: 0.34, color: "34, 40, 52", speed: 0.013, alpha: 0.36 },
  ];

  for (const blob of blobs) {
    const cx = width * blob.x + Math.sin(t * blob.speed) * width * 0.05 + pointerX * width * 0.01;
    const cy = height * blob.y + Math.cos(t * blob.speed * 0.8) * height * 0.04 + pointerY * height * 0.01;
    const radius = Math.max(width, height) * blob.r;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, `rgba(${blob.color}, ${blob.alpha})`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
};

const mesh: SceneRenderer = ({ ctx, width, height, t, pointerX }) => {
  clear(ctx, width, height, "#0d1219", "#080a0d");

  const spacing = Math.max(56, Math.round(width / 22));
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(150, 185, 225, 0.05)";

  const wobble = (x: number, y: number) =>
    Math.sin((x / width) * 3.1 + t * 0.05) * 6 + Math.cos((y / height) * 2.6 + t * 0.04) * 5;

  ctx.beginPath();
  for (let x = -spacing; x <= width + spacing; x += spacing) {
    for (let y = -spacing; y <= height + spacing; y += spacing) {
      const px = x + wobble(x, y) + pointerX * 6;
      const py = y + wobble(y, x);
      ctx.moveTo(px, py);
      ctx.lineTo(px + spacing, py);
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + spacing);
    }
  }
  ctx.stroke();

  const glow = ctx.createRadialGradient(
    width * 0.5 + pointerX * 40,
    height * 0.42,
    0,
    width * 0.5 + pointerX * 40,
    height * 0.42,
    Math.max(width, height) * 0.6,
  );
  glow.addColorStop(0, "rgba(70, 120, 180, 0.08)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
};

const starfield: SceneRenderer = ({ ctx, width, height, t, pointerX, pointerY }) => {
  clear(ctx, width, height, "#080a10", "#05060a");

  // Deterministic star placement so the field is stable between frames.
  let seed = 20261;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const count = Math.min(320, Math.round((width * height) / 9000));
  for (let i = 0; i < count; i += 1) {
    const baseX = random();
    const baseY = random();
    const depth = 0.35 + random() * 0.65;
    const twinkle = 0.55 + Math.sin(t * (0.2 + depth * 0.35) + i) * 0.35;
    const x = baseX * width + pointerX * 14 * depth;
    const y = baseY * height + pointerY * 10 * depth;
    const size = depth * 1.5;
    ctx.fillStyle = `rgba(214, 226, 245, ${(twinkle * depth * 0.7).toFixed(3)})`;
    ctx.fillRect(x, y, size, size);
  }

  const nebulaGradient = ctx.createRadialGradient(
    width * 0.66,
    height * 0.3,
    0,
    width * 0.66,
    height * 0.3,
    Math.max(width, height) * 0.5,
  );
  nebulaGradient.addColorStop(0, "rgba(58, 42, 96, 0.16)");
  nebulaGradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = nebulaGradient;
  ctx.fillRect(0, 0, width, height);
};

const waves: SceneRenderer = ({ ctx, width, height, t, pointerX }) => {
  clear(ctx, width, height, "#0a1018", "#07090c");

  const layers = [
    { y: 0.52, amp: 22, speed: 0.03, color: "rgba(24, 40, 58, 0.6)", offset: 0 },
    { y: 0.64, amp: 30, speed: 0.021, color: "rgba(18, 32, 48, 0.72)", offset: 1.7 },
    { y: 0.78, amp: 18, speed: 0.015, color: "rgba(12, 22, 34, 0.86)", offset: 3.1 },
  ];

  for (const layer of layers) {
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 12) {
      const phase = (x / width) * Math.PI * 2;
      const y =
        height * layer.y +
        Math.sin(phase * 1.6 + t * layer.speed * 2 + layer.offset) * layer.amp +
        Math.sin(phase * 3.4 + t * layer.speed + layer.offset) * layer.amp * 0.35;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = layer.color;
    ctx.fill();
  }

  const haze = ctx.createLinearGradient(0, height * 0.3, 0, height);
  haze.addColorStop(0, "rgba(40, 70, 110, 0.1)");
  haze.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0 + pointerX * 8, height * 0.3, width, height * 0.7);
};

const rainfall: SceneRenderer = ({ ctx, width, height, t, pointerX, pointerY }) => {
  clear(ctx, width, height, "#0a0e14", "#07090c");

  // Deterministic columns so the streaks are stable between frames.
  let seed = 8851;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const columns = Math.max(18, Math.round(width / 42));
  ctx.lineCap = "round";
  for (let i = 0; i < columns; i += 1) {
    const x = (i + 0.5) * (width / columns) + pointerX * 6;
    const speed = 90 + random() * 150;
    const offset = random() * height;
    const length = 40 + random() * 90;
    const y = ((t * speed + offset) % (height + 160)) - 80 + pointerY * 4;
    const gradient = ctx.createLinearGradient(x, y, x, y + length);
    gradient.addColorStop(0, "rgba(150, 190, 230, 0)");
    gradient.addColorStop(1, "rgba(170, 205, 240, 0.14)");
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + length);
    ctx.stroke();
  }

  const glow = ctx.createRadialGradient(width * 0.5, height * 0.1, 0, width * 0.5, height * 0.1, height * 0.9);
  glow.addColorStop(0, "rgba(50, 80, 120, 0.1)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
};

const ember: SceneRenderer = ({ ctx, width, height, t, pointerX, pointerY }) => {
  clear(ctx, width, height, "#150d0a", "#08060a");

  let seed = 4211;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const count = Math.min(160, Math.round((width * height) / 16000));
  for (let i = 0; i < count; i += 1) {
    const baseX = random();
    const depth = 0.35 + random() * 0.65;
    const speed = 12 + depth * 34;
    const rise = (t * speed + random() * height) % (height + 80);
    const y = height + 40 - rise + pointerY * 8 * depth;
    const x = baseX * width + Math.sin(t * 0.4 + i) * 14 * depth + pointerX * 12 * depth;
    const size = depth * 2.4;
    const alpha = (0.1 + depth * 0.32) * (1 - rise / (height + 80));
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, size * 4);
    gradient.addColorStop(0, `rgba(255, 176, 96, ${Math.max(0, alpha).toFixed(3)})`);
    gradient.addColorStop(1, "rgba(255, 140, 60, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, size * 4, 0, Math.PI * 2);
    ctx.fill();
  }

  const warm = ctx.createLinearGradient(0, height, 0, height * 0.4);
  warm.addColorStop(0, "rgba(120, 52, 24, 0.16)");
  warm.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = warm;
  ctx.fillRect(0, height * 0.4, width, height * 0.6);
};

const snowfall: SceneRenderer = ({ ctx, width, height, t, pointerX, pointerY }) => {
  clear(ctx, width, height, "#0d1119", "#07090c");

  // Deterministic flakes so the drift is stable between frames.
  let seed = 7331;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const count = Math.min(180, Math.round((width * height) / 14000));
  for (let i = 0; i < count; i += 1) {
    const baseX = random();
    const depth = 0.3 + random() * 0.7;
    const speed = 16 + depth * 26;
    const travel = (t * speed + random() * height) % (height + 60);
    const y = travel - 30 + pointerY * 6 * depth;
    const x = baseX * width + Math.sin(t * 0.28 + i * 0.7) * 22 * depth + pointerX * 10 * depth;
    // Fade the flake in near the top and out near the bottom so the loop
    // never shows a hard edge.
    const fade = Math.sin((travel / (height + 60)) * Math.PI);
    const alpha = (0.12 + depth * 0.34) * fade;
    ctx.fillStyle = `rgba(226, 236, 250, ${Math.max(0, alpha).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, 1 + depth * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  const cold = ctx.createLinearGradient(0, 0, 0, height);
  cold.addColorStop(0, "rgba(90, 120, 170, 0.12)");
  cold.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = cold;
  ctx.fillRect(0, 0, width, height);
};

const dunes: SceneRenderer = ({ ctx, width, height, t, pointerX }) => {
  clear(ctx, width, height, "#1a140e", "#080605");

  const ridges = [
    { y: 0.46, amp: 34, speed: 0.012, color: "rgba(58, 40, 26, 0.55)", offset: 0 },
    { y: 0.6, amp: 44, speed: 0.009, color: "rgba(44, 30, 20, 0.7)", offset: 2.2 },
    { y: 0.76, amp: 28, speed: 0.006, color: "rgba(30, 21, 14, 0.85)", offset: 4.4 },
  ];

  for (const ridge of ridges) {
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 14) {
      const phase = (x / width) * Math.PI * 2;
      const y =
        height * ridge.y +
        Math.sin(phase * 1.1 + t * ridge.speed + ridge.offset) * ridge.amp +
        Math.sin(phase * 2.3 + t * ridge.speed * 0.6 + ridge.offset) * ridge.amp * 0.3;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = ridge.color;
    ctx.fill();
  }

  // A low sun behind the crest line, warm and very faint.
  const sun = ctx.createRadialGradient(
    width * 0.7 + pointerX * 30,
    height * 0.24,
    0,
    width * 0.7 + pointerX * 30,
    height * 0.24,
    Math.max(width, height) * 0.5,
  );
  sun.addColorStop(0, "rgba(190, 130, 70, 0.1)");
  sun.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, width, height);
};

export const liveScenes: Record<LiveSceneId, SceneRenderer> = {
  aurora,
  drift,
  mesh,
  starfield,
  waves,
  rainfall,
  ember,
  snowfall,
  dunes,
};

export const liveSceneLabels: Record<LiveSceneId, string> = {
  aurora: "Aurora Drift",
  drift: "Slow Drift",
  mesh: "Lattice",
  starfield: "Deep Field",
  waves: "Ridgeline",
  rainfall: "Rainfall",
  ember: "Embers",
  snowfall: "Snowfall",
  dunes: "Dunes",
};
