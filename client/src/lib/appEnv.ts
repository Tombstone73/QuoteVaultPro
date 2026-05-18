/**
 * appEnv.ts — Environment detection for TitanOS.
 *
 * Priority order:
 *   1. VITE_PUBLIC_APP_ENV build-time var ("prod" → production, "dev" → dev)
 *   2. Runtime hostname fallback — so a missing env var does not cause the
 *      production domain to show the DEV badge.
 *
 * Hostname rules (applied only when VITE_PUBLIC_APP_ENV is unset):
 *   printershero.com, www.printershero.com → prod
 *   dev.printershero.com, localhost, etc.  → dev
 *
 * Usage:
 *   import { isProd, getEnvLabel } from '@/lib/appEnv';
 */

const _raw: string = (import.meta.env.VITE_PUBLIC_APP_ENV ?? '').trim().toLowerCase();

/** Production hostnames that must never show the DEV badge. */
const PROD_HOSTNAMES = new Set(['printershero.com', 'www.printershero.com']);

/** Infer prod/dev from the page's hostname at runtime. */
function _detectFromHostname(): 'prod' | 'dev' {
  if (typeof window === 'undefined') return 'dev';
  const hostname = window.location.hostname.toLowerCase();
  return PROD_HOSTNAMES.has(hostname) ? 'prod' : 'dev';
}

/**
 * Returns 'prod' or 'dev'.
 * Explicit VITE_PUBLIC_APP_ENV takes priority; hostname is the fallback.
 */
export function getAppEnv(): 'prod' | 'dev' {
  if (_raw === 'prod') return 'prod';
  if (_raw === 'dev') return 'dev';
  // Env var absent or unrecognised — infer from runtime hostname.
  return _detectFromHostname();
}

/** True only when the resolved environment is production. */
export function isProd(): boolean {
  return getAppEnv() === 'prod';
}

/**
 * Returns a short label for display ('DEV') or empty string in prod.
 * Useful for badges and title prefixes.
 */
export function getEnvLabel(): string {
  return isProd() ? '' : 'DEV';
}
