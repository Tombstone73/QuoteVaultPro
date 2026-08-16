/**
 * client/src/lib/api/me.ts
 * Frontend API helpers for /api/me/* endpoints.
 */
import { getApiUrl } from "@/lib/apiConfig";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
  isDefault?: boolean;
}

export interface MyOrgsResult {
  success: boolean;
  data?: {
    orgs: OrgSummary[];
    lastActiveOrgId: string | null;
  };
  message?: string;
}

export interface SetActiveOrgResult {
  success: boolean;
  data?: { lastActiveOrgId: string };
  message?: string;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function fetchMyOrgs(): Promise<MyOrgsResult> {
  const res = await fetch(getApiUrl("/api/me/orgs"), {
    credentials: "include",
  });
  return res.json();
}

export async function setActiveOrg(orgId: string): Promise<SetActiveOrgResult> {
  const res = await fetch(getApiUrl("/api/me/active-org"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ orgId }),
  });
  return res.json();
}
