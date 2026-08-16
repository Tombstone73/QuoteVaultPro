/**
 * The Lovable visual system is a frontend presentation preference.  It is not
 * an organization setting, authority grant, or business fact.  Until a typed
 * preference API is designed, this adapter deliberately keeps the browser
 * persistence boundary local and optional.
 */
export type VisualTheme =
  | "light"
  | "dark"
  | "command"
  | "contrast"
  | "lowglare"
  | "warm";
export type VisualDensity = "comfortable" | "compact";
export type VisualAccent = "blue" | "teal" | "amber" | "violet" | "red";
export type VisualCorners = "rounded" | "sharp";
export type VisualFont =
  | "inter"
  | "segoe"
  | "arial"
  | "roboto"
  | "roboto-condensed"
  | "atkinson";
export type VisualColorVision = "standard" | "protan" | "deutan" | "tritan";

export type VisualAppearance = Readonly<{
  theme: VisualTheme;
  density: VisualDensity;
  accent: VisualAccent;
  corners: VisualCorners;
  font: VisualFont;
  fontScale: number;
  sidebar: "expanded" | "collapsed";
  colorVision: VisualColorVision;
  statusBoost: boolean;
}>;

export const defaultVisualAppearance: VisualAppearance = {
  theme: "light",
  density: "comfortable",
  accent: "blue",
  corners: "rounded",
  font: "inter",
  fontScale: 1,
  sidebar: "expanded",
  colorVision: "standard",
  statusBoost: false,
};

const isTheme = (value: unknown): value is VisualTheme =>
  ["light", "dark", "command", "contrast", "lowglare", "warm"].includes(
    String(value),
  );
const isDensity = (value: unknown): value is VisualDensity =>
  value === "comfortable" || value === "compact";
const isAccent = (value: unknown): value is VisualAccent =>
  ["blue", "teal", "amber", "violet", "red"].includes(String(value));
const isCorners = (value: unknown): value is VisualCorners =>
  value === "rounded" || value === "sharp";
const isFont = (value: unknown): value is VisualFont =>
  ["inter", "segoe", "arial", "roboto", "roboto-condensed", "atkinson"].includes(
    String(value),
  );
const isColorVision = (value: unknown): value is VisualColorVision =>
  ["standard", "protan", "deutan", "tritan"].includes(String(value));

export const normalizeVisualAppearance = (
  value: Partial<VisualAppearance> | undefined,
): VisualAppearance => ({
  theme: isTheme(value?.theme) ? value.theme : defaultVisualAppearance.theme,
  density: isDensity(value?.density)
    ? value.density
    : defaultVisualAppearance.density,
  accent: isAccent(value?.accent) ? value.accent : defaultVisualAppearance.accent,
  corners: isCorners(value?.corners)
    ? value.corners
    : defaultVisualAppearance.corners,
  font: isFont(value?.font) ? value.font : defaultVisualAppearance.font,
  fontScale:
    typeof value?.fontScale === "number" &&
    Number.isFinite(value.fontScale) &&
    value.fontScale >= 0.875 &&
    value.fontScale <= 1.125
      ? value.fontScale
      : defaultVisualAppearance.fontScale,
  sidebar:
    value?.sidebar === "collapsed" || value?.sidebar === "expanded"
      ? value.sidebar
      : defaultVisualAppearance.sidebar,
  colorVision: isColorVision(value?.colorVision)
    ? value.colorVision
    : defaultVisualAppearance.colorVision,
  statusBoost:
    typeof value?.statusBoost === "boolean"
      ? value.statusBoost
      : defaultVisualAppearance.statusBoost,
});

export interface VisualAppearanceProvider {
  read(): VisualAppearance;
  write(value: VisualAppearance): void;
}

export const browserVisualAppearancePreferences: VisualAppearanceProvider = {
  read: () => {
    try {
      const raw = localStorage.getItem("ph.v2.visual-appearance");
      return raw
        ? normalizeVisualAppearance(JSON.parse(raw) as Partial<VisualAppearance>)
        : defaultVisualAppearance;
    } catch {
      return defaultVisualAppearance;
    }
  },
  write: (value) => {
    try {
      localStorage.setItem("ph.v2.visual-appearance", JSON.stringify(value));
    } catch {
      // Appearance must never block an authenticated V2 workspace.
    }
  },
};

export const applyVisualAppearance = (value: VisualAppearance): void => {
  const root = document.documentElement;
  root.dataset.theme = value.theme;
  root.dataset.density = value.density;
  root.dataset.accent = value.accent;
  root.dataset.corners = value.corners;
  root.dataset.font = value.font;
  root.dataset.cvd = value.colorVision;
  root.dataset.statusBoost = value.statusBoost ? "on" : "off";
  root.style.setProperty("--font-scale", String(value.fontScale));
};
