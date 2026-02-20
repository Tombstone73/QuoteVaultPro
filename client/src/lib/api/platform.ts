/**
 * client/src/lib/api/platform.ts
 * Frontend API helpers for platform-admin endpoints and public invite endpoints.
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

export interface InvitePreviewResult {
  success: boolean;
  status: "valid" | "invalid" | "expired" | "used" | "error";
  email?: string;
  orgName?: string;
  orgId?: string;
  emailAlreadyRegistered?: boolean;
  expiresAt?: string;
  message?: string;
}

export interface AcceptInviteResult {
  success: boolean;
  data?: {
    orgId: string;
    userId: string;
    email: string;
  };
  code?: string;
  message?: string;
  email?: string; // returned alongside PASSWORD_REQUIRED for display
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

// ─── Platform-admin API calls ─────────────────────────────────────────────────

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
export async function createPlatformOrg(
  payload: CreateOrgPayload
): Promise<{ httpStatus: number; body: CreateOrgResult }> {
  const res = await postJson("/api/platform/orgs", payload);
  const body: CreateOrgResult = await res.json();
  return { httpStatus: res.status, body };
}

// ─── Public invite API calls ───────────────────────────────────────────────────

/**
 * Preview an invite token — returns status and metadata without consuming it.
 * Returns { status: 'valid'|'invalid'|'expired'|'used' }
 */
export async function previewInvite(token: string): Promise<{ httpStatus: number; body: InvitePreviewResult }> {
  const res = await fetch(
    getApiUrl(`/api/invites/preview?token=${encodeURIComponent(token)}`),
    { credentials: "include" }
  );
  const body: InvitePreviewResult = await res.json();
  return { httpStatus: res.status, body };
}

/**
 * Accept an invite. Pass password only for new users (emailAlreadyRegistered=false).
 * On success, a session cookie is set and the user is logged in.
 */
export async function acceptInvite(
  token: string,
  password?: string
): Promise<{ httpStatus: number; body: AcceptInviteResult }> {
  const res = await postJson("/api/invites/accept", { token, password });
  const body: AcceptInviteResult = await res.json();
  return { httpStatus: res.status, body };
}
