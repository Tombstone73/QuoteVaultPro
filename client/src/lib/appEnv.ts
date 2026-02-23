/**
 * appEnv.ts — Build-time environment detection for TitanOS.
 *
 * Controlled by the VITE_PUBLIC_APP_ENV env var (set per Vercel project).
 * Fail-safe: anything that is NOT exactly "prod" (case-insensitive) is
 * treated as DEV so we never silently run a dev build in prod.
 *
 * Usage:
 *   import { isProd, getEnvLabel } from '@/lib/appEnv';
 */

const _raw: string = (import.meta.env.VITE_PUBLIC_APP_ENV ?? '').trim().toLowerCase();

/** Returns 'prod' or 'dev'. Only the explicit value "prod" yields production. */
export function getAppEnv(): 'prod' | 'dev' {
  return _raw === 'prod' ? 'prod' : 'dev';
}

/** True only when VITE_PUBLIC_APP_ENV === "prod" (case-insensitive). */
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
