/**
 * Deployment-bound API routing rules.
 *
 * These are deliberately centralized: a production web bundle must never
 * accept the development API as its application backend (and vice versa).
 */
import { PRODUCTION_API_ORIGIN, DEVELOPMENT_API_ORIGIN, expectedApiOriginForWebHost } from "@shared/deploymentOrigins";
export { PRODUCTION_API_ORIGIN, DEVELOPMENT_API_ORIGIN, expectedApiOriginForWebHost };

export function normalizeOrigin(value: string | undefined): string {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
}

export function resolveApiOriginForWebHost(
  hostname: string | undefined,
  configuredApiOrigin: string | undefined,
): string {
  return normalizeOrigin(configuredApiOrigin) || expectedApiOriginForWebHost(hostname) || "";
}

export function validateApiOriginForWebHost(
  hostname: string | undefined,
  configuredApiOrigin: string | undefined,
): { isValid: boolean; expectedApiOrigin: string | null; configuredApiOrigin: string } {
  const expectedApiOrigin = expectedApiOriginForWebHost(hostname);
  const normalizedConfiguredOrigin = normalizeOrigin(configuredApiOrigin);

  if (!expectedApiOrigin) {
    return { isValid: true, expectedApiOrigin: null, configuredApiOrigin: normalizedConfiguredOrigin };
  }

  return {
    isValid: normalizedConfiguredOrigin === expectedApiOrigin,
    expectedApiOrigin,
    configuredApiOrigin: normalizedConfiguredOrigin,
  };
}

export function isPrintersHeroApiOrigin(value: string | undefined): boolean {
  const normalizedOrigin = normalizeOrigin(value);
  return normalizedOrigin === PRODUCTION_API_ORIGIN || normalizedOrigin === DEVELOPMENT_API_ORIGIN;
}
