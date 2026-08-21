import { ArrowRight } from "lucide-react";
import React from "react";
import type {
  ProductDraftOption,
  ProductProductionUnitSpecification,
  ProductRecipeComponent,
} from "../api";
import { Chip } from "./referencePrimitives";

/** A condition fact projected from one of its canonical V2 owners. */
export type CanonicalConditionReference = Readonly<{
  id: string;
  owner: "materials" | "production";
  sourceLabel: string;
  sourceOptionId: string;
  choiceValue: string;
  targetLabel: string;
  effect: "include" | "require";
}>;

/**
 * Projects conditional facts owned by Recipe and Production into the Lovable
 * rule-card layout. It intentionally creates no RuleCard state: V2's
 * optionId/choiceValue and production selection keys remain authoritative.
 */
export function projectCanonicalConditions({
  options,
  recipe,
  production,
  selectionKeys = {},
}: Readonly<{
  options: readonly ProductDraftOption[];
  recipe: readonly ProductRecipeComponent[];
  production: ProductProductionUnitSpecification | null;
  selectionKeys?: Readonly<Record<string, string>>;
}>): readonly CanonicalConditionReference[] {
  const source = (optionId: string, choiceValue: string) => {
    const option = options.find(
      (entry) => entry.optionId === optionId || selectionKeys[entry.optionId] === optionId,
    );
    const choice = option?.choices.find((entry) => entry.choiceValue === choiceValue);
    return { label: option?.label ?? optionId, choice: choice?.label ?? choiceValue };
  };

  const recipeRules = recipe.flatMap((component, index) => {
    if (!component.condition || component.condition.type !== "selected") return [];
    const match = source(component.condition.optionId, component.condition.choiceValue);
    return [{
      id: `recipe:${component.componentId ?? `${component.materialId}:${index}`}`,
      owner: "materials" as const,
      sourceLabel: match.label,
      sourceOptionId: component.condition.optionId,
      choiceValue: match.choice,
      targetLabel: component.materialName ?? component.materialId,
      effect: "include" as const,
    }];
  });

  const productionRules = (production?.rules ?? []).flatMap((rule, index) => {
    if (!rule.when) return [];
    const match = source(rule.when.selectionKey, String(rule.when.equals));
    return [{
      id: `production:${rule.key || index}`,
      owner: "production" as const,
      sourceLabel: match.label,
      sourceOptionId: rule.when.selectionKey,
      choiceValue: match.choice,
      targetLabel: rule.key || `Production unit ${index + 1}`,
      effect: "require" as const,
    }];
  });

  return [...recipeRules, ...productionRules];
}

/**
 * Direct visual port of Lovable's rule-cards.tsx. The source's editable rule
 * engine is deliberately rendered as canonical, read-only condition cards:
 * V2 does not persist arbitrary visibility rules and must not fabricate them.
 */
export function RuleCards({
  conditions,
  onJumpToOwner,
}: Readonly<{
  conditions: readonly CanonicalConditionReference[];
  onJumpToOwner?: (owner: "materials" | "production") => void;
}>) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-[12px] text-muted-foreground">
          Each canonical condition is shown as one sentence. Recipe and Production own the
          persisted rule; this view makes its stable Option/Choice identity visible without a
          duplicate rule engine.
        </p>
      </div>
      {conditions.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
          No conditional Recipe or Production requirements are configured.
        </p>
      )}
      <div className="space-y-2.5">
        {conditions.map((rule) => (
          <ConditionCard key={rule.id} rule={rule} onJumpToOwner={onJumpToOwner} />
        ))}
      </div>
    </div>
  );
}

function ConditionCard({
  rule,
  onJumpToOwner,
}: Readonly<{
  rule: CanonicalConditionReference;
  onJumpToOwner?: (owner: "materials" | "production") => void;
}>) {
  const effect = rule.effect === "include" ? "Include requirement" : "Require production unit";
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-7 max-w-[280px] border-transparent bg-transparent text-[13px] font-semibold"
          value={rule.targetLabel}
          readOnly
          aria-label="Condition target"
        />
        <span className="flex-1" />
        <Chip tone="accent">Canonical</Chip>
      </div>
      <div className="mt-2.5 flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-2/60 p-2.5">
        <span className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">When</span>
        <span className="min-w-[200px] flex-[2] rounded border border-border px-2 py-1.5 text-[13px]">{rule.sourceLabel}</span>
        <span className="w-[92px] rounded border border-border px-2 py-1.5 text-[13px]">is</span>
        <span className="min-w-[130px] flex-1 rounded border border-border px-2 py-1.5 text-[13px]">{rule.choiceValue}</span>
        <ArrowRight className="mb-2 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-[190px] flex-1 rounded border border-border px-2 py-1.5 text-[13px]">{effect}</span>
      </div>
      <p className="mt-2.5 border-t border-border pt-2 text-[12px] leading-relaxed text-muted-foreground">
        <Chip tone="accent">Canonical</Chip> Stable selection key: <code>{rule.sourceOptionId}</code>. Edit this requirement in its owning domain.
      </p>
      {onJumpToOwner && <button type="button" className="mt-2 text-[12px] text-primary hover:underline" onClick={() => onJumpToOwner(rule.owner)}>Open owning section</button>}
    </div>
  );
}
