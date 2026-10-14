/** The sole organization preference controlling the new file-prefix tools. */
export function filePrefixToolsEnabledFromSettings(settings: unknown): boolean {
  return (settings as any)?.preferences?.enableFilePrefixTools === true;
}

export function withFilePrefixToolsSetting(settings: unknown, enabled: boolean): Record<string, unknown> {
  const current = settings && typeof settings === "object" && !Array.isArray(settings)
    ? settings as Record<string, unknown> : {};
  const rawPreferences = current.preferences;
  const preferences = rawPreferences && typeof rawPreferences === "object" && !Array.isArray(rawPreferences)
    ? rawPreferences as Record<string, unknown> : {};
  return { ...current, preferences: { ...preferences, enableFilePrefixTools: enabled } };
}
