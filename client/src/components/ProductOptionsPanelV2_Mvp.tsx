import React from "react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { buildOptionTreeV2FromLegacyOptions } from "@shared/optionTreeV2Initializer";
import {
  type BranchEdge,
  type ConditionExpr,
  type OptionNodeV2,
  type OptionTreeV2,
  optionTreeV2Schema,
  validateOptionTreeV2,
} from "@shared/optionTreeV2";
import { decodePricingImpact, encodePricingImpact, type PricingDisplayUnit } from "@/lib/optionTreeV2PricingCodec";
import { ArrowDown, ArrowUp, Plus, Settings2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Props = {
  productId: string;
  optionTreeJson: string | null;
  onChangeOptionTreeJson: (nextJson: string) => void;
};

type PricingModeUi = "none" | "addFlat" | "addPerQty" | "addPerSqft" | "percentOfBase" | "multiplier";

type GuardrailErrors = {
  global: string[];
  byNodeId: Map<string, string[]>;
};

type ParseState =
  | { status: "empty" }
  | { status: "invalid-json"; message: string }
  | {
      status: "invalid-tree";
      raw: any;
      zodError: z.ZodError;
      graphErrors: string[];
      nodeErrors: Map<string, string[]>;
    }
  | {
      status: "ok";
      raw: OptionTreeV2;
      graphErrors: string[];
      nodeErrors: Map<string, string[]>;
    };

function slugifyNodeId(input: string): string {
  const raw = String(input || "").trim().toLowerCase();
  const cleaned = raw
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return cleaned || "option";
}

function slugifyChoiceValue(input: string): string {
  const raw = String(input || "").trim().toLowerCase();
  const cleaned = raw
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return cleaned || "choice";
}

function uniqueId(base: string, existing: Set<string>): string {
  let v = base;
  if (!existing.has(v)) return v;
  let i = 2;
  while (existing.has(`${v}_${i}`)) i += 1;
  return `${v}_${i}`;
}

function walkConditionExpr(expr: ConditionExpr | undefined, visit: (node: ConditionExpr) => ConditionExpr): ConditionExpr | undefined {
  if (!expr) return undefined;
  const next = visit(expr);
  switch (next.op) {
    case "and":
    case "or":
      return { ...next, args: next.args.map((a) => walkConditionExpr(a, visit)!).filter(Boolean) as ConditionExpr[] };
    case "not":
      return { ...next, arg: walkConditionExpr(next.arg, visit)! };
    default:
      return next;
  }
}

function formatCondition(expr?: ConditionExpr): string {
  if (!expr) return "Always";
  switch (expr.op) {
    case "truthy":
      return `When ${expr.ref} is true`;
    case "equals":
      return `When ${expr.ref} = ${JSON.stringify(expr.value)}`;
    case "contains":
      return `When ${expr.ref} contains ${JSON.stringify(expr.value)}`;
    case "notEquals":
      return `When ${expr.ref} ≠ ${JSON.stringify(expr.value)}`;
    case "and":
      return `All of (${expr.args.map((a) => formatCondition(a)).join(", ")})`;
    case "or":
      return `Any of (${expr.args.map((a) => formatCondition(a)).join(", ")})`;
    case "not":
      return `Not (${formatCondition(expr.arg)})`;
    default: {
      const _exhaustive: never = expr;
      return String(_exhaustive);
    }
  }
}

function buildNodeErrorsFromZod(error: z.ZodError): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const issue of error.issues) {
    const path = issue.path;
    if (path.length >= 2 && path[0] === "nodes" && typeof path[1] === "string") {
      const nodeId = path[1];
      const arr = map.get(nodeId) ?? [];
      arr.push(issue.message);
      map.set(nodeId, arr);
    }
  }
  map.forEach((v, k) => {
    map.set(k, Array.from(new Set(v)));
  });
  return map;
}

function parseOptionTreeJson(optionTreeJson: string | null): ParseState {
  const rawText = String(optionTreeJson ?? "").trim();
  if (!rawText) return { status: "empty" };

  let raw: any;
  try {
    raw = JSON.parse(rawText);
  } catch (e) {
    return { status: "invalid-json", message: e instanceof Error ? e.message : "Invalid JSON" };
  }

  const zodRes = optionTreeV2Schema.safeParse(raw);
  const graphRes = validateOptionTreeV2(raw);
  const graphErrors = graphRes.ok ? [] : graphRes.errors;

  if (!zodRes.success) {
    return {
      status: "invalid-tree",
      raw,
      zodError: zodRes.error,
      graphErrors,
      nodeErrors: buildNodeErrorsFromZod(zodRes.error),
    };
  }

  return {
    status: "ok",
    raw: raw as OptionTreeV2,
    graphErrors,
    nodeErrors: new Map(),
  };
}

type TreeRow = {
  id: string;
  depth: number;
  node: OptionNodeV2;
  triggerLabel?: string;
};

function nodeSortKey(node: OptionNodeV2 | undefined, id: string): [number, string] {
  const sortOrderRaw = node?.ui?.sortOrder;
  const sortOrder = typeof sortOrderRaw === "number" && Number.isFinite(sortOrderRaw) ? sortOrderRaw : 0;
  return [sortOrder, id];
}

function buildTreeRows(tree: OptionTreeV2): TreeRow[] {
  const rows: TreeRow[] = [];
  const visited = new Set<string>();

  const walk = (id: string, depth: number, triggerLabel?: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = tree.nodes[id];
    if (!node) return;
    rows.push({ id, depth, node, triggerLabel });

    const children = node.edges?.children ?? [];
    children
      .slice()
      .sort((a, b) => {
        const ka = nodeSortKey(tree.nodes[a.toNodeId], a.toNodeId);
        const kb = nodeSortKey(tree.nodes[b.toNodeId], b.toNodeId);
        if (ka[0] !== kb[0]) return ka[0] - kb[0];
        return ka[1].localeCompare(kb[1]);
      })
      .forEach((edge) => {
        if (!edge?.toNodeId) return;
        walk(edge.toNodeId, depth + 1, edge.when ? formatCondition(edge.when) : "Always");
      });
  };

  const roots = Array.isArray(tree.rootNodeIds) ? tree.rootNodeIds : [];
  roots.forEach((rootId) => {
    if (typeof rootId !== "string" || !rootId.trim()) return;
    walk(rootId, 0);
  });

  // Orphans (still editable)
  const orphanIds = Object.keys(tree.nodes).filter((id) => !visited.has(id));
  orphanIds
    .sort((a, b) => {
      const ka = nodeSortKey(tree.nodes[a], a);
      const kb = nodeSortKey(tree.nodes[b], b);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      return ka[1].localeCompare(kb[1]);
    })
    .forEach((id) => {
      const node = tree.nodes[id];
      if (!node) return;
      rows.push({ id, depth: 0, node });
    });

  return rows;
}

function ensureQuestionDefaults(node: OptionNodeV2): OptionNodeV2 {
  if (node.kind !== "question") return node;
  const input = node.input ?? { type: "boolean" as const };
  return { ...node, input };
}

function isEmptyDefaultValue(inputType: NonNullable<OptionNodeV2["input"]>["type"], defaultValue: any): boolean {
  if (inputType === "boolean") return defaultValue !== true && defaultValue !== false;
  if (inputType === "select") return typeof defaultValue !== "string" || defaultValue.trim().length === 0;
  if (inputType === "multiselect") return !Array.isArray(defaultValue) || defaultValue.length === 0;
  if (inputType === "number") return defaultValue === undefined || defaultValue === null || !Number.isFinite(Number(defaultValue));
  if (inputType === "text" || inputType === "textarea") return String(defaultValue ?? "").trim().length === 0;
  // file/dimension not supported in this MVP editor
  return defaultValue === undefined;
}

