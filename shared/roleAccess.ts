export type RoleAccessInput = {
  role?: string | null;
  orgRole?: string | null;
  isAdmin?: boolean | null;
};

export function normalizeRole(role: unknown): string {
  return typeof role === "string" ? role.trim().toLowerCase() : "";
}

export function hasAdminOrOwnerOperationalRole(user: RoleAccessInput | string | null | undefined): boolean {
  const role = typeof user === "string" ? normalizeRole(user) : normalizeRole(user?.orgRole ?? user?.role);
  return role === "owner" || role === "admin" || (typeof user === "object" && user?.isAdmin === true);
}

export function hasOwnerOnlyAdminToolsRole(user: RoleAccessInput | string | null | undefined): boolean {
  const role = typeof user === "string" ? normalizeRole(user) : normalizeRole(user?.orgRole ?? user?.role);
  return role === "owner";
}
