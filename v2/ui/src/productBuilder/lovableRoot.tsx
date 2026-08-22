import { Boxes, ClipboardCheck, Factory, Package, Route as RouteIcon, SlidersHorizontal, Tags } from "lucide-react";
import React, { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Chip, ReferenceButton, Section } from "./referencePrimitives";

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

export function LovableProductBuilderRoot({ title, lifecycle, subtitle, onSave, onPublish, saving, publishing, findings, children, rail, canEdit = false, persisted = false, saveError, sectionJumpRef }: Readonly<{
  title: string; lifecycle: ReactNode; onSave: () => void; onPublish?: () => void;
  subtitle?: ReactNode;
  saving?: boolean; publishing?: boolean; findings: Readonly<{ errors: number; warnings: number }>;
  children: Readonly<Partial<Record<ProductBuilderSection, ReactNode>>>; rail: ReactNode;
  canEdit?: boolean; persisted?: boolean; saveError?: string | null;
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
  return <div className="p-4 pb-24 product-builder-reference-port">
    <PageHeader
      title={<span className="flex flex-wrap items-center gap-2">{title}{lifecycle}</span>}
      subtitle={subtitle}
      actions={<>{canEdit && <ReferenceButton variant="outline" size="sm" disabled={saving} onClick={onSave}>{saving ? "Saving…" : "Save Changes"}</ReferenceButton>}<ReferenceButton variant="outline" size="sm" onClick={() => jumpTo("review")}>Review</ReferenceButton>{canEdit && persisted && onPublish && <ReferenceButton size="sm" disabled={publishing || findings.errors > 0} onClick={onPublish}>{publishing ? "Publishing…" : "Publish"}</ReferenceButton>}</>}
    />
    {saveError && <p role="alert" className="v2-product-version-message">{saveError}</p>}
    <div className="sticky top-0 z-30 -mx-4 mt-3 border-b border-border bg-background/95 px-4 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/80"><div className="flex items-center gap-2"><nav aria-label="Product sections" className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1">{SECTIONS.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={active === id ? "true" : undefined} className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-[0.75rem] transition-colors ${active === id ? "bg-primary/15 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`} onClick={() => jumpTo(id)}><Icon className="size-3.5" />{label}</button>)}</nav><div className="hidden shrink-0 items-center gap-1.5 sm:flex">{findings.errors > 0 && <Chip tone="late">{findings.errors} error{findings.errors === 1 ? "" : "s"}</Chip>}{findings.warnings > 0 && <Chip tone="warn">{findings.warnings} warning{findings.warnings === 1 ? "" : "s"}</Chip>}{findings.errors === 0 && findings.warnings === 0 && <Chip tone="ok">No local findings</Chip>}</div></div></div>
    <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"><div className="min-w-0 space-y-3">{SECTIONS.map(({ id, label }) => <Section key={id} id={id} title={id === "review" ? "Review & publish" : id === "materials" ? "Materials & recipe" : label} hint={hints[id]} open={!collapsed[id]} onToggle={() => setCollapsed((state) => ({ ...state, [id]: !state[id] }))} register={(node) => { refs.current[id] = node; }}>{children[id]}{id === "review" && <div className="mt-3 flex flex-wrap items-center gap-2">{canEdit && persisted && onPublish && <ReferenceButton size="sm" disabled={publishing || findings.errors > 0} onClick={onPublish}>{publishing ? "Publishing…" : "Publish"}</ReferenceButton>}{canEdit && <ReferenceButton variant="outline" size="sm" disabled={saving} onClick={onSave}>{saving ? "Saving…" : "Save Changes"}</ReferenceButton>}{findings.errors > 0 && <span className="text-[0.75rem] text-late">Fix {findings.errors} blocking issue{findings.errors === 1 ? "" : "s"} first.</span>}</div>}</Section>)}</div><div className="min-w-0 xl:sticky xl:top-14 xl:h-[calc(100vh-5rem)] xl:overflow-y-auto xl:pb-6">{rail}</div></div>
  </div>;
}
const hints: Record<ProductBuilderSection, string> = { basics: "Identity, measurement mode and workflow intent.", options: "Option groups, choices, defaults and ordering.", pricing: "What this Product charges, and why.", materials: "What this Product physically consumes — separate from pricing.", production: "Production units and the option conditions that require them.", routing: "Which Routing-module template this Product's orders follow.", review: "Full Draft summary and changes against the live version." };

/** Literal PageHeader port from reference/lovable-ui/src/components/app/primitives.tsx.
 * The V2 shell supplies the surrounding application navigation. */
function PageHeader({ title, subtitle, actions }: Readonly<{ title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }>) {
  return <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3"><div className="min-w-0"><h1 className="text-lg font-semibold tracking-tight">{title}</h1>{subtitle && <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">{subtitle}</p>}</div>{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}</div>;
}
