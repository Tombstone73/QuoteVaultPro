import type { CSSProperties, ReactNode } from "react";
import { AlertTriangle, ChevronDown, Image as ImageIcon, LayoutGrid, Printer, Search } from "lucide-react";
import { Status } from "@/components/app/primitives";
import { cn } from "@/lib/utils";

export type ThemeId = "light" | "dark" | "command" | "contrast" | "lowglare" | "warm";
export type DensityId = "comfortable" | "compact";
export type FontScaleId = "small" | "default" | "large";
export type CornerId = "square" | "subtle" | "rounded";
export type AccentId = "blue" | "teal" | "amber" | "violet" | "red";
export type FontId = "inter" | "segoe" | "arial" | "roboto" | "roboto-condensed" | "atkinson";
export type ColorVisionId = "standard" | "protan" | "deutan" | "tritan";

export const FONT_SETS: { id: FontId; label: string; hint: string }[] = [
  { id: "inter", label: "Inter", hint: "Clean modern application default" },
  { id: "segoe", label: "Segoe UI", hint: "Familiar Windows-native workstation feel" },
  { id: "arial", label: "Arial", hint: "Maximum familiarity and compatibility" },
  { id: "roboto", label: "Roboto", hint: "Clean, highly compatible general-purpose UI" },
  { id: "roboto-condensed", label: "Roboto Condensed", hint: "Narrower — fits dense operational screens" },
  { id: "atkinson", label: "Atkinson Hyperlegible", hint: "Enhanced character recognition and readability" },
];

export const COLOR_VISION: { id: ColorVisionId; label: string; hint: string }[] = [
  { id: "standard", label: "Standard", hint: "Default PrintersHero status palette" },
  { id: "protan", label: "Protanopia", hint: "Reduced red perception — states use blue, amber and magenta" },
  { id: "deutan", label: "Deuteranopia", hint: "Reduced green perception — no red/green-only distinctions" },
  { id: "tritan", label: "Tritanopia", hint: "Blue/yellow difficulty — states use green, orange and pink" },
];

export const FONT_SCALE: Record<FontScaleId, number> = { small: 0.92, default: 1, large: 1.1 };
export const CORNER_RADIUS: Record<CornerId, string> = {
  square: "0.0625rem",
  subtle: "0.375rem",
  rounded: "0.75rem",
};

export const THEME_LABEL: Record<ThemeId, string> = {
  light: "Modern Light",
  dark: "Modern Dark",
  command: "Command Center",
  contrast: "High Contrast",
  lowglare: "Low Glare",
  warm: "Warm Neutral",
};

export interface PreviewSettings {
  theme: ThemeId;
  accent: AccentId;
  density: DensityId;
  fontScale: FontScaleId;
  sidebar: DensityId;
  rows: DensityId;
  corners: CornerId;
  reducedMotion: boolean;
  font: FontId;
  colorVision: ColorVisionId;
  statusBoost: boolean;
  orgName: string;
}

export function previewStyle(s: PreviewSettings): CSSProperties {
  return {
    fontSize: `${13 * FONT_SCALE[s.fontScale]}px`,
    ["--radius" as string]: CORNER_RADIUS[s.corners],
    ["--row-h" as string]: s.rows === "compact" ? "1.9rem" : "2.6rem",
  };
}


/* ---------- miniature theme card preview ---------- */

