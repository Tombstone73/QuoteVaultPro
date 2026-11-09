import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import type { RollOrderGroup } from "./rollProductionGrouping";

type Props = {
  group: RollOrderGroup;
  orderNumber: string;
  selectableIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  expanded: boolean;
  onToggle: () => void;
  onSelectionChange: (ids: Set<string>) => void;
};

export function RollOrderGroupRow({ group, orderNumber, selectableIds, selectedIds, expanded, onToggle, onSelectionChange }: Props) {
  const eligible = group.jobs.filter((job) => selectableIds.has(job.id));
  const selectedCount = eligible.filter((job) => selectedIds.has(job.id)).length;
  const blockedCount = group.jobs.length - eligible.length;

  return <TableRow className="bg-titan-bg-muted/70" data-production-order-group={group.orderId}>
    <TableCell onClick={(event) => event.stopPropagation()}>
      <Checkbox
        checked={selectedCount === 0 ? false : selectedCount === eligible.length ? true : "indeterminate"}
        onCheckedChange={(checked) => {
          const next = new Set(selectedIds);
          for (const job of eligible) { if (checked === true) next.add(job.id); else next.delete(job.id); }
          onSelectionChange(next);
        }}
        aria-label={`Select eligible jobs in Order ${orderNumber}`}
        disabled={eligible.length === 0}
      />
    </TableCell>
    <TableCell colSpan={10} className="p-0">
      <button type="button" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 text-left hover:bg-titan-bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} Order ${orderNumber}`} onClick={onToggle}>
        <span aria-hidden="true" className="text-base">{expanded ? "▾" : "▸"}</span>
        <span className="font-semibold text-titan-text-primary">Order {orderNumber} | {group.customerName}</span>
        {group.jobLabel ? <span className="text-titan-text-muted">{group.jobLabel}</span> : null}
        <span className="text-xs text-titan-text-muted">{group.jobs.length} lines · Qty {group.quantity} · {group.statuses.map(({ status, count }) => `${count} ${status.replace(/_/g, " ")}`).join(" · ")} · {group.materialSummary}</span>
        {blockedCount > 0 ? <span className="text-xs text-amber-700 dark:text-amber-300">{blockedCount} unavailable for bulk selection</span> : null}
      </button>
    </TableCell>
  </TableRow>;
}
