import { ArrowRight } from "lucide-react";
import React from "react";
import type { ProductDraftOption, ProductProductionUnitSpecification, ProductRecipeComponent } from "../api";
import { Chip } from "./referencePrimitives";

/** A server-owned conditional reference, projected from Recipe or Production. */
export type CanonicalConditionReference = Readonly<{ id: string; sourceLabel: string; sourceOptionId: string; choiceValue: string; targetLabel: string; effect: "include" | "require" }>;

/**
 * Projects conditional facts owned by Recipe and Production into the Lovable
 * Rule Cards view.  It deliberately stores no rule state: the `optionId` /
 * `choiceValue` and `selectionKey` values passed to V2 persistence remain the
 * authority and are shown beneath every card for auditability.
 */
export function projectCanonicalConditions({
  options,
  recipe,
  production,
}: Readonly<{
  options: readonly ProductDraftOption[];
  recipe: readonly ProductRecipeComponent[];
  production: ProductProductionUnitSpecification | null;
}>): readonly CanonicalConditionReference[] {
  const source = (optionId: string, choiceValue: string) => {
    const option = options.find((entry) => entry.optionId === optionId);
    const choice = option?.choices.find((entry) => entry.choiceValue === choiceValue);
    return { label: option?.label ?? optionId, choice: choice?.label ?? choiceValue };
  };
  const recipeRules = recipe.flatMap((component, index) => {
    if (!component.condition || component.condition.type !== "selected") return [];
    const match = source(component.condition.optionId, component.condition.choiceValue);
    return [{
      id: `recipe:${component.componentId ?? `${component.materialId}:${index}`}`,
      sourceLabel: match.label,
      sourceOptionId: component.condition.optionId,
      choiceValue: match.choice,
      targetLabel: component.materialName ?? component.materialId,
      effect: "include" as const,
    }];
  });
  const productionRules = (production?.rules ?? []).flatMap((rule, index) => {
    if (!rule.when) return [];
    const optionId = rule.when.selectionKey;
    const choiceValue = String(rule.when.equals);
    const match = source(optionId, choiceValue);
    return [{
      id: `production:${rule.key || index}`,
      sourceLabel: match.label,
      sourceOptionId: optionId,
      choiceValue: match.choice,
      targetLabel: rule.key || `Production unit ${index + 1}`,
      effect: "require" as const,
    }];
  });
  return [...recipeRules, ...productionRules];
}

/**
 * Direct visual port of Lovable's rule-cards.tsx. V2 has no independent
 * Product visibility-rule persistence contract: conditional Recipe and
 * Production facts are authoritative. Rule cards therefore remain a faithful
 * read-only projection rather than a local rule engine.
 */
export function RuleCards({ conditions, onJumpToOwner }: Readonly<{ conditions: readonly CanonicalConditionReference[]; onJumpToOwner?: (owner: "materials" | "production") => void }>) {
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="max-w-2xl text-[12px] text-muted-foreground">Conditions are owned by the canonical Recipe and Production Unit specifications. This projection makes their stable Option/Choice identities visible without creating duplicate visibility-rule persistence.</p></div>
    {conditions.length === 0 && <p className="rounded-md border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">No conditional Recipe or Production requirements are configured.</p>}
    <div className="space-y-2.5">{conditions.map((rule) => <article key={rule.id} className="rounded-md border border-border p-3"><div className="flex flex-wrap items-center gap-2"><strong className="text-[13px]">{rule.targetLabel}</strong><span className="flex-1" /><Chip tone="warn">Canonical</Chip></div><div className="mt-2.5 flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-2/60 p-2.5"><span className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">When</span><span className="min-w-[200px] flex-[2] rounded border border-border px-2 py-1.5 text-[13px]">{rule.sourceLabel}</span><span className="w-[92px] rounded border border-border px-2 py-1.5 text-[13px]">is</span><span className="min-w-[130px] flex-1 rounded border border-border px-2 py-1.5 text-[13px]">{rule.choiceValue}</span><ArrowRight className="mb-2 size-4 shrink-0 text-muted-foreground" /><span className="min-w-[190px] flex-1 rounded border border-border px-2 py-1.5 text-[13px]">{rule.effect === "include" ? "Include requirement" : "Require production unit"}</span></div><p className="mt-2.5 border-t border-border pt-2 text-[12px] leading-relaxed text-muted-foreground">Stable selection key: <code>{rule.sourceOptionId}</code>. Edit this requirement in its owning domain.</p>{onJumpToOwner && <button type="button" className="mt-2 text-[12px] text-primary hover:underline" onClick={() => onJumpToOwner(rule.effect === "include" ? "materials" : "production")}>Open owning section</button>}</article>)}</div>
  </div>;
}
