import * as React from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRight, GripVertical, Loader2, Plus, Settings2, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  useCreateProductionStep,
  useReorderProductionSteps,
  useUpdateProductionStep,
  type ProductionManagedStep,
} from "@/hooks/useProductionSettings";

type StationStepEditorProps = {
  stationKey: string;
  stationLabel: string;
  steps: ProductionManagedStep[];
  isLoading?: boolean;
};

type SortableStepCardProps = {
  id: string;
  step: ProductionManagedStep;
  isSelected: boolean;
  onSelect: () => void;
  isSaving: boolean;
};

function SortableStepCard({ id, step, isSelected, onSelect, isSaving }: SortableStepCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-3">
      <div
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
        role="button"
        tabIndex={0}
        className={[
          "min-w-[220px] cursor-pointer rounded-titan-lg border px-4 py-4 text-left transition-colors",
          isSelected
            ? "border-titan-accent bg-titan-bg-card-elevated shadow-sm"
            : "border-titan-border-subtle bg-card hover:bg-titan-bg-card-elevated",
          isDragging ? "opacity-70 shadow-lg" : "",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-titan-text-primary">{step.label}</div>
            <div className="text-xs text-titan-text-muted">{step.key}</div>
          </div>
          <button
            type="button"
            className="rounded-md border border-titan-border-subtle p-2 text-titan-text-muted hover:text-titan-text-primary"
            aria-label={`Reorder ${step.label}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Badge variant={step.active ? "secondary" : "outline"}>{step.active ? "Active" : "Disabled"}</Badge>
          <Badge variant="outline">Order {step.sortOrder}</Badge>
          <Badge variant="outline">{step.triggers.length} trigger{step.triggers.length === 1 ? "" : "s"}</Badge>
          {isSaving ? <Loader2 className="ml-auto h-4 w-4 animate-spin text-titan-text-muted" /> : null}
        </div>
      </div>

      <ArrowRight className="h-4 w-4 shrink-0 text-titan-text-muted" />
    </div>
  );
}

const normalizeStepKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-");

export function StationStepEditor({ stationKey, stationLabel, steps, isLoading }: StationStepEditorProps) {
  const createStep = useCreateProductionStep();
  const updateStep = useUpdateProductionStep();
  const reorderSteps = useReorderProductionSteps();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sortedSteps = React.useMemo(
    () => [...steps].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    [steps],
  );
  const [orderedKeys, setOrderedKeys] = React.useState<string[]>(sortedSteps.map((step) => step.key));
  const [selectedStepKey, setSelectedStepKey] = React.useState<string>(sortedSteps[0]?.key ?? "");
  const [draftLabel, setDraftLabel] = React.useState<string>(sortedSteps[0]?.label ?? "");
  const [newStepLabel, setNewStepLabel] = React.useState("");

  React.useEffect(() => {
    setOrderedKeys(sortedSteps.map((step) => step.key));
    if (!sortedSteps.some((step) => step.key === selectedStepKey)) {
      setSelectedStepKey(sortedSteps[0]?.key ?? "");
    }
  }, [sortedSteps, selectedStepKey]);

  const selectedStep = sortedSteps.find((step) => step.key === selectedStepKey) ?? sortedSteps[0] ?? null;

  React.useEffect(() => {
    setDraftLabel(selectedStep?.label ?? "");
  }, [selectedStep?.key, selectedStep?.label]);

  const orderedSteps = React.useMemo(() => {
    const map = new Map(sortedSteps.map((step) => [step.key, step]));
    return orderedKeys.map((key) => map.get(key)).filter((step): step is ProductionManagedStep => !!step);
  }, [orderedKeys, sortedSteps]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedKeys.indexOf(String(active.id));
    const newIndex = orderedKeys.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const nextKeys = arrayMove(orderedKeys, oldIndex, newIndex);
    setOrderedKeys(nextKeys);
    try {
      await reorderSteps.mutateAsync({ stationKey, keys: nextKeys });
    } catch {
      setOrderedKeys(sortedSteps.map((step) => step.key));
    }
  };

  const handleSaveStep = async () => {
    if (!selectedStep || !draftLabel.trim() || draftLabel.trim() === selectedStep.label) return;
    await updateStep.mutateAsync({
      stationKey,
      key: selectedStep.key,
      label: draftLabel.trim(),
    });
  };

  const handleToggleActive = async (active: boolean) => {
    if (!selectedStep) return;
    await updateStep.mutateAsync({
      stationKey,
      key: selectedStep.key,
      active,
    });
  };

  const handleCreateStep = async () => {
    if (!newStepLabel.trim()) return;
    await createStep.mutateAsync({
      stationKey,
      label: newStepLabel.trim(),
      key: normalizeStepKey(newStepLabel),
    });
    setNewStepLabel("");
  };

  return (
    <div className="rounded-titan-lg border border-titan-border-subtle p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-titan-text-primary">{stationLabel}</div>
          <div className="text-xs text-titan-text-muted">{stationKey}</div>
        </div>
        <Badge variant="secondary">{sortedSteps.length} step{sortedSteps.length === 1 ? "" : "s"}</Badge>
      </div>

      <div className="rounded-md bg-titan-bg-subtle p-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-titan-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading steps…
          </div>
        ) : (
          <div className="overflow-x-auto pb-2">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={orderedKeys} strategy={horizontalListSortingStrategy}>
                <div className="flex min-w-max items-center gap-3">
                  {orderedSteps.map((step, index) => (
                    <React.Fragment key={step.key}>
                      <SortableStepCard
                        id={step.key}
                        step={step}
                        isSelected={selectedStep?.key === step.key}
                        onSelect={() => setSelectedStepKey(step.key)}
                        isSaving={updateStep.isPending && selectedStep?.key === step.key}
                      />
                      {index === orderedSteps.length - 1 ? null : null}
                    </React.Fragment>
                  ))}

                  <div className="min-w-[220px] rounded-titan-lg border border-dashed border-titan-border-subtle bg-card p-4 space-y-3">
                    <div className="text-sm font-medium text-titan-text-primary">Add Step</div>
                    <Input
                      value={newStepLabel}
                      onChange={(event) => setNewStepLabel(event.target.value)}
                      placeholder="e.g. QC"
                    />
                    <Button size="sm" className="w-full" onClick={handleCreateStep} disabled={!newStepLabel.trim() || createStep.isPending}>
                      {createStep.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      <span className="ml-2">Add Step</span>
                    </Button>
                  </div>
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}
      </div>

      {selectedStep ? (
        <div className="rounded-md border border-titan-border-subtle bg-card p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-titan-text-primary">
            <Settings2 className="h-4 w-4" /> Step Settings
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Label</Label>
              <Input value={draftLabel} onChange={(event) => setDraftLabel(event.target.value)} placeholder="Step label" />
            </div>
            <div className="space-y-2">
              <Label>Key</Label>
              <Input value={selectedStep.key} readOnly className="bg-muted" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md bg-titan-bg-subtle px-4 py-3">
            <div>
              <div className="text-sm font-medium text-titan-text-primary">Enable step</div>
              <div className="text-xs text-titan-text-muted">Disabled steps remain visible for history but are hidden from active routing selectors.</div>
            </div>
            <Switch checked={selectedStep.active} onCheckedChange={handleToggleActive} disabled={updateStep.isPending} />
          </div>

          <div className="rounded-md bg-titan-bg-subtle p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-titan-text-primary">
              <Zap className="h-4 w-4" /> Step Entry Triggers
            </div>
            <div className="text-xs text-titan-text-muted">
              Triggers will run when a job enters this step. Configuration is reserved for Phase 2.
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedStep.triggers.length === 0 ? (
                <Badge variant="outline">No triggers configured</Badge>
              ) : (
                selectedStep.triggers.map((trigger, index) => (
                  <Badge key={`${trigger.type}-${index}`} variant="secondary">{trigger.type}</Badge>
                ))
              )}
            </div>
            <Button variant="outline" size="sm" disabled>
              Add Trigger (Phase 2)
            </Button>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSaveStep} disabled={updateStep.isPending || !draftLabel.trim() || draftLabel.trim() === selectedStep.label}>
              {updateStep.isPending ? "Saving…" : "Save Step"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
