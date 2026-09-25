import { apiFetch } from "@/lib/queryClient";
import { stripeDiagnosticBatchSchema, type StripeDiagnosticEvent, type StripeDiagnosticSurface } from "@shared/stripePaymentDiagnostics";

export function createStripePaymentDiagnostics(apiBasePath: string, invoiceId: string, grouped = false) {
  // getRandomValues also supports older iPhones without randomUUID.
  const sessionId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : (() => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  })();
  const surface: StripeDiagnosticSurface = apiBasePath === "/api/guest/invoices" ? "guest_invoice"
    : apiBasePath === "/api/portal/invoices" ? grouped ? "grouped_portal_invoices" : "portal_invoice" : "staff_payment";
  let sequence = 0;
  let mounts = 0;
  let ready = false;
  const queue: StripeDiagnosticEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastChange = "";
  let lastViewport = "";
  const flush = () => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      clearTimeout(timer);
      timer = undefined;
      if (!queue.length) return;
      const batch = stripeDiagnosticBatchSchema.safeParse({ sessionId, surface, events: queue.splice(0, 20) });
      if (!batch.success) return;
      // Never await delivery from payment code, never retry, and bound hung requests.
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 5000);
      void apiFetch(`${apiBasePath}/${encodeURIComponent(invoiceId)}/payments/stripe/diagnostics`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch.data), signal: controller.signal, keepalive: true,
      }).catch(() => undefined).finally(() => clearTimeout(timeout));
    } catch { clearTimeout(timeout); }
  };
  const emit = (event: StripeDiagnosticEvent["event"], fields: Partial<Pick<StripeDiagnosticEvent, "complete" | "empty" | "elementType" | "success" | "error">> = {}) => {
    try {
      if (sequence >= 100) return;
      // Reserve the final events for submission/errors/close in long sessions.
      if (sequence >= 80 && (event === "element_change" || event === "viewport_change")) return;
      if (event === "element_mount") { mounts++; ready = false; lastChange = ""; }
      if (event === "element_unmount" || event === "element_load_error") ready = false;
      if (event === "element_ready") ready = true;
      const width = Math.min(20000, Math.max(0, Math.round(window.visualViewport?.width ?? window.innerWidth)));
      const height = Math.min(20000, Math.max(0, Math.round(window.visualViewport?.height ?? window.innerHeight)));
      if (event === "element_change") {
        const state = `${fields.complete}:${fields.empty}`;
        if (state === lastChange) return;
        lastChange = state;
      }
      if (event === "viewport_change") {
        const state = `${width}:${height}`;
        if (state === lastViewport) return;
        lastViewport = state;
      }
      queue.push({ event, sequence: ++sequence, timestamp: new Date().toISOString(), width, height, mountCount: mounts, ready,
        ...(fields.elementType === "payment" ? { elementType: "payment" as const } : {}),
        ...(typeof fields.complete === "boolean" ? { complete: fields.complete } : {}),
        ...(typeof fields.empty === "boolean" ? { empty: fields.empty } : {}),
        ...(typeof fields.success === "boolean" ? { success: fields.success } : {}),
        ...(fields.error ? { error: fields.error } : {}),
      });
      if (queue.length >= 20 || event === "dialog_close") flush();
      else if (!timer) timer = setTimeout(flush, 750);
    } catch { /* Diagnostics must never break payment. */ }
  };
  return { sessionId, emit, flush };
}
export type StripePaymentDiagnostics = ReturnType<typeof createStripePaymentDiagnostics>;
