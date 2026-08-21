import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Layers,
  ListOrdered,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  INPUT_TYPES,
  uid,
  type EditorOption,
  type OptionGroup,
  type OptionState,
  type ProductDraft,
  type RuleCard,
} from "@/lib/mock/product-editor";
import { Cell, Chip, Picker, Toggle } from "./fields";
import { ChoiceEditor } from "./option-choice";

export function OptionGroupsSection({
  draft,
  patch,
  states,
  onJumpToRules,
}: {
  draft: ProductDraft;
  patch: (fn: (d: ProductDraft) => void) => void;
  states: Record<string, OptionState>;
  onJumpToRules: () => void;
}) {
  const [selected, setSelected] = useState(draft.groups[0]?.id ?? "");
  const [drag, setDrag] = useState<string | null>(null);
  const group = draft.groups.find((g) => g.id === selected) ?? draft.groups[0];
  const gi = draft.groups.findIndex((g) => g.id === group?.id);

  const addGroup = () => {
    const id = uid("g");
    patch((d) => {
      d.groups.push({
        id,
        name: "New group",
        description: "",
        required: false,
        multiSelect: false,
        options: [],
      });
    });
    setSelected(id);
  };

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    patch((d) => {
      const from = d.groups.findIndex((g) => g.id === fromId);
      const to = d.groups.findIndex((g) => g.id === toId);
      if (from < 0 || to < 0) return;
      const [moved] = d.groups.splice(from, 1);
      d.groups.splice(to, 0, moved!);
    });
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[264px_minmax(0,1fr)]">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Layers className="size-3.5" />
          Option groups
          <span className="num ml-auto rounded border border-border px-1.5 text-[11px] text-foreground">
            {draft.groups.length}
          </span>
        </div>
        <Button size="sm" className="h-8 w-full gap-1.5" onClick={addGroup}>
          <Plus className="size-4" />
          Add group
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-full gap-1.5"
          onClick={() =>
            patch((d) => {
              d.groups.push({
                id: uid("g"),
                name: "Grommets (template)",
                description: "Imported from shop template.",
                required: false,
                multiSelect: false,
                options: [
                  {
                    id: uid("o"),
                    label: "Grommet Placement",
                    help: "",
                    inputType: "Dropdown (Single Choice)",
                    required: false,
                    enabled: true,
                    choices: [],
                  },
                ],
              });
            })
          }
        >
          <ListOrdered className="size-4" />
          Import template
        </Button>

        <ul className="space-y-1.5">
          {draft.groups.map((g) => {
            const money = g.options.some((o) => o.choices.some((c) => c.impacts.length > 0));
            const conditional = g.options.some((o) => states[o.id]?.conditional);
            return (
              <li
                key={g.id}
                draggable
                onDragStart={() => setDrag(g.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (drag) reorder(drag, g.id);
                  setDrag(null);
                }}
              >
                <button
                  type="button"
                  onClick={() => setSelected(g.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                    g.id === group?.id
                      ? "border-primary/60 bg-primary/10"
                      : "border-border hover:bg-accent/60",
                  )}
                >
                  <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{g.name}</span>
                    <span className="num block text-[11px] text-muted-foreground">
                      {g.options.length} option{g.options.length === 1 ? "" : "s"}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {g.required && <Chip tone="late">Required</Chip>}
                      {g.multiSelect && <Chip>Multi</Chip>}
                      {money && <Chip tone="ok">$</Chip>}
                      {conditional && <Chip tone="accent">Conditional</Chip>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] text-muted-foreground">
          Drag groups to reorder — order follows through to quoting and the storefront.
        </p>
      </div>

      {group ? (
        <GroupDetail
          key={group.id}
          group={group}
          states={states}
          rules={draft.rules}
          onJumpToRules={onJumpToRules}
          patchGroup={(fn) => patch((d) => fn(d.groups[gi]!))}
          onDelete={() => {
            patch((d) => {
              d.groups.splice(gi, 1);
            });
            setSelected(draft.groups[0]?.id ?? "");
          }}
        />
      ) : (
        <div className="grid place-items-center rounded-md border border-dashed border-border p-10 text-[13px] text-muted-foreground">
          Add an option group to start configuring choices.
        </div>
      )}
    </div>
  );
}

function GroupDetail({
  group,
  patchGroup,
  onDelete,
  states,
  rules,
  onJumpToRules,
}: {
  group: OptionGroup;
  patchGroup: (fn: (g: OptionGroup) => void) => void;
  onDelete: () => void;
  states: Record<string, OptionState>;
  rules: RuleCard[];
  onJumpToRules: () => void;
}) {
  return (
    <div className="min-w-0 space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start gap-3">
        <Cell label="Group name" className="min-w-[200px] flex-1">
          <Input
            className="h-8 text-[13px]"
            value={group.name}
            onChange={(e) =>
              patchGroup((g) => {
                g.name = e.target.value;
              })
            }
          />
        </Cell>
        <Button
          size="sm"
          variant="ghost"
          className="mt-6 h-8 gap-1.5 text-[12px] text-muted-foreground hover:text-late"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
          Delete group
        </Button>
      </div>
      <Cell label="Group description" hint="Shown to staff and portal users above the choices.">
        <Textarea
          className="min-h-[52px] text-[13px]"
          value={group.description}
          placeholder="Group description…"
          onChange={(e) =>
            patchGroup((g) => {
              g.description = e.target.value;
            })
          }
        />
      </Cell>
      <div className="grid gap-2 sm:grid-cols-2">
        <Toggle
          label="Required group"
          hint="A selection must be made before pricing resolves."
          checked={group.required}
          onChange={(v) =>
            patchGroup((g) => {
              g.required = v;
            })
          }
        />
        <Toggle
          label="Multi-select"
          hint="Allow more than one choice from this group."
          checked={group.multiSelect}
          onChange={(v) =>
            patchGroup((g) => {
              g.multiSelect = v;
            })
          }
        />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Options
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-[12px]"
          onClick={() =>
            patchGroup((g) => {
              g.options.push({
                id: uid("o"),
                label: "New option",
                help: "",
                inputType: "Dropdown (Single Choice)",
                required: false,
                enabled: true,
                choices: [],
              });
            })
          }
        >
          <Plus className="size-3.5" />
          Add option
        </Button>
      </div>

      <div className="space-y-2">
        {group.options.length === 0 && (
          <p className="text-[12px] italic text-muted-foreground">No options in this group yet.</p>
        )}
        {group.options.map((o, oi) => (
          <OptionEditor
            key={o.id}
            option={o}
            state={states[o.id]}
            ruleLabels={rules.filter((r) => r.targetOptionIds.includes(o.id)).map((r) => r.label)}
            onJumpToRules={onJumpToRules}
            patchOption={(fn) => patchGroup((g) => fn(g.options[oi]!))}
            onDelete={() =>
              patchGroup((g) => {
                g.options.splice(oi, 1);
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

function OptionEditor({
  option,
  patchOption,
  onDelete,
  state,
  ruleLabels,
  onJumpToRules,
}: {
  option: EditorOption;
  patchOption: (fn: (o: EditorOption) => void) => void;
  onDelete: () => void;
  state: OptionState | undefined;
  ruleLabels: string[];
  onJumpToRules: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isChoice = option.inputType.includes("Choice") || option.inputType.includes("Multi");

  return (
    <div className={cn("rounded-md border border-border", !option.enabled && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2 px-2 py-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={open ? "Collapse option" : "Expand option"}
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <span className="text-[13px] font-semibold">{option.label}</span>
        <Chip>{option.inputType.split(" ")[0]}</Chip>
        {option.required && <Chip tone="late">Required</Chip>}
        {state?.conditional && (
          <button
            type="button"
            onClick={onJumpToRules}
            className="inline-flex"
            title={ruleLabels.join(" · ")}
          >
            <Chip tone="accent">Conditional</Chip>
          </button>
        )}
        <span className="num text-[11px] text-muted-foreground">
          {option.choices.length} choice{option.choices.length === 1 ? "" : "s"}
        </span>
        <span className="flex-1" />
        <Toggle
          label="Enabled"
          checked={option.enabled}
          onChange={(v) =>
            patchOption((o) => {
              o.enabled = v;
            })
          }
        />
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-late"
          aria-label="Delete option"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-border p-3 @container">
          <div className="grid gap-3 @[560px]:grid-cols-2">
            <Cell label="Option label">
              <Input
                className="h-8 text-[13px]"
                value={option.label}
                onChange={(e) =>
                  patchOption((o) => {
                    o.label = e.target.value;
                  })
                }
              />
            </Cell>
            <Cell label="Input type">
              <Picker
                value={option.inputType}
                items={INPUT_TYPES}
                onChange={(v) =>
                  patchOption((o) => {
                    o.inputType = v;
                  })
                }
              />
            </Cell>
            <Cell label="Description / help text" className="@[560px]:col-span-2">
              <Textarea
                className="min-h-[44px] text-[13px]"
                placeholder="Optional help text for users…"
                value={option.help}
                onChange={(e) =>
                  patchOption((o) => {
                    o.help = e.target.value;
                  })
                }
              />
            </Cell>
          </div>
          <Toggle
            label="Required field"
            checked={option.required}
            onChange={(v) =>
              patchOption((o) => {
                o.required = v;
              })
            }
            {...(state?.conditional
              ? { hint: `Rules also control this option: ${ruleLabels.join(", ")}` }
              : {})}
          />

          {isChoice && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Choices
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-[12px]"
                  onClick={() =>
                    patchOption((o) => {
                      o.choices.push({
                        id: uid("c"),
                        label: "New choice",
                        value: `choice_${o.choices.length + 1}`,
                        variantDefining: false,
                        additiveModifier: true,
                        pricingOverride: "None",
                        priceDelta: "",
                        tags: "",
                        impacts: [],
                        materials: [],
                      });
                    })
                  }
                >
                  <Plus className="size-3.5" />
                  Add choice
                </Button>
              </div>
              {option.choices.length === 0 && (
                <p className="text-[12px] italic text-muted-foreground">
                  No choices yet — this option will be skipped at quote time.
                </p>
              )}
              {option.choices.map((c, ci) => (
                <ChoiceEditor
                  key={c.id}
                  choice={c}
                  onChange={(fn) => patchOption((o) => fn(o.choices[ci]!))}
                  onRemove={() =>
                    patchOption((o) => {
                      o.choices.splice(ci, 1);
                    })
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