function computeGuardrailErrors(tree: OptionTreeV2 | null): GuardrailErrors {
  const byNodeId = new Map<string, string[]>();
  const global: string[] = [];
  if (!tree) return { global, byNodeId };

  if (!tree.nodes || typeof (tree as any).nodes !== "object") {
    return { global, byNodeId };
  }

  for (const nodeId of Object.keys(tree.nodes)) {
    const node = tree.nodes[nodeId];
    if (!node || typeof node !== "object") continue;
    if (node.kind !== "question") continue;

    const inputType = node.input?.type;
    if (!inputType) continue;

    const errs: string[] = [];

    // Select-type questions should have choices.
    if (inputType === "select" || inputType === "multiselect") {
      const choices = Array.isArray(node.choices) ? node.choices : [];
      if (choices.length === 0) {
        errs.push("Add at least one choice.");
      }

      const allowed = new Set(choices.map((c) => String(c.value)));
      const dv = node.input?.defaultValue;
      if (inputType === "select") {
        if (typeof dv === "string" && dv.trim().length > 0 && !allowed.has(dv)) {
          errs.push("Default choice must match an existing choice.");
        }
      }
      if (inputType === "multiselect") {
        if (Array.isArray(dv)) {
          const invalid = dv.map(String).filter((v) => !allowed.has(v));
          if (invalid.length > 0) {
            errs.push("Default selections must match existing choices.");
          }
        }
      }
    }

    // Required questions should have a default in this builder UI.
    if (node.input?.required) {
      const dv = node.input?.defaultValue;
      if (inputType === "boolean") {
        // For a required toggle, defaulting ON prevents an impossible-to-satisfy state.
        if (dv !== true) errs.push("Required yes/no should default to On.");
      } else if (isEmptyDefaultValue(inputType, dv)) {
        errs.push("Required options must have a default value.");
      }
    }

    if (errs.length > 0) byNodeId.set(nodeId, Array.from(new Set(errs)));
  }

  return { global: Array.from(new Set(global)), byNodeId };
}

function getInputType(node: OptionNodeV2): NonNullable<OptionNodeV2["input"]>["type"] | null {
  if (node.kind !== "question") return null;
  return node.input?.type ?? null;
}

function getDefaultValue(node: OptionNodeV2): any {
  if (node.kind !== "question") return undefined;
  return node.input?.defaultValue;
}

function normalizeChoices(node: OptionNodeV2): Array<{ value: string; label: string; sortOrder?: number }> {
  const choices = Array.isArray(node.choices) ? node.choices.slice() : [];
  choices.sort((a, b) => {
    const ao = typeof a.sortOrder === "number" ? a.sortOrder : 0;
    const bo = typeof b.sortOrder === "number" ? b.sortOrder : 0;
    if (ao !== bo) return ao - bo;
    return String(a.value).localeCompare(String(b.value));
  });
  return choices;
}

function toCents(input: string): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function summarizePricing(treeNode: OptionNodeV2): string {
  const impact = Array.isArray(treeNode.pricingImpact) ? treeNode.pricingImpact[0] : null;
  const ui = decodePricingImpact(impact ?? undefined);
  if (ui.mode === "none") return "No pricing change.";
  if (ui.displayUnit === "each") return `Adds $${(ui.amountCents / 100).toFixed(2)} (once).`;
  if (ui.displayUnit === "per_qty") return `Adds $${(ui.amountCents / 100).toFixed(2)} per quantity.`;
  if (ui.displayUnit === "per_sqft") return `Adds $${(ui.amountCents / 100).toFixed(2)} per sq ft.`;
  if (ui.displayUnit === "percent") return `Adds ${ui.amountCents}% of base price.`;
  if (ui.displayUnit === "multiplier") return `Multiplies price by ${ui.amountCents}×.`;
  return "Pricing rule not set.";
}

function conditionReferencesChoice(expr: ConditionExpr | undefined, refNodeId: string, choiceValue: string): boolean {
  if (!expr) return false;
  switch (expr.op) {
    case "equals":
    case "contains":
      return expr.ref === refNodeId && (expr as any).value === choiceValue;
    case "notEquals":
      return false;
    case "truthy":
      return false;
    case "and":
    case "or":
      return expr.args.some((a) => conditionReferencesChoice(a, refNodeId, choiceValue));
    case "not":
      return conditionReferencesChoice(expr.arg, refNodeId, choiceValue);
    default: {
      const _exhaustive: never = expr;
      return Boolean(_exhaustive);
    }
  }
}

function ensureUnassignedGroup(tree: OptionTreeV2): { tree: OptionTreeV2; groupId: string } {
  const base = "unassigned";
  const existing = new Set(Object.keys(tree.nodes));
  const groupId = existing.has(base) ? uniqueId(base, existing) : base;
  if (tree.nodes[groupId] && tree.nodes[groupId].kind === "group") {
    const roots = tree.rootNodeIds.includes(groupId) ? tree.rootNodeIds : [...tree.rootNodeIds, groupId];
    return { tree: { ...tree, rootNodeIds: roots }, groupId };
  }

  const groupNode: OptionNodeV2 = {
    id: groupId,
    kind: "group",
    label: "Unassigned",
    description: "Children moved here when their trigger becomes invalid.",
    ui: { sortOrder: 9999 },
    edges: { children: [] },
  };

  return {
    tree: {
      ...tree,
      rootNodeIds: [...tree.rootNodeIds, groupId],
      nodes: { ...tree.nodes, [groupId]: groupNode },
    },
    groupId,
  };
}

function renameNodeId(tree: OptionTreeV2, oldId: string, desiredId: string): OptionTreeV2 {
  const normalized = slugifyNodeId(desiredId);
  const existing = new Set(Object.keys(tree.nodes));
  existing.delete(oldId);
  const nextId = uniqueId(normalized, existing);
  if (nextId === oldId) return tree;

  const oldNode = tree.nodes[oldId];
  if (!oldNode) return tree;

  const nodes: Record<string, any> = { ...tree.nodes };
  delete nodes[oldId];
  nodes[nextId] = { ...oldNode, id: nextId };

  // Update refs across all nodes.
  for (const nodeKey of Object.keys(nodes)) {
    const node: any = nodes[nodeKey];

    if (node?.visibility?.condition) {
      node.visibility = {
        ...(node.visibility ?? {}),
        condition: walkConditionExpr(node.visibility.condition, (expr) => {
          if ((expr as any).ref === oldId) return { ...(expr as any), ref: nextId };
          return expr;
        }),
      };
    }

    if (Array.isArray(node?.edges?.children)) {
      node.edges = {
        ...(node.edges ?? {}),
        children: node.edges.children.map((edge: BranchEdge) => {
          const toNodeId = edge.toNodeId === oldId ? nextId : edge.toNodeId;
          const when = walkConditionExpr(edge.when, (expr) => {
            if ((expr as any).ref === oldId) return { ...(expr as any), ref: nextId };
            return expr;
          });
          return { ...edge, toNodeId, when };
        }),
      };
    }

    if (Array.isArray(node?.pricingImpact)) {
      node.pricingImpact = node.pricingImpact.map((impact: any) => {
        const applyWhen = walkConditionExpr(impact.applyWhen, (expr) => {
          if ((expr as any).ref === oldId) return { ...(expr as any), ref: nextId };
          return expr;
        });
        return { ...impact, applyWhen };
      });
    }
  }

  const rootNodeIds = (tree.rootNodeIds ?? []).map((id) => (id === oldId ? nextId : id));

  return { ...tree, rootNodeIds, nodes: nodes as any };
}

