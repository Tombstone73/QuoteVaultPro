export function canUseProductPlanning(user: {
  role?: string | null;
  isPlatformAdmin?: boolean | null;
  isPlatformDeveloper?: boolean | null;
} | null | undefined): boolean {
  const role = String(user?.role ?? "").toLowerCase();
  return Boolean(user?.isPlatformAdmin || user?.isPlatformDeveloper || role === "owner" || role === "admin");
}
