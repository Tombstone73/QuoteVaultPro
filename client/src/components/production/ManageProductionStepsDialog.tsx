import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import {
  useCreateProductionStep,
  useProductionStationSteps,
  useUpdateProductionStep,
} from "@/hooks/useProductionSettings";

type ManageProductionStepsDialogProps = {
  stationKey?: string | null;
  stationLabel?: string | null;
  disabled?: boolean;
};

const normalizeStepKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-");

export function ManageProductionStepsDialog({ stationKey, stationLabel, disabled }: ManageProductionStepsDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [newLabel, setNewLabel] = React.useState("");
  const [newKey, setNewKey] = React.useState("");
  const [draftLabels, setDraftLabels] = React.useState<Record<string, string>>({});

  const { data: stepsByStation, isLoading, isError, error } = useProductionStationSteps();
  const createStep = useCreateProductionStep();
  const updateStep = useUpdateProductionStep();

  const normalizedStationKey = String(stationKey ?? "").trim();
  const stationSteps = React.useMemo(
    () => (normalizedStationKey ? stepsByStation?.[normalizedStationKey] ?? [] : []),
    [normalizedStationKey, stepsByStation],
  );

  React.useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const step of stationSteps) {
      next[step.key] = step.label;
    }
    setDraftLabels(next);
  }, [open, stationSteps]);

  const canCreate = normalizedStationKey.length > 0 && newLabel.trim().length > 0 && !createStep.isPending;

  const handleCreate = async () => {
    if (!canCreate) return;
    await createStep.mutateAsync({
      stationKey: normalizedStationKey,
      label: newLabel.trim(),
      key: newKey.trim() ? normalizeStepKey(newKey) : undefined,
    });
    setNewLabel("");
    setNewKey("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || !normalizedStationKey}>
          Manage Steps
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Manage Steps{stationLabel ? ` · ${stationLabel}` : normalizedStationKey ? ` · ${normalizedStationKey}` : ""}
          </DialogTitle>
        </DialogHeader>

        {!normalizedStationKey ? (
          <p className="text-sm text-muted-foreground">Select a station first.</p>
        ) : isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading steps…
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">{(error as any)?.message || "Failed to load steps"}</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {stationSteps.length === 0 ? (
                <p className="text-sm text-muted-foreground">No steps configured for this station yet.</p>
              ) : (
                stationSteps.map((step) => {
                  const draftLabel = draftLabels[step.key] ?? step.label;
                  const isSaving = updateStep.isPending;
                  return (
                    <div key={step.key} className="rounded-md border p-3 space-y-2">
                      <div className="text-xs text-muted-foreground">Key: {step.key}</div>
                      <div className="grid grid-cols-[1fr_auto] gap-3 items-center">
                        <Input
                          value={draftLabel}
                          onChange={(e) => setDraftLabels((prev) => ({ ...prev, [step.key]: e.target.value }))}
                          placeholder="Step label"
                        />
                        <div className="flex items-center gap-2">
                          <Label className="text-xs">Active</Label>
                          <Switch
                            checked={step.active !== false}
                            onCheckedChange={(active) => {
                              updateStep.mutate({ stationKey: normalizedStationKey, key: step.key, active });
                            }}
                            disabled={isSaving}
                          />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={isSaving || !draftLabel.trim() || draftLabel.trim() === step.label}
                          onClick={() => {
                            updateStep.mutate({ stationKey: normalizedStationKey, key: step.key, label: draftLabel.trim() });
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <p className="text-sm font-medium">Add Step</p>
              <div className="space-y-2">
                <Input
                  value={newLabel}
                  onChange={(e) => {
                    const next = e.target.value;
                    setNewLabel(next);
                    if (!newKey.trim()) {
                      setNewKey(normalizeStepKey(next));
                    }
                  }}
                  placeholder="Label (e.g., Print)"
                />
                <Input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="Key (optional, auto-generated)"
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={handleCreate} disabled={!canCreate}>
                  {createStep.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Step"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