function updateChoiceValueEverywhere(tree: OptionTreeV2, nodeId: string, oldValue: string, nextValue: string): OptionTreeV2 {
  if (!oldValue || oldValue === nextValue) return tree;
  const nodes: Record<string, any> = { ...tree.nodes };

  const node = nodes[nodeId];
  if (!node) return tree;

  // Update defaultValue on the node itself.
  const inputType = node?.input?.type;
  if (inputType === "select" && node?.input) {
    if (node.input.defaultValue === oldValue) {
      node.input = { ...node.input, defaultValue: nextValue };
    }
  }
  if (inputType === "multiselect" && node?.input) {
    const dv = node.input.defaultValue;
    if (Array.isArray(dv)) {
      node.input = { ...node.input, defaultValue: dv.map((v: any) => (v === oldValue ? nextValue : v)) };
    }
  }

  // Update condition expressions across the whole tree that point at nodeId.
  for (const id of Object.keys(nodes)) {
    const n: any = nodes[id];

    const updateExpr = (expr: ConditionExpr) => {
      if ((expr.op === "equals" || expr.op === "contains") && expr.ref === nodeId && (expr as any).value === oldValue) {
        return { ...(expr as any), value: nextValue } as any;
      }
      return expr;
    };

    if (n?.visibility?.condition) {
      n.visibility = { ...(n.visibility ?? {}), condition: walkConditionExpr(n.visibility.condition, updateExpr) };
    }

    if (Array.isArray(n?.edges?.children)) {
      n.edges = {
        ...(n.edges ?? {}),
        children: n.edges.children.map((edge: any) => ({
          ...edge,
          when: walkConditionExpr(edge.when, updateExpr),
        })),
      };
    }

    if (Array.isArray(n?.pricingImpact)) {
      n.pricingImpact = n.pricingImpact.map((impact: any) => ({
        ...impact,
        applyWhen: walkConditionExpr(impact.applyWhen, updateExpr),
      }));
    }
  }

  return { ...tree, nodes: nodes as any };
}

