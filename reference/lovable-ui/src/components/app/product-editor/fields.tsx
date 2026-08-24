import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Labelled form cell used across every product-editor section. */
export function Cell({
  label, hint, children, className,
}: { label?: string | undefined; hint?: ReactNode; children: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      {label && <Label className="text-[12px]">{label}</Label>}
      {children}
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Picker<T extends string>({
  value, onChange, items, className, disabled,
}: { value: T; onChange: (v: T) => void; items: readonly T[]; className?: string; disabled?: boolean | undefined }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={!!disabled}>
      <SelectTrigger className={cn("h-8 min-w-0 text-[13px] [&>span]:truncate", className)}><SelectValue /></SelectTrigger>
      <SelectContent>
        {items.map((i) => <SelectItem key={i} value={i} className="text-[13px]">{i}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Compact segmented switch (Basic | Advanced, Quantity Tiers | Size Tiers, …). */
export function Segmented<T extends string>({
  value, onChange, items, className,
}: { value: T; onChange: (v: T) => void; items: readonly { id: T; label: string }[]; className?: string }) {
  return (
    <div className={cn("inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5", className)}>
      {items.map((i) => (
        <button
          key={i.id}
          type="button"
          onClick={() => onChange(i.id)}
          aria-pressed={value === i.id}
          className={cn(
            "rounded px-2 py-1 text-[12px] font-medium transition-colors",
            value === i.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  label, hint, checked, onChange, disabled, disabledReason,
}: { label: string; hint?: string | undefined; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean | undefined; disabledReason?: string | undefined }) {
  return (
    <label className={cn("flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2", disabled && "opacity-60")}>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        {(disabled && disabledReason ? disabledReason : hint) && (
          <span className="block text-[11px] leading-snug text-muted-foreground">{disabled && disabledReason ? disabledReason : hint}</span>
        )}
      </span>
      <SwitchLike checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </label>
  );
}

function SwitchLike({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean | undefined; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border border-border transition-colors",
        checked ? "bg-primary" : "bg-surface-2",
        disabled && "cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-3.5 rounded-full bg-background transition-all",
          checked ? "left-[18px]" : "left-0.5",
        )}
      />
    </button>
  );
}

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "ok" | "warn" | "late" }) {
  const tones = {
    neutral: "border-border text-muted-foreground",
    accent: "border-primary/50 bg-primary/15 text-primary",
    ok: "border-ok/50 bg-ok/15 text-ok",
    warn: "border-warn/50 bg-warn/15 text-warn",
    late: "border-late/50 bg-late/15 text-late",
  } as const;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", tones[tone])}>
      {children}
    </span>
  );
}
