import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpRight, Ban, Check, CheckCircle, Circle, Info, Loader2, Lock, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { READINESS_LABEL, type Readiness } from "@/lib/mock/settings";

const TONE: Record<Readiness, { cls: string; icon: typeof CheckCircle }> = {
  ready: { cls: "text-ok border-ok bg-ok/20", icon: CheckCircle },
  attention: { cls: "text-warn border-warn bg-warn/20", icon: AlertTriangle },
  "not-configured": { cls: "text-muted-foreground border-border bg-transparent", icon: Circle },
  reconnect: { cls: "text-warn border-warn bg-warn/20", icon: RefreshCw },
  error: { cls: "text-late border-late bg-late/20", icon: XCircle },
  optional: { cls: "text-info border-info bg-info/20", icon: Info },
};

export function ReadyChip({ state, label, className }: { state: Readiness; label?: string | undefined; className?: string | undefined }) {
  const t = TONE[state];
  const Icon = t.icon;
  return (
    <span
      className={cn(
        "status-badge inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none",
        t.cls,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {label ?? READINESS_LABEL[state]}
    </span>
  );
}

export function SettingsPage({
  title, description, children, actions,
}: { title: string; description?: string | undefined; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-4 lg:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-0.5 max-w-2xl text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Section({
  title, hint, action, children, className,
}: { title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode; className?: string | undefined }) {
  return (
    <section className={cn("section-panel", className)}>
      <header className="section-head flex items-center gap-2 px-0.5 py-1.5">
        <span className="section-label">{title}</span>
        <span className="section-rule" aria-hidden />
        {action}
      </header>
      {hint && <p className="px-0.5 pb-1 text-[12px] text-muted-foreground">{hint}</p>}
      <div className="px-0.5 pt-2">{children}</div>
    </section>
  );
}

export function Row({ label, hint, children, className }: { label: string; hint?: string | undefined; children: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label className="text-[12px]">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SaveBar({ note }: { note?: string | undefined }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        {state === "saving" && <><Loader2 className="size-3.5 animate-spin" /> Saving…</>}
        {state === "saved" && <span className="inline-flex items-center gap-1.5 text-ok"><Check className="size-3.5" /> Saved</span>}
        {state === "error" && <span className="inline-flex items-center gap-1.5 text-late"><XCircle className="size-3.5" /> Could not save. Try again.</span>}
        {state === "idle" && note}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-8 text-[12px]" onClick={() => setState("idle")}>Discard</Button>
        <Button
          size="sm"
          className="h-8 text-[12px]"
          onClick={() => {
            setState("saving");
            window.setTimeout(() => setState("saved"), 600);
          }}
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}

export function EmptyBlock({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-2/40 px-4 py-6 text-center">
      <p className="text-[13px] font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">{body}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

export function PermissionNotice({ what }: { what: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2.5">
      <Lock className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
      <div className="text-[12px]">
        <div className="font-medium">{what}</div>
        <p className="text-muted-foreground">You do not have permission to change this setting. Contact an organization administrator.</p>
      </div>
    </div>
  );
}

export function DeepLink({ to, search, params, children }: { to: string; search?: Record<string, unknown>; params?: Record<string, string>; children: ReactNode }) {
  return (
    <Button asChild variant="outline" size="sm" className="h-7 gap-1 text-[12px]">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Link to={to as any} search={search as any} params={params as any}>
        {children}
        <ArrowUpRight className="size-3.5" aria-hidden />
      </Link>
    </Button>
  );
}

export function ConnectionCard({
  name, status, detail, actions, badge,
}: { name: string; status: Readiness; detail: string; actions?: ReactNode; badge?: string | undefined }) {
  return (
    <div className="panel flex items-start justify-between gap-3 p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">{name}</span>
          {badge && <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{badge}</span>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <ReadyChip state={status} />
          <span className="text-[12px] text-muted-foreground">{detail}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </div>
  );
}

export function AuditLine({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-muted-foreground">{children}</p>;
}

export function Unavailable({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2.5 text-[12px] text-muted-foreground">
      <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
