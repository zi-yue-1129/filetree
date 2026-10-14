/**
 * Hand-off of App Link paths from the Capacitor listener (registered before
 * React renders) to the React Router (available once the router mounts).
 *
 * Deliberately free of Capacitor imports so the eager app bundle stays small.
 */

/** Router navigation callback. */
export type AppLinkNavigate = (path: string) => void;

let activeNavigate: AppLinkNavigate | null = null;
let pendingPath: string | null = null;

/**
 * Route an App Link path now, or as soon as the router subscribes.
 *
 * @param path - Path with query and hash, e.g. `/share/abc?x=1#y`.
 */
export function deliverAppLink(path: string): void {
  if (activeNavigate !== null) {
    activeNavigate(path);
    return;
  }
  // Only the latest link matters if several arrive before the router mounts.
  pendingPath = path;
}

/**
 * Register the router's navigate function; flushes a link that arrived early.
 *
 * @param navigate - Navigation callback.
 * @returns Unsubscribe function.
 */
export function subscribeAppLinks(navigate: AppLinkNavigate): () => void {
  activeNavigate = navigate;
  if (pendingPath !== null) {
    const path = pendingPath;
    pendingPath = null;
    navigate(path);
  }
  return () => {
    if (activeNavigate === navigate) activeNavigate = null;
  };
}
