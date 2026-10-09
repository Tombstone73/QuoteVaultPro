import { createHash, randomUUID } from "node:crypto";
import type { OperationContext } from "../../src/application/operation.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { createConsoleLogger, type V2Logger } from "../../src/observability/logger.js";

type Stage = "scope_validation" | "quote_read" | "authorization"
  | "prepare_connection" | "prepare_begin" | "prepare_quote_read" | "prepare_request"
  | "prepare_replay" | "prepare_state" | "prepare_recipient" | "prepare_suppression_schema"
  | "prepare_routing" | "prepare_tax" | "prepare_document" | "prepare_pdf"
  | "prepare_evidence" | "prepare_attempt" | "prepare_commit" | "prepare_rollback"
  | "provider_delivery" | "delivery_reconciliation" | "sales_checkpoint" | "receipt_finalization" | "qa_reconciliation";

export type QuotePublicationDiagnostics = Readonly<{
  stage(value: Stage): void;
  failure(cause: unknown): void;
}>;

const property = (cause: unknown, key: string): unknown => {
  try { return cause && typeof cause === "object" ? Reflect.get(cause, key) : undefined; }
  catch { return undefined; }
};

/** Messages can contain SQL values or provider secrets. Retain structural detail only. */
export const createQuotePublicationDiagnostics = (
  context: OperationContext,
  input: Readonly<{ quoteId: string; businessRequestId: string }>,
  logger: V2Logger = createConsoleLogger(),
): QuotePublicationDiagnostics => {
  let stage: Stage = "scope_validation";
  let lastCause: unknown = Symbol("unreported");
  let correlationId: string | undefined;
  return {
    stage: value => { stage = value; },
    failure: cause => {
      try {
        if (cause instanceof V2ApplicationError || cause === lastCause) return;
        lastCause = cause;
        const name = property(cause, "name");
        const exceptionClass = typeof name === "string" && ["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "URIError", "EvalError", "AggregateError", "DatabaseError", "error"].includes(name) ? name : "UnknownException";
        const code = property(cause, "code");
        const sqlstate = typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
        const rawMessage = property(cause, "message");
        const message = typeof rawMessage === "string" ? rawMessage.slice(0, 2048) : "";
        const errorMessage = sqlstate ? `PostgreSQL error ${sqlstate}; original message redacted`
          : /is not a function/i.test(message) ? "Method is not callable; expression redacted"
          : /cannot read propert(?:y|ies)/i.test(message) ? "Property access failed; object and property redacted"
          : `Unexpected ${exceptionClass}; original message redacted`;
        const rawStack = property(cause, "stack");
        const stackLocations = typeof rawStack === "string" ? rawStack.slice(0, 12000).split(/\r?\n/).slice(1, 25).flatMap(line => {
          const location = /(?:^|[\/\\])((?:v2[\/\\](?:src|infrastructure)[\/\\][A-Za-z0-9_\/-]+|dist-v2[\/\\](?:server|main))\.(?:[cm]?js|ts)):(\d{1,8}):(\d{1,5})\)?$/.exec(line);
          return location ? [`${location[1].replaceAll("\\", "/")}:${location[2]}:${location[3]}`] : [];
        }).slice(0, 8) : [];
        const identifier = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : "redacted_non_uuid";
        const diagnostic = {
          operationId: correlationId ??= randomUUID(),
          businessRequestIdHash: createHash("sha256").update(input.businessRequestId).digest("hex"),
          organizationId: identifier(context.organizationId),
          resourceType: "quote",
          resourceId: identifier(input.quoteId),
          stage, exceptionClass, ...(sqlstate ? { sqlstate } : {}), errorMessage, stackLocations,
        };
        logger.log("error", "v2.quote.publication.unexpected_failure", diagnostic);
      } catch { /* Diagnostics must not change the publication result, including on logger failure. */ }
    },
  };
};
