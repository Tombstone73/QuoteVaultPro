import { Button } from "@/components/ui/button";

export function CombinedProofSelectionBar({
  selectedCount,
  jobLabel,
  matchingCount,
  onSelectAll,
  onClear,
}: {
  selectedCount: number;
  jobLabel: string;
  matchingCount: number;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  if (selectedCount < 1) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#232948] bg-[#1337ec]/10 px-6 py-2 text-sm text-slate-100">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{selectedCount} selected</span>
        <span className="text-slate-400">Job {jobLabel}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {matchingCount > selectedCount ? (
          <Button type="button" size="sm" variant="outline" onClick={onSelectAll}>
            Select all for job {jobLabel} ({matchingCount})
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>
          Clear selection
        </Button>
      </div>
    </div>
  );
}
