/** Produces the next durable sender slot without relying on process memory. */
export function getNextBulkInvoiceEmailSlot(input: {
  now: Date;
  latestScheduledAt?: Date | string | null;
  spacingSeconds: number;
}): Date {
  const latestMs = input.latestScheduledAt ? new Date(input.latestScheduledAt).getTime() : Number.NaN;
  const nextAfterExisting = Number.isFinite(latestMs) ? latestMs + input.spacingSeconds * 1000 : Number.NEGATIVE_INFINITY;
  return new Date(Math.max(input.now.getTime(), nextAfterExisting));
}
