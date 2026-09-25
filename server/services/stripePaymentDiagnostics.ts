import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { stripeDiagnosticBatchSchema, type StripeDiagnosticSurface } from "../../shared/stripePaymentDiagnostics";

// Uses existing server application logs; retention/access follow the hosting
// log policy. No payment tables, browser tokens, or raw request bodies are logged.
export const stripeDiagnosticLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { success: false, code: "DIAGNOSTIC_LIMIT" } });

export function stripeDiagnosticHandler(
  scope: (req: Request) => Promise<{ organizationId: string; invoiceId: string } | null>,
  surfaces: StripeDiagnosticSurface[],
  write: (entry: object) => void = (entry) => console.info("[STRIPE_PAYMENT_DIAGNOSTIC]", JSON.stringify(entry)),
) {
  return async (req: Request, res: Response) => {
    try {
      if (Number(req.headers["content-length"] || 0) > 16_384 || JSON.stringify(req.body ?? {}).length > 16_384) return res.sendStatus(413);
      const parsed = stripeDiagnosticBatchSchema.safeParse(req.body);
      if (!parsed.success || !surfaces.includes(parsed.data.surface)) return res.sendStatus(400);
      const authorized = await scope(req);
      if (!authorized) return res.sendStatus(404);
      write({ ...authorized, ...parsed.data, receivedAt: new Date().toISOString() });
      return res.sendStatus(204);
    } catch { return res.sendStatus(204); } // no raw errors/payloads, no payment dependency
  };
}
