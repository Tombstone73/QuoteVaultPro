import { useQuery } from "@tanstack/react-query";
import { resolveActiveOrganization } from "@shared/activeOrganization";
import { fetchMyOrgs, type MyOrgsResult, type OrgSummary } from "@/lib/api/me";
import { getApiUrl } from "@/lib/apiConfig";

export type ActiveOrganizationRole = "owner" | "admin" | "manager" | "member" | null;

/**
 * Resolves UI authorization from the active organization membership. Global
 * session identity fields are never a fallback here.
 */
export function resolveActiveOrganizationRole(data: MyOrgsResult | undefined): {
  activeOrgId: string | null;
  activeOrg: OrgSummary | null;
  role: ActiveOrganizationRole;
} {
  const activeOrg = resolveActiveOrganization(data?.data?.orgs, data?.data?.lastActiveOrgId);
  return {
    activeOrgId: activeOrg?.id ?? null,
    activeOrg,
    role: (activeOrg?.role?.toLowerCase() ?? null) as ActiveOrganizationRole,
  };
}

export function useActiveOrganizationRole(options: { enabled?: boolean } = {}) {
  const query = useQuery({
    queryKey: [getApiUrl("/api/me/orgs")],
    queryFn: fetchMyOrgs,
    staleTime: 60_000,
    enabled: options.enabled ?? true,
  });
  const { activeOrgId, activeOrg, role } = resolveActiveOrganizationRole(query.data);
  const isInternalUser = role !== null;
  const isAdminOrOwner = role === "owner" || role === "admin";
  const isApprover = isInternalUser && ["owner", "admin", "manager", "member"].includes(role ?? "");

  return {
    activeOrgId,
    activeOrg,
    role,
    isLoading: query.isLoading,
    isInternalUser,
    isAdminOrOwner,
    isOwner: role === "owner",
    isApprover,
  };
}
