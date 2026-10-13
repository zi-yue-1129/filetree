/**
 * Frame-capped requestAnimationFrame loop that stops while the page is hidden.
 *
 * Background canvases do not need 60 fps; capping them halves their main
 * thread and compositor cost, and pausing on `visibilitychange` keeps hidden
 * tabs / backgrounded WebViews (Capacitor, Tauri) from burning battery.
 */

/** Reference frame duration that `draw`'s `frameScale` is relative to. */
const REFERENCE_FRAME_MS = 1000 / 60;
/** Upper bound for `frameScale` after long stalls, to avoid jumps. */
const MAX_FRAME_SCALE = 4;

/**
 * Start a capped animation loop.
 *
 * @param draw - Called per rendered frame with the rAF timestamp and the
 *   elapsed time as a multiple of a 60 fps frame (for time-based motion).
 * @param maxFps - Frame cap.
 * @returns Function that stops the loop and removes listeners.
 */
export function startCappedLoop(draw: (timestamp: number, frameScale: number) => void, maxFps: number): () => void {
  const minFrameMs = 1000 / maxFps;
  let handle = 0;
  let lastDrawn: number | null = null;
  let running = false;

  const tick = (timestamp: number): void => {
    handle = requestAnimationFrame(tick);
    if (lastDrawn !== null && timestamp - lastDrawn < minFrameMs - 1) return;
    const frameScale = lastDrawn === null ? 1 : Math.min((timestamp - lastDrawn) / REFERENCE_FRAME_MS, MAX_FRAME_SCALE);
    lastDrawn = timestamp;
    draw(timestamp, frameScale);
  };
  const start = (): void => {
    if (running) return;
    running = true;
    lastDrawn = null;
    handle = requestAnimationFrame(tick);
  };
  const stop = (): void => {
    running = false;
    cancelAnimationFrame(handle);
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') start();
    else stop();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  if (document.visibilityState === 'visible') start();
  return () => {
    stop();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
