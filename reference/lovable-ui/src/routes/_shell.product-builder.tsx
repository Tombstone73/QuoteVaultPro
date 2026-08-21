import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Boxes,
  ChevronDown,
  ClipboardCheck,
  Factory,
  Package,
  Route as RouteIcon,
  Sparkles,
  SlidersHorizontal,
  Tags,
} from "lucide-react";
import { PageHeader } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { Cell, Chip, Picker, Toggle } from "@/components/app/product-editor/fields";
import { OptionGroupsSection } from "@/components/app/product-editor/option-groups";
import { RuleCards } from "@/components/app/product-editor/rule-cards";
import { PricingEngine } from "@/components/app/product-editor/pricing-engine";
import { MatrixPricing, OptionImpacts } from "@/components/app/product-editor/matrix-pricing";
import { RecipeEditor } from "@/components/app/product-editor/recipe";
import {
  ProductionUnits,
  RoutingSection,
} from "@/components/app/product-editor/production-routing";
import { ReviewSummary } from "@/components/app/product-editor/review";
import { PricingPreview } from "@/components/app/product-editor/pricing-preview";
import { materials } from "@/lib/mock/data";
import {
  CATEGORIES,
  MEASUREMENTS,
  PRODUCT_TYPES,
  WORKFLOW_INTENTS,
  allOptions,
  evaluateRules,
  loadDraft,
  productDrafts,
  validateDraft,
  type PreviewInputs,
  type ProductDraft,
} from "@/lib/mock/product-editor";

