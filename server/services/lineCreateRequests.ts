import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { lineCreateRequests, orderLineItems, quoteLineItems } from "@shared/schema";

export const LINE_CREATE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type LineCreateScope = {
  organizationId: string;
  actorUserId: string;
  documentType: "order" | "quote" | "quote_draft";
  documentId: string;
  requestKey: string;
  requestHash: string;
  expiresAt: Date;
};

const failure = (message: string, code: string, statusCode = 409) =>
  Object.assign(new Error(message), { code, statusCode });

function canonicalPayload(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalPayload).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalPayload(record[key])}`).join(",")}}`;
}

export function prepareLineCreateRequest(
  scope: Omit<LineCreateScope, "requestKey" | "requestHash" | "expiresAt">,
  key: unknown,
  payload: unknown,
  now = Date.now(),
): LineCreateScope {
  // Timestamped keys permit bounded receipt retention without ever treating an
  // expired retry as a fresh insert. The timestamp is not an authorization claim.
  if (typeof key !== "string" || !/^\d{13}:[0-9a-f-]{36}$/i.test(key)) {
    throw failure("A valid line creation request key is required. Refresh and try again.", "LINE_CREATE_KEY_REQUIRED", 400);
  }
  const issuedAt = Number(key.split(":")[0]);
  if (issuedAt > now + 5 * 60 * 1000 || issuedAt + LINE_CREATE_RETENTION_MS <= now) {
    throw failure("This add request has expired. Refresh the document before starting a new add.", "LINE_CREATE_KEY_EXPIRED");
  }
  return { ...scope, requestKey: key, requestHash: createHash("sha256").update(canonicalPayload(payload)).digest("hex"), expiresAt: new Date(issuedAt + LINE_CREATE_RETENTION_MS) };
}

function predicate(scope: LineCreateScope) {
  return and(
    eq(lineCreateRequests.organizationId, scope.organizationId),
    eq(lineCreateRequests.actorUserId, scope.actorUserId),
    eq(lineCreateRequests.operationType, "line_create"),
    eq(lineCreateRequests.documentType, scope.documentType),
    eq(lineCreateRequests.documentId, scope.documentId),
    eq(lineCreateRequests.requestKey, scope.requestKey),
  );
}

export async function readLineCreateResult(scope: LineCreateScope, executor: Executor | typeof db = db) {
  const [receipt] = await executor.select().from(lineCreateRequests).where(predicate(scope)).limit(1);
  if (!receipt) return null;
  if (receipt.requestHash !== scope.requestHash) {
    throw failure("This add request was already used with different details. Refresh the document.", "LINE_CREATE_IDEMPOTENCY_CONFLICT");
  }
  const table = scope.documentType === "order" ? orderLineItems : quoteLineItems;
  const [line] = await executor.select().from(table).where(eq(table.id, receipt.resultLineId)).limit(1);
  // Keep the receipt even when its line is deleted. A retry must not resurrect it.
  if (!line) throw failure("The item created by this request was removed. Refresh the document.", "LINE_CREATE_RESULT_REMOVED");
  const result = line as typeof orderLineItems.$inferSelect & typeof quoteLineItems.$inferSelect;
  if ((scope.documentType === "order" && result.orderId !== scope.documentId)
    || (scope.documentType === "quote" && result.quoteId !== scope.documentId)
    || (scope.documentType === "quote_draft" && (result.createdByUserId !== scope.actorUserId || result.quoteId !== null))) {
    throw failure("This item now belongs to a different or finalized document. Refresh the document.", "LINE_CREATE_RESULT_MOVED");
  }
  return line;
}

export async function runLineCreateRequest<T extends { id: string }>(scope: LineCreateScope, create: (tx: Executor) => Promise<T>, database = db) {
  return database.transaction(async (tx) => {
    const lockScope = JSON.stringify([scope.organizationId, "line_create", scope.documentType, scope.documentId]);
    // Serialize creates on the document so different legitimate requests also
    // see each other's committed rows when calculating financial/bundle totals.
    // This PostgreSQL lock spans workers and releases on rollback. The unique
    // request index is the durable second line of defense.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockScope}, 0))`);
    if (scope.expiresAt.getTime() <= Date.now()) {
      throw failure("This add request has expired. Refresh the document.", "LINE_CREATE_KEY_EXPIRED");
    }
    const existing = await readLineCreateResult(scope, tx);
    if (existing) return { line: existing as unknown as T, replayed: true };
    const line = await create(tx);
    await tx.insert(lineCreateRequests).values({ ...scope, operationType: "line_create", resultLineId: line.id });
    return { line, replayed: false };
  });
}

export async function cleanupLineCreateRequests(database = db) {
  // Bounded batches; no FK or cascading operation touches canonical lines.
  await database.execute(sql`delete from line_create_requests where id in (
    select id from line_create_requests where expires_at < now() order by expires_at limit 1000
  )`);
}
