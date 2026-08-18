import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Ban, Building2, Check, CheckCircle, Eye, Lock, Palette, RotateCcw, Trash2, TriangleAlert, Upload, User, XCircle } from "lucide-react";
import { PageHeader, Panel, Status } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApp, type Accent } from "@/lib/app-store";
import { CURRENT_USER } from "@/lib/mock/data";
import { cn } from "@/lib/utils";
import {
  COLOR_VISION, FONT_SCALE, FONT_SETS, LivePreview, MiniTheme, THEME_LABEL,
  type AccentId, type ColorVisionId, type CornerId, type DensityId, type FontId, type FontScaleId, type PreviewSettings, type ThemeId,
} from "@/components/app/theme-preview";


export const Route = createFileRoute("/_shell/appearance")({
  head: () => ({
    meta: [
      { title: "Themes & Appearance — PrintersHero V2" },
      { name: "description", content: "Set the organization theme defaults and your personal appearance preferences, with a live PrintersHero preview." },
      { property: "og:title", content: "Themes & Appearance — PrintersHero V2" },
      { property: "og:description", content: "Organization theme defaults and personal overrides, previewed instantly." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AppearancePage,
});

/* ---------------- models ---------------- */

type Inherit<T> = T | "inherit";

interface OrgSettings {
  theme: ThemeId;
  accent: AccentId;
  density: DensityId;
  fontScale: FontScaleId;
  sidebar: DensityId;
  rows: DensityId;
  corners: CornerId;
  font: FontId;
  name: string;
  logo: string;
  allowCommand: boolean;
}

interface UserSettings {
  theme: Inherit<ThemeId | "system">;
  density: Inherit<DensityId>;
  fontScale: Inherit<FontScaleId>;
  sidebar: Inherit<DensityId>;
  rows: Inherit<DensityId>;
  font: Inherit<FontId>;
  reducedMotion: boolean;
  colorVision: ColorVisionId;
  statusBoost: boolean;
}

const defaultOrg: OrgSettings = {
  theme: "light", accent: "blue", density: "comfortable", fontScale: "default",
  sidebar: "comfortable", rows: "comfortable", corners: "subtle", font: "inter",
  name: "Hensley Graphics", logo: "HG", allowCommand: true,
};

const defaultUser: UserSettings = {
  theme: "inherit", density: "inherit", fontScale: "inherit",
  sidebar: "inherit", rows: "inherit", font: "inherit", reducedMotion: false,
  colorVision: "standard", statusBoost: false,
};

const themeCards: { id: ThemeId; label: string; hint: string }[] = [
  { id: "light", label: "Modern Light", hint: "Front desk, daylight shops, customer-facing screens" },
  { id: "dark", label: "Modern Dark", hint: "Late shifts, design and prepress work" },
  { id: "command", label: "Command Center", hint: "Wall displays and the production floor — dense, squared, high-signal" },
  { id: "contrast", label: "High Contrast", hint: "Maximum separation and strong borders for bright, glare-heavy areas" },
  { id: "lowglare", label: "Low Glare", hint: "Charcoal surfaces and restrained brightness for long sessions" },
  { id: "warm", label: "Warm Neutral", hint: "Warm gray and ivory — comfortable for sales, counter and accounting" },
];


const accents: { id: AccentId; label: string }[] = [
  { id: "blue", label: "Signal Blue" }, { id: "teal", label: "Press Teal" },
  { id: "amber", label: "Amber" }, { id: "violet", label: "Violet" }, { id: "red", label: "Ink Red" },
];

/* ---------------- small controls ---------------- */

function SegGroup<T extends string>({
  value, onChange, options, className,
}: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[]; className?: string }) {
  return (
    <div className={cn("inline-flex flex-wrap gap-1 rounded-md border border-border bg-surface-2 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-[calc(var(--radius)-2px)] px-2.5 py-1 text-[12px] font-medium transition-colors",
            value === o.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({
  label, source, onReset, children,
}: { label: string; source?: "inherited" | "override"; onReset?: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="text-[12px]">{label}</Label>
        {source && (
          <span
            className={cn(
              "rounded border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide",
              source === "inherited"
                ? "border-border bg-surface-2 text-muted-foreground"
                : "border-primary/40 bg-primary/10 text-primary",
            )}
          >
            {source === "inherited" ? "Inherited from organization" : "Personal override"}
          </span>
        )}
        {source === "override" && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            <RotateCcw className="size-3" /> Use organization default
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

const densityOpts: { id: DensityId; label: string }[] = [
  { id: "comfortable", label: "Comfortable" }, { id: "compact", label: "Compact" },
];
const fontOpts: { id: FontScaleId; label: string }[] = [
  { id: "small", label: "Small" }, { id: "default", label: "Default" }, { id: "large", label: "Large" },
];
const cornerOpts: { id: CornerId; label: string }[] = [
  { id: "square", label: "Square" }, { id: "subtle", label: "Subtle" }, { id: "rounded", label: "Rounded" },
];

function StatusSwatch({ label }: { label: string }) {
  return <Status value={label} className="text-[10px]" />;
}


/* ---------------- page ---------------- */

function AppearancePage() {
  const { setAppearance } = useApp();
  const [scope, setScope] = useState<"org" | "user">("org");
  const [org, setOrg] = useState<OrgSettings>(defaultOrg);
  const [user, setUser] = useState<UserSettings>(defaultUser);

  const systemDark =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;

  const effective: PreviewSettings = useMemo(() => {
    const theme: ThemeId =
      user.theme === "inherit" ? org.theme
      : user.theme === "system" ? (systemDark ? "dark" : "light")
      : user.theme;
    return {
      theme,
      accent: org.accent,
      density: user.density === "inherit" ? org.density : user.density,
      fontScale: user.fontScale === "inherit" ? org.fontScale : user.fontScale,
      sidebar: user.sidebar === "inherit" ? org.sidebar : user.sidebar,
      rows: user.rows === "inherit" ? org.rows : user.rows,
      corners: org.corners,
      font: user.font === "inherit" ? org.font : user.font,
      reducedMotion: user.reducedMotion,
      colorVision: user.colorVision,
      statusBoost: user.statusBoost,
      orgName: org.name,
    };
  }, [org, user, systemDark]);

  // Preview of the org baseline only (used while editing organization defaults)
  const orgBaseline: PreviewSettings = {
    theme: org.theme, accent: org.accent, density: org.density, fontScale: org.fontScale,
    sidebar: org.sidebar, rows: org.rows, corners: org.corners, font: org.font, reducedMotion: false,
    colorVision: "standard", statusBoost: false, orgName: org.name,
  };
  const preview = scope === "org" ? orgBaseline : effective;

  function applyScope() {
    const s = scope === "org" ? orgBaseline : effective;
    setAppearance({
      theme: s.theme,
      density: s.density,
      accent: s.accent as Accent,
      corners: s.corners === "square" ? "sharp" : "rounded",
      fontScale: FONT_SCALE[s.fontScale],
      font: s.font,
      colorVision: s.colorVision,
      statusBoost: s.statusBoost,
    });
  }

  const src = <T,>(v: Inherit<T>) => (v === "inherit" ? "inherited" : "override") as "inherited" | "override";

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title="Themes & Appearance"
        subtitle={
          scope === "org"
            ? "Default appearance for users in this organization."
            : "Personal appearance preferences for your workspace."
        }
        actions={
          <Button size="sm" className="h-8 gap-1.5" onClick={applyScope}>
            <Check className="size-4" />
            {scope === "org" ? "Save organization theme" : "Save my appearance"}
          </Button>
        }
      />


      {/* scope switch */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-border bg-surface-2 p-1">
          {[
            { id: "org" as const, label: "Organization Theme", icon: Building2 },
            { id: "user" as const, label: "My Appearance", icon: User },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setScope(t.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[calc(var(--radius)-2px)] px-3 py-1.5 text-[13px] font-medium transition-colors",
                scope === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="size-4" /> {t.label}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-muted-foreground">
          {scope === "org"
            ? `Applies to everyone in ${org.name} unless a user sets a personal override.`
            : `Affects only ${CURRENT_USER.name}. Organization defaults stay unchanged.`}
        </p>
      </div>

      {/* inheritance model */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px]">
        <span className="rounded border border-border bg-background px-2 py-0.5 text-muted-foreground">System default</span>
        <span className="text-muted-foreground">+</span>
        <span className={cn("rounded border px-2 py-0.5", scope === "org" ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground")}>
          Organization theme
        </span>
        <span className="text-muted-foreground">+</span>
        <span className={cn("rounded border px-2 py-0.5", scope === "user" ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground")}>
          Your preferences
        </span>
        <span className="ml-auto text-muted-foreground">
          You currently see: <strong className="text-foreground">{THEME_LABEL[effective.theme]}</strong>
          {" · "}<span className="capitalize">{effective.density}</span>
          {user.theme === "inherit" && user.density === "inherit" ? " (all inherited)" : " (personal overrides active)"}
        </span>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* ---------- left: controls ---------- */}
        <div className="space-y-3">
          {scope === "org" ? (
            <>
              <Panel title="Theme presets">
                <div className="grid gap-3 sm:grid-cols-3">
                  {themeCards.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setOrg({ ...org, theme: t.id })}
                      className={cn(
                        "rounded-md border p-2 text-left transition-colors",
                        org.theme === t.id ? "border-primary ring-1 ring-primary" : "border-border hover:bg-accent/60",
                      )}
                    >
                      <MiniTheme theme={t.id} accent={org.accent} />
                      <div className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold">
                        {t.label}
                        {org.theme === t.id && <Check className="size-3.5 text-primary" />}
                      </div>
                      <div className="text-[11px] leading-snug text-muted-foreground">{t.hint}</div>
                    </button>
                  ))}
                </div>
              </Panel>

              <Panel title="Organization defaults">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Default density">
                    <SegGroup value={org.density} onChange={(density) => setOrg({ ...org, density })} options={densityOpts} />
                  </Field>
                  <Field label="Default font scale">
                    <SegGroup value={org.fontScale} onChange={(fontScale) => setOrg({ ...org, fontScale })} options={fontOpts} />
                  </Field>
                  <Field label="Sidebar density">
                    <SegGroup value={org.sidebar} onChange={(sidebar) => setOrg({ ...org, sidebar })} options={densityOpts} />
                  </Field>
                  <Field label="Table row density">
                    <SegGroup value={org.rows} onChange={(rows) => setOrg({ ...org, rows })} options={densityOpts} />
                  </Field>
                  <Field label="Corner style">
                    <SegGroup value={org.corners} onChange={(corners) => setOrg({ ...org, corners })} options={cornerOpts} />
                  </Field>
                  <Field label="Command Center theme">
                    <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                      <Switch checked={org.allowCommand} onCheckedChange={(allowCommand) => setOrg({ ...org, allowCommand })} />
                      Allow users to select it personally
                    </div>
                  </Field>
                </div>
              </Panel>

              <Panel title="Typeface">
                <TypefaceCards value={org.font} onChange={(font) => setOrg({ ...org, font: font as FontId })} />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Sets the default typeface for everyone. Users can pick a different one for themselves.
                </p>
              </Panel>

              <AccentPanel accent={org.accent} onChange={(accent) => setOrg({ ...org, accent })} />

              <Panel title="Organization branding">
                <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                  <div className="space-y-1.5">
                    <Label className="text-[12px]">Logo</Label>
                    <div className="flex items-center gap-2">
                      <div className="flex size-12 items-center justify-center rounded-md bg-primary text-[15px] font-bold text-primary-foreground">
                        {org.logo.slice(0, 2).toUpperCase()}
                      </div>
                      <Button size="sm" variant="outline" className="h-8 gap-1.5" type="button">
                        <Upload className="size-3.5" /> Upload
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[12px]">Organization display name</Label>
                    <Input
                      className="h-8 text-[13px]"
                      value={org.name}
                      onChange={(e) => setOrg({ ...org, name: e.target.value, logo: e.target.value.slice(0, 2) })}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Employee workspace only. Customer storefront branding is configured separately.
                    </p>
                  </div>
                </div>
              </Panel>
            </>
          ) : (
            <>
              <Panel title="My preferences">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Theme"
                    source={src(user.theme)}
                    onReset={() => setUser({ ...user, theme: "inherit" })}
                  >
                    <SegGroup
                      value={user.theme}
                      onChange={(theme) => setUser({ ...user, theme })}
                      options={[
                        { id: "inherit" as const, label: "Organization default" },
                        { id: "system" as const, label: "System" },
                        { id: "light" as const, label: "Modern Light" },
                        { id: "dark" as const, label: "Modern Dark" },
                        ...(org.allowCommand ? [{ id: "command" as const, label: "Command Center" }] : []),
                        { id: "contrast" as const, label: "High Contrast" },
                        { id: "lowglare" as const, label: "Low Glare" },
                        { id: "warm" as const, label: "Warm Neutral" },
                      ]}

                    />
                  </Field>
                  <Field label="Density" source={src(user.density)} onReset={() => setUser({ ...user, density: "inherit" })}>
                    <SegGroup
                      value={user.density}
                      onChange={(density) => setUser({ ...user, density })}
                      options={[{ id: "inherit" as const, label: "Organization default" }, ...densityOpts]}
                    />
                  </Field>
                  <Field label="Font scale" source={src(user.fontScale)} onReset={() => setUser({ ...user, fontScale: "inherit" })}>
                    <SegGroup
                      value={user.fontScale}
                      onChange={(fontScale) => setUser({ ...user, fontScale })}
                      options={[{ id: "inherit" as const, label: "Organization default" }, ...fontOpts]}
                    />
                  </Field>
                  <Field label="Sidebar density" source={src(user.sidebar)} onReset={() => setUser({ ...user, sidebar: "inherit" })}>
                    <SegGroup
                      value={user.sidebar}
                      onChange={(sidebar) => setUser({ ...user, sidebar })}
                      options={[{ id: "inherit" as const, label: "Organization default" }, ...densityOpts]}
                    />
                  </Field>
                  <Field label="Table row height" source={src(user.rows)} onReset={() => setUser({ ...user, rows: "inherit" })}>
                    <SegGroup
                      value={user.rows}
                      onChange={(rows) => setUser({ ...user, rows })}
                      options={[{ id: "inherit" as const, label: "Organization default" }, ...densityOpts]}
                    />
                  </Field>
                  <Field label="Reduced motion" source={user.reducedMotion ? "override" : "inherited"} onReset={() => setUser({ ...user, reducedMotion: false })}>
                    <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                      <Switch checked={user.reducedMotion} onCheckedChange={(reducedMotion) => setUser({ ...user, reducedMotion })} />
                      Minimize animations and transitions
                    </div>
                  </Field>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                  <p className="text-[12px] text-muted-foreground">
                    Accent and corner style follow the organization theme.
                  </p>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setUser(defaultUser)}>
                    <RotateCcw className="size-3.5" /> Reset all to organization defaults
                  </Button>
                </div>
              </Panel>

              <Panel
                title={
                  <span className="flex items-center gap-2">
                    Typography
                    <span
                      className={cn(
                        "rounded border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide",
                        user.font === "inherit"
                          ? "border-border bg-surface-2 text-muted-foreground"
                          : "border-primary/40 bg-primary/10 text-primary",
                      )}
                    >
                      {user.font === "inherit" ? "Inherited from organization" : "Personal override"}
                    </span>
                  </span>
                }
              >
                <TypefaceCards
                  value={user.font}
                  onChange={(font) => setUser({ ...user, font })}
                  allowInherit
                  inherited={org.font}
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Font family is separate from Font scale — pair any face with Small, Default or Large type.
                </p>
              </Panel>

              <Panel title="Color vision & accessibility">
                <p className="text-[12px] text-muted-foreground">
                  A personal accessibility layer on top of your theme. It re-maps status hues only — the theme keeps its
                  own personality, and no organization-wide setting is changed.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {COLOR_VISION.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setUser({ ...user, colorVision: c.id })}
                      className={cn(
                        "rounded-md border p-2.5 text-left transition-colors",
                        user.colorVision === c.id ? "border-primary ring-1 ring-primary" : "border-border hover:bg-accent/60",
                      )}
                    >
                      <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                        <Eye className="size-3.5" /> {c.label}
                        {user.colorVision === c.id && <Check className="ml-auto size-3.5 text-primary" />}
                      </div>
                      <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{c.hint}</div>
                      <div
                        data-cvd={c.id}
                        className="mt-2 flex flex-wrap gap-1"
                      >
                        {["Ready", "Waiting on Proof", "Late", "Blocked"].map((s) => (
                          <StatusSwatch key={s} label={s} />
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex items-start gap-3 border-t border-border pt-3">
                  <Switch
                    checked={user.statusBoost}
                    onCheckedChange={(statusBoost) => setUser({ ...user, statusBoost })}
                    aria-label="Enhanced status differentiation"
                  />
                  <div>
                    <div className="text-[13px] font-medium">Enhanced status differentiation</div>
                    <p className="text-[11px] text-muted-foreground">
                      Use stronger icons, borders, labels and visual separation between workflow states. Works with any
                      theme and any color-vision setting.
                    </p>
                  </div>
                </div>
              </Panel>

              <AccentPanel accent={org.accent} readOnly />

            </>
          )}

          <Panel title="Protected system colors">
            <p className="text-[12px] text-muted-foreground">
              Operational status colors are controlled by PrintersHero so job states mean the same thing in every theme.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { label: "Success", icon: CheckCircle, cls: "text-ok border-ok bg-ok/20" },
                { label: "Warning", icon: TriangleAlert, cls: "text-warn border-warn bg-warn/20" },
                { label: "Error", icon: XCircle, cls: "text-destructive-foreground border-destructive bg-destructive" },
                { label: "Blocked", icon: Ban, cls: "text-blocked border-blocked bg-blocked/20" },
                { label: "Destructive", icon: Trash2, cls: "text-destructive-foreground border-destructive bg-destructive" },
                { label: "Disabled", icon: Lock, cls: "text-muted-foreground border-border bg-surface-2" },
                { label: "Focus ring", icon: Check, cls: "text-primary border-primary bg-primary/15" },
              ].map((s) => (
                <span key={s.label} className={cn("inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium", s.cls)}>
                  <s.icon className="size-3.5" /> {s.label}
                </span>
              ))}
            </div>
          </Panel>
        </div>

        {/* ---------- right: live preview ---------- */}
        <div className="space-y-3">
          <Panel
            title={scope === "org" ? "Live preview — organization default" : "Live preview — your workspace"}
            action={
              <span className="text-[11px] text-muted-foreground">
                {preview.theme === "command" ? "Command Center" : preview.theme === "dark" ? "Modern Dark" : "Modern Light"}
                {" · "}{preview.density} · {preview.fontScale} type · {preview.corners} corners
              </span>
            }
            dense
          >
            <div className="p-3">
              <LivePreview settings={preview} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function TypefaceCards({
  value, onChange, allowInherit, inherited,
}: {
  value: FontId | "inherit";
  onChange: (v: FontId | "inherit") => void;
  allowInherit?: boolean;
  inherited?: FontId;
}) {
  const resolved: FontId = value === "inherit" ? (inherited ?? "inter") : value;
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {FONT_SETS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange(f.id)}
            data-font={f.id}
            className={cn(
              "rounded-md border p-2.5 text-left transition-colors",
              resolved === f.id && value !== "inherit"
                ? "border-primary ring-1 ring-primary"
                : resolved === f.id
                  ? "border-primary/50"
                  : "border-border hover:bg-accent/60",
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] font-semibold" style={{ fontFamily: "var(--ui-font-display)" }}>{f.label}</span>
              {resolved === f.id && <Check className="size-3.5 text-primary" />}
            </div>
            <div className="mt-1 text-[15px]" style={{ fontFamily: "var(--ui-font)" }}>
              Order <span style={{ fontFamily: "var(--ui-font-mono)" }}>#10671</span> — 24 pcs
            </div>
            <div className="mt-1 text-[11px] leading-snug text-muted-foreground" style={{ fontFamily: "var(--ui-font)" }}>
              {f.hint}
            </div>
          </button>
        ))}
      </div>
      {allowInherit && (
        <button
          type="button"
          onClick={() => onChange("inherit")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px]",
            value === "inherit" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          <RotateCcw className="size-3.5" /> Use organization default
        </button>
      )}
    </div>
  );
}

function AccentPanel({
  accent, onChange, readOnly,
}: { accent: AccentId; onChange?: (a: AccentId) => void; readOnly?: boolean }) {
  return (
    <Panel title="Accent color">
      <div className="flex flex-wrap items-center gap-2">
        {accents.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={readOnly}
            onClick={() => onChange?.(a.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-md border px-2 py-1.5 text-[12px]",
              accent === a.id ? "border-primary ring-1 ring-primary" : "border-border hover:bg-accent/60",
              readOnly && "cursor-not-allowed opacity-70",
            )}
          >
            <span className="size-4 rounded-full" style={{ background: `var(--accent-${a.id})` }} />
            {a.label}
            {accent === a.id && <Check className="size-3.5 text-primary" />}
          </button>
        ))}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Palette className="size-3.5" />
        {readOnly
          ? "Accent is set by the organization theme."
          : "Curated palette only — accent affects interactive elements, never status meaning."}
      </p>
    </Panel>
  );
}
