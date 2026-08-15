import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";

type SessionCarrier = Request & {
  session?: { v2CsrfToken?: string };
};

/**
 * Session-bound synchronizer token for the same-origin V2 browser surface.
 * It is deliberately independent from a business-request idempotency key.
 */
export const issueV2CsrfToken = (request: Request): string => {
  const session = (request as SessionCarrier).session;
  if (!session) throw new Error("A trusted host session is required for V2 CSRF.");
  return (session.v2CsrfToken ??= randomBytes(32).toString("base64url"));
};

export const requireV2CsrfToken: RequestHandler = (request, response, next) => {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    next();
    return;
  }
  const session = (request as SessionCarrier).session;
  const supplied = request.header("x-v2-csrf-token");
  const expected = session?.v2CsrfToken;
  const valid =
    typeof supplied === "string" &&
    typeof expected === "string" &&
    supplied.length === expected.length &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!valid) {
    response.status(403).json({
      ok: false,
      error: { code: "FORBIDDEN", message: "A valid V2 CSRF token is required." },
    });
    return;
  }
  next();
};
