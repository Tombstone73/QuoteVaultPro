import React, { type ReactNode } from "react";

/**
 * Direct presentation port of reference/lovable-ui/src/components/app/product-editor/fields.tsx.
 * Native controls are the sole shell adaptation: V2 deliberately has no shadcn dependency.
 */
export function Cell({ label, hint, children, className }: Readonly<{ label?: string; hint?: ReactNode; children: ReactNode; className?: string }>) {
  return <label className={`grid min-w-0 gap-1.5 ${className ?? ""}`}>
    {label && <span className="text-[12px]">{label}</span>}
    {children}
    {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
  </label>;
}

export function Picker<T extends string>({ value, onChange, items, className, disabled }: Readonly<{ value: T; onChange: (value: T) => void; items: readonly T[]; className?: string; disabled?: boolean }>) {
  return <select className={`h-8 min-w-0 text-[13px] ${className ?? ""}`} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as T)}>
    {items.map((item) => <option key={item} value={item}>{item}</option>)}
  </select>;
}

export function Toggle({ label, hint, checked, onChange, disabled }: Readonly<{ label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }>) {
  return <label className="flex min-w-0 items-start gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2">
    <input className="mt-0.5" type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    <span className="min-w-0"><b className="block text-[12px]">{label}</b>{hint && <small className="block text-[11px] leading-snug text-muted-foreground">{hint}</small>}</span>
  </label>;
}

export function Chip({ children, tone = "neutral" }: Readonly<{ children: ReactNode; tone?: "neutral" | "accent" | "ok" | "warn" | "late" }>) {
  return <span className={`v2-ref-chip ${tone}`}>{children}</span>;
}

export function Section({ id, title, hint, open, onToggle, register, children }: Readonly<{ id: string; title: string; hint?: string; open: boolean; onToggle: () => void; register: (element: HTMLElement | null) => void; children: ReactNode }>) {
  return <section ref={register} data-section={id} id={`section-${id}`} className="panel scroll-mt-14 overflow-hidden">
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border bg-surface-2/50 px-3 py-2">
      <div className="min-w-0"><h2 className="truncate text-[13px] font-bold uppercase tracking-wide">{title}</h2>{hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}</div>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground">{open ? "Collapse" : "Expand"}<span aria-hidden>{open ? "⌄" : "›"}</span></button>
    </header>
    {open && <div className="p-3">{children}</div>}
  </section>;
}

export function Sub({ title, hint, children }: Readonly<{ title: string; hint?: string; children: ReactNode }>) {
  return <div><div className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-border pb-1"><h3 className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>{hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}</div>{children}</div>;
}
