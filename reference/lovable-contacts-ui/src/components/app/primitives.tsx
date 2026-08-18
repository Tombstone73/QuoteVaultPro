import { CheckCircle, AlertTriangle, XCircle, Ban, Info, Circle, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "ok" | "warn" | "late" | "blocked" | "info" | "accent";

const toneClass: Record<Tone, string> = {
  neutral: "text-muted-foreground border-border bg-transparent",
  ok: "text-ok border-ok bg-ok/20",
  warn: "text-warn border-warn bg-warn/20",
  late: "text-late border-late bg-late/20",
  blocked: "text-blocked border-blocked bg-blocked/20",
  info: "text-info border-info bg-info/20",
  accent: "text-primary border-primary bg-primary/15",
};

const STATUS_TONE: Record<string, Tone> = {
  Draft: "neutral", Sent: "info", Accepted: "ok", Converted: "accent", Declined: "late", Expired: "neutral",
  Open: "info", "In Production": "accent", Ready: "ok", Shipped: "ok", Complete: "neutral", Cancelled: "late",
  Issued: "info", Paid: "ok", "Partially Paid": "warn", Unpaid: "neutral", Voided: "late",
  Queued: "neutral", "In Progress": "accent",
  "Needs Artwork": "warn", "Proof Pending": "warn", Approved: "ok", "Production Ready": "ok",
  Connected: "ok", "Not Connected": "neutral", Error: "late",
  Active: "ok", "On Hold": "warn", Prospect: "info",
  Late: "late", "Due Today": "warn",
  "Partially Picked Up": "warn", Staged: "info",
  "Waiting on Proof": "warn", Blocked: "blocked",
  "Needs Design": "warn", "In Design": "accent", "Revision Requested": "warn",
  "Waiting on Customer": "info", "Ready for Proof": "info", "Design Complete": "ok",
  Viewed: "info", "Awaiting Customer": "warn", "Ready to Send": "accent",
  Superseded: "neutral", Revoked: "late",
};


const toneIcon: Record<Tone, typeof CheckCircle> = {
  neutral: Circle,
  ok: CheckCircle,
  warn: AlertTriangle,
  late: XCircle,
  blocked: Ban,
  info: Info,
  accent: Circle,
};

export function Status({ value, className }: { value: string; className?: string }) {
  const tone = STATUS_TONE[value] ?? "neutral";
  const Icon = toneIcon[tone];
  return (
    <span
      data-tone={tone}
      className={cn(
        "status-badge inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap",
        toneClass[tone],
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {value}
    </span>
  );
}


export function PageHeader({
  title, subtitle, actions, meta,
}: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>}
        {meta}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Metric({
  label, value, hint, tone = "neutral", quiet,
}: { label: string; value: ReactNode; hint?: string; tone?: Tone; quiet?: boolean }) {
  return (
    <div className={quiet ? "rounded-md border border-border/60 bg-surface-2/40 px-3 py-2" : "panel px-3 py-2.5"}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("num mt-1 text-xl font-semibold", tone === "late" && "text-late", tone === "ok" && "text-ok", tone === "warn" && "text-warn")}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Panel({
  title, action, children, className, dense, section,
}: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; dense?: boolean; section?: boolean }) {
  return (
    <section className={cn(section ? "section-panel" : "panel overflow-hidden", className)}>
      {title && (
        <header
          className={cn(
            "flex items-center gap-2",
            section ? "section-head px-0.5 py-1.5" : "justify-between border-b border-border px-3 py-2",
          )}
        >
          {section ? (
            <>
              <span className="section-label">{title}</span>
              <span className="section-rule" aria-hidden />
            </>
          ) : (
            <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
          )}
          {action}
        </header>
      )}
      <div className={dense ? "" : section ? "px-0.5 pt-2.5" : "p-3"}>{children}</div>


    </section>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-[13px]">{children}</div>
    </div>
  );
}

export function Thumb({ label, className }: { label: string; className?: string }) {
  const seed = label.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = seed % 360;
  return (
    <div
      className={cn("flex size-8 shrink-0 items-center justify-center rounded border border-border text-[10px] font-semibold uppercase", className)}
      style={{ background: `oklch(0.72 0.09 ${hue} / 0.35)` }}
      aria-hidden
    >
      {label.slice(0, 2)}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export const th = "sticky top-0 z-10 bg-surface-2 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
export const td = "px-3 py-0 align-middle text-[13px]";

export function TxType({ type }: { type: "Payment" | "Refund" }) {
  const refund = type === "Refund";
  const Icon = refund ? ArrowUpRight : ArrowDownLeft;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[12px] font-medium", refund ? "text-warn" : "text-ok")}>
      <Icon className="size-3.5" aria-hidden />
      {type}
    </span>
  );
}
