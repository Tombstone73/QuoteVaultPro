import { Library, Lock } from "lucide-react";
import { Chip } from "@/components/app/product-editor/fields";
import type { Formula, FormulaStatus, FormulaVisibility } from "@/lib/mock/formulas";

export function StatusChip({ status }: { status: FormulaStatus }) {
  const tone = status === "Active" ? "ok" : status === "Inactive" ? "neutral" : "warn";
  return <Chip tone={tone}>{status}</Chip>;
}

/**
 * Reusable-scope of the Formula identity. "Shared" is deliberately absent —
 * it is reserved for the future cross-organization sharing capability.
 */
export function VisibilityChip({ visibility }: { visibility: FormulaVisibility }) {
  if (visibility === "In Library") return <Chip><Library className="size-3" />In library</Chip>;
  return <Chip tone="warn"><Lock className="size-3" />Product scoped</Chip>;
}

export function FormulaChips({ formula }: { formula: Formula }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusChip status={formula.status} />
      <VisibilityChip visibility={formula.visibility} />
    </span>
  );
}
