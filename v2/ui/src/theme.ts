export type AppearancePreference = "light" | "dark" | "system";
export type ThemeId = "printershero" | "corporate" | "industrial";
export type ThemeTokens = Readonly<
  Record<
    | "app"
    | "surface"
    | "elevated"
    | "foreground"
    | "mutedForeground"
    | "border"
    | "subtleBorder"
    | "input"
    | "primary"
    | "primaryForeground"
    | "secondary"
    | "secondaryForeground"
    | "accent"
    | "focus"
    | "selected"
    | "hover"
    | "destructive"
    | "destructiveForeground"
    | "success"
    | "warning"
    | "informational"
    | "disabled"
    | "elevation",
    string
  >
>;
export type OrganizationBranding = Readonly<{
  primary?: string;
  secondary?: string;
  wordmark?: string;
}>;
export interface AppearancePreferenceProvider {
  read(): Readonly<{ theme: ThemeId; appearance: AppearancePreference }>;
  write(value: Readonly<{ theme: ThemeId; appearance: AppearancePreference }>): void;
}
export interface OrganizationBrandingProvider {
  current(): OrganizationBranding | undefined;
}
export type ResolvedTheme = Readonly<{
  id: ThemeId;
  appearance: "light" | "dark";
  tokens: ThemeTokens;
  wordmark: string;
}>;

const protectedTokens = [
  "destructive",
  "success",
  "warning",
  "informational",
  "focus",
  "disabled",
] as const;
const light: ThemeTokens = {
  app: "#f6f8fb",
  surface: "#ffffff",
  elevated: "#eef2f7",
  foreground: "#172033",
  mutedForeground: "#58657a",
  border: "#d9e0ea",
  subtleBorder: "#e8edf4",
  input: "#ffffff",
  primary: "#2257c6",
  primaryForeground: "#fff",
  secondary: "#e8edf5",
  secondaryForeground: "#172033",
  accent: "#e4edff",
  focus: "#245ee6",
  selected: "#dce9ff",
  hover: "#f1f5fb",
  destructive: "#bd2435",
  destructiveForeground: "#ffffff",
  success: "#177c4d",
  warning: "#a75d00",
  informational: "#1d65b3",
  disabled: "#9aa5b4",
  elevation: "0 4px 16px rgb(23 32 51 / .05)",
};
const dark: ThemeTokens = {
  ...light,
  app: "#101722",
  surface: "#172131",
  elevated: "#202d40",
  foreground: "#edf3fb",
  mutedForeground: "#a9b7ca",
  border: "#344258",
  subtleBorder: "#273449",
  input: "#121c2b",
  primary: "#7aa7ff",
  primaryForeground: "#101722",
  secondary: "#273449",
  secondaryForeground: "#edf3fb",
  accent: "#263b61",
  focus: "#a9c4ff",
  selected: "#2e4d81",
  hover: "#202e43",
  destructive: "#ff8996",
  destructiveForeground: "#301017",
  success: "#69d49b",
  warning: "#ffc36c",
  informational: "#79b9ff",
  disabled: "#6f7c8e",
};
const themes: Record<ThemeId, { light: ThemeTokens; dark: ThemeTokens }> = {
  printershero: { light, dark },
  corporate: {
    light: {
      ...light,
      app: "#fbfcfd",
      elevated: "#f4f6f8",
      primary: "#283d62",
      accent: "#e7edf5",
      focus: "#405b87",
    },
    dark: { ...dark, primary: "#b8cae9", accent: "#25334a", focus: "#c5d6f4" },
  },
  industrial: {
    light: {
      ...light,
      app: "#e8eaeb",
      surface: "#f8f8f6",
      foreground: "#182020",
      primary: "#275f55",
      accent: "#dce9dd",
      focus: "#237b6a",
    },
    dark: {
      ...dark,
      app: "#121716",
      surface: "#1c2422",
      elevated: "#29322f",
      border: "#3a4743",
      primary: "#9ecb48",
      primaryForeground: "#182010",
      accent: "#354931",
      focus: "#c7ec70",
      selected: "#415c3a",
    },
  },
};
const hexColor = /^#[0-9a-f]{6}$/i;
const readableForeground = (color: string): string => {
  const components = [1, 3, 5].map((index) =>
    Number.parseInt(color.slice(index, index + 2), 16) / 255,
  );
  const linear = components.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  const luminance =
    0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.42 ? "#172033" : "#ffffff";
};
const safeBrandColor = (value: string | undefined): string | undefined =>
  value && hexColor.test(value) ? value : undefined;
export const resolveTheme = (
  id: ThemeId | string | undefined,
  preference: AppearancePreference,
  branding?: OrganizationBranding,
  systemDark = false,
): ResolvedTheme => {
  const safeId: ThemeId =
    id === "corporate" || id === "industrial" || id === "printershero"
      ? id
      : "printershero";
  const appearance =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;
  const base = themes[safeId][appearance];
  const primary = safeBrandColor(branding?.primary);
  const secondary = safeBrandColor(branding?.secondary);
  const tokens: Record<keyof ThemeTokens, string> = {
    ...base,
    ...(primary
      ? { primary, primaryForeground: readableForeground(primary) }
      : {}),
    ...(secondary
      ? { secondary, secondaryForeground: readableForeground(secondary) }
      : {}),
  };
  for (const token of protectedTokens) tokens[token] = base[token];
  return {
    id: safeId,
    appearance,
    tokens: Object.freeze(tokens),
    wordmark: branding?.wordmark?.trim() || "PrintersHero V2",
  };
};
