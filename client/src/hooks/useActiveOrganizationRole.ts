import { useQuery } from "@tanstack/react-query";
import { fetchMyOrgs } from "@/lib/api/me";
import { getApiUrl } from "@/lib/apiConfig";

export type ActiveOrganizationRole = "owner" | "admin" | "manager" | "member" | null;

/**
 * Resolves UI authorization from the active organization membership. Global
 * session identity fields are never a fallback here.
 */
export function useActiveOrganizationRole() {
  const query = useQuery({
    queryKey: [getApiUrl("/api/me/orgs")],
    queryFn: fetchMyOrgs,
    staleTime: 60_000,
  });
  const activeOrgId = query.data?.data?.lastActiveOrgId ?? null;
  const activeOrg = query.data?.data?.orgs.find((org) => org.id === activeOrgId) ?? null;
  const role = (activeOrg?.role?.toLowerCase() ?? null) as ActiveOrganizationRole;
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
