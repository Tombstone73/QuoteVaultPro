import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  RULE_EFFECTS,
  allOptions,
  findOption,
  uid,
  type ProductDraft,
  type RuleCard,
  type RuleEffect,
} from "@/lib/mock/product-editor";
import { Cell, Chip, Picker, Toggle } from "./fields";

const effectLabels = RULE_EFFECTS.map((e) => e.label);

/**
 * Plain-language rule cards. One card replaces a legacy rule's
 * then-actions plus its mirrored else-actions — the inverse is generated.
 */
export function RuleCards({
  draft,
  patch,
}: {
  draft: ProductDraft;
  patch: (fn: (d: ProductDraft) => void) => void;
}) {
  const refs = allOptions(draft);
  const sources = refs.filter((r) => r.option.choices.length > 0);

  const addRule = () => {
    const src = sources[0];
    if (!src) return;
    patch((d) => {
      d.rules.push({
        id: uid("r"),
        enabled: true,
        label: "New rule",
        sourceOptionId: src.option.id,
        operator: "is",
        value: src.option.choices[0]?.label ?? "",
        effect: "show-require",
        targetOptionIds: [],
      });
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-[12px] text-muted-foreground">
          Each rule is one sentence. Say what should happen when a choice is picked — the opposite
          case (hide, make optional and clear the value) is handled automatically, so there is no
          second list of else-actions to maintain.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          onClick={addRule}
          disabled={sources.length === 0}
        >
          <Plus className="size-4" />
          Add rule
        </Button>
      </div>

      {draft.rules.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
          No option rules configured. Every option is always visible.
        </p>
      )}

      <div className="space-y-2.5">
        {draft.rules.map((rule, ri) => (
          <Card
            key={rule.id}
            rule={rule}
            draft={draft}
            patchRule={(fn) => patch((d) => fn(d.rules[ri]!))}
            onDelete={() =>
              patch((d) => {
                d.rules.splice(ri, 1);
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

function Card({
  rule,
  draft,
  patchRule,
  onDelete,
}: {
  rule: RuleCard;
  draft: ProductDraft;
  patchRule: (fn: (r: RuleCard) => void) => void;
  onDelete: () => void;
}) {
  const refs = allOptions(draft);
  const sources = refs.filter((r) => r.option.choices.length > 0);
  const source = findOption(draft, rule.sourceOptionId);
  const values = source?.option.choices.map((c) => c.label) ?? [];
  const effect = RULE_EFFECTS.find((e) => e.id === rule.effect)!;
  const targets = refs.filter((r) => r.option.id !== rule.sourceOptionId);
  const defaultValues = rule.targetOptionIds.flatMap(
    (id) => findOption(draft, id)?.option.choices.map((c) => c.label) ?? [],
  );

  const optName = (id: string) => {
    const r = findOption(draft, id);
    return r
      ? r.group.name === r.option.label
        ? r.option.label
        : `${r.group.name} → ${r.option.label}`
      : "(missing option)";
  };

  return (
    <div className={cn("rounded-md border border-border p-3", !rule.enabled && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-7 max-w-[280px] border-transparent bg-transparent text-[13px] font-semibold hover:border-border focus:border-border"
          value={rule.label}
          onChange={(e) =>
            patchRule((r) => {
              r.label = e.target.value;
            })
          }
        />
        <span className="flex-1" />
        <Toggle
          label="Enabled"
          checked={rule.enabled}
          onChange={(v) =>
            patchRule((r) => {
              r.enabled = v;
            })
          }
        />
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-late"
          aria-label="Delete rule"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-2/60 p-2.5">
        <span className="pb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          When
        </span>
        <Cell className="min-w-[200px] flex-[2]">
          <Picker
            className="min-w-0 [&>span]:truncate"
            value={source ? optName(source.option.id) : "(missing option)"}
            items={sources.map((s) => optName(s.option.id))}
            onChange={(v) =>
              patchRule((r) => {
                const next = sources.find((s) => optName(s.option.id) === v);
                if (!next) return;
                r.sourceOptionId = next.option.id;
                r.value = next.option.choices[0]?.label ?? "";
              })
            }
          />
        </Cell>
        <Cell className="w-[92px] shrink-0">
          <Picker
            value={rule.operator}
            items={["is", "is not"] as const}
            onChange={(v) =>
              patchRule((r) => {
                r.operator = v;
              })
            }
          />
        </Cell>
        <Cell className="min-w-[130px] flex-1">
          <Picker
            className="min-w-0 [&>span]:truncate"
            value={rule.value || values[0] || ""}
            items={values.length ? values : [""]}
            onChange={(v) =>
              patchRule((r) => {
                r.value = v;
              })
            }
          />
        </Cell>
        <ArrowRight className="mb-2 size-4 shrink-0 text-muted-foreground" />
        <Cell className="min-w-[190px] flex-1">
          <Picker
            className="min-w-0 [&>span]:truncate"
            value={effect.label}
            items={effectLabels}
            onChange={(v) =>
              patchRule((r) => {
                r.effect = RULE_EFFECTS.find((e) => e.label === v)!.id as RuleEffect;
              })
            }
          />
        </Cell>
        {rule.effect === "default" && (
          <Cell className="min-w-[140px]">
            <Picker
              value={rule.defaultValue ?? defaultValues[0] ?? ""}
              items={defaultValues.length ? defaultValues : [""]}
              onChange={(v) =>
                patchRule((r) => {
                  r.defaultValue = v;
                })
              }
            />
          </Cell>
        )}
      </div>

      <div className="mt-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          These options
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {targets.map((t) => {
            const on = rule.targetOptionIds.includes(t.option.id);
            return (
              <button
                key={t.option.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  patchRule((r) => {
                    r.targetOptionIds = on
                      ? r.targetOptionIds.filter((id) => id !== t.option.id)
                      : [...r.targetOptionIds, t.option.id];
                  })
                }
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                  on
                    ? "border-primary bg-primary/15 font-medium text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {optName(t.option.id)}
              </button>
            );
          })}
        </div>
        {rule.targetOptionIds.length === 0 && (
          <p className="mt-1.5 text-[11px] text-warn">
            Pick at least one option for this rule to affect.
          </p>
        )}
      </div>

      <p className="mt-2.5 border-t border-border pt-2 text-[12px] leading-relaxed text-muted-foreground">
        <Chip tone="accent">Auto</Chip> Otherwise those options are{" "}
        <span className="text-foreground">{effect.inverse}</span> — no extra actions needed.
        {rule.targetOptionIds.length > 0 && (
          <>
            {" "}
            Affects:{" "}
            <span className="text-foreground">{rule.targetOptionIds.map(optName).join(", ")}</span>.
          </>
        )}
      </p>
    </div>
  );
}
