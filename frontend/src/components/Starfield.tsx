import React, { useEffect, useRef } from 'react';
import { startCappedLoop } from '../lib/animationLoop';

/** Background animation frame cap: slow star drift does not need 60 fps. */
const STARFIELD_MAX_FPS = 30;
const STAR_COUNT = 150;
const STAR_COLORS = ['#fff', '#22d3ee', '#a855f7', '#818cf8', '#ffffff'];
const NEBULA_COLORS = ['rgba(123, 97, 255, 0.03)', 'rgba(0, 255, 255, 0.02)', 'rgba(255, 0, 255, 0.02)'];

interface Star {
  x: number;
  y: number;
  size: number;
  speed: number;
  opacity: number;
  color: string;
}

interface StarfieldProps {
  /** Animate the stars; when false a single static frame is drawn. */
  animated: boolean;
}

/**
 * Create the star population for a canvas size.
 *
 * @param width - Canvas width in px.
 * @param height - Canvas height in px.
 * @returns Randomly placed stars.
 */
function createStars(width: number, height: number): Star[] {
  return Array.from({ length: STAR_COUNT }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    size: Math.random() * 1.5,
    speed: Math.random() * 0.12 + 0.03,
    opacity: Math.random() * 0.7 + 0.2,
    color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
  }));
}

/**
 * Paint the three faint nebula gradients.
 *
 * @param context - 2D context.
 * @param width - Canvas width.
 * @param height - Canvas height.
 */
function drawNebulas(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.globalCompositeOperation = 'screen';
  NEBULA_COLORS.forEach((color, index) => {
    const centerX = width * (0.2 + index * 0.3);
    const centerY = height * (0.3 + (index % 2) * 0.4);
    const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, width * 0.4);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'transparent');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  });
  context.globalCompositeOperation = 'source-over';
}

/**
 * Paint every star at its current position.
 *
 * @param context - 2D context.
 * @param stars - Stars to paint.
 */
function drawStars(context: CanvasRenderingContext2D, stars: Star[]): void {
  for (const star of stars) {
    context.fillStyle = star.color;
    context.globalAlpha = star.opacity;
    context.beginPath();
    context.arc(star.x, star.y, star.size, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

/**
 * Advance the drift and twinkle of every star.
 *
 * @param stars - Stars to move (mutated).
 * @param width - Canvas width.
 * @param height - Canvas height.
 * @param frameScale - Elapsed time in 60 fps frames.
 */
function moveStars(stars: Star[], width: number, height: number, frameScale: number): void {
  for (const star of stars) {
    // Cosmic vertical drift with very slight horizontal drift
    star.y -= star.speed * frameScale;
    star.x += star.speed * 0.05 * frameScale;
    if (star.y < -10) {
      star.y = height + 10;
      star.x = Math.random() * width;
    }
    if (star.x > width + 10) star.x = -10;
    if (star.x < -10) star.x = width + 10;
    // Soft twinkle
    star.opacity = Math.min(0.8, Math.max(0.2, star.opacity + (Math.random() - 0.5) * 0.01 * frameScale));
  }
}

/**
 * Dark-theme background: drifting stars over faint nebulas.
 *
 * Animated at most 30 fps and paused while the page is hidden; in low-power
 * mode (`animated={false}`) it paints one static frame per resize.
 */
export const Starfield: React.FC<StarfieldProps> = ({ animated }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) {
      // Decorative background only: report it, but keep the app usable.
      console.error('Starfield: 2D canvas context unavailable');
      return;
    }

    let stars: Star[] = [];
    const paintStatic = (): void => {
      context.fillStyle = 'rgb(2, 2, 5)';
      context.fillRect(0, 0, canvas.width, canvas.height);
      drawNebulas(context, canvas.width, canvas.height);
      drawStars(context, stars);
    };
    const handleResize = (): void => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      stars = createStars(canvas.width, canvas.height);
      if (!animated) paintStatic();
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    const stopLoop = animated
      ? startCappedLoop((_timestamp, frameScale) => {
          // Semi-transparent fill keeps short trails behind moving stars.
          context.fillStyle = 'rgba(2, 2, 5, 0.5)';
          context.fillRect(0, 0, canvas.width, canvas.height);
          drawNebulas(context, canvas.width, canvas.height);
          drawStars(context, stars);
          moveStars(stars, canvas.width, canvas.height, frameScale);
        }, STARFIELD_MAX_FPS)
      : null;

    return () => {
      stopLoop?.();
      window.removeEventListener('resize', handleResize);
    };
  }, [animated]);

  return <canvas ref={canvasRef} className="fixed inset-0 -z-20 pointer-events-none opacity-90" />;
};
