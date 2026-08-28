import { createFileRoute } from "@tanstack/react-router";
import { User } from "lucide-react";
import { DeepLink, ReadyChip, Section, SettingsPage } from "@/components/app/settings/shared";
import { Switch } from "@/components/ui/switch";
import { useApp, type Accent, type ColorVision, type FontFamilyId, type ThemeName } from "@/lib/app-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/settings/preferences")({
  head: () => ({
    meta: [
      { title: "My Appearance — PrintersHero V2 Settings" },
      { name: "description", content: "Personal theme, font and accessibility preferences that apply only to your account." },
      { property: "og:title", content: "My Appearance — PrintersHero V2 Settings" },
      { property: "og:description", content: "Your own view of PrintersHero, previewed live." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PreferencesPage,
});

const THEMES: { id: ThemeName; label: string }[] = [
  { id: "light", label: "Modern Light" },
  { id: "dark", label: "Modern Dark" },
  { id: "command", label: "Command Center" },
  { id: "contrast", label: "High Contrast" },
  { id: "lowglare", label: "Low Glare" },
  { id: "warm", label: "Warm Neutral" },
];

const FONTS: { id: FontFamilyId; label: string }[] = [
  { id: "inter", label: "Inter" },
  { id: "segoe", label: "Segoe UI" },
  { id: "arial", label: "Arial" },
  { id: "roboto", label: "Roboto" },
  { id: "roboto-condensed", label: "Roboto Condensed" },
  { id: "atkinson", label: "Atkinson Hyperlegible" },
];

const VISION: { id: ColorVision; label: string }[] = [
  { id: "standard", label: "Standard" },
  { id: "protan", label: "Red-weak (protan)" },
  { id: "deutan", label: "Green-weak (deutan)" },
  { id: "tritan", label: "Blue-weak (tritan)" },
];

const ACCENTS: { id: Accent; label: string }[] = [
  { id: "blue", label: "Signal Blue" }, { id: "teal", label: "Press Teal" },
  { id: "amber", label: "Amber" }, { id: "violet", label: "Violet" }, { id: "red", label: "Ink Red" },
];

function Chip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
        active ? "border-primary bg-primary/12 text-primary" : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PreferencesPage() {
  const { appearance, setAppearance } = useApp();

  return (
    <SettingsPage
      title="My Preferences · Appearance"
      description="These settings apply only to you. They do not change what anyone else sees."
      actions={<ReadyChip state="optional" label="Personal" />}
    >
      <div className="flex items-start gap-2 rounded-lg border border-info/40 bg-info/10 px-3 py-2.5 text-[12px]">
        <User className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <span>Organization default: <strong>Modern Light</strong>. Anything you choose here overrides that default for your account only.</span>
      </div>

      <Section title="Theme">
        <div className="flex flex-wrap gap-2">
          {THEMES.map((t) => <Chip key={t.id} active={appearance.theme === t.id} onClick={() => setAppearance({ theme: t.id })}>{t.label}</Chip>)}
        </div>
      </Section>

      <Section title="Accent">
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((a) => <Chip key={a.id} active={appearance.accent === a.id} onClick={() => setAppearance({ accent: a.id })}>{a.label}</Chip>)}
        </div>
      </Section>

      <Section title="Font" hint="Choose from the supported list. Custom font files cannot be uploaded.">
        <div className="flex flex-wrap gap-2">
          {FONTS.map((f) => <Chip key={f.id} active={appearance.font === f.id} onClick={() => setAppearance({ font: f.id })}>{f.label}</Chip>)}
        </div>
      </Section>

      <Section title="Accessibility">
        <div className="space-y-2">
          <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2/50 px-3 py-2 text-[13px]">
            <span>High contrast theme<span className="block text-[11px] text-muted-foreground">Stronger borders and separation for bright areas.</span></span>
            <Switch checked={appearance.theme === "contrast"} onCheckedChange={(v) => setAppearance({ theme: v ? "contrast" : "light" })} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2/50 px-3 py-2 text-[13px]">
            <span>Enhanced status differentiation<span className="block text-[11px] text-muted-foreground">Adds shape and text cues so status is not carried by color alone.</span></span>
            <Switch checked={appearance.statusBoost} onCheckedChange={(v) => setAppearance({ statusBoost: v })} />
          </label>
          <div className="rounded-md border border-border bg-surface-2/50 px-3 py-2">
            <div className="text-[13px]">Color vision</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {VISION.map((v) => <Chip key={v.id} active={appearance.colorVision === v.id} onClick={() => setAppearance({ colorVision: v.id })}>{v.label}</Chip>)}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Live preview" hint="Changes apply immediately across PrintersHero for your account.">
        <div className="panel space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <ReadyChip state="ready" /><ReadyChip state="attention" /><ReadyChip state="not-configured" /><ReadyChip state="error" />
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1.5">Order</th><th className="px-2 py-1.5">Customer</th><th className="px-2 py-1.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr><td className="num px-2 py-1.5">10671</td><td className="px-2 py-1.5">Delta Signs</td><td className="num px-2 py-1.5 text-right">$1,240.00</td></tr>
              <tr><td className="num px-2 py-1.5">10672</td><td className="px-2 py-1.5">Northend Brewing</td><td className="num px-2 py-1.5 text-right">$486.50</td></tr>
            </tbody>
          </table>
        </div>
        <div className="mt-3"><DeepLink to="/appearance">Open full Themes & Appearance</DeepLink></div>
      </Section>
    </SettingsPage>
  );
}