export function MiniTheme({ theme, accent }: { theme: ThemeId; accent: AccentId }) {
  const command = theme === "command";
  return (
    <div
      data-theme={theme}
      data-accent={accent}
      data-corners={command ? "sharp" : "rounded"}
      className="pointer-events-none overflow-hidden rounded-md border border-border-strong/60"
      style={{ background: "var(--background)", color: "var(--foreground)" }}
    >
      <div className="flex h-[104px]">
        <div
          className={cn("flex w-[26%] shrink-0 flex-col gap-[3px] p-[5px]", command && "gap-[2px]")}
          style={{ background: "var(--sidebar)", borderRight: "1px solid var(--sidebar-border)" }}
        >
          <div className="mb-[3px] flex items-center gap-1">
            <span className="size-[9px] rounded-[2px]" style={{ background: "var(--primary)" }} />
            <span className="h-[4px] flex-1 rounded-full" style={{ background: "var(--border-strong)" }} />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={cn("h-[9px] rounded-[3px]", command && "rounded-none")}
              style={
                i === 1
                  ? { background: "color-mix(in oklab, var(--primary) 22%, transparent)", borderLeft: "2px solid var(--primary)" }
                  : { background: "var(--sidebar-accent)" }
              }
            />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className="flex h-[16px] items-center gap-1 px-[5px]"
            style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}
          >
            <span className="h-[5px] w-[38%] rounded-full" style={{ background: "var(--muted)" }} />
            <span className="ml-auto h-[7px] w-[16px] rounded-[3px]" style={{ background: "var(--primary)" }} />
          </div>
          <div className="flex-1 space-y-[4px] p-[5px]">
            {command ? (
              <>
                <div className="flex gap-[4px]">
                  {["var(--ok)", "var(--warn)", "var(--late)"].map((c) => (
                    <div key={c} className="flex-1 border p-[3px]" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                      <div className="h-[3px] w-[60%]" style={{ background: "var(--muted-foreground)" }} />
                      <div className="mt-[3px] h-[7px] w-[70%]" style={{ background: c }} />
                    </div>
                  ))}
                </div>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-[4px]" style={{ borderTop: "1px solid var(--border)", paddingTop: 2 }}>
                    <span className="h-[4px] w-[18%]" style={{ background: "var(--primary)" }} />
                    <span className="h-[4px] flex-1" style={{ background: "var(--muted)" }} />
                    <span className="h-[4px] w-[12%]" style={{ background: i === 0 ? "var(--late)" : "var(--ok)" }} />
                  </div>
                ))}
              </>
            ) : (
              <>
                <div
                  className="rounded-[4px] p-[5px]"
                  style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                >
                  <div className="h-[4px] w-[45%] rounded-full" style={{ background: "var(--muted-foreground)" }} />
                  <div className="mt-[5px] flex items-center gap-[4px]">
                    <span className="h-[6px] flex-1 rounded-full" style={{ background: "var(--muted)" }} />
                    <span className="h-[6px] w-[20%] rounded-full" style={{ background: "var(--ok)" }} />
                  </div>
                  <div className="mt-[4px] flex items-center gap-[4px]">
                    <span className="h-[6px] flex-1 rounded-full" style={{ background: "var(--muted)" }} />
                    <span className="h-[6px] w-[20%] rounded-full" style={{ background: "var(--warn)" }} />
                  </div>
                </div>
                <div className="flex gap-[4px]">
                  <span className="h-[10px] w-[34px] rounded-[4px]" style={{ background: "var(--primary)" }} />
                  <span className="h-[10px] w-[28px] rounded-[4px]" style={{ background: "var(--secondary)" }} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- rich live preview ---------- */

const jobs = [
  { id: "10671", cust: "Delta Faucet Company", item: "3mm ACM Panels", qty: 24, status: "In Production" },
  { id: "10672", cust: "McDonald's Franchise Group", item: "Window Clings", qty: 150, status: "Waiting on Proof" },
  { id: "10668", cust: "Ace Hardware — Lafayette", item: "Coroplast Yard Signs", qty: 60, status: "Late" },
  { id: "10675", cust: "Purdue Athletics", item: "Banner 4×8", qty: 6, status: "Blocked" },
  { id: "10662", cust: "Lafayette Brewing Co.", item: "Vinyl Decals", qty: 300, status: "Ready" },
  { id: "10655", cust: "Wabash Valley Schools", item: "Hall Graphics", qty: 18, status: "Complete" },
];


function Chip({ children, active }: { children: ReactNode; active?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--radius-sm)] border px-[0.5em] py-[0.25em] text-[0.85em]",
        active
          ? "border-primary/40 bg-primary/12 text-primary"
          : "border-border bg-surface-2 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function LivePreview({ settings }: { settings: PreviewSettings }) {
  const s = settings;
  const pad = s.density === "compact" ? "p-[0.55em]" : "p-[0.95em]";
  const gap = s.density === "compact" ? "gap-[0.45em]" : "gap-[0.8em]";
  const navPad = s.sidebar === "compact" ? "py-[0.3em]" : "py-[0.55em]";

  return (
    <div
      data-theme={s.theme}
      data-accent={s.accent}
      data-density={s.density}
      data-font={s.font}
      data-cvd={s.colorVision}
      data-status-boost={s.statusBoost ? "on" : "off"}

      style={previewStyle(s)}
      className="overflow-hidden rounded-lg border border-border-strong/60 bg-background text-foreground"
    >
      <div className="flex min-h-[26em]">
        {/* sidebar */}
        <aside
          className={cn("w-[13em] shrink-0 border-r border-sidebar-border bg-sidebar", s.density === "compact" ? "p-[0.4em]" : "p-[0.6em]")}
        >
          <div className="mb-[0.7em] flex items-center gap-[0.5em] px-[0.3em]">
            <span className="flex size-[1.7em] items-center justify-center rounded-[var(--radius-sm)] bg-primary text-primary-foreground">
              <Printer className="size-[1em]" />
            </span>
            <span className="truncate font-semibold">{s.orgName}</span>
          </div>
          {[
            { label: "Command Center", icon: LayoutGrid, active: false },
            { label: "Sales", icon: LayoutGrid, active: false },
            { label: "Production", icon: LayoutGrid, active: true },
            { label: "Prepress", icon: LayoutGrid, active: false },
            { label: "Fulfillment", icon: LayoutGrid, active: false },
            { label: "Billing", icon: LayoutGrid, active: false },
          ].map((n) => (
            <div
              key={n.label}
              className={cn(
                "flex items-center gap-[0.5em] rounded-[var(--radius-sm)] px-[0.5em] text-[0.95em]",
                navPad,
                n.active
                  ? "bg-primary/15 font-medium text-primary shadow-[inset_2px_0_0_0_var(--primary)]"
                  : "text-sidebar-foreground",
              )}
            >
              <n.icon className="size-[1em] opacity-70" />
              {n.label}
            </div>
          ))}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* top bar */}
          <div className="flex items-center gap-[0.6em] border-b border-border bg-surface px-[0.8em] py-[0.5em]">
            <div className="flex flex-1 items-center gap-[0.4em] rounded-[var(--radius-sm)] border border-border bg-background px-[0.5em] py-[0.3em] text-muted-foreground">
              <Search className="size-[1em]" />
              <span className="text-[0.9em]">Search orders, customers…</span>
            </div>
            <button className="rounded-[var(--radius-sm)] bg-primary px-[0.8em] py-[0.35em] font-medium text-primary-foreground">
              New Order
            </button>
            <button className="rounded-[var(--radius-sm)] border border-border bg-surface-2 px-[0.8em] py-[0.35em]">
              Export
            </button>
          </div>

          <div className={cn("flex min-w-0 flex-1 flex-col", pad, gap)}>
            {/* order header */}
            <div className="flex flex-wrap items-center gap-[0.6em]">
              <div className="min-w-0">
                <div className="num text-[1.5em] font-semibold leading-none">#10671</div>
                <div className="text-[0.9em] text-muted-foreground">Delta Faucet Company · Due Aug 21</div>
              </div>
              <div className="ml-auto flex items-center gap-[0.4em]">
                <Status value="In Production" />
                <Status value="Ready" />
                <Status value="Late" />
              </div>
            </div>

            {/* alert */}
            <div className="flex items-start gap-[0.5em] rounded-[var(--radius-md)] border border-warn/40 bg-warn/10 px-[0.7em] py-[0.5em] text-warn">
              <AlertTriangle className="mt-[0.1em] size-[1em] shrink-0" />
              <span className="text-[0.92em]">Artwork size differs from expected line-item size on Panel B.</span>
            </div>

            <div className={cn("flex min-w-0 flex-1 flex-wrap", gap)}>
              {/* table */}
              <div className="min-w-[22em] flex-1 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
                <table className="w-full border-collapse text-[0.92em]">
                  <thead>
                    <tr className="bg-surface-2 text-left text-[0.85em] uppercase tracking-wide text-muted-foreground">
                      <th className="px-[0.7em] py-[0.4em] font-medium">Order</th>
                      <th className="px-[0.7em] py-[0.4em] font-medium">Item</th>
                      <th className="px-[0.7em] py-[0.4em] text-right font-medium">Qty</th>
                      <th className="px-[0.7em] py-[0.4em] font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j, i) => (
                      <tr
                        key={j.id}
                        className={cn(
                          "row-h border-t border-border",
                          i === 0 && "bg-primary/10 shadow-[inset_2px_0_0_0_var(--primary)]",
                        )}
                      >
                        <td className="num px-[0.7em]">#{j.id}</td>
                        <td className="truncate px-[0.7em]">{j.item}</td>
                        <td className="num px-[0.7em] text-right">{j.qty}</td>
                        <td className="px-[0.7em]"><Status value={j.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* side panel */}
              <div className={cn("w-[15em] shrink-0 space-y-[0.6em] rounded-[var(--radius-md)] border border-border bg-surface", pad)}>
                <div className="text-[0.85em] font-semibold uppercase tracking-wide text-muted-foreground">
                  Production art
                </div>
                <div className="flex items-center gap-[0.5em]">
                  <div className="flex size-[3.2em] items-center justify-center rounded-[var(--radius-sm)] border border-border bg-surface-2 text-muted-foreground">
                    <ImageIcon className="size-[1.3em]" />
                  </div>
                  <div className="min-w-0 text-[0.9em]">
                    <div className="truncate font-medium">DELTA_PANEL_F.pdf</div>
                    <div className="text-muted-foreground">Front · 48 × 96 in</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-[0.35em]">
                  <Chip active>Front</Chip>
                  <Chip>Back</Chip>
                </div>
                <label className="block space-y-[0.25em] text-[0.9em]">
                  <span className="text-muted-foreground">Material</span>
                  <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-input bg-background px-[0.55em] py-[0.35em]">
                    3mm ACM White <ChevronDown className="size-[1em] opacity-60" />
                  </div>
                </label>
                <label className="block space-y-[0.25em] text-[0.9em]">
                  <span className="text-muted-foreground">Operator note</span>
                  <input
                    readOnly
                    value="Grain vertical"
                    className="w-full rounded-[var(--radius-sm)] border border-input bg-background px-[0.55em] py-[0.35em] outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
                <div className="flex gap-[0.4em]">
                  <button className="flex-1 rounded-[var(--radius-sm)] bg-primary px-[0.6em] py-[0.4em] text-[0.9em] font-medium text-primary-foreground">
                    Release
                  </button>
                  <button className="rounded-[var(--radius-sm)] border border-border bg-surface-2 px-[0.6em] py-[0.4em] text-[0.9em]">
                    Hold
                  </button>
                </div>
                <button
                  disabled
                  className="w-full cursor-not-allowed rounded-[var(--radius-sm)] border border-border px-[0.6em] py-[0.4em] text-[0.9em] text-muted-foreground opacity-60"
                >
                  Ship (disabled)
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {s.reducedMotion && (
        <div className="border-t border-border bg-surface-2 px-[0.8em] py-[0.35em] text-[0.85em] text-muted-foreground">
          Reduced motion is on — transitions and animations are minimized.
        </div>
      )}
    </div>
  );
}
