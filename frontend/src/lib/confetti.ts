// Framework-free confetti ("cracker blast") on a single full-screen canvas.
//
//   const stop = fireConfetti({ intensity: 1 });   // returns a cancel function
//
// - Two cannons shoot from the bottom corners, then streamers rain from the top for a few seconds.
// - Nothing is left behind: the canvas removes itself when the last particle is gone (or when stop() is called).
// - prefers-reduced-motion: does nothing (returns a no-op).
// - Only one canvas at a time; calling again adds more particles to the running one.

export interface ConfettiOptions {
  /** 0.4 = small pop … 1 = full celebration … 1.5 = huge. */
  intensity?: number;
  colors?: string[];
  /** Milliseconds of "rain" after the cannon burst. */
  rainMs?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  shape: 0 | 1 | 2; // rect, circle, streamer
  tilt: number;
  vt: number;
  life: number; // frames lived
  max: number; // frames to live
  drag: number;
}

const DEFAULT_COLORS = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899"];

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let raf = 0;
const timers = new Set<number>();
let resizeHandler: (() => void) | null = null;

/** setTimeout that is tracked, so the animation loop knows more particles are still coming and teardown can cancel it. */
function later(ms: number, fn: () => void) {
  const id = window.setTimeout(() => {
    timers.delete(id);
    if (canvas) fn();
  }, ms);
  timers.add(id);
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function ensureCanvas(): boolean {
  if (canvas && ctx) return true;
  if (typeof document === "undefined") return false;
  const c = document.createElement("canvas");
  c.setAttribute("aria-hidden", "true");
  c.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000";
  const g = c.getContext("2d");
  if (!g) return false;
  canvas = c;
  ctx = g;
  fit();
  resizeHandler = fit;
  window.addEventListener("resize", resizeHandler);
  document.body.appendChild(c);
  return true;
}

function fit() {
  if (!canvas || !ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function teardown() {
  cancelAnimationFrame(raf);
  raf = 0;
  timers.forEach((t) => window.clearTimeout(t));
  timers.clear();
  particles = [];
  if (resizeHandler) window.removeEventListener("resize", resizeHandler);
  resizeHandler = null;
  canvas?.remove();
  canvas = null;
  ctx = null;
}

function make(x: number, y: number, angle: number, speed: number, colors: string[], spread = 0): Particle {
  const a = angle + rand(-spread, spread);
  const s = speed * rand(0.55, 1);
  const shape = (Math.random() < 0.55 ? 0 : Math.random() < 0.6 ? 1 : 2) as 0 | 1 | 2;
  return {
    x,
    y,
    vx: Math.cos(a) * s,
    vy: Math.sin(a) * s,
    size: shape === 2 ? rand(10, 18) : rand(6, 11),
    rot: rand(0, Math.PI * 2),
    vr: rand(-0.3, 0.3),
    color: colors[Math.floor(Math.random() * colors.length)],
    shape,
    tilt: rand(0, Math.PI * 2),
    vt: rand(0.08, 0.3),
    life: 0,
    max: rand(110, 190),
    drag: rand(0.985, 0.992),
  };
}

function cannon(fromLeft: boolean, count: number, colors: string[]) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const x = fromLeft ? -8 : w + 8;
  const y = h + 8;
  // up and towards the middle, wide fan
  const base = fromLeft ? -Math.PI / 3 : (-2 * Math.PI) / 3;
  const power = Math.max(13, Math.min(26, h / 34));
  for (let i = 0; i < count; i++) particles.push(make(x, y, base, power, colors, 0.55));
}

function rain(count: number, colors: string[]) {
  const w = window.innerWidth;
  for (let i = 0; i < count; i++) {
    const p = make(rand(0, w), -12, Math.PI / 2, rand(2, 5), colors, 0.35);
    p.max = rand(160, 260);
    p.drag = 0.995;
    particles.push(p);
  }
}

const GRAVITY = 0.32;

function frame() {
  if (!canvas || !ctx) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life++;
    p.vx *= p.drag;
    p.vy = p.vy * p.drag + GRAVITY * (p.shape === 2 ? 0.6 : 1);
    p.x += p.vx + Math.sin(p.tilt) * 0.6;
    p.y += p.vy;
    p.rot += p.vr;
    p.tilt += p.vt;
    if (p.life > p.max || p.y > h + 30) {
      particles.splice(i, 1);
      continue;
    }
    const fade = p.life > p.max - 30 ? Math.max(0, (p.max - p.life) / 30) : 1;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    const flip = Math.cos(p.tilt); // paper flutter
    if (p.shape === 0) {
      ctx.scale(1, Math.max(0.15, Math.abs(flip)));
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, (p.size * 2) / 3);
    } else if (p.shape === 1) {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.scale(Math.max(0.2, Math.abs(flip)), 1);
      ctx.fillRect(-1.5, -p.size, 3, p.size * 2);
    }
    ctx.restore();
  }
  if (particles.length === 0 && timers.size === 0) {
    teardown();
    return;
  }
  raf = requestAnimationFrame(frame);
}

/** Fires one celebration. Returns a function that stops it immediately. */
export function fireConfetti(opts: ConfettiOptions = {}): () => void {
  if (typeof window === "undefined" || prefersReducedMotion()) return () => {};
  if (!ensureCanvas()) return () => {};
  const k = Math.max(0.2, Math.min(2, opts.intensity ?? 1));
  const colors = opts.colors && opts.colors.length ? opts.colors : DEFAULT_COLORS;
  const rainMs = opts.rainMs ?? 2600;

  cannon(true, Math.round(70 * k), colors);
  cannon(false, Math.round(70 * k), colors);
  // a second, slightly later pop from both sides
  later(380, () => {
    cannon(true, Math.round(40 * k), colors);
    cannon(false, Math.round(40 * k), colors);
  });
  // gentle rain
  const steps = Math.max(1, Math.floor(rainMs / 180));
  for (let i = 1; i <= steps; i++) later(450 + i * 180, () => rain(Math.max(1, Math.round(3 * k)), colors));

  if (!raf) raf = requestAnimationFrame(frame);
  return teardown;
}

/** Is a celebration currently on screen? (used by tests) */
export function confettiActive(): boolean {
  return !!canvas;
}
