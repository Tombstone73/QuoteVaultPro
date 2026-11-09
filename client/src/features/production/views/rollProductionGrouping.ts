import type { ProductionJobListItem } from "@/hooks/useProduction";
import { isProductionRunItem } from "@/lib/productionRuns";

export type RollOrderGroup = {
  kind: "group";
  orderId: string;
  jobs: ProductionJobListItem[];
  customerName: string;
  orderNumber: string;
  jobLabel: string | null;
  quantity: number;
  statuses: Array<{ status: string; count: number }>;
  materialSummary: string;
};

export type RollQueueItem = RollOrderGroup | { kind: "job"; job: ProductionJobListItem };

export function visibleRollQueueItems(items: RollQueueItem[], expandedOrderIds: ReadonlySet<string>): RollQueueItem[] {
  return items.flatMap((item) => item.kind === "group"
    ? [item, ...(expandedOrderIds.has(item.orderId) ? item.jobs.map((job) => ({ kind: "job" as const, job })) : [])]
    : [item]);
}

function text(value: unknown): string | null {
  const result = String(value ?? "").trim();
  return result && result !== "—" ? result : null;
}

export function groupRollProductionJobs(jobs: ProductionJobListItem[]): RollQueueItem[] {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    if (isProductionRunItem(job)) continue;
    const orderId = text((job as any).orderId) ?? text(job.order?.id);
    if (orderId) counts.set(orderId, (counts.get(orderId) ?? 0) + 1);
  }

  const result: RollQueueItem[] = [];
  const groups = new Map<string, RollOrderGroup>();
  for (const job of jobs) {
    const orderId = isProductionRunItem(job) ? null : text((job as any).orderId) ?? text(job.order?.id);
    if (!orderId || (counts.get(orderId) ?? 0) < 2) {
      result.push({ kind: "job", job });
      continue;
    }
    let group = groups.get(orderId);
    if (!group) {
      group = {
        kind: "group", orderId, jobs: [],
        customerName: text(job.order?.customerName) ?? "Unknown customer",
        orderNumber: text(job.displayNumber) ?? text(job.orderNumber) ?? text(job.order?.orderNumber) ?? orderId,
        jobLabel: null, quantity: 0, statuses: [], materialSummary: "—",
      };
      groups.set(orderId, group);
      result.push(group);
    }
    group.jobs.push(job);
  }

  for (const group of Array.from(groups.values())) {
    const statuses = new Map<string, number>();
    const materials = new Set<string>();
    const labels = new Set<string>();
    for (const job of group.jobs) {
      statuses.set(job.status, (statuses.get(job.status) ?? 0) + 1);
      const material = text(job.media) ?? text(job.productionSpecs?.material);
      if (material) materials.add(material);
      const label = text(job.jobDescription);
      if (label) labels.add(label);
      const rawQty = job.qty ?? job.order?.lineItems?.primary?.quantity;
      const qty = Number(rawQty);
      if (rawQty != null && Number.isFinite(qty)) group.quantity += qty;
    }
    group.statuses = Array.from(statuses, ([status, count]) => ({ status, count }));
    group.materialSummary = materials.size > 1 ? "Mixed Materials" : Array.from(materials)[0] ?? "—";
    group.jobLabel = labels.size === 1 ? Array.from(labels)[0] : null;
  }
  return result;
}
