import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";

export const EPS_CALLBACK_PATH = "/api/payments/eps/response";
export const EPS_CALLBACK_MAX_BODY_BYTES = 64 * 1024;

/** EPS confirmed JSON POST delivery, but has not supplied a callback schema,
 * authentication contract or authoritative transaction lookup. Intentionally
 * NO payment/database dependencies. API keys, arbitrary signature headers,
 * PTKs and browser sessions cannot enable posting. normalizeEpsResponse is for
 * synchronous gateway replies; it is not a documented callback validator. */
export function registerEpsCallbackRoutes(app: Express): void {
  const requireHttps: RequestHandler = (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!req.secure) {
      res.status(426).json({ success: false, code: "EPS_CALLBACK_HTTPS_REQUIRED", error: "EPS callbacks require HTTPS." });
      return;
    }
    if (!req.is("application/json")) {
      res.status(415).json({ success: false, code: "EPS_CALLBACK_JSON_REQUIRED", error: "EPS callbacks require application/json." });
      return;
    }
    next();
  };

  app.post(EPS_CALLBACK_PATH, requireHttps,
    express.json({ limit: EPS_CALLBACK_MAX_BODY_BYTES, strict: true, inflate: false }),
    (req, res) => {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        res.status(400).json({ success: false, code: "EPS_CALLBACK_INVALID_JSON", error: "EPS callback must contain a JSON object." });
        return;
      }
      const reference = randomUUID();
      // Never log payloads, query strings, headers, merchant IDs or card data.
      console.warn("[EPS_CALLBACK]", { reference, stage: "verification", category: "contract_unavailable", posted: false });
      res.status(503).json({ success: false, code: "EPS_CALLBACK_VERIFICATION_UNAVAILABLE",
        error: "EPS callback verification is not available. No payment result was accepted or posted.", reference });
    });

  app.all(EPS_CALLBACK_PATH, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Allow", "POST");
    res.status(405).json({ success: false, code: "EPS_CALLBACK_METHOD_NOT_ALLOWED", error: "EPS callbacks require POST." });
  });

  const parseError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const type = error && typeof error === "object" && "type" in error ? error.type : null;
    const status = type === "entity.too.large" ? 413 : type === "encoding.unsupported" || type === "charset.unsupported" ? 415 : 400;
    res.setHeader("Cache-Control", "no-store");
    res.status(status).json({ success: false, code: status === 413 ? "EPS_CALLBACK_TOO_LARGE" : "EPS_CALLBACK_INVALID_JSON", error: "EPS callback JSON could not be accepted. No payment result was processed." });
  };
  app.use(EPS_CALLBACK_PATH, parseError);
}
