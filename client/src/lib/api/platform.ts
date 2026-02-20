/**
 * client/src/lib/api/platform.ts
 * Frontend API helpers for platform-admin endpoints.
 */
import { getApiUrl } from "@/lib/apiConfig";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReauthResult {
  success: boolean;
  code?: string;
  message?: string;
}

export interface CreateOrgPayload {
  name: string;
  slug?: string;
  ownerEmail: string; // always required; owner invite is always created
}

export interface CreateOrgResult {
  success: boolean;
  data?: {
    orgId: string;
    slug: string;
    inviteLink: string;
    ownerEmail: string;
  };
  code?: string;
  message?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(getApiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
}

// ─── API calls ────────────────────────────────────────────────────────────────

/**
 * Submit password for step-up authentication.
 * Returns { success: true } on match, { success: false } on mismatch.
 */
export async function platformReauth(password: string): Promise<ReauthResult> {
  const res = await postJson("/api/platform/reauth", { password });
  return res.json();
}

/**
 * Create a new organization (platform-admin only + step-up required).
 * Returns 404 for non-platform-admins.
 * Returns 401 { code: 'STEP_UP_REQUIRED' } when step-up is needed.
 */
export async function createPlatformOrg(payload: CreateOrgPayload): Promise<{ httpStatus: number; body: CreateOrgResult }> {
  const res = await postJson("/api/platform/orgs", payload);
  const body: CreateOrgResult = await res.json();
  return { httpStatus: res.status, body };
}
