import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAssignProductionPrinter } from "@/hooks/useProduction";

const DEFAULT_MACHINE_OPTIONS: Record<string, string[]> = {
  roll: ["S40", "S60", "Canon"],
  wide_roll: ["S40", "S60", "Canon"],
  flatbed: ["Jetson"],
};

function normalizeStationKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function getProductionMachineOptions(stationKey: unknown, configured?: string[]): string[] {
  const key = normalizeStationKey(stationKey);
  const defaults = DEFAULT_MACHINE_OPTIONS[key] ?? [];
  const merged = [...(configured ?? []), ...defaults]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return Array.from(new Set(merged));
}

export function hasProductionPrinterAssignment(job: {
  assignedPrinterName?: string | null;
  assignedPrinterId?: string | null;
}): boolean {
  return Boolean(String(job.assignedPrinterName ?? job.assignedPrinterId ?? "").trim());
}

export function PrinterMachineAssignment({
  jobId,
  stationKey,
  assignedPrinterName,
  assignedPrinterId,
  assignedPrinterAt,
  printerOptions,
  compact = false,
}: {
  jobId: string;
  stationKey?: string | null;
  assignedPrinterName?: string | null;
  assignedPrinterId?: string | null;
  assignedPrinterAt?: string | null;
  printerOptions?: string[];
  compact?: boolean;
}) {
  const saveAssignment = useAssignProductionPrinter(jobId);
  const options = useMemo(
    () => getProductionMachineOptions(stationKey, printerOptions),
    [printerOptions, stationKey],
  );
  const [value, setValue] = useState(assignedPrinterName ?? assignedPrinterId ?? "");

  useEffect(() => {
    setValue(assignedPrinterName ?? assignedPrinterId ?? "");
  }, [assignedPrinterId, assignedPrinterName]);

  const trimmedValue = value.trim();
  const savedValue = String(assignedPrinterName ?? assignedPrinterId ?? "").trim();
  const canSave = Boolean(trimmedValue) && trimmedValue !== savedValue && !saveAssignment.isPending;

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`printer-machine-${jobId}`} className="text-xs font-medium text-titan-text-muted">
          Printer / Machine
        </Label>
        {savedValue ? (
          <span className="text-[11px] text-titan-text-muted">
            {assignedPrinterAt ? `Saved ${new Date(assignedPrinterAt).toLocaleDateString()}` : "Saved"}
          </span>
        ) : (
          <span className="text-[11px] text-amber-500">Not assigned</span>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          id={`printer-machine-${jobId}`}
          list={`printer-machine-options-${jobId}`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={options[0] ? `Suggested: ${options[0]}` : "Enter machine used"}
          className={compact ? "h-8 bg-titan-bg-card" : "bg-titan-bg-card"}
          aria-label="Printer / Machine"
        />
        <datalist id={`printer-machine-options-${jobId}`}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
        <Button
          type="button"
          size={compact ? "sm" : "default"}
          variant="secondary"
          onClick={() =>
            saveAssignment.mutate({
              assignedPrinterId: null,
              assignedPrinterName: trimmedValue,
            })
          }
          disabled={!canSave}
          aria-label="Save printer / machine assignment"
        >
          <Save className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
