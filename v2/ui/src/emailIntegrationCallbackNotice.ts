export type EmailIntegrationCallbackOutcome = "connected" | "cancelled" | "error";

const notices: Readonly<Record<EmailIntegrationCallbackOutcome, string>> = {
  connected: "Gmail was connected. Email delivery readiness has been refreshed.",
  cancelled: "Google authorization was cancelled. No email credential was changed.",
  error: "Google connection could not be completed. Reconnect Gmail and try again.",
};

/** Google returns here after a server-side callback. The outcome is only
 * presentation; canonical readiness remains a fresh server read. */
export const emailIntegrationCallbackNotice = (search: string): string | undefined => {
  const outcome = new URLSearchParams(search).get("email");
  return outcome === "connected" || outcome === "cancelled" || outcome === "error"
    ? notices[outcome]
    : undefined;
};