export const Route = createFileRoute("/_shell/product-builder")({
  validateSearch: (search: Record<string, unknown>): { product?: string } =>
    typeof search["product"] === "string" ? { product: search["product"] as string } : {},
  head: () => ({
    meta: [
      { title: "Product Builder — PrintersHero V2" },
      {
        name: "description",
        content:
          "Define a print product as one continuous definition: basics, options, matrix pricing, recipe, production units and routing, with a live configuration preview and publish review.",
      },
      { property: "og:title", content: "Product Builder — PrintersHero V2" },
      {
        property: "og:description",
        content:
          "One scrolling product definition with matrix pricing, recipe, production units, routing and a live preview.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProductBuilderPage,
});

const SECTIONS = [
  { id: "basics", label: "Basics", icon: Package },
  { id: "options", label: "Options", icon: Tags },
  { id: "pricing", label: "Pricing", icon: SlidersHorizontal },
  { id: "materials", label: "Materials", icon: Boxes },
  { id: "production", label: "Production", icon: Factory },
  { id: "routing", label: "Routing", icon: RouteIcon },
  { id: "review", label: "Review", icon: ClipboardCheck },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const materialNames = materials.map((m) => m.name);
const PRODUCT_CHOICES = Object.keys(productDrafts).map((id) => ({ id, label: loadDraft(id).name }));

/** Seed the preview with each option's first choice so a price resolves immediately. */
const seedSelections = (d: ProductDraft): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const { option } of allOptions(d)) {
    const first = option.choices[0];
    if (first) out[option.id] = first.label;
  }
  return out;
};

function ProductBuilderPage() {
  const { product } = Route.useSearch();
  const initialId = product && productDrafts[product] ? product : "p2";
  const [productId, setProductId] = useState(initialId);
  const [draft, setDraft] = useState<ProductDraft>(() => loadDraft(initialId));
  const [dirty, setDirty] = useState(false);
  const [pendingProduct, setPendingProduct] = useState<string | null>(null);
  const [sel, setSel] = useState<Record<string, string>>(() =>
    seedSelections(loadDraft(initialId)),
  );
  const [inputs, setInputs] = useState<PreviewInputs>({ w: "24", h: "18", qty: "25" });
  const [active, setActive] = useState<SectionId>("basics");
  const [collapsed, setCollapsed] = useState<Partial<Record<SectionId, boolean>>>({});

  const patch = (fn: (d: ProductDraft) => void) => {
    setDraft((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
  };

  const applyProduct = useCallback((id: string) => {
    setProductId(id);
    const next = loadDraft(id);
    setDraft(next);
    setSel(seedSelections(next));
    setDirty(false);
  }, []);

  const requestProduct = (id: string) => {
    if (id === productId) return;
    if (dirty) setPendingProduct(id);
    else applyProduct(id);
  };

  /* ---------------- scroll spy + smooth jump ---------------- */
  const refs = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});
  const jumpTo = useCallback((id: string) => {
    const el = refs.current[id as SectionId];
    if (!el) return;
    setCollapsed((c) => ({ ...c, [id as SectionId]: false }));
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id as SectionId);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const id = visible?.target.getAttribute("data-section") as SectionId | undefined;
        if (id) setActive(id);
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: 0 },
    );
    for (const s of SECTIONS) {
      const el = refs.current[s.id];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const states = useMemo(() => evaluateRules(draft, sel), [draft, sel]);
  const findings = validateDraft(draft);
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;

  const sectionProps = (id: SectionId) => ({
    id,
    open: !collapsed[id],
    onToggle: () => setCollapsed((c) => ({ ...c, [id]: !c[id] })),
    register: (el: HTMLElement | null) => {
      refs.current[id] = el;
    },
  });

  return (
    <div className="p-4 pb-24">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {draft.name || "Untitled product"}
            <Chip tone={draft.active ? "ok" : "neutral"}>{draft.active ? "Active" : "Draft"}</Chip>
            {dirty && <Chip tone="warn">Unsaved</Chip>}
          </span>
        }
        subtitle={`${draft.version.draftVersion} · live version ${draft.version.activeVersion} · published ${draft.version.lastPublished}`}
        actions={
          <>
            <Picker
              className="w-[190px]"
              value={PRODUCT_CHOICES.find((c) => c.id === productId)?.label ?? ""}
              items={PRODUCT_CHOICES.map((c) => c.label)}
              onChange={(v) => requestProduct(PRODUCT_CHOICES.find((c) => c.label === v)!.id)}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => {
                setDirty(false);
                toast.success("Draft saved");
              }}
            >
              Save Changes
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => jumpTo("review")}>
              Review
            </Button>
            <Button
              size="sm"
              className="h-8"
              disabled={errors > 0}
              onClick={() => {
                setDirty(false);
                toast.success(`${draft.name} published`);
              }}
            >
              Publish
            </Button>
          </>
        }
      />

      {/* sticky section nav — jumps, never hides content */}
      <div className="sticky top-0 z-30 -mx-4 mt-3 border-b border-border bg-background/95 px-4 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-2">
          <nav
            aria-label="Product sections"
            className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1"
          >
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => jumpTo(s.id)}
                aria-current={active === s.id ? "true" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-[12px] transition-colors",
                  active === s.id
                    ? "bg-primary/15 font-semibold text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <s.icon className="size-3.5" />
                {s.label}
              </button>
            ))}
          </nav>
          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
            {errors > 0 && (
              <Chip tone="late">
                {errors} error{errors === 1 ? "" : "s"}
              </Chip>
            )}
            {warnings > 0 && (
              <Chip tone="warn">
                {warnings} warning{warnings === 1 ? "" : "s"}
              </Chip>
            )}
            {errors === 0 && warnings === 0 && <Chip tone="ok">Valid</Chip>}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-3">
          <Section
            {...sectionProps("basics")}
            title="Basics"
            hint="Identity, measurement mode and workflow intent."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Cell label="Product name">
                <Input
                  className="h-8 text-[13px]"
                  value={draft.name}
                  onChange={(e) =>
                    patch((d) => {
                      d.name = e.target.value;
                    })
                  }
                />
              </Cell>
              <Cell
                label="Shop name"
                hint="Short internal name shown in queues and station screens."
              >
                <Input
                  className="h-8 text-[13px]"
                  value={draft.shopName}
                  onChange={(e) =>
                    patch((d) => {
                      d.shopName = e.target.value;
                    })
                  }
                />
              </Cell>
              <Cell label="Description" className="sm:col-span-2">
                <Textarea
                  className="min-h-[60px] text-[13px]"
                  value={draft.description}
                  onChange={(e) =>
                    patch((d) => {
                      d.description = e.target.value;
                    })
                  }
                />
              </Cell>
              <Cell label="Category">
                <Picker
                  value={draft.category}
                  items={CATEGORIES}
                  onChange={(v) =>
                    patch((d) => {
                      d.category = v;
                    })
                  }
                />
              </Cell>
              <Cell label="Product type" hint="Drives sheet yield and usage math.">
                <Picker
                  value={draft.productType}
                  items={PRODUCT_TYPES}
                  onChange={(v) =>
                    patch((d) => {
                      d.productType = v;
                    })
                  }
                />
              </Cell>
              <Cell label="Measurement mode">
                <Picker
                  value={draft.measurements}
                  items={MEASUREMENTS}
                  onChange={(v) =>
                    patch((d) => {
                      d.measurements = v;
                    })
                  }
                />
              </Cell>
              <Cell label="Workflow intent">
                <Picker
                  value={draft.workflowIntent}
                  items={WORKFLOW_INTENTS}
                  onChange={(v) =>
                    patch((d) => {
                      d.workflowIntent = v;
                    })
                  }
                />
              </Cell>
              <Cell label="Units">
                <Picker
                  value={draft.pricing.units}
                  items={["Imperial", "Metric"] as const}
                  onChange={(v) =>
                    patch((d) => {
                      d.pricing.units = v;
                    })
                  }
                />
              </Cell>
              <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2 lg:grid-cols-3">
                <Toggle
                  label="Active in catalog"
                  checked={draft.active}
                  onChange={(v) =>
                    patch((d) => {
                      d.active = v;
                    })
                  }
                />
                <Toggle
                  label="Service fee product"
                  hint="No material or production usage."
                  checked={draft.serviceFee}
                  onChange={(v) =>
                    patch((d) => {
                      d.serviceFee = v;
                    })
                  }
                />
                <Toggle
                  label="Requires proof"
                  checked={draft.flags.proof}
                  onChange={(v) =>
                    patch((d) => {
                      d.flags.proof = v;
                    })
                  }
                />
                <Toggle
                  label="Creates production job"
                  checked={draft.flags.productionJob}
                  onChange={(v) =>
                    patch((d) => {
                      d.flags.productionJob = v;
                    })
                  }
                />
                <Toggle
                  label="Allow $0.00 lines"
                  checked={draft.flags.allowZero}
                  onChange={(v) =>
                    patch((d) => {
                      d.flags.allowZero = v;
                    })
                  }
                />
                <Toggle
                  label="Taxable"
                  checked={draft.flags.taxable}
                  onChange={(v) =>
                    patch((d) => {
                      d.flags.taxable = v;
                    })
                  }
                />
              </div>
            </div>

            <Disclosure
              label="AI parsing hints (optional)"
              icon={<Sparkles className="size-3.5" />}
            >
              <div className="space-y-2.5">
                <p className="text-[12px] text-muted-foreground">
                  Only used when inbound email and RFQ text is matched to catalog products. Not
                  required to publish.
                </p>
                <Toggle
                  label="Use the customer-facing description"
                  hint="Turn off to write a dedicated parsing description."
                  checked={draft.aiUseDescription}
                  onChange={(v) =>
                    patch((d) => {
                      d.aiUseDescription = v;
                    })
                  }
                />
                {!draft.aiUseDescription && (
                  <Textarea
                    className="min-h-[76px] text-[13px]"
                    value={draft.aiDescription}
                    onChange={(e) =>
                      patch((d) => {
                        d.aiDescription = e.target.value;
                      })
                    }
                  />
                )}
              </div>
            </Disclosure>
          </Section>

          <Section
            {...sectionProps("options")}
            title="Options"
            hint="Option groups, choices, defaults and ordering."
          >
            <OptionGroupsSection
              draft={draft}
              patch={patch}
              states={states}
              onJumpToRules={() => jumpTo("options")}
            />
            <Disclosure label={`Option visibility conditions (${draft.rules.length})`}>
              <RuleCards draft={draft} patch={patch} />
            </Disclosure>
          </Section>

          <Section
            {...sectionProps("pricing")}
            title="Pricing"
            hint="What this product charges, and why."
          >
            <div className="space-y-4">
              <PricingEngine draft={draft} patch={patch} />
              <Sub title="Matrix pricing">
                <MatrixPricing draft={draft} patch={patch} />
              </Sub>
              <Sub
                title="Option pricing impacts"
                hint="Options that change price without being matrix dimensions. Edit amounts on the choice in Options."
              >
                <OptionImpacts draft={draft} />
              </Sub>
              {draft.productType === "Sheet" && (
                <Sub title="Computed sheet usage">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Cell label="Sheet width (in)">
                      <Input
                        className="num h-8 text-[13px]"
                        value={draft.pricing.sheetWidth ?? "48"}
                        onChange={(e) =>
                          patch((d) => {
                            d.pricing.sheetWidth = e.target.value;
                          })
                        }
                      />
                    </Cell>
                    <Cell label="Sheet length (in)">
                      <Input
                        className="num h-8 text-[13px]"
                        value={draft.pricing.sheetLength ?? "96"}
                        onChange={(e) =>
                          patch((d) => {
                            d.pricing.sheetLength = e.target.value;
                          })
                        }
                      />
                    </Cell>
                    {draft.pricing.mode === "Basic" && (
                      <Cell label="Rotation" hint="Allow rotated / mixed layouts when nesting.">
                        <Toggle
                          label="Allow rotation"
                          checked={draft.pricing.allowRotation}
                          onChange={(v) =>
                            patch((d) => {
                              d.pricing.allowRotation = v;
                            })
                          }
                        />
                      </Cell>
                    )}
                  </div>
                </Sub>
              )}
            </div>
          </Section>

          <Section
            {...sectionProps("materials")}
            title="Materials & recipe"
            hint="What this product physically consumes — separate from pricing."
          >
            <div className="space-y-4">
              <Sub title="Recipe">
                <RecipeEditor draft={draft} patch={patch} />
              </Sub>
              <Sub title="Primary material & weight">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Cell label="Primary material">
                    <Picker
                      value={
                        materials.find((m) => m.id === draft.material.primaryMaterialId)?.name ??
                        materialNames[0]!
                      }
                      items={materialNames}
                      onChange={(v) =>
                        patch((d) => {
                          d.material.primaryMaterialId = materials.find((m) => m.name === v)!.id;
                        })
                      }
                    />
                  </Cell>
                  <Cell label="Shipping policy">
                    <Picker
                      value={draft.material.shippingPolicy}
                      items={
                        ["Pickup only", "Ships parcel", "Freight only", "Pickup or ship"] as const
                      }
                      onChange={(v) =>
                        patch((d) => {
                          d.material.shippingPolicy = v;
                        })
                      }
                    />
                  </Cell>
                  <Cell label="Material weight" hint="Resolved from the material record.">
                    <Input
                      className="num h-8 text-[13px]"
                      readOnly
                      value={draft.material.configuredWeight ?? "Not configured"}
                    />
                  </Cell>
                  <Cell label="Weight basis">
                    <Picker
                      value={draft.material.weightBasis}
                      items={["Per item", "Per sheet", "Per sq ft"] as const}
                      onChange={(v) =>
                        patch((d) => {
                          d.material.weightBasis = v;
                        })
                      }
                    />
                  </Cell>
                  <Cell label="Fallback weight" hint="Used only when the material has no weight.">
                    <Input
                      className="num h-8 text-[13px]"
                      value={draft.material.fallbackWeight}
                      onChange={(e) =>
                        patch((d) => {
                          d.material.fallbackWeight = e.target.value;
                        })
                      }
                    />
                  </Cell>
                  <Cell label="Fallback unit">
                    <Picker
                      value={draft.material.fallbackUnit}
                      items={["oz", "lb", "kg"] as const}
                      onChange={(v) =>
                        patch((d) => {
                          d.material.fallbackUnit = v;
                        })
                      }
                    />
                  </Cell>
                  <Cell label="Trim allowance — width (in)">
                    <Input
                      className="num h-8 text-[13px]"
                      value={draft.material.trimW}
                      onChange={(e) =>
                        patch((d) => {
                          d.material.trimW = e.target.value;
                        })
                      }
                    />
                  </Cell>
                  <Cell label="Trim allowance — height (in)">
                    <Input
                      className="num h-8 text-[13px]"
                      value={draft.material.trimH}
                      onChange={(e) =>
                        patch((d) => {
                          d.material.trimH = e.target.value;
                        })
                      }
                    />
                  </Cell>
                </div>
              </Sub>
            </div>
          </Section>

          <Section
            {...sectionProps("production")}
            title="Production"
            hint="Production units and the option conditions that require them."
          >
            <ProductionUnits draft={draft} patch={patch} />
          </Section>

          <Section
            {...sectionProps("routing")}
            title="Routing"
            hint="Which Routing-module template this product's orders follow."
          >
            <RoutingSection draft={draft} patch={patch} />
          </Section>

          <Section
            {...sectionProps("review")}
            title="Review & publish"
            hint="Full draft summary and changes against the live version."
          >
            <ReviewSummary draft={draft} findings={findings} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="h-8"
                disabled={errors > 0}
                onClick={() => {
                  setDirty(false);
                  toast.success(`${draft.name} published`);
                }}
              >
                Publish {draft.version.draftVersion}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => {
                  setDirty(false);
                  toast.success("Draft saved");
                }}
              >
                Save Changes
              </Button>
              {errors > 0 && (
                <span className="text-[12px] text-late">
                  Fix {errors} blocking issue{errors === 1 ? "" : "s"} first.
                </span>
              )}
            </div>
          </Section>
        </div>

        {/* preview rail — sticky on desktop, inline below content on narrow widths */}
        <div className="min-w-0 xl:sticky xl:top-14 xl:h-[calc(100vh-5rem)] xl:overflow-y-auto xl:pb-6">
          <PricingPreview
            draft={draft}
            states={states}
            inputs={inputs}
            setInputs={setInputs}
            sel={sel}
            setSel={setSel}
            onJump={jumpTo}
          />
        </div>
      </div>

      <AlertDialog
        open={pendingProduct !== null}
        onOpenChange={(o) => {
          if (!o) setPendingProduct(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {draft.name} has unsaved draft changes. Switching products now discards them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDirty(false);
                toast.success("Draft saved");
                const id = pendingProduct!;
                setPendingProduct(null);
                applyProduct(id);
              }}
            >
              Save and switch
            </Button>
            <AlertDialogAction
              onClick={() => {
                const id = pendingProduct!;
                setPendingProduct(null);
                applyProduct(id);
              }}
            >
              Discard and switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Section({
  id,
  title,
  hint,
  open,
  onToggle,
  register,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  register: (el: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return (
    <section
      ref={register}
      data-section={id}
      id={`section-${id}`}
      className="panel scroll-mt-14 overflow-hidden"
    >
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border bg-surface-2/50 px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-bold uppercase tracking-wide">{title}</h2>
          {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          {open ? "Collapse" : "Expand"}
          <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        </button>
      </header>
      {open && <div className="p-3">{children}</div>}
    </section>
  );
}

function Sub({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-border pb-1">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Disclosure({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        {icon}
        {label}
      </button>
      {open && <div className="border-t border-border p-2.5">{children}</div>}
    </div>
  );
}
