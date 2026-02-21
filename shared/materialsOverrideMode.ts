export type MaterialsOverrideMode = "prepress_only" | "prepress_and_production";

export const DEFAULT_MATERIALS_OVERRIDE_MODE: MaterialsOverrideMode = "prepress_and_production";

export function resolveMaterialsOverrideModeFromOrgPreferences(preferences: unknown): MaterialsOverrideMode {
  const prefs = preferences && typeof preferences === "object" ? (preferences as any) : {};
  const production = prefs?.production && typeof prefs.production === "object" ? prefs.production : {};
  const raw = production?.materialsOverrideMode;

  if (raw === "prepress_only" || raw === "prepress_and_production") {
    return raw;
  }

  return DEFAULT_MATERIALS_OVERRIDE_MODE;
}
