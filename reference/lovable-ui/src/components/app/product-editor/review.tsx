import { ArrowRight, CheckCircle2 } from "lucide-react";
import { materials } from "@/lib/mock/data";
import {
  allOptions,
  findOption,
  findRouteTemplate,
  matrixDimensions,
  type Finding,
  type ProductDraft,
} from "@/lib/mock/product-editor";
import { Chip } from "./fields";

/** Human-readable digest of the whole draft plus the diff against the active version. */
export function ReviewSummary({ draft, findings }: { draft: ProductDraft; findings: Finding[] }) {
  const dims = matrixDimensions(draft);
  const errors = findings.filter((f) => f.severity === "error");

  const rows: { label: string; value: string }[] = [
    { label: "Product", value: `${draft.name} · ${draft.category} · ${draft.productType}` },
    { label: "Measurement", value: `${draft.measurements} · ${draft.pricing.units}` },
    { label: "Workflow intent", value: draft.workflowIntent },
    {
      label: "Options",
      value: draft.groups.length
        ? draft.groups
            .map((g) => `${g.name} (${g.options.reduce((a, o) => a + o.choices.length, 0)})`)
            .join(", ")
        : "No option groups",
    },
    {
      label: "Pricing",
      value: draft.matrix.enabled
        ? `Matrix on ${dims.map((d) => d.option.label).join(" × ") || "—"}, ${draft.matrix.unit}${draft.matrix.tierBasis !== "None" ? `, tiered by ${draft.matrix.tierBasis}` : ""}`
        : `$${draft.pricing.ratePerSqFt} / sq ft${Number(draft.pricing.ratePerPiece) > 0 ? ` + $${draft.pricing.ratePerPiece} / piece` : ""}`,
    },
    { label: "Minimum charge", value: `$${draft.pricing.minimumCharge}` },
    {
      label: "Materials",
      value: draft.recipe.length
        ? draft.recipe
            .map((l) => {
              const m = materials.find((x) => x.id === l.materialId)?.name ?? "Material";
              const cond = l.conditionOptionId
                ? findOption(draft, l.conditionOptionId)?.option.label
                : undefined;
              return cond ? `${m} when ${cond} = ${l.conditionValue}` : m;
            })
            .join(", ")
        : "No recipe",
    },
    {
      label: "Production",
      value: draft.production.length
        ? draft.production
            .map((u) => (u.conditionOptionId ? `${u.name} (conditional)` : u.name))
            .join(", ")
        : "No production units",
    },
    { label: "Routing", value: draft.routing.policy },
    ...(draft.routing.policy === "Route required"
      ? [
          {
            label: "Template",
            value: `${draft.routing.template} · revision ${findRouteTemplate(draft.routing.template)?.revision ?? 1}`,
          },
          { label: "Steps", value: draft.routing.steps.join(" → ") || "No steps" },
        ]
      : []),

    {
      label: "Rules",
      value: draft.rules.length
        ? `${draft.rules.length} option visibility condition${draft.rules.length === 1 ? "" : "s"}`
        : "None",
    },
    {
      label: "Choice count",
      value: `${allOptions(draft).reduce((a, o) => a + o.option.choices.length, 0)} choices across ${allOptions(draft).length} options`,
    },
  ];

  return (
    <div className="space-y-3">
      <dl className="divide-y divide-border rounded-md border border-border">
        {rows.map((r) => (
          <div
            key={r.label}
            className="grid grid-cols-[minmax(0,1fr)] gap-0.5 px-3 py-1.5 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-3"
          >
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {r.label}
            </dt>
            <dd className="min-w-0 text-[13px]">{r.value}</dd>
          </div>
        ))}
      </dl>

      <div className="rounded-md border border-border">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <span className="text-[12px] font-bold uppercase tracking-wide">
            Changes vs {draft.version.activeVersion}
          </span>
          <Chip>{draft.version.draftVersion}</Chip>
          <span className="ml-auto text-[11px] text-muted-foreground">
            Last published {draft.version.lastPublished}
          </span>
        </header>
        <ul className="divide-y divide-border">
          {draft.version.changes.map((c, i) => (
            <li
              key={i}
              className="grid grid-cols-[minmax(0,1fr)] gap-1 px-3 py-1.5 sm:grid-cols-[110px_minmax(0,1fr)_auto] sm:items-center sm:gap-3"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {c.section}
              </span>
              <span className="min-w-0 truncate text-[13px]">{c.label}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-[12px]">
                <span className="num text-muted-foreground line-through">{c.from}</span>
                <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
                <span className="num font-medium">{c.to}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div
        className={`rounded-md border px-3 py-2 text-[12px] ${errors.length ? "border-late/50 bg-late/10 text-late" : "border-ok/50 bg-ok/10 text-ok"}`}
      >
        {errors.length ? (
          <span>
            {errors.length} blocking issue{errors.length === 1 ? "" : "s"} must be fixed before
            publishing.
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5" />
            Server validation reports no blocking issues — ready to publish.
          </span>
        )}
      </div>
    </div>
  );
}
