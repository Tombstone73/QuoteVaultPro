export function materialFamilyLifecycleRequest(isActive: boolean) { return { isActive: !isActive }; }
export function materialDimensionKey(displayName: string) { return displayName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
export function activeMaterialFamilies<T extends { isActive: boolean }>(families: readonly T[]) { return families.filter((family) => family.isActive); }
