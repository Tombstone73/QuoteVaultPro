import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Flag, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Reusable PrintersHero pattern: ORDER parent (commercial container, aggregate
 * presentation only) with expandable LINE ITEM children (operational units).
 * The parent never replaces child truth — it only summarizes it.
 */

export function QueueToolbarToggles({ onExpandAll, onCollapseAll }: { onExpandAll: () => void; onCollapseAll: () => void }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <button type="button" onClick={onExpandAll} className="rounded border border-border px-1.5 py-0.5 hover:border-primary/50">Expand all</button>
      <button type="button" onClick={onCollapseAll} className="rounded border border-border px-1.5 py-0.5 hover:border-primary/50">Collapse all</button>
    </div>
  );
}

export function AggregateChip({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "ok" | "warn" | "late" | "info" }) {
  const tones: Record<string, string> = {
    neutral: "border-border text-muted-foreground",
    ok: "border-ok/40 bg-ok/10 text-ok",
    warn: "border-warn/40 bg-warn/10 text-warn",
    late: "border-late/40 bg-late/10 text-late",
    info: "border-info/40 bg-info/10 text-info",
  };
  return (
    <span className={cn("inline-flex items-center rounded border px-1 py-0.5 text-[10px] font-semibold leading-none whitespace-nowrap", tones[tone])}>
      {label}
    </span>
  );
}

export function OrderGroup({
  open, onToggle, orderNumber, customer, due, count, pieces, rush, alert, chips, active, children,
}: {
  open: boolean;
  onToggle: () => void;
  orderNumber: string;
  customer: string;
  due: string;
  count: number;
  /** total pieces across the order's line items */
  pieces?: number;
  rush?: boolean;
  /** short blocker text shown even while collapsed */
  alert?: string | undefined;
  chips: ReactNode;
  /** the currently selected line item belongs to this order */
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded border transition", active ? "border-primary/60 bg-primary/[0.06]" : "border-border bg-surface-2/30")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-1.5 px-1.5 py-1.5 text-left"
      >
        <span className="mt-0.5 text-muted-foreground">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="num text-[14px] font-bold">#{orderNumber}</span>
            <span className="truncate text-[12px] text-muted-foreground">{customer}</span>
            {rush && (
              <span className="inline-flex items-center gap-0.5 rounded border border-late/40 bg-late/10 px-1 text-[10px] font-semibold uppercase text-late">
                <Flag className="size-2.5" />Rush
              </span>
            )}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">Due {due}</span>
            <span>· {count} item{count === 1 ? "" : "s"}</span>
            {pieces !== undefined && <span className="num">· {pieces.toLocaleString()} pcs</span>}
          </span>
          <span className="mt-1 flex flex-wrap gap-1">{chips}</span>
          {alert && (
            <span className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-warn">
              <AlertTriangle className="size-3" />{alert}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="ml-[13px] space-y-1 border-l border-border/70 py-1 pl-1.5 pr-1.5">{children}</div>
      )}
    </div>
  );
}

export function LineRow({
  active, onClick, thumb, title, meta, sub, status, right,
}: {
  active?: boolean;
  onClick: () => void;
  thumb: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  sub?: ReactNode;
  status?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={cn(
        "flex w-full cursor-pointer items-start gap-2 rounded border p-1.5 text-left transition",
        active ? "border-primary bg-primary/10" : "border-transparent hover:border-primary/40 hover:bg-surface-2/50",
      )}
    >
      {thumb}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium">{title}</span>
        </span>
        {meta && <span className="num block truncate text-[11px] text-muted-foreground">{meta}</span>}
        {sub && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
        {status && <span className="mt-1 flex flex-wrap items-center gap-1">{status}</span>}
      </span>
      {right}
    </div>
  );
}

