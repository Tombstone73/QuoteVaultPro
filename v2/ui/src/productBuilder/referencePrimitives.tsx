import { ChevronDown } from "lucide-react";
import React, { useState, type ReactNode } from "react";

/** Native-control adaptation of Lovable's Input/Select/Textarea visual contract. */
export const builderControlClass = "rounded-md border border-input bg-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted-foreground";

/**
 * Presentation port of reference/lovable-ui/src/components/app/product-editor/fields.tsx
 * plus the page-local Section/Sub/Disclosure primitives from its product-builder
 * route. Native controls are the sole shell adaptation: V2 has no shadcn runtime.
 */
export function Cell({ label, hint, children, className }: Readonly<{ label?: string; hint?: ReactNode; children: ReactNode; className?: string }>) {
  return <div className={`grid min-w-0 gap-1.5 text-[0.8125rem] ${className ?? ""}`}>
    {label && <span className="text-[0.75rem]">{label}</span>}
    {children}
    {hint && <p className="text-[0.6875rem] leading-snug text-muted-foreground">{hint}</p>}
  </div>;
}

export function Picker<T extends string>({ value, onChange, items, className, disabled }: Readonly<{ value: T; onChange: (value: T) => void; items: readonly T[]; className?: string; disabled?: boolean }>) {
  return <select className={`${builderControlClass} h-8 min-w-0 w-full text-[0.8125rem] ${className ?? ""}`} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as T)}>
    {items.map((item) => <option key={item} value={item}>{item}</option>)}
  </select>;
}

/** Compact segmented switch (Basic | Advanced, Quantity Tiers | Size Tiers, …). */
export function Segmented<T extends string>({ value, onChange, items, className, disabled }: Readonly<{ value: T; onChange: (value: T) => void; items: readonly { id: T; label: string }[]; className?: string; disabled?: boolean }>) {
  return <div className={`inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5 ${className ?? ""}`}>
    {items.map((item) => <button key={item.id} type="button" disabled={disabled} onClick={() => onChange(item.id)} aria-pressed={value === item.id} className={`rounded px-2 py-1 text-[0.75rem] font-medium transition-colors ${value === item.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
      {item.label}
    </button>)}
  </div>;
}

export function Toggle({ label, hint, checked, onChange, disabled, disabledReason }: Readonly<{ label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; disabledReason?: string }>) {
  return <label className={`flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2${disabled ? " opacity-60" : ""}`}>
    <span className="min-w-0">
      <span className="block text-[0.8125rem] font-medium">{label}</span>
      {(disabled && disabledReason ? disabledReason : hint) && <span className="block text-[0.6875rem] leading-snug text-muted-foreground">{disabled && disabledReason ? disabledReason : hint}</span>}
    </span>
    <SwitchLike checked={checked} onChange={onChange} disabled={disabled} label={label} />
  </label>;
}

function SwitchLike({ checked, onChange, disabled, label }: Readonly<{ checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; label: string }>) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={`relative h-5 w-9 shrink-0 rounded-full border border-border transition-colors ${checked ? "bg-primary" : "bg-surface-2"}${disabled ? " cursor-not-allowed" : ""}`}>
    <span className={`absolute top-0.5 size-3.5 rounded-full bg-background transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
  </button>;
}

export function Chip({ children, tone = "neutral" }: Readonly<{ children: ReactNode; tone?: "neutral" | "accent" | "ok" | "warn" | "late" }>) {
  const tones = {
    neutral: "border-border text-muted-foreground",
    accent: "border-primary/50 bg-primary/15 text-primary",
    ok: "border-ok/50 bg-ok/15 text-ok",
    warn: "border-warn/50 bg-warn/15 text-warn",
    late: "border-late/50 bg-late/15 text-late",
  } as const;
  return <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide ${tones[tone]}`}>{children}</span>;
}

export function Section({ id, title, hint, open, onToggle, register, children }: Readonly<{ id: string; title: string; hint?: string; open: boolean; onToggle: () => void; register: (element: HTMLElement | null) => void; children: ReactNode }>) {
  return <section ref={register} data-section={id} id={`section-${id}`} className="panel scroll-mt-14 overflow-hidden">
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border bg-surface-2/50 px-3 py-2">
      <div className="min-w-0">
        <h2 className="truncate text-[0.8125rem] font-bold uppercase tracking-wide">{title}</h2>
        {hint && <p className="truncate text-[0.6875rem] text-muted-foreground">{hint}</p>}
      </div>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground">
        {open ? "Collapse" : "Expand"}
        <ChevronDown className={`size-3.5 transition-transform${open ? "" : " -rotate-90"}`} />
      </button>
    </header>
    {open && <div className="p-3">{children}</div>}
  </section>;
}

export function Sub({ title, hint, children }: Readonly<{ title: string; hint?: string; children: ReactNode }>) {
  return <div>
    <div className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-border pb-1">
      <h3 className="text-[0.75rem] font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {hint && <p className="text-[0.6875rem] text-muted-foreground">{hint}</p>}
    </div>
    {children}
  </div>;
}

export function Disclosure({ label, icon, children }: Readonly<{ label: string; icon?: ReactNode; children: ReactNode }>) {
  const [open, setOpen] = useState(false);
  return <div className="mt-3 rounded-md border border-border">
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[0.75rem] font-medium text-muted-foreground hover:text-foreground">
      <ChevronDown className={`size-3.5 transition-transform${open ? "" : " -rotate-90"}`} />
      {icon}
      {label}
    </button>
    {open && <div className="border-t border-border p-2.5">{children}</div>}
  </div>;
}
