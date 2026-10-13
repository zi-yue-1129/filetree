/**
 * Centralized API service for handling requests with authentication.
 */

/**
 * Origin of the backend API. Set `VITE_API_BASE_URL` (e.g. https://api.example.com)
 * when the frontend is hosted separately (Cloudflare Pages). When unset it falls
 * back to the page origin, which is what the Vite dev proxy and the
 * backend-served SPA rely on.
 */
const DEFAULT_API_ORIGIN: string = (
  import.meta.env.VITE_API_BASE_URL || window.location.origin
).replace(/\/+$/, '');

/**
 * Current backend origin. This is a live ES-module binding: the native apps
 * may replace it once at startup (before rendering) with a user-configured
 * server URL via {@link setApiOrigin}. The web build never changes it.
 */
export let API_ORIGIN: string = DEFAULT_API_ORIGIN;

/**
 * Override the backend origin (native apps only; call before rendering).
 *
 * @param origin - Absolute http(s) origin, or `null` to restore the build-time default.
 */
export function setApiOrigin(origin: string | null): void {
  API_ORIGIN = origin ? origin.replace(/\/+$/, '') : DEFAULT_API_ORIGIN;
}

/**
 * Build-time default backend origin (`VITE_API_BASE_URL` or the page origin).
 *
 * @returns Origin without trailing slash.
 */
export function getDefaultApiOrigin(): string {
  return DEFAULT_API_ORIGIN;
}

/**
 * Build an absolute backend URL.
 *
 * @param path - Path beginning with `/`, e.g. `/api/login`.
 * @returns Absolute HTTP(S) URL on the backend origin.
 */
export function apiUrl(path: string): string {
  return `${API_ORIGIN}${path}`;
}

/**
 * Build an absolute backend WebSocket URL.
 *
 * @param path - Path beginning with `/`, e.g. `/ws/global`.
 * @returns Absolute ws(s) URL on the backend origin.
 */
export function wsUrl(path: string): string {
  return `${API_ORIGIN.replace(/^http/, 'ws')}${path}`;
}

interface RequestOptions extends RequestInit {
  token?: string | null;
}

export async function apiRequest(endpoint: string, options: RequestOptions = {}) {
  const { token, headers: customHeaders, ...rest } = options;
  
  const headers = new Headers(customHeaders);
  
  // SECURE: Automatically include session token if available
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Automatically set Content-Type if body is stringified JSON
  if (rest.body && typeof rest.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_ORIGIN}/api${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`, {
    ...rest,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: 'An unknown error occurred' }));
    throw new Error(errorData.detail || response.statusText);
  }

  return response.json();
}

/**
 * Helper for POST requests with Form Data (e.g. file uploads via legacy API)
 */
export async function apiPostForm(endpoint: string, formData: FormData, token?: string | null) {
  const headers = new Headers();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_ORIGIN}/api${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`, {
    method: 'POST',
    body: formData,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: 'An unknown error occurred' }));
    throw new Error(errorData.detail || response.statusText);
  }

  return response.json();
}
