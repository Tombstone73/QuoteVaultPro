import { Check, Palette, Type } from "lucide-react";
import type {
  VisualAccent,
  VisualAppearance,
  VisualDensity,
  VisualFont,
  VisualTheme,
  VisualColorVision,
} from "./appearance";

const themes: readonly Readonly<{ id: VisualTheme; label: string; hint: string }>[] = [
  { id: "light", label: "Modern Light", hint: "Front desk, daylight shops, customer-facing screens" },
  { id: "dark", label: "Modern Dark", hint: "Late shifts, design and prepress work" },
  { id: "command", label: "Command Center", hint: "Dense, squared, high-signal workspaces" },
  { id: "contrast", label: "High Contrast", hint: "Maximum separation for glare-heavy areas" },
  { id: "lowglare", label: "Low Glare", hint: "Charcoal surfaces for long sessions" },
  { id: "warm", label: "Warm Neutral", hint: "Warm gray and ivory for sales and accounting" },
];
const accents: readonly Readonly<{ id: VisualAccent; label: string }>[] = [
  { id: "blue", label: "Signal Blue" },
  { id: "teal", label: "Press Teal" },
  { id: "amber", label: "Amber" },
  { id: "violet", label: "Violet" },
  { id: "red", label: "Ink Red" },
];
const fonts: readonly Readonly<{ id: VisualFont; label: string }>[] = [
  { id: "inter", label: "Inter" },
  { id: "segoe", label: "Segoe UI" },
  { id: "arial", label: "Arial" },
  { id: "roboto", label: "Roboto" },
  { id: "roboto-condensed", label: "Roboto Condensed" },
  { id: "atkinson", label: "Atkinson Hyperlegible" },
];
const colorVision: readonly Readonly<{ id: VisualColorVision; label: string }>[] = [{ id: "standard", label: "Standard" }, { id: "protan", label: "Protan" }, { id: "deutan", label: "Deutan" }, { id: "tritan", label: "Tritan" }];

export const AppearanceWorkspace = ({
  appearance,
  setAppearance,
}: Readonly<{
  appearance: VisualAppearance;
  setAppearance: (patch: Partial<VisualAppearance>) => void;
}>) => (
  <section className="v2-page v2-appearance-page">
    <header className="v2-page-header">
      <div>
        <h1>Themes &amp; Appearance</h1>
        <p>Personal visual preferences for this V2 workspace.</p>
      </div>
      <span className="v2-appearance-deferred">Browser preference until a typed preference API is introduced.</span>
    </header>
    <div className="v2-appearance-grid">
      <section className="v2-appearance-panel">
        <h2><Palette aria-hidden /> Workspace theme</h2>
        <p>Approved Lovable visual themes apply to the shared shell and every V2 page.</p>
        <div className="v2-theme-cards">
          {themes.map((theme) => (
            <button
              key={theme.id}
              type="button"
              aria-label={`Select ${theme.label} theme`}
              className={appearance.theme === theme.id ? "is-selected" : ""}
              onClick={() => setAppearance({ theme: theme.id })}
            >
              <span className="v2-theme-card-preview" data-preview-theme={theme.id} />
              <strong>{theme.label}</strong>
              <small>{theme.hint}</small>
              {appearance.theme === theme.id && <Check aria-hidden />}
            </button>
          ))}
        </div>
      </section>
      <section className="v2-appearance-panel">
        <h2>Workspace density</h2>
        <Segmented
          value={appearance.density}
          onChange={(density) => setAppearance({ density })}
          options={[
            { id: "comfortable", label: "Comfortable" },
            { id: "compact", label: "Compact" },
          ]}
        />
        <h2 className="v2-subhead">Corners</h2>
        <Segmented
          value={appearance.corners}
          onChange={(corners) => setAppearance({ corners })}
          options={[
            { id: "rounded", label: "Rounded" },
            { id: "sharp", label: "Sharp" },
          ]}
        />
        <h2 className="v2-subhead">Accent color</h2>
        <div className="v2-accent-options">
          {accents.map((accent) => (
            <button
              key={accent.id}
              type="button"
              onClick={() => setAppearance({ accent: accent.id })}
              className={appearance.accent === accent.id ? "is-selected" : ""}
            >
              <i data-accent={accent.id} /> {accent.label}
              {appearance.accent === accent.id && <Check aria-hidden />}
            </button>
          ))}
        </div>
      </section>
      <section className="v2-appearance-panel">
        <h2><Type aria-hidden /> Typography</h2>
        <div className="v2-font-options">
          {fonts.map((font) => (
            <button
              key={font.id}
              type="button"
              data-font={font.id}
              className={appearance.font === font.id ? "is-selected" : ""}
              onClick={() => setAppearance({ font: font.id })}
            >
              <strong>{font.label}</strong>
              <span>Order #10671 â€” 24 pcs</span>
              {appearance.font === font.id && <Check aria-hidden />}
            </button>
          ))}
        </div>
        <h2 className="v2-subhead">Text scale</h2>
        <input aria-label="Text scale" type="range" min="0.875" max="1.125" step="0.025" value={appearance.fontScale} onChange={(event) => setAppearance({ fontScale: Number(event.target.value) })} />
        <h2 className="v2-subhead">Color vision</h2>
        <Segmented value={appearance.colorVision} onChange={(colorVision) => setAppearance({ colorVision })} options={colorVision} />
        <h2 className="v2-subhead">Status emphasis</h2>
        <label><input type="checkbox" checked={appearance.statusBoost} onChange={(event) => setAppearance({ statusBoost: event.target.checked })} /> Increase status contrast</label>
      </section>
    </div>
  </section>
);

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: Readonly<{
  value: T;
  onChange: (value: T) => void;
  options: readonly Readonly<{ id: T; label: string }>[];
}>) {
  return (
    <div className="v2-segmented">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={value === option.id ? "is-selected" : ""}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