export default function ProductOptionsPanelV2_Mvp({
  productId,
  optionTreeJson,
  onChangeOptionTreeJson,
}: Props) {
  const { toast } = useToast();
  const parsed = React.useMemo(() => parseOptionTreeJson(optionTreeJson), [optionTreeJson]);

  const tree: OptionTreeV2 | null = parsed.status === "ok" ? parsed.raw : parsed.status === "invalid-tree" ? (parsed.raw as any) : null;
  const zodIssues = parsed.status === "invalid-tree" ? parsed.zodError.issues : [];
  const nodeErrorsFromZod = parsed.status === "invalid-tree" ? parsed.nodeErrors : new Map<string, string[]>();
  const graphErrors = parsed.status === "ok" ? parsed.graphErrors : parsed.status === "invalid-tree" ? parsed.graphErrors : [];

  const guardrails = React.useMemo(() => computeGuardrailErrors(tree), [tree]);
  const nodeErrorsMerged = React.useMemo(() => {
    const out = new Map<string, string[]>();

    nodeErrorsFromZod.forEach((v, k) => out.set(k, v));
    guardrails.byNodeId.forEach((v, k) => {
      const existing = out.get(k) ?? [];
      out.set(k, Array.from(new Set([...existing, ...v])));
    });
    return out;
  }, [nodeErrorsFromZod, guardrails.byNodeId]);

  const rows = React.useMemo(() => (tree ? buildTreeRows(tree) : []), [tree]);

  const firstEditableId = React.useMemo(() => {
    if (!tree) return null;
    const firstQuestion = rows.find((r) => r.node.kind === "question");
    return (firstQuestion?.id ?? rows[0]?.id ?? null) as string | null;
  }, [tree, rows]);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!tree) {
      setSelectedId(null);
      return;
    }
    setSelectedId((cur) => {
      if (cur && tree.nodes[cur]) return cur;
      return firstEditableId;
    });
  }, [tree, firstEditableId]);

  const selectedNode: OptionNodeV2 | null = React.useMemo(() => {
    if (!tree || !selectedId) return null;
    const n = tree.nodes[selectedId];
    return n ?? null;
  }, [tree, selectedId]);

  const [nodeIdDraft, setNodeIdDraft] = React.useState<string>("");
  React.useEffect(() => {
    if (!selectedNode) {
      setNodeIdDraft("");
      return;
    }
    setNodeIdDraft(selectedNode.id);
  }, [selectedNode?.id]);

  const selectedNodeZodErrors = React.useMemo(() => {
    if (!selectedId) return [];
    return nodeErrorsMerged.get(selectedId) ?? [];
  }, [nodeErrorsMerged, selectedId]);

  const isValid = parsed.status === "ok" && graphErrors.length === 0;

  const [pricingDrawerOpen, setPricingDrawerOpen] = React.useState(false);
  const [visibilityDrawerOpen, setVisibilityDrawerOpen] = React.useState(false);
  const [devDrawerOpen, setDevDrawerOpen] = React.useState(false);

  const [childConditionDrawerOpen, setChildConditionDrawerOpen] = React.useState(false);
  const [childConditionTarget, setChildConditionTarget] = React.useState<{ parentId: string; childId: string } | null>(null);

  // UI-only pricing metadata. Not persisted to schema.
  const [pricingTaxableByNodeId, setPricingTaxableByNodeId] = React.useState<Record<string, boolean>>({});
  const getPricingTaxable = React.useCallback(
    (nodeId: string) => {
      const v = pricingTaxableByNodeId[nodeId];
      return typeof v === "boolean" ? v : true;
    },
    [pricingTaxableByNodeId]
  );

  const [customerPreview, setCustomerPreview] = React.useState({
    quantity: 10,
    widthIn: 24,
    heightIn: 36,
  });

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        setDevDrawerOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const commitTree = (next: OptionTreeV2) => {
    onChangeOptionTreeJson(JSON.stringify(next, null, 2));
  };

  const updateTree = (updater: (t: OptionTreeV2) => OptionTreeV2) => {
    if (!tree) return;
    const next = updater(tree);
    commitTree(next);
  };

  const initTree = () => {
    // Uses the existing initializer module; empty legacy options yields a valid blank v2 tree.
    const blank = buildOptionTreeV2FromLegacyOptions([]);
    commitTree(blank);
  };

  const addRootOption = () => {
    updateTree((t) => {
      const existing = new Set(Object.keys(t.nodes));
      const newId = uniqueId("new_option", existing);

      const newNode: OptionNodeV2 = {
        id: newId,
        kind: "question",
        label: "New Option",
        input: { type: "boolean", required: false, defaultValue: false },
        ui: { sortOrder: 0 },
        edges: { children: [] },
      };

      // Attach under the first root if it's a group; otherwise append as new root.
      const rootId = (t.rootNodeIds ?? [])[0];
      const root = rootId ? t.nodes[rootId] : null;
      if (root && root.kind === "group") {
        const rootEdges = Array.isArray(root.edges?.children) ? root.edges!.children!.slice() : [];
        rootEdges.push({ toNodeId: newId });
        const nodes = {
          ...t.nodes,
          [rootId]: { ...root, edges: { ...(root.edges ?? {}), children: rootEdges } },
          [newId]: newNode,
        };
        return { ...t, nodes };
      }

      return {
        ...t,
        rootNodeIds: [...(t.rootNodeIds ?? []), newId],
        nodes: { ...t.nodes, [newId]: newNode },
      };
    });
  };

  const updateSelectedNode = (patch: Partial<OptionNodeV2>) => {
    if (!tree || !selectedId) return;
    updateTree((t) => {
      const prev = t.nodes[selectedId];
      if (!prev) return t;
      const merged: OptionNodeV2 = { ...prev, ...patch } as any;
      return { ...t, nodes: { ...t.nodes, [selectedId]: merged } };
    });
  };

  const updateSelectedInput = (patch: Partial<NonNullable<OptionNodeV2["input"]>>) => {
    if (!tree || !selectedId) return;
    updateTree((t) => {
      const prev = t.nodes[selectedId];
      if (!prev) return t;
      const ensured = ensureQuestionDefaults(prev);
      if (ensured.kind !== "question") return t;
      const input = { ...(ensured.input ?? { type: "boolean" }), ...patch };
      return { ...t, nodes: { ...t.nodes, [selectedId]: { ...ensured, input } } };
    });
  };

  const setInputType = (nextType: NonNullable<OptionNodeV2["input"]>["type"]) => {
    if (!tree || !selectedId || !selectedNode) return;
    const prevType = getInputType(selectedNode);
    if (!prevType || prevType === nextType) return;

    const prevChoicesCount = Array.isArray(selectedNode.choices) ? selectedNode.choices.length : 0;
    const willDropChoices = (prevType === "select" || prevType === "multiselect") && nextType !== "select" && nextType !== "multiselect" && prevChoicesCount > 0;

    const needsConfirm = willDropChoices;
    if (needsConfirm) {
      const ok = window.confirm(
        "Changing input type will reset incompatible fields (like choices/defaults). Continue?"
      );
      if (!ok) return;
    }

    updateTree((t) => {
      if (!selectedId) return t;
      const prev = t.nodes[selectedId];
      if (!prev) return t;
      const ensured = ensureQuestionDefaults(prev);
      if (ensured.kind !== "question") return t;

      const input = { ...(ensured.input ?? { type: "boolean" }), type: nextType };

      // Reset defaults that no longer apply.
      let defaultValue: any = input.defaultValue;
      if (nextType === "boolean") defaultValue = Boolean(defaultValue);
      else if (nextType === "select") defaultValue = typeof defaultValue === "string" ? defaultValue : "";
      else if (nextType === "multiselect") defaultValue = Array.isArray(defaultValue) ? defaultValue : [];
      else if (nextType === "number") defaultValue = Number.isFinite(Number(defaultValue)) ? Number(defaultValue) : 0;
      else if (nextType === "text" || nextType === "textarea") defaultValue = String(defaultValue ?? "");
      else defaultValue = undefined;
      input.defaultValue = defaultValue;

      const nextNode: OptionNodeV2 = { ...ensured, input };

      // Choices only for select / multiselect.
      if (nextType !== "select" && nextType !== "multiselect") {
        (nextNode as any).choices = undefined;
      } else {
        const choices = Array.isArray(nextNode.choices) ? nextNode.choices : [];
        (nextNode as any).choices = choices;
      }

      // If switching to boolean and required is enabled, default ON to avoid an impossible required state.
      if (nextType === "boolean" && input.required) {
        input.defaultValue = true;
      }

      return { ...t, nodes: { ...t.nodes, [selectedId]: nextNode } };
    });
  };

  const addChoice = () => {
    if (!tree || !selectedId || !selectedNode) return;
    const inputType = getInputType(selectedNode);
    if (inputType !== "select" && inputType !== "multiselect") return;

    updateTree((t) => {
      const prev = t.nodes[selectedId];
      if (!prev) return t;
      const choices = normalizeChoices(prev);
      const existing = new Set(choices.map((c) => c.value));
      const base = uniqueId("choice", new Set());
      const value = uniqueId(slugifyChoiceValue(base), new Set(Array.from(existing).map((v) => v.replace(/-/g, "_"))))
        .replace(/_/g, "-");
      const sortOrder = choices.length;
      const nextChoices = [...choices, { value, label: `Choice ${choices.length + 1}`, sortOrder }];
      const nextNode: OptionNodeV2 = { ...prev, choices: nextChoices };
      return { ...t, nodes: { ...t.nodes, [selectedId]: nextNode } };
    });
  };

  const updateChoice = (value: string, patch: Partial<{ value: string; label: string }>) => {
    if (!tree || !selectedId) return;
    updateTree((t) => {
      const prev = t.nodes[selectedId];
      if (!prev) return t;
      const choices = normalizeChoices(prev);
      const idx = choices.findIndex((c) => c.value === value);
      if (idx === -1) return t;

      const nextChoices = choices.map((c) => (c.value === value ? { ...c, ...patch } : c));
      // Re-assign sortOrder by current array order.
      const withOrder = nextChoices.map((c, i) => ({ ...c, sortOrder: i }));
      const nextNode: OptionNodeV2 = { ...prev, choices: withOrder };

      let nextTree: OptionTreeV2 = { ...t, nodes: { ...t.nodes, [selectedId]: nextNode } };

      // If value changed, update defaults and existing conditions.
      if (patch.value && patch.value !== value) {
        nextTree = updateChoiceValueEverywhere(nextTree, selectedId, value, patch.value);
      }

      return nextTree;
    });
  };

  const moveChoice = (value: string, dir: -1 | 1) => {
    if (!tree || !selectedId) return;
    updateTree((t) => {
      const prev = t.nodes[selectedId];
      if (!prev) return t;
      const choices = normalizeChoices(prev);
      const idx = choices.findIndex((c) => c.value === value);
      if (idx === -1) return t;
      const nextIndex = idx + dir;
      if (nextIndex < 0 || nextIndex >= choices.length) return t;
      const nextChoices = choices.slice();
      const [moved] = nextChoices.splice(idx, 1);
      nextChoices.splice(nextIndex, 0, moved);
      const withOrder = nextChoices.map((c, i) => ({ ...c, sortOrder: i }));
      return { ...t, nodes: { ...t.nodes, [selectedId]: { ...prev, choices: withOrder } } };
    });
  };

  const removeChoice = (value: string) => {
    if (!tree || !selectedId) return;
    updateTree((t) => {
      const prev = t.nodes[selectedId];
      if (!prev) return t;
      const choices = normalizeChoices(prev);
      const nextChoices = choices.filter((c) => c.value !== value).map((c, i) => ({ ...c, sortOrder: i }));

      const prevEdges = Array.isArray(prev.edges?.children) ? prev.edges!.children!.slice() : [];
      const affectedEdges = prevEdges.filter((e) => conditionReferencesChoice(e.when, selectedId, value));
      const remainingEdges = prevEdges.filter((e) => !conditionReferencesChoice(e.when, selectedId, value));

      let nextTree: OptionTreeV2 = { ...t };

      // If any children are now invalid, move them under an Unassigned root group.
      if (affectedEdges.length > 0) {
        const ensured = ensureUnassignedGroup(nextTree);
        nextTree = ensured.tree;

        const unassigned = nextTree.nodes[ensured.groupId];
        const unassignedEdges = Array.isArray(unassigned.edges?.children) ? unassigned.edges!.children!.slice() : [];

        for (const edge of affectedEdges) {
          unassignedEdges.push({ toNodeId: edge.toNodeId });
        }

        nextTree = {
          ...nextTree,
          nodes: {
            ...nextTree.nodes,
            [ensured.groupId]: { ...unassigned, edges: { ...(unassigned.edges ?? {}), children: unassignedEdges } },
          },
        };

        toast({
          title: "Sub-options moved to Unassigned",
          description: `Removed choice '${value}'. ${affectedEdges.length} sub-option(s) were preserved and moved.`,
          variant: "destructive",
        });
      }

      const nextNode: OptionNodeV2 = {
        ...prev,
        choices: nextChoices,
        edges: { ...(prev.edges ?? {}), children: remainingEdges },
      };

      return { ...nextTree, nodes: { ...nextTree.nodes, [selectedId]: nextNode } };
    });
  };

  const addChildOption = (when: ConditionExpr) => {
    if (!tree || !selectedId || !selectedNode) return;
    updateTree((t) => {
      const parent = t.nodes[selectedId];
      if (!parent) return t;

      const existingIds = new Set(Object.keys(t.nodes));
      const baseId = slugifyNodeId(`child_${selectedId}`);
      const childId = uniqueId(baseId, existingIds);

      const childrenEdges = Array.isArray(parent.edges?.children) ? parent.edges!.children!.slice() : [];
      const nextSort = (() => {
        const existingChildren = childrenEdges
          .map((e) => t.nodes[e.toNodeId])
          .filter(Boolean)
          .map((n) => (typeof n.ui?.sortOrder === "number" ? n.ui.sortOrder : 0));
        const max = existingChildren.length ? Math.max(...existingChildren) : 0;
        return max + 1;
      })();

      const childNode: OptionNodeV2 = {
        id: childId,
        kind: "question",
        label: "New Sub-Option",
        input: { type: "boolean", required: false, defaultValue: false },
        ui: { sortOrder: nextSort },
        edges: { children: [] },
      };

      childrenEdges.push({ toNodeId: childId, when });
      const nextParent: OptionNodeV2 = {
        ...parent,
        edges: { ...(parent.edges ?? {}), children: childrenEdges },
      };

      return {
        ...t,
        nodes: {
          ...t.nodes,
          [selectedId]: nextParent,
          [childId]: childNode,
        },
      };
    });
  };

  const setPricingUi = (displayUnit: PricingDisplayUnit, value: number) => {
    if (!tree || !selectedId) return;
    updateTree((t) => {
      const prev = t.nodes[selectedId];
      if (!prev) return t;
      const impacts = Array.isArray(prev.pricingImpact) ? prev.pricingImpact.slice() : [];

      // Schema-safe: all pricing impacts must be from the allowed discriminator set.
      // "No change" is represented as pricingImpact: undefined.

      const encoded = encodePricingImpact({
        mode: displayUnit === "percent" ? "percentOfBase" : displayUnit === "multiplier" ? "multiplier" : "addFlat",
        amountCents: value,
        displayUnit,
        taxable: true,
      });

      if (!encoded) {
        // Remove the first impact, preserve any remaining.
        if (impacts.length <= 1) {
          const nextNode: OptionNodeV2 = { ...prev, pricingImpact: undefined };
          return { ...t, nodes: { ...t.nodes, [selectedId]: nextNode } };
        }
        const remaining = impacts.slice(1);
        const nextNode: OptionNodeV2 = { ...prev, pricingImpact: remaining };
        return { ...t, nodes: { ...t.nodes, [selectedId]: nextNode } };
      }

      if (impacts.length === 0) impacts.push(encoded);
      else impacts[0] = encoded;

      const nextNode: OptionNodeV2 = { ...prev, pricingImpact: impacts };
      return { ...t, nodes: { ...t.nodes, [selectedId]: nextNode } };
    });
  };

  const updateChildEdgeWhen = (toNodeId: string, when: ConditionExpr | undefined) => {
    if (!tree || !selectedId) return;
    updateTree((t) => {
      const prev = t.nodes[selectedId];
      if (!prev) return t;
      const edges = Array.isArray(prev.edges?.children) ? prev.edges!.children!.slice() : [];
      const idx = edges.findIndex((e) => e.toNodeId === toNodeId);
      if (idx === -1) return t;
      edges[idx] = { ...edges[idx], when };
      return { ...t, nodes: { ...t.nodes, [selectedId]: { ...prev, edges: { ...(prev.edges ?? {}), children: edges } } } };
    });
  };

  const [newChildChoiceValue, setNewChildChoiceValue] = React.useState<string>("");

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* LEFT: Product Options Tree */}
      <div className="col-span-12 lg:col-span-3">
        <Card className="h-full">
          <CardHeader className="space-y-1">
            <CardTitle className="text-base">Product Options Tree</CardTitle>
            <CardDescription>Single page. Edits save into optionTreeJson.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="text-xs text-muted-foreground">Status</div>
                {parsed.status === "empty" ? (
                  <Badge variant="secondary" className="text-[11px]">Empty</Badge>
                ) : isValid ? (
                  <Badge variant="secondary" className="text-[11px]">Valid</Badge>
                ) : (
                  <Badge variant="destructive" className="text-[11px]">Invalid</Badge>
                )}
              </div>
              <Button size="sm" onClick={addRootOption} type="button" disabled={!tree}>
                <Plus className="h-4 w-4 mr-2" />
                Add Option
              </Button>
            </div>

            {parsed.status === "empty" ? (
              <div className="rounded-md border border-border p-3">
                <div className="text-sm font-medium">No Tree v2 data yet</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Initialize Tree v2 to begin building options. Product: {productId}
                </div>
                <div className="mt-3">
                  <Button type="button" onClick={initTree}>
                    Initialize Tree v2
                  </Button>
                </div>
              </div>
            ) : null}

            {parsed.status === "invalid-json" ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <div className="text-sm font-medium text-destructive">Invalid JSON</div>
                <div className="text-xs text-destructive mt-1">{parsed.message}</div>
              </div>
            ) : null}

            {parsed.status === "invalid-tree" ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <div className="text-sm font-medium text-destructive">Invalid Tree v2</div>
                <div className="text-xs text-destructive mt-1">Fix issues to enable saving.</div>
              </div>
            ) : null}

            {tree ? (
              <ScrollArea className="h-[520px] rounded-md border border-border">
                <div className="p-2 space-y-1">
                  {rows.map((r) => {
                    const isActive = r.id === selectedId;
                    const hasNodeErrors = nodeErrorsMerged.has(r.id);
                    const inputType = r.node.kind === "question" ? r.node.input?.type : undefined;
                    const required = r.node.kind === "question" ? !!r.node.input?.required : false;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setSelectedId(r.id)}
                        className={
                          "w-full text-left rounded-md border px-2 py-2 transition " +
                          (isActive
                            ? "bg-muted border-border"
                            : "bg-background border-border hover:bg-muted")
                        }
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0" style={{ paddingLeft: `${Math.min(r.depth, 6) * 12}px` }}>
                            <div className="truncate text-sm font-medium text-foreground">
                              {r.node.label}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {r.id}
                              {r.depth > 0 && r.triggerLabel ? ` • ${r.triggerLabel}` : ""}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {hasNodeErrors ? <Badge variant="destructive" className="text-[11px]">!</Badge> : null}
                            {r.node.kind === "group" ? (
                              <Badge variant="outline" className="text-[11px]">Group</Badge>
                            ) : r.node.kind === "computed" ? (
                              <Badge variant="outline" className="text-[11px]">Computed</Badge>
                            ) : (
                              <div className="text-[11px] text-muted-foreground">
                                {inputType ?? "question"}
                                {required ? " • req" : ""}
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            ) : null}

            <div className="text-xs text-muted-foreground">
              Advanced editors open as drawers. Dev drawer: Ctrl+Shift+D.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* CENTER: Option Editor */}
      <div className="col-span-12 lg:col-span-6">
        <Card className="h-full">
          <CardHeader className="space-y-1">
            <CardTitle className="text-base">Option Editor</CardTitle>
            <CardDescription>Edit one option at a time.</CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {!tree ? (
              <div className="text-sm text-muted-foreground">Initialize Tree v2 to start editing.</div>
            ) : !selectedNode || !selectedId ? (
              <div className="text-sm text-muted-foreground">Select an option from the left.</div>
            ) : (
              <>
                {/* 1) Option Identity */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">1. Option Identity</div>
                      <div className="text-xs text-muted-foreground">Name, internal key, and description.</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Label</Label>
                      <Input value={selectedNode.label} onChange={(e) => updateSelectedNode({ label: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label>Internal ID (Slug)</Label>
                      <Input
                        value={nodeIdDraft}
                        onChange={(e) => {
                          setNodeIdDraft(e.target.value);
                        }}
                        onBlur={(e) => {
                          const desired = e.target.value;
                          if (!tree) return;
                          const oldId = selectedNode.id;
                          const normalized = slugifyNodeId(desired);
                          const existing = new Set(Object.keys(tree.nodes));
                          existing.delete(oldId);
                          const nextId = uniqueId(normalized, existing);
                          if (nextId === oldId) {
                            setNodeIdDraft(oldId);
                            return;
                          }

                          const nextTree = renameNodeId(tree, oldId, nextId);
                          commitTree(nextTree);
                          setSelectedId(nextId);
                          setNodeIdDraft(nextId);
                        }}
                      />
                      <div className="text-xs text-muted-foreground">Changing IDs updates references automatically.</div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label>Description</Label>
                    <Textarea
                      value={selectedNode.description ?? ""}
                      onChange={(e) => updateSelectedNode({ description: e.target.value })}
                      placeholder="Shown to operators (and optionally customers)."
                      className="min-h-[80px]"
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <div className="text-sm font-medium">Required</div>
                      <div className="text-xs text-muted-foreground">Prevent saving if not answered.</div>
                    </div>
                    <Switch
                      checked={!!selectedNode.input?.required}
                      onCheckedChange={(v) => {
                        const t = getInputType(selectedNode);
                        if (!t) return;

                        if (!v) {
                          updateSelectedInput({ required: false });
                          return;
                        }

                        // Turning required on should not create an invalid/unsatisfiable state.
                        if ((t === "select" || t === "multiselect") && normalizeChoices(selectedNode).length === 0) {
                          toast({
                            title: "Add choices first",
                            description: "Make at least one choice before marking this option required.",
                            variant: "destructive",
                          });
                          return;
                        }

                        // Auto-set a safe default when enabling required.
                        const dv = getDefaultValue(selectedNode);
                        if (t === "boolean") {
                          updateSelectedInput({ required: true, defaultValue: true });
                          return;
                        }

                        if (isEmptyDefaultValue(t, dv)) {
                          if (t === "select") {
                            const choices = normalizeChoices(selectedNode);
                            const first = choices[0]?.value ?? "";
                            updateSelectedInput({ required: true, defaultValue: first });
                            return;
                          }
                          if (t === "multiselect") {
                            const choices = normalizeChoices(selectedNode);
                            const first = choices[0]?.value;
                            updateSelectedInput({ required: true, defaultValue: first ? [first] : [] });
                            return;
                          }
                          if (t === "number") {
                            updateSelectedInput({ required: true, defaultValue: 0 });
                            return;
                          }
                          if (t === "text" || t === "textarea") {
                            updateSelectedInput({ required: true, defaultValue: "" });
                            return;
                          }
                        }

                        updateSelectedInput({ required: true });
                      }}
                      disabled={selectedNode.kind !== "question"}
                    />
                  </div>
                </div>

                <Separator />

                {/* 2) Input Type (visual buttons) */}
                <div className="space-y-3">
                  <div>
                    <div className="text-sm font-semibold">2. Input Type</div>
                    <div className="text-xs text-muted-foreground">Choose how the operator answers this option.</div>
                  </div>

                  <ToggleGroup
                    type="single"
                    value={getInputType(selectedNode) ?? ""}
                    onValueChange={(val) => {
                      if (!val) return;
                      setInputType(val as any);
                    }}
                    className="justify-start flex-wrap"
                    disabled={selectedNode.kind !== "question"}
                  >
                    <ToggleGroupItem value="boolean" aria-label="Boolean">Yes / No</ToggleGroupItem>
                    <ToggleGroupItem value="select" aria-label="Select">Dropdown</ToggleGroupItem>
                    <ToggleGroupItem value="multiselect" aria-label="Multi Select">Multi-select</ToggleGroupItem>
                    <ToggleGroupItem value="text" aria-label="Text">Text</ToggleGroupItem>
                    <ToggleGroupItem value="number" aria-label="Number">Number</ToggleGroupItem>
                  </ToggleGroup>
                </div>

                <div className="rounded-md border border-border p-3">
                  <div className="text-xs text-muted-foreground">Default value</div>
                  <div className="mt-2">
                    {(() => {
                      const t = getInputType(selectedNode);
                      if (!t) return <div className="text-sm text-muted-foreground">Not a question node.</div>;

                      const dv = getDefaultValue(selectedNode);

                      if (t === "boolean") {
                        return (
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm">Default On</div>
                            <Switch checked={dv === true} onCheckedChange={(v) => updateSelectedInput({ defaultValue: v })} />
                          </div>
                        );
                      }

                      if (t === "select") {
                        const choices = normalizeChoices(selectedNode);
                        return (
                          <div className="space-y-1">
                            <Label className="text-sm">Default choice</Label>
                            <Select
                              value={typeof dv === "string" ? dv : ""}
                              onValueChange={(v) => updateSelectedInput({ defaultValue: v })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="None" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="">None</SelectItem>
                                {choices.map((c) => (
                                  <SelectItem key={c.value} value={c.value}>
                                    {c.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      }

                      if (t === "multiselect") {
                        const choices = normalizeChoices(selectedNode);
                        const current = Array.isArray(dv) ? (dv as any[]).map(String) : [];
                        const set = new Set(current);
                        return (
                          <div className="space-y-2">
                            <div className="text-sm">Default selected</div>
                            {choices.length === 0 ? (
                              <div className="text-sm text-muted-foreground">Add choices first.</div>
                            ) : (
                              <div className="space-y-2">
                                {choices.map((c) => (
                                  <label key={c.value} className="flex items-center gap-2 text-sm">
                                    <Checkbox
                                      checked={set.has(c.value)}
                                      onCheckedChange={(checked) => {
                                        const next = new Set(set);
                                        if (checked) next.add(c.value);
                                        else next.delete(c.value);
                                        updateSelectedInput({ defaultValue: Array.from(next) });
                                      }}
                                    />
                                    <span>{c.label}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      }

                      if (t === "text" || t === "textarea") {
                        return (
                          <div className="space-y-1">
                            <Label className="text-sm">Default text</Label>
                            <Input value={String(dv ?? "")} onChange={(e) => updateSelectedInput({ defaultValue: e.target.value })} />
                          </div>
                        );
                      }

                      if (t === "number") {
                        return (
                          <div className="space-y-1">
                            <Label className="text-sm">Default number</Label>
                            <Input
                              inputMode="decimal"
                              value={String(dv ?? 0)}
                              onChange={(e) => updateSelectedInput({ defaultValue: Number(e.target.value) })}
                            />
                          </div>
                        );
                      }

                      return <div className="text-sm text-muted-foreground">Default not supported for {t}.</div>;
                    })()}
                  </div>
                </div>

                {selectedNodeZodErrors.length > 0 ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                    <div className="text-sm font-medium text-destructive">Fix required fields</div>
                    <ul className="mt-2 list-disc pl-5 text-xs text-destructive space-y-1">
                      {selectedNodeZodErrors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <Separator />

                {/* 3) Sub-Options (conditional) */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">3. Sub-Options (Conditional)</div>
                      <div className="text-xs text-muted-foreground">
                        Create dependent options that appear only when certain answers are chosen.
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const inputType = getInputType(selectedNode);
                        if (!inputType) return null;

                        if (inputType === "boolean") {
                          return (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => addChildOption({ op: "truthy", ref: selectedId })}
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Add Child (toggle ON)
                            </Button>
                          );
                        }

                        if (inputType === "select" || inputType === "multiselect") {
                          const choices = normalizeChoices(selectedNode);
                          const current = newChildChoiceValue || choices[0]?.value || "";
                          return (
                            <div className="flex items-center gap-2">
                              <Select value={current} onValueChange={setNewChildChoiceValue}>
                                <SelectTrigger className="h-8 w-[200px]">
                                  <SelectValue placeholder="Pick a choice" />
                                </SelectTrigger>
                                <SelectContent>
                                  {choices.map((c) => (
                                    <SelectItem key={c.value} value={c.value}>
                                      {c.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  if (!current) return;
                                  addChildOption({
                                    op: inputType === "select" ? "equals" : "contains",
                                    ref: selectedId,
                                    value: current,
                                  } as any);
                                }}
                                disabled={choices.length === 0 || !current}
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Add Child
                              </Button>
                            </div>
                          );
                        }

                        return null;
                      })()}
                    </div>
                  </div>

                  <div className="rounded-md border border-border p-3">
                    <div className="text-xs text-muted-foreground">Children</div>
                    <div className="mt-2 space-y-2">
                      {Array.isArray(selectedNode.edges?.children) && selectedNode.edges!.children!.length > 0 ? (
                        selectedNode.edges!.children!.map((edge, idx) => {
                          const child = tree.nodes[edge.toNodeId];
                          const inputType = getInputType(selectedNode);
                          const parentChoices = normalizeChoices(selectedNode);
                          const triggerKind = edge.when?.op;
                          const currentChoiceValue = (edge.when && (edge.when.op === "equals" || edge.when.op === "contains") && (edge.when as any).ref === selectedId)
                            ? String((edge.when as any).value ?? "")
                            : "";
                          return (
                            <div key={`${edge.toNodeId}_${idx}`} className="flex items-start justify-between gap-3 rounded-md border border-border p-2">
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{child?.label ?? edge.toNodeId}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  <div className="text-xs text-muted-foreground">Trigger</div>
                                  {inputType === "boolean" ? (
                                    <Badge variant="outline" className="text-[11px]">Toggle ON</Badge>
                                  ) : inputType === "select" || inputType === "multiselect" ? (
                                    <Select
                                      value={currentChoiceValue}
                                      onValueChange={(v) => {
                                        const when: ConditionExpr = {
                                          op: inputType === "select" ? "equals" : "contains",
                                          ref: selectedId,
                                          value: v,
                                        } as any;
                                        updateChildEdgeWhen(edge.toNodeId, when);
                                      }}
                                    >
                                      <SelectTrigger className="h-8 w-[220px]">
                                        <SelectValue placeholder="Select choice" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {parentChoices.map((c) => (
                                          <SelectItem key={c.value} value={c.value}>
                                            {c.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <div className="text-xs text-muted-foreground">{formatCondition(edge.when)}</div>
                                  )}
                                  {inputType === "select" || inputType === "multiselect" ? (
                                    <div className="text-xs text-muted-foreground truncate">
                                      {triggerKind ? formatCondition(edge.when) : "Always"}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-muted-foreground truncate">{formatCondition(edge.when)}</div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (!selectedId) return;
                                    setChildConditionTarget({ parentId: selectedId, childId: edge.toNodeId });
                                    setChildConditionDrawerOpen(true);
                                  }}
                                >
                                  Advanced…
                                </Button>
                                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedId(edge.toNodeId)}>
                                  Edit
                                </Button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-sm text-muted-foreground">No sub-options yet.</div>
                      )}
                    </div>
                  </div>

                  {(() => {
                    const inputType = getInputType(selectedNode);
                    if (inputType !== "select" && inputType !== "multiselect") return null;
                    const choices = normalizeChoices(selectedNode);
                    return (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">Choices</div>
                          <Button type="button" size="sm" onClick={addChoice}>
                            <Plus className="h-4 w-4 mr-2" />
                            Add Choice
                          </Button>
                        </div>

                        {choices.length === 0 ? (
                          <div className="text-sm text-muted-foreground">No choices yet.</div>
                        ) : (
                          <div className="space-y-2">
                            {choices.map((c, idx) => (
                              <div key={c.value} className="rounded-md border border-border p-2 space-y-2">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  <div className="space-y-1">
                                    <Label className="text-xs">Label</Label>
                                    <Input value={c.label} onChange={(e) => updateChoice(c.value, { label: e.target.value })} />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">Internal ID</Label>
                                    <Input
                                      value={c.value}
                                      onChange={(e) => {
                                        const nextVal = slugifyChoiceValue(e.target.value);
                                        updateChoice(c.value, { value: nextVal });
                                      }}
                                    />
                                  </div>
                                </div>

                                <div className="flex items-center justify-between">
                                  <div className="text-xs text-muted-foreground">Order: {idx + 1}</div>
                                  <div className="flex items-center gap-1">
                                    <Button type="button" variant="ghost" size="sm" onClick={() => moveChoice(c.value, -1)} disabled={idx === 0}>
                                      <ArrowUp className="h-4 w-4" />
                                    </Button>
                                    <Button type="button" variant="ghost" size="sm" onClick={() => moveChoice(c.value, 1)} disabled={idx === choices.length - 1}>
                                      <ArrowDown className="h-4 w-4" />
                                    </Button>
                                    <Button type="button" variant="ghost" size="sm" onClick={() => removeChoice(c.value)}>
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <Separator />

                {/* 4) Pricing Impact */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">4. Pricing Impact</div>
                      <div className="text-xs text-muted-foreground">Configure what this option does to pricing.</div>
                    </div>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setPricingDrawerOpen(true)}>
                      <Settings2 className="h-4 w-4 mr-2" />
                      Advanced Pricing…
                    </Button>
                  </div>

                  {(() => {
                    const impact = Array.isArray(selectedNode.pricingImpact) ? selectedNode.pricingImpact[0] : null;
                    const ui = decodePricingImpact(impact ?? undefined);

                    const taxable = selectedId ? getPricingTaxable(selectedId) : true;

                    const displayUnit = ui.mode === "none" ? ("each" as PricingDisplayUnit) : ui.displayUnit;
                    const value = ui.amountCents;

                    const label =
                      displayUnit === "each"
                        ? "Amount (cents)"
                        : displayUnit === "per_qty"
                          ? "Amount per qty (cents)"
                          : displayUnit === "per_sqft"
                            ? "Amount per sq ft (cents)"
                            : displayUnit === "percent"
                              ? "Percent"
                              : "Factor";

                    const parseSimpleAmount = (raw: string): number => {
                      const n = Number(raw);
                      if (!Number.isFinite(n)) return 0;
                      // Add* modes are cents integers.
                      if (displayUnit === "each" || displayUnit === "per_qty" || displayUnit === "per_sqft") return Math.trunc(n);
                      return n;
                    };

                    const summary = (() => {
                      const base = summarizePricing(selectedNode);
                      if (ui.mode === "none") return base;
                      return `${base} • ${taxable ? "Taxable" : "Non-taxable"}`;
                    })();

                    return (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="space-y-1 md:col-span-1">
                            <Label>Unit</Label>
                            <Select
                              value={ui.mode === "none" ? "none" : displayUnit}
                              onValueChange={(v) => {
                                if (v === "none") {
                                  updateTree((t) => {
                                    if (!selectedId) return t;
                                    const prev = t.nodes[selectedId];
                                    if (!prev) return t;
                                    return { ...t, nodes: { ...t.nodes, [selectedId]: { ...prev, pricingImpact: undefined } } };
                                  });
                                  return;
                                }
                                setPricingUi(v as PricingDisplayUnit, value);
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No change</SelectItem>
                                <SelectItem value="each">Each</SelectItem>
                                <SelectItem value="per_qty">Per qty</SelectItem>
                                <SelectItem value="per_sqft">Per sq ft</SelectItem>
                                <SelectItem value="percent">Percent of base</SelectItem>
                                <SelectItem value="multiplier">Multiplier</SelectItem>
                              </SelectContent>
                            </Select>
                            <div className="text-xs text-muted-foreground">
                              Per sq in is not offered (cannot round-trip safely).
                            </div>
                          </div>
                          <div className="space-y-1 md:col-span-2">
                            <Label>{label}</Label>
                            <Input
                              inputMode={displayUnit === "each" || displayUnit === "per_qty" || displayUnit === "per_sqft" ? "numeric" : "decimal"}
                              value={String(value)}
                              onChange={(e) => {
                                setPricingUi(displayUnit, parseSimpleAmount(e.target.value));
                              }}
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between rounded-md border border-border p-3">
                          <div>
                            <div className="text-sm font-medium">Taxable</div>
                            <div className="text-xs text-muted-foreground">Controls how taxes apply in future pricing.</div>
                          </div>
                          <Switch
                            checked={taxable}
                            onCheckedChange={(v) => {
                              if (!selectedId) return;
                              setPricingTaxableByNodeId((p) => ({ ...p, [selectedId]: v }));
                            }}
                            disabled={!selectedId}
                          />
                        </div>

                        <div className="rounded-md border border-border p-3">
                          <div className="text-xs text-muted-foreground">Plain English</div>
                          <div className="text-sm">{summary}</div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <Separator />

                {/* 5) Visibility Rules */}
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">5. Visibility Rules</div>
                      <div className="text-xs text-muted-foreground">Control when this option appears.</div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setVisibilityDrawerOpen(true)}
                    >
                      <Settings2 className="h-4 w-4 mr-2" />
                      Advanced Visibility…
                    </Button>
                  </div>

                  <div className="rounded-md border border-border p-3">
                    <div className="text-xs text-muted-foreground">Rule</div>
                    <div className="text-sm">
                      {selectedNode.visibility?.condition ? formatCondition(selectedNode.visibility.condition) : "Always visible."}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Advanced Visibility will provide a condition builder; this field is read-only in the MVP.
                    </div>
                  </div>
                </div>

                {!isValid && (graphErrors.length > 0 || zodIssues.length > 0) ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                    <div className="text-sm font-medium text-destructive">Option tree has validation errors</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Product saving should be blocked until this is resolved.
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* RIGHT: Customer Preview + Live Pricing */}
      <div className="col-span-12 lg:col-span-3">
        <div className="space-y-4">
          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="text-base">Customer Preview</CardTitle>
              <CardDescription>What an operator/customer would see.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label>Qty</Label>
                  <Input
                    inputMode="numeric"
                    value={String(customerPreview.quantity)}
                    onChange={(e) =>
                      setCustomerPreview((p) => ({ ...p, quantity: Number(e.target.value || 0) }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>W (in)</Label>
                  <Input
                    inputMode="decimal"
                    value={String(customerPreview.widthIn)}
                    onChange={(e) => setCustomerPreview((p) => ({ ...p, widthIn: Number(e.target.value || 0) }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>H (in)</Label>
                  <Input
                    inputMode="decimal"
                    value={String(customerPreview.heightIn)}
                    onChange={(e) => setCustomerPreview((p) => ({ ...p, heightIn: Number(e.target.value || 0) }))}
                  />
                </div>
              </div>

              <div className="rounded-md border border-border p-3">
                <div className="text-xs text-muted-foreground">Preview</div>
                <div className="text-sm text-muted-foreground">
                  UI rendering + live selection wiring will plug into the tree later.
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-1">
              <CardTitle className="text-base">Live Pricing</CardTitle>
              <CardDescription>Connected later (no backend yet).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border border-border p-3">
                <div className="text-xs text-muted-foreground">Estimate</div>
                <div className="text-lg font-semibold">—</div>
                <div className="text-xs text-muted-foreground">
                  Pricing evaluation is not implemented in this UI scaffolding.
                </div>
              </div>
              <Button type="button" variant="secondary" disabled className="w-full">
                Calculate (coming soon)
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ADVANCED: Pricing Drawer */}
      <Sheet open={pricingDrawerOpen} onOpenChange={setPricingDrawerOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Advanced Pricing</SheetTitle>
            <SheetDescription>
              {selectedNode ? `Editing: ${selectedNode.label}` : "Select an option to edit pricing."}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <Card>
              <CardHeader className="space-y-1">
                <CardTitle className="text-base">Formula Editor (Scaffold)</CardTitle>
                <CardDescription>
                  This will support formulas and ordered pricing rules. Not wired to backend yet.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Label>Formula</Label>
                <Textarea
                  placeholder="e.g. basePrice * 1.15 + (qty * 0.25)"
                  className="min-h-[140px]"
                  value={""}
                  onChange={() => void 0}
                />
                <div className="text-xs text-muted-foreground">
                  Placeholder only — no evaluation in this component.
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="space-y-1">
                <CardTitle className="text-base">Variables (Scaffold)</CardTitle>
                <CardDescription>Pick variables to insert into formulas.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
                  Variable picker will live here.
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="space-y-1">
                <CardTitle className="text-base">Circular Dependency Safety (Scaffold)</CardTitle>
                <CardDescription>Prevents formulas that depend on themselves.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
                  Dependency graph warnings will appear here.
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="space-y-1">
                <CardTitle className="text-base">Rule Ordering (Scaffold)</CardTitle>
                <CardDescription>Reorder pricing rules (UI only).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
                  Rule ordering UI will live here.
                </div>
              </CardContent>
            </Card>
          </div>
        </SheetContent>
      </Sheet>

      {/* ADVANCED: Visibility Drawer */}
      <Sheet open={visibilityDrawerOpen} onOpenChange={setVisibilityDrawerOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Advanced Visibility</SheetTitle>
            <SheetDescription>
              {selectedNode ? `Editing: ${selectedNode.label}` : "Select an option to edit visibility."}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <Card>
              <CardHeader className="space-y-1">
                <CardTitle className="text-base">Condition Builder (Scaffold)</CardTitle>
                <CardDescription>Logic graph / condition builder will appear here.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
                  No logic is executed yet — this is UI scaffolding only.
                </div>
              </CardContent>
            </Card>
          </div>
        </SheetContent>
      </Sheet>

      {/* ADVANCED (Hidden): Developer Drawer */}
      <Sheet open={devDrawerOpen} onOpenChange={setDevDrawerOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Developer</SheetTitle>
            <SheetDescription>
              Hidden drawer. Toggle with Ctrl+Shift+D. JSON is not shown by default.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <Card>
              <CardHeader className="space-y-1">
                <CardTitle className="text-base">Diagnostics (Read-only)</CardTitle>
                <CardDescription>Internal state snapshot for debugging.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Label>State</Label>
                <Textarea
                  className="min-h-[320px] font-mono text-xs"
                  readOnly
                  value={
                    JSON.stringify(
                      {
                        productId,
                        selectedId,
                        selected: selectedNode ? { ...selectedNode } : null,
                        parseStatus: parsed.status,
                        isValid,
                        graphErrors,
                        zodIssues,
                        tree,
                        customerPreview,
                      },
                      null,
                      2
                    )
                  }
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="space-y-1">
                <CardTitle className="text-base">Current JSON</CardTitle>
                <CardDescription>Pretty-printed optionTreeJson.</CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  className="min-h-[320px] font-mono text-xs"
                  readOnly
                  value={tree ? JSON.stringify(tree, null, 2) : optionTreeJson ?? ""}
                />
              </CardContent>
            </Card>
          </div>
        </SheetContent>
      </Sheet>

      {/* ADVANCED: Child Condition Drawer (Scaffold) */}
      <Sheet open={childConditionDrawerOpen} onOpenChange={setChildConditionDrawerOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Advanced Child Condition</SheetTitle>
            <SheetDescription>
              {childConditionTarget && selectedNode
                ? `Editing child condition for ${selectedNode.label}`
                : "Select a sub-option condition to edit."}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <Card>
              <CardHeader className="space-y-1">
                <CardTitle className="text-base">Condition Builder (Scaffold)</CardTitle>
                <CardDescription>Advanced condition editing will be implemented here.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
                  No logic is executed yet — this is UI scaffolding only.
                </div>
                <Label className="text-sm">Current condition (read-only)</Label>
                <Textarea
                  className="min-h-[160px] font-mono text-xs"
                  readOnly
                  value={(() => {
                    if (!tree || !childConditionTarget) return "";
                    const parent = tree.nodes[childConditionTarget.parentId];
                    const edge = parent?.edges?.children?.find((e) => e.toNodeId === childConditionTarget.childId);
                    return edge?.when ? JSON.stringify(edge.when, null, 2) : "";
                  })()}
                />
              </CardContent>
            </Card>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
