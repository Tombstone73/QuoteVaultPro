export const SESSION_EXPIRED_EVENT = "titanos:session-expired";
export const SESSION_EXPIRED_MESSAGE = "Session expired. Please sign in again.";

export function isUnauthorizedError(error: Error): boolean {
  return /^401: .*Unauthorized/.test(error.message);
}

export function isSessionExpiredError(error: unknown): boolean {
  const status = (error as any)?.status;
  if (status === 401) return true;

  const message = String((error as any)?.message || error || "");
  if (/^401\b/.test(message)) return true;
  return message.includes('"message":"Unauthorized"') || message.includes('"message":"User not authenticated"');
}

export function notifySessionExpired(source?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { source } }));
}
