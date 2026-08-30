const notices: Readonly<Record<"connected" | "error", string>> = {
  connected: "QuickBooks authorization completed. Accounting readiness has been refreshed.",
  error: "QuickBooks connection could not be completed. Review Accounting readiness and reconnect if required.",
};

/** Callback outcomes are presentation-only. The authoritative connection state
 * is always read again from the tenant-scoped Accounting readiness endpoint. */
export const quickBooksIntegrationCallbackNotice = (search: string): string | undefined => {
  const outcome = new URLSearchParams(search).get("quickbooks");
  return outcome === "connected" || outcome === "error" ? notices[outcome] : undefined;
};
