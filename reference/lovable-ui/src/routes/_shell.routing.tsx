import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight, GripVertical, Plus, X } from "lucide-react";
import { PageHeader, Panel } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { products, routeTemplates as seedTemplates } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/routing")({
  head: () => ({
    meta: [
      { title: "Routing — PrintersHero V2" },
      { name: "description", content: "Drag-and-drop route template editor: arrange the internal destinations a product travels through." },
      { property: "og:title", content: "Routing — PrintersHero V2" },
      { property: "og:description", content: "Simple ordered route templates for new jobs." },
    ],
  }),
  component: RoutingPage,
});

type Step = { name: string; station: string; required: boolean };
type Template = { id: string; name: string; steps: Step[]; usedBy: number };

const DESTINATIONS: { name: string; station: string }[] = [
  { name: "Design", station: "Art Desk" },
  { name: "Proofing", station: "Art Desk" },
  { name: "Prepress", station: "Prepress" },
  { name: "Production", station: "Print Floor" },
  { name: "Lamination", station: "Finishing Bench" },
  { name: "CNC", station: "Router" },
  { name: "Finishing", station: "Finishing Bench" },
  { name: "Installation", station: "Field Crew" },
  { name: "Fulfillment", station: "Shipping Bench" },
];

function RoutingPage() {
  const [templates, setTemplates] = useState<Template[]>(() =>
    structuredClone(seedTemplates) as Template[],
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftSteps, setDraftSteps] = useState<Step[]>([]);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const typesByTemplate = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const p of products) {
      const list = (map[p.routeTemplate] ??= []);
      if (!list.includes(p.type)) list.push(p.type);
    }
    return map;
  }, []);

  const startEdit = (t: Template) => {
    setEditingId(t.id);
    setDraftName(t.name);
    setDraftSteps(structuredClone(t.steps));
  };

  const cancel = () => setEditingId(null);

  const save = () => {
    setTemplates((ts) =>
      editingId === "new"
        ? [...ts.filter((t) => t.id !== "new"), { id: `rt-${Date.now()}`, name: draftName || "Untitled Route", steps: draftSteps, usedBy: 0 }]
        : ts.map((t) => (t.id === editingId ? { ...t, name: draftName || t.name, steps: draftSteps } : t)),
    );
    setEditingId(null);
  };

  const newTemplate = () => {
    setEditingId("new");
    setDraftName("New Route Template");
    setDraftSteps([]);
  };

  const insertAt = (index: number, dest: { name: string; station: string }) => {
    setDraftSteps((s) => {
      const next = [...s];
      next.splice(index, 0, { ...dest, required: true });
      return next;
    });
  };

  const moveStep = (from: number, to: number) => {
    setDraftSteps((s) => {
      const next = [...s];
      const [item] = next.splice(from, 1);
      if (!item) return s;
      next.splice(from < to ? to - 1 : to, 0, item);
      return next;
    });
  };

  const onDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIdx(null);
    const raw = e.dataTransfer.getData("text/plain");
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { kind: "dest" | "step"; name?: string; station?: string; from?: number };
      if (data.kind === "dest" && data.name && data.station) insertAt(index, { name: data.name, station: data.station });
      else if (data.kind === "step" && typeof data.from === "number") moveStep(data.from, index);
    } catch {
      /* ignore */
    }
  };

  const editing = editingId === "new"
    ? ({ id: "new", name: draftName, steps: draftSteps, usedBy: 0 } as Template)
    : templates.find((t) => t.id === editingId);

  return (
    <div className="space-y-3 p-4">
      <PageHeader
        title="Routing"
        subtitle="Templates apply per product and can be overridden on any line item."
        actions={<Button size="sm" className="h-8" onClick={newTemplate}>New Template</Button>}
      />

      {editing ? (
        <div className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
          <Panel title="Available Destinations">
            <p className="mb-2 text-[11px] text-muted-foreground">Drag a destination into the route.</p>
            <ul className="space-y-1.5">
              {DESTINATIONS.map((d) => (
                <li
                  key={d.name}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "dest", ...d }))}
                  className="flex cursor-grab items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] active:cursor-grabbing"
                >
                  <GripVertical className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{d.name}</span>
                  <button
                    type="button"
                    className="ml-auto text-muted-foreground hover:text-foreground"
                    onClick={() => insertAt(draftSteps.length, d)}
                    aria-label={`Add ${d.name} to route`}
                  >
                    <Plus className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            title={
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="h-8 max-w-xs text-[13px] font-semibold"
                aria-label="Route template name"
              />
            }
            action={
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" className="h-8" onClick={cancel}>Cancel</Button>
                <Button size="sm" className="h-8" onClick={save}>Save</Button>
              </div>
            }
          >
            <p className="mb-3 text-[11px] text-muted-foreground">
              Changes apply to <span className="font-medium text-foreground">new jobs only</span>. Active job routes are not changed.
            </p>

            <ol className="space-y-1">
              {draftSteps.map((s, i) => (
                <li key={`${s.name}-${i}`}>
                  <DropZone active={dragOverIdx === i} onDragOver={() => setDragOverIdx(i)} onDrop={(e) => onDrop(e, i)} />
                  <div
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "step", from: i }))}
                    className="flex cursor-grab items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[12px] active:cursor-grabbing"
                  >
                    <GripVertical className="size-3.5 text-muted-foreground" />
                    <span className="num w-5 text-muted-foreground">{i + 1}</span>
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground">· {s.station}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setDraftSteps((st) => st.map((x, xi) => (xi === i ? { ...x, required: !x.required } : x)))
                      }
                      className={cn(
                        "ml-auto rounded border px-1.5 py-0.5 text-[11px]",
                        s.required ? "border-primary/35 bg-primary/10 text-primary" : "border-border text-muted-foreground",
                      )}
                    >
                      {s.required ? "Required" : "Optional"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraftSteps((st) => st.filter((_, xi) => xi !== i))}
                      className="text-muted-foreground hover:text-late"
                      aria-label={`Remove ${s.name}`}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </li>
              ))}
              <li>
                <DropZone
                  active={dragOverIdx === draftSteps.length}
                  onDragOver={() => setDragOverIdx(draftSteps.length)}
                  onDrop={(e) => onDrop(e, draftSteps.length)}
                  label={draftSteps.length === 0 ? "Drag destinations here to build the route" : "Drop here to add at the end"}
                />
              </li>
            </ol>
          </Panel>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {templates.map((r) => (
            <Panel
              key={r.id}
              title={`${r.name} · used by ${r.usedBy} products`}
              action={<Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => startEdit(r)}>Edit</Button>}
            >
              <ol className="flex flex-wrap items-center gap-2">
                {r.steps.map((s, i) => (
                  <li key={`${s.name}-${i}`} className="flex items-center gap-2">
                    <span className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[12px]">
                      <span className="num mr-1 text-muted-foreground">{i + 1}</span>
                      {s.name}
                      <span className="ml-1 text-muted-foreground">· {s.station}</span>
                      {!s.required && <span className="ml-1 text-muted-foreground">(optional)</span>}
                    </span>
                    {i < r.steps.length - 1 && <ChevronRight className="size-3.5 text-muted-foreground" />}
                  </li>
                ))}
              </ol>
              <div className="mt-3 text-[11px] text-muted-foreground">
                Product types:{" "}
                {(typesByTemplate[r.name] ?? []).length
                  ? (typesByTemplate[r.name] ?? []).join(", ")
                  : "none yet"}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

function DropZone({
  active, onDragOver, onDrop, label,
}: { active: boolean; onDragOver: () => void; onDrop: (e: React.DragEvent) => void; label?: string }) {
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDrop={onDrop}
      className={cn(
        "flex items-center justify-center rounded text-[11px] text-muted-foreground transition-all",
        label ? "h-14 border border-dashed border-border" : "h-2",
        active && "h-14 border border-dashed border-primary bg-primary/10",
      )}
    >
      {label}
    </div>
  );
}
