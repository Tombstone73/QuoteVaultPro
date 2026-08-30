/** Pure policy kept separate so queue failure behavior is testable without DB or OAuth configuration. */
export const quickBooksQueueFailureState = (cause: unknown): "retry" | "uncertain" | "blocked" => {
  const value = cause as { statusCode?: unknown; code?: unknown; message?: unknown };
  const status = Number(value?.statusCode);
  if (Number.isFinite(status) && status >= 400 && status < 500 && status !== 429) return "blocked";
  if (Number.isFinite(status)) return status >= 500 || status === 429 ? "uncertain" : "retry";
  const code = String(value?.code ?? "").toLowerCase();
  const message = String(value?.message ?? "").toLowerCase();
  return ["econnreset", "etimedout", "enotfound", "network", "fetch failed", "socket"].some((fragment) => code.includes(fragment) || message.includes(fragment)) ? "uncertain" : "retry";
};

export const v2QuickBooksQueueWorkerEnabled = (environment: Readonly<Record<string, string | undefined>> = process.env) => String(environment.QUICKBOOKS_AUTOMATION_OWNER || "").trim().toLowerCase() === "queue";
