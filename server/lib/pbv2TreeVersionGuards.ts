export function assertPbv2TreeVersionNotDraft(status: unknown, context: "persist" | "accept" | "recompute"): void {
  const normalized = typeof status === "string" ? status.toUpperCase() : "";
  if (normalized !== "DRAFT") return;

  const msgByContext: Record<typeof context, string> = {
    persist: "PBV2 DRAFT tree versions cannot be persisted on orders",
    accept: "PBV2 DRAFT tree versions cannot be accepted on orders",
    recompute: "PBV2 DRAFT tree versions cannot be recomputed on orders",
  };

  const err: any = new Error(msgByContext[context]);
  // Treat as conflict to make it clear this is a state mismatch.
  err.statusCode = 409;
  throw err;
}
