import { Boxes, ClipboardCheck, Factory, Package, Route as RouteIcon, SlidersHorizontal, Tags } from "lucide-react";
import React, { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Chip, Section } from "./referencePrimitives";

/**
 * Directly ported structure from reference/lovable-ui/src/routes/_shell.product-builder.tsx.
 * This component intentionally owns no product business logic; V2's adapter supplies all facts/actions.
 */
const SECTIONS = [
  { id: "basics", label: "Basics", icon: Package },
  { id: "options", label: "Options", icon: Tags },
  { id: "pricing", label: "Pricing", icon: SlidersHorizontal },
  { id: "materials", label: "Materials", icon: Boxes },
  { id: "production", label: "Production", icon: Factory },
  { id: "routing", label: "Routing", icon: RouteIcon },
  { id: "review", label: "Review", icon: ClipboardCheck },
] as const;
export type ProductBuilderSection = (typeof SECTIONS)[number]["id"];

export function LovableProductBuilderRoot({ title, lifecycle, picker, onBack, onSave, onPublish, saving, publishing, findings, children, rail, dialog, canEdit = false, persisted = false, saveError, sectionJumpRef }: Readonly<{
  title: string; lifecycle: ReactNode; picker: ReactNode; onBack: () => void; onSave: () => void; onPublish?: () => void;
  saving?: boolean; publishing?: boolean; findings: Readonly<{ errors: number; warnings: number }>;
  children: Readonly<Partial<Record<ProductBuilderSection, ReactNode>>>; rail: ReactNode; dialog?: ReactNode; canEdit?: boolean; persisted?: boolean; saveError?: string | null;
  sectionJumpRef?: MutableRefObject<((section: ProductBuilderSection) => void) | null>;
}>) {
  const [active, setActive] = useState<ProductBuilderSection>("basics");
  const [collapsed, setCollapsed] = useState<Partial<Record<ProductBuilderSection, boolean>>>({});
  const refs = useRef<Partial<Record<ProductBuilderSection, HTMLElement | null>>>({});
  const jumpTo = (id: ProductBuilderSection) => { setCollapsed((state) => ({ ...state, [id]: false })); refs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" }); setActive(id); };
  if (sectionJumpRef) sectionJumpRef.current = jumpTo;
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const first = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      const id = first?.target.getAttribute("data-section") as ProductBuilderSection | null;
      if (id) setActive(id);
    }, { rootMargin: "-96px 0px -60% 0px", threshold: 0 });
    SECTIONS.forEach(({ id }) => { const node = refs.current[id]; if (node) observer.observe(node); });
    return () => observer.disconnect();
  });
  return <div className="v2-products product-builder-reference-port">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><button type="button" className="v2-products-back" onClick={onBack}>← Products</button><div className="min-w-0"><h1 className="truncate text-[18px] font-bold">{title}</h1><div className="flex flex-wrap gap-1">{lifecycle}</div></div></div><div className="flex flex-wrap items-center gap-2">{picker}<button type="button" className="button secondary" disabled={!canEdit || saving} onClick={onSave}>{saving ? "Saving…" : "Save Changes"}</button><button type="button" className="button secondary" onClick={() => jumpTo("review")}>Review</button>{onPublish && <button type="button" className="button" disabled={!canEdit || !persisted || publishing || findings.errors > 0} onClick={onPublish}>{publishing ? "Publishing…" : "Publish"}</button>}</div></div>
    {saveError && <p role="alert" className="v2-product-version-message">{saveError}</p>}
    <div className="sticky top-0 z-10 mt-3 flex flex-wrap items-center justify-between gap-2 border-y border-border bg-background/95 py-2 backdrop-blur"><nav className="flex min-w-0 flex-wrap gap-1" aria-label="Product sections">{SECTIONS.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={active === id ? "true" : undefined} className={`flex items-center gap-1 rounded px-2 py-1 text-[12px] ${active === id ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`} onClick={() => jumpTo(id)}><Icon className="size-3.5" />{label}</button>)}</nav><div className="flex gap-1">{findings.errors > 0 && <Chip tone="late">{findings.errors} error{findings.errors === 1 ? "" : "s"}</Chip>}{findings.warnings > 0 && <Chip tone="warn">{findings.warnings} warning{findings.warnings === 1 ? "" : "s"}</Chip>}{findings.errors === 0 && findings.warnings === 0 && <Chip tone="ok">No local findings</Chip>}</div></div>
    <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"><main className="min-w-0 space-y-3">{SECTIONS.map(({ id, label }) => <Section key={id} id={id} title={id === "review" ? "Review & publish" : id === "materials" ? "Materials & recipe" : label} hint={hints[id]} open={!collapsed[id]} onToggle={() => setCollapsed((state) => ({ ...state, [id]: !state[id] }))} register={(node) => { refs.current[id] = node; }}>{children[id]}</Section>)}</main><aside className="min-w-0 xl:sticky xl:top-14 xl:h-[calc(100vh-5rem)] xl:overflow-y-auto xl:pb-6">{rail}</aside></div>
    {dialog}
  </div>;
}
const hints: Record<ProductBuilderSection, string> = { basics: "Identity, measurement mode and workflow intent.", options: "Option groups, choices, defaults and ordering.", pricing: "What this Product charges, and why.", materials: "What this Product physically consumes — separate from pricing.", production: "Production units and the option conditions that require them.", routing: "Which Routing-module template this Product's orders follow.", review: "Full Draft summary and changes against the live version." };
