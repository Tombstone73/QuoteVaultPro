import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Clock, FileText, Info, Loader2, PackageCheck, Truck, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Customer portal component language.
 * Plain React + Tailwind + shadcn primitives so it ports directly into the
 * PrintersHero V2 application.
 */

/* ---------- page scaffolding ---------- */

export function PortalPage({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string | undefined;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 pb-5 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Section({
  title,
  description,
  action,
  children,
  className,
  bare,
}: {
  title?: ReactNode | undefined;
  description?: string | undefined;
  action?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
  bare?: boolean | undefined;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card", className)}>
      {title && (
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={bare ? "" : "px-4 py-4 sm:px-5"}>{children}</div>
    </section>
  );
}

/* ---------- status ---------- */

type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "progress";

const TONE: Record<string, Tone> = {
  "Awaiting Your Approval": "warn",
  "Revision Requested": "warn",
  Approved: "ok",
  Superseded: "neutral",
  Received: "info",
  "In Design": "progress",
  "In Production": "progress",
  "Partially Shipped": "progress",
  "Ready for Pickup": "ok",
  Shipped: "ok",
  Completed: "neutral",
  Cancelled: "danger",
  Open: "info",
  Overdue: "danger",
  Paid: "ok",
  Accepted: "ok",
  Expired: "neutral",
  Converted: "info",
  "Partially Fulfilled": "progress",
  Fulfilled: "ok",
  "Pickup Ready": "ok",
  "Not Started": "neutral",
  "In Transit": "progress",
  Delivered: "ok",
  "Label Created": "neutral",
};

const toneClass: Record<Tone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  ok: "border-ok/40 bg-ok/15 text-ok",
  warn: "border-warn/40 bg-warn/15 text-warn",
  danger: "border-late/40 bg-late/15 text-late",
  info: "border-info/40 bg-info/15 text-info",
  progress: "border-primary/40 bg-primary/12 text-primary",
};

const toneIcon: Record<Tone, typeof CheckCircle2> = {
  neutral: Info,
  ok: CheckCircle2,
  warn: AlertTriangle,
  danger: XCircle,
  info: Info,
  progress: Clock,
};

export function StatusPill({ value, className, icon = true }: { value: string; className?: string | undefined; icon?: boolean }) {
  const tone = TONE[value] ?? "neutral";
  const Icon = toneIcon[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-medium leading-5",
        toneClass[tone],
        className,
      )}
    >
      {icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      {value}
    </span>
  );
}

/* ---------- data display ---------- */

export function Money({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("tabular-nums", className)}>
      {value.toLocaleString("en-US", { style: "currency", currency: "USD" })}
    </span>
  );
}

export function KeyValue({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{children}</dd>
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string | undefined; tone?: "ok" | "warn" | "danger" | undefined }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          tone === "danger" && "text-late",
          tone === "warn" && "text-warn",
          tone === "ok" && "text-ok",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[12px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

/* ---------- states ---------- */

export function EmptyState({
  icon: Icon = PackageCheck,
  title,
  message,
  action,
}: {
  icon?: typeof PackageCheck;
  title: string;
  message?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <Icon className="size-7 text-muted-foreground" aria-hidden />
      <p className="text-sm font-semibold">{title}</p>
      {message && <p className="max-w-md text-[13px] text-muted-foreground">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

export function InlineSpinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "warn" | "danger" | "ok";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const map = {
    info: "border-info/40 bg-info/10 text-info",
    warn: "border-warn/40 bg-warn/10 text-warn",
    danger: "border-late/40 bg-late/10 text-late",
    ok: "border-ok/40 bg-ok/10 text-ok",
  } as const;
  const Icon = tone === "ok" ? CheckCircle2 : tone === "danger" ? XCircle : tone === "warn" ? AlertTriangle : Info;
  return (
    <div className={cn("grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl border px-4 py-3", map[tone])}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        {children && <div className="mt-0.5 text-[13px] text-foreground/80">{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

/* ---------- misc ---------- */

export function ProductThumb({ hue, label, className }: { hue: number; label: string; className?: string }) {
  return (
    <div
      className={cn("flex items-center justify-center rounded-lg border border-border text-[11px] font-semibold uppercase tracking-wide text-foreground/70", className)}
      style={{ background: `linear-gradient(140deg, oklch(0.82 0.09 ${hue} / 0.55), oklch(0.68 0.11 ${hue} / 0.32))` }}
      aria-hidden
    >
      {label.slice(0, 2)}
    </div>
  );
}

export function DocumentLink({ name, date }: { name: string; date?: string | undefined }) {
  return (
    <a
      href="#"
      onClick={(e) => e.preventDefault()}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border px-3 py-2 transition-colors hover:bg-accent"
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate text-[13px] font-medium">{name}</span>
      {date && <span className="shrink-0 text-[12px] text-muted-foreground">{date}</span>}
    </a>
  );
}

export function TrackingRow({
  carrier,
  service,
  tracking,
  shippedOn,
  contents,
  status,
}: {
  carrier: string;
  service: string;
  tracking: string;
  shippedOn: string;
  contents: string;
  status: string;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <div className="flex items-center gap-2">
        <Truck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-sm font-semibold">{carrier}</span>
        <span className="text-[12px] text-muted-foreground">{service}</span>
      </div>
      <div className="min-w-0">
        <p className="truncate text-[13px]">{contents}</p>
        <p className="text-[12px] text-muted-foreground">
          Shipped {shippedOn} · <span className="tabular-nums">{tracking}</span>
        </p>
      </div>
      <div className="flex items-center gap-2">
        <StatusPill value={status} />
        <Button size="sm" variant="outline" className="h-8" asChild>
          <a href="#" onClick={(e) => e.preventDefault()}>Track</a>
        </Button>
      </div>
    </div>
  );
}

export function RowCardLink({ to, params, children }: { to: string; params?: Record<string, string>; children: ReactNode }) {
  return (
    <Link
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      to={to as any}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params={params as any}
      className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      {children}
    </Link>
  );
}
