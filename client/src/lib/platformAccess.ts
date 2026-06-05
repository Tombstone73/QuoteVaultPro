export function canUsePlatformTools(user: {
  isPlatformAdmin?: boolean | null;
  isPlatformDeveloper?: boolean | null;
} | null | undefined): boolean {
  return Boolean(user?.isPlatformAdmin || user?.isPlatformDeveloper);
}
