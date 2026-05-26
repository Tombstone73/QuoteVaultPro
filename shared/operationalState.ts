export const ORDER_CANCELED_STATES = ["canceled", "cancelled"] as const;

export const TERMINAL_PRODUCTION_STATUSES = ["done", "void", "canceled", "cancelled"] as const;

export type TerminalProductionStatus = (typeof TERMINAL_PRODUCTION_STATUSES)[number];

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isCanceledOrder(order: {
  state?: string | null;
  status?: string | null;
  canceledAt?: string | Date | null;
} | null | undefined): boolean {
  if (!order) return false;
  return (
    ORDER_CANCELED_STATES.includes(normalizeStatus(order.state) as any) ||
    ORDER_CANCELED_STATES.includes(normalizeStatus(order.status) as any) ||
    Boolean(order.canceledAt)
  );
}

export function isTerminalProductionStatus(status: string | null | undefined): boolean {
  return TERMINAL_PRODUCTION_STATUSES.includes(normalizeStatus(status) as any);
}

export function isOperationallyActiveProductionJob(job: {
  status?: string | null;
} | null | undefined): boolean {
  return Boolean(job?.status) && !isTerminalProductionStatus(job?.status);
}
