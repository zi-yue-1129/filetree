import React, { useEffect, useRef } from 'react';
import { startCappedLoop } from '../lib/animationLoop';

/**
 * AuraField Component
 *
 * Implements the "Ultimate Liquid Spatial Glass" design.
 * Features:
 * - Ambient Aurora (Layered gradients)
 * - Fluid Glass Blobs (Simplex-noise-like smooth movement)
 * - Interactive Parallax (Mouse responsive)
 *
 * Performance: the blobs are soft radial gradients, so the canvas renders at
 * 1/8 of the CSS resolution and the browser's bilinear upscaling provides the
 * blur. This replaces the former per-frame `ctx.filter = 'blur(140px)'`,
 * which re-blurred the full-screen canvas 60 times per second. The loop runs
 * at most 30 fps, pauses while hidden, and paints one static frame when
 * `animated` is false (low-power mode).
 */

/** Canvas pixels per CSS pixel (the upscale acts as the blur). */
const RENDER_SCALE = 1 / 8;
/** Blob radii grow a little to match the halo the old blur filter added. */
const BLUR_HALO_FACTOR = 1.15;
const AURA_MAX_FPS = 30;
const BLOB_COUNT = 9;
const AMBIENT_BLOB_COUNT = 5;

// Simple pseudo-random for noise-like movement
const simplex = (x: number, y: number, t: number): number => {
  return Math.sin(x * 0.005 + t) * Math.cos(y * 0.005 + t) * 0.5 + 0.5;
};

const BLOB_COLORS = [
  'rgba(240, 220, 255, 0.35)', // Muted Pastel Purple
  'rgba(210, 235, 255, 0.35)', // Muted Pastel Blue
  'rgba(255, 220, 240, 0.35)', // Muted Pastel Pink
  'rgba(225, 255, 245, 0.30)', // Muted Pastel Mint
];

class Blob {
  x: number;
  y: number;
  size: number;
  color: string;
  vx: number;
  vy: number;
  seed: number;

  /**
   * Create a randomly placed blob.
   *
   * @param width - Viewport width in CSS px.
   * @param height - Viewport height in CSS px.
   */
  constructor(width: number, height: number) {
    this.seed = Math.random() * 1000;
    this.x = Math.random() * width;
    this.y = Math.random() * height;
    this.size = Math.random() * 600 + 400;
    this.color = BLOB_COLORS[Math.floor(Math.random() * BLOB_COLORS.length)];
    this.vx = (Math.random() - 0.5) * 0.25; // Slower speed for more stability
    this.vy = (Math.random() - 0.5) * 0.25;
  }

  /**
   * Advance the blob.
   *
   * @param t - Time in seconds.
   * @param mouse - Pointer position in CSS px.
   * @param width - Viewport width.
   * @param height - Viewport height.
   * @param frameScale - Elapsed time in 60 fps frames.
   */
  update(t: number, mouse: { x: number; y: number }, width: number, height: number, frameScale: number): void {
    // Organic movement based on time and position
    const noiseX = simplex(this.x, this.y, t * 0.5 + this.seed);
    const noiseY = simplex(this.y, this.x, t * 0.5 + this.seed);

    this.x += (this.vx + (noiseX - 0.5) * 3.0) * frameScale; // More turbulence
    this.y += (this.vy + (noiseY - 0.5) * 3.0) * frameScale;

    // Mouse attraction (Subtle "Gravity Field")
    const dx = mouse.x - this.x;
    const dy = mouse.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 900) {
      const force = Math.min(1, (1 - dist / 900) * 0.08 * frameScale); // Gentler attraction
      this.x += dx * force;
      this.y += dy * force;
    }

    // Boundary check with wrapping
    if (this.x < -this.size) this.x = width + this.size;
    if (this.x > width + this.size) this.x = -this.size;
    if (this.y < -this.size) this.y = height + this.size;
    if (this.y > height + this.size) this.y = -this.size;
  }

  /**
   * Paint the blob (context transform maps CSS px to canvas px).
   *
   * @param context - 2D context.
   */
  draw(context: CanvasRenderingContext2D): void {
    const radius = this.size * BLUR_HALO_FACTOR;
    const gradient = context.createRadialGradient(this.x, this.y, 0, this.x, this.y, radius);
    gradient.addColorStop(0, this.color);
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    context.fillStyle = gradient;
    context.beginPath();
    context.arc(this.x, this.y, radius, 0, Math.PI * 2);
    context.fill();
  }
}

interface AuraFieldProps {
  /** Animate the aurora; when false a single static frame is drawn. */
  animated: boolean;
}

export const AuraField: React.FC<AuraFieldProps> = ({ animated }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      // Decorative background only: report it, but keep the app usable.
      console.error('AuraField: 2D canvas context unavailable');
      return;
    }

    let width = 0;
    let height = 0;
    let blobs: Blob[] = [];

    const paint = (t: number, frameScale: number, move: boolean): void => {
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);

      // Layer 1: Ambient Aurora (Base Gradient)
      const bgGrad = ctx.createLinearGradient(0, 0, width, height);
      bgGrad.addColorStop(0, '#f8fafc');
      bgGrad.addColorStop(1, '#f1f5f9');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Layer 2: Ambient glow, then the slightly faster liquid structure.
      blobs.forEach((blob, index) => {
        if (move) blob.update(index < AMBIENT_BLOB_COUNT ? t : t * 1.2, mouseRef.current, width, height, frameScale);
        blob.draw(ctx);
      });

      // Layer 3: Interactive Mouse Light (Subtle Highlight)
      const mouse = mouseRef.current;
      const mouseGrad = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 500);
      mouseGrad.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
      mouseGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = mouseGrad;
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';
    };

    const init = (): void => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.max(1, Math.ceil(width * RENDER_SCALE));
      canvas.height = Math.max(1, Math.ceil(height * RENDER_SCALE));
      blobs = Array.from({ length: BLOB_COUNT }, () => new Blob(width, height));
      if (!animated) paint(0, 0, false);
    };

    const handleMouseMove = (e: MouseEvent): void => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };

    window.addEventListener('resize', init);
    if (animated) window.addEventListener('mousemove', handleMouseMove);
    init();
    const stopLoop = animated
      ? startCappedLoop((timestamp, frameScale) => paint(timestamp * 0.001, frameScale, true), AURA_MAX_FPS)
      : null;

    return () => {
      stopLoop?.();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', init);
    };
  }, [animated]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full -z-10 pointer-events-none"
      style={{ isolation: 'isolate' }}
    />
  );
};

export default AuraField;
