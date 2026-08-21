import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Copy, ExternalLink, Eye, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ROUTE_POLICIES,
  ROUTE_TEMPLATE_CATALOG,
  findRouteTemplate,
  allOptions,
  findOption,
  uid,
  type ProductDraft,
  type ProductionUnitSpec,
} from "@/lib/mock/product-editor";
import { Cell, Chip, Picker } from "./fields";

const STATIONS = [
  "Océ Arizona (Flatbed)",
  "HP Latex 570 (Roll)",
  "Roland VG3 (Print/Cut)",
  "Zünd Cutter",
  "Finishing bench",
  "Outsourced",
] as const;

/** Production units are generic: any number of named units with optional option conditions. */
export function ProductionUnits({
  draft,
  patch,
}: {
  draft: ProductDraft;
  patch: (fn: (d: ProductDraft) => void) => void;
}) {
  const options = allOptions(draft).filter(({ option }) => option.choices.length > 0);
  const condLabel = (o: { group: { name: string }; option: { label: string } }) =>
    o.group.name === o.option.label ? o.option.label : `${o.group.name} → ${o.option.label}`;

  return (
    <div className="space-y-2.5">
      <p className="text-[12px] text-muted-foreground">
        Production units are the physical things that get made — sides, pages, layers or panels. Add
        a condition when a unit only exists for certain options.
      </p>

      <div className="space-y-2">
        {draft.production.map((u, i) => {
          const set = (fn: (u: ProductionUnitSpec) => void) =>
            patch((d) => {
              fn(d.production[i]!);
            });
          const cond = u.conditionOptionId ? findOption(draft, u.conditionOptionId) : undefined;
          return (
            <div key={u.id} className="rounded-md border border-border p-2.5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-[13px] font-semibold">
                    {u.name || "Untitled unit"}
                  </span>
                  {cond ? (
                    <Chip tone="accent">
                      When {cond.option.label} = {u.conditionValue}
                    </Chip>
                  ) : (
                    <Chip tone="ok">Always</Chip>
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0 text-muted-foreground hover:text-late"
                  aria-label="Remove production unit"
                  onClick={() =>
                    patch((d) => {
                      d.production.splice(i, 1);
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Cell label="Unit name">
                  <Input
                    className="h-8 text-[13px]"
                    value={u.name}
                    onChange={(e) =>
                      set((x) => {
                        x.name = e.target.value;
                      })
                    }
                  />
                </Cell>
                <Cell label="Station">
                  <Picker
                    value={u.station}
                    items={STATIONS}
                    onChange={(v) =>
                      set((x) => {
                        x.station = v;
                      })
                    }
                  />
                </Cell>
                <Cell label="Required when">
                  <Picker
                    value={cond ? condLabel(cond) : "Always"}
                    items={["Always", ...options.map(condLabel)]}
                    onChange={(v) =>
                      set((x) => {
                        if (v === "Always") {
                          x.conditionOptionId = undefined;
                          x.conditionValue = undefined;
                          return;
                        }
                        const hit = options.find((o) => condLabel(o) === v)!;
                        x.conditionOptionId = hit.option.id;
                        x.conditionValue = hit.option.choices[0]?.label;
                      })
                    }
                  />
                </Cell>
                {cond && (
                  <Cell label="Choice">
                    <Picker
                      value={u.conditionValue ?? ""}
                      items={cond.option.choices.map((c) => c.label)}
                      onChange={(v) =>
                        set((x) => {
                          x.conditionValue = v;
                        })
                      }
                    />
                  </Cell>
                )}
                <Cell label="Operator note" className="sm:col-span-2 lg:col-span-4">
                  <Input
                    className="h-8 text-[13px]"
                    value={u.note}
                    onChange={(e) =>
                      set((x) => {
                        x.note = e.target.value;
                      })
                    }
                  />
                </Cell>
              </div>
            </div>
          );
        })}
        {draft.production.length === 0 && (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] italic text-muted-foreground">
            No production units — nothing is manufactured for this product.
          </p>
        )}
      </div>

      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1 text-[12px]"
        onClick={() =>
          patch((d) => {
            d.production.push({
              id: uid("pu"),
              name: "New unit",
              station: STATIONS[0],
              note: "",
              conditionOptionId: undefined,
              conditionValue: undefined,
            });
          })
        }
      >
        <Plus className="size-3.5" />
        Add production unit
      </Button>
    </div>
  );
}

export function RoutingSection({
  draft,
  patch,
}: {
  draft: ProductDraft;
  patch: (fn: (d: ProductDraft) => void) => void;
}) {
  const [viewOpen, setViewOpen] = useState(false);
  const templates = ROUTE_TEMPLATE_CATALOG.map((t) => t.name);
  const tpl = findRouteTemplate(draft.routing.template);
  const required = draft.routing.policy === "Route required";

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">
        Route Templates are defined and versioned in the Routing module. This product only selects
        which one its orders should follow.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Cell
          label="Route policy"
          hint="Whether orders for this product must follow a route template."
        >
          <Picker
            value={draft.routing.policy}
            items={ROUTE_POLICIES}
            onChange={(v) =>
              patch((d) => {
                d.routing.policy = v;
              })
            }
          />
        </Cell>
        {required && (
          <Cell
            label="Default route"
            hint="Selected from Route Templates owned by the Routing module."
          >
            <Picker
              value={draft.routing.template}
              items={templates}
              onChange={(v) =>
                patch((d) => {
                  d.routing.template = v;
                  d.routing.steps = [...(findRouteTemplate(v)?.steps ?? [])];
                })
              }
            />
          </Cell>
        )}
      </div>

      {required ? (
        <div className="rounded-md border border-border p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Route preview
            </span>
            <Chip tone="ok">Read-only</Chip>
            <span className="ml-auto text-[11px] text-muted-foreground">
              Revision {tpl?.revision ?? 1}
            </span>
          </div>
          <div className="mt-1.5 text-[13px] font-semibold">{draft.routing.template}</div>
          <ol className="mt-2 flex flex-wrap items-center gap-1.5">
            {draft.routing.steps.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5">
                {i > 0 && <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />}
                <span className="rounded border border-border bg-surface-2 px-2 py-1 text-[12px] font-medium">
                  {s}
                </span>
              </li>
            ))}
            {draft.routing.steps.length === 0 && (
              <li className="text-[12px] italic text-muted-foreground">
                This template has no steps.
              </li>
            )}
          </ol>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-[12px]"
              onClick={() => setViewOpen(true)}
            >
              <Eye className="size-3.5" />
              View route
            </Button>
            <Button asChild size="sm" variant="outline" className="h-7 gap-1.5 text-[12px]">
              <Link to="/routing">
                <ExternalLink className="size-3.5" />
                Manage routes
              </Link>
            </Button>
            <Button
              asChild
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-[12px] text-muted-foreground"
            >
              <Link to="/routing">
                <Copy className="size-3.5" />
                Duplicate &amp; customize
              </Link>
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Editing steps happens in the Routing module.
            </span>
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          {draft.routing.policy === "No route"
            ? "Orders skip routing — typical for service fees and billing-only products."
            : "Routing is unconfigured; staff will route these orders manually."}
        </p>
      )}

      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{tpl?.name ?? draft.routing.template}</DialogTitle>
            <DialogDescription className="text-[12px]">
              {tpl?.description ?? "Route template defined in the Routing module."}
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-2 gap-2 text-[12px]">
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">{tpl?.status ?? "Active"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Revision</dt>
              <dd className="font-medium">{tpl?.revision ?? 1}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Owned by</dt>
              <dd className="font-medium">{tpl?.owner ?? "Routing module"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Steps</dt>
              <dd className="font-medium">{draft.routing.steps.length}</dd>
            </div>
          </dl>
          <ol className="space-y-1">
            {draft.routing.steps.map((s, i) => (
              <li
                key={s}
                className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px]"
              >
                <span className="num w-4 text-muted-foreground">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-muted-foreground">
            Read-only context. Changes to this route affect every product that references it.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
