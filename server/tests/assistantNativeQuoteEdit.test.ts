import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";
import { getTableColumns, type SQL } from "drizzle-orm";
import { PgDialect, type AnyPgTable } from "drizzle-orm/pg-core";
import { assistantQuoteIntakeSessions, auditLogs, organizations, quoteLineItems, quotes } from "@shared/schema";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";
import { resolveAssistantActorAuthority } from "../services/assistant/actorAuthorityResolver";
import { ExecutionPlanningService } from "../services/assistant/execution/executionPlanningService";
import { createQuoteDraftUpdateExecutionCommand } from "../services/assistant/execution/quoteDraftUpdateExecutionCommand";
import { createQuoteDraftUpdateCommandDefinition } from "../services/assistant/execution/quoteDraftUpdateCommand";
import type { ExecutionActorScope, ExecutionCommandResult, ExecutionConfirmationRecord, ExecutionPlanRecord, ExecutionPlanRepository } from "../services/assistant/execution/types";
import type { AssistantOperatorTrustedContext } from "../services/assistant/operatorRuntime";

// Unit/contract test, NOT a PostgreSQL rehearsal: only persistence is synthetic.
// The tool, proposal builder, intake dispatcher, GO executor, native editor save,
// canonical editable transaction, aggregate totals, and validation are real.
// Unknown persistence/pricing operations fail closed; there is no DB/provider URL.
// Tool arguments are supplied deterministically; provider interpretation is not tested.
type Row = Record<string, any>;
let tables = new Map<AnyPgTable, Row[]>();
const locks: AnyPgTable[] = [];
const dialect = new PgDialect();
const clone = <T,>(value: T): T => structuredClone(value);
const rows = (table: AnyPgTable) => {
  const result = tables.get(table);
  if (!result) throw new Error("Unexpected table in isolated label-edit test");
  return result;
};

// Supports only the AND/equality predicates this scenario actually uses. This
// does not replace PostgreSQL authorization or locking; it asserts that real
// services emit their tenant/record/status predicates at the storage boundary.
function matching(table: AnyPgTable, predicate: SQL): Row[] {
  const query = dialect.sqlToQuery(predicate);
  const terms = Array.from(query.sql.matchAll(/"[^"]+"\."([^"]+)" = \$(\d+)/g));
  if (!terms.length || query.sql.replace(/"[^"]+"\."[^"]+" = \$\d+|\band\b|[()\s]/g, "")) {
    throw new Error(`Unsupported synthetic predicate: ${query.sql}`);
  }
  const columns = getTableColumns(table);
  return rows(table).filter((row) => terms.every(([, column, index]) => {
    const key = Object.keys(columns).find((key) => columns[key].name === column);
    if (!key) throw new Error(`Unknown predicate column: ${column}`);
    return row[key] === query.params[Number(index) - 1];
  }));
}

const fakeDb = {
  select: () => ({ from: (table: AnyPgTable) => {
    let selected: Row[] = [];
    const query = {
      where: (predicate: SQL) => { selected = matching(table, predicate); return query; },
      for: (mode: string) => { expect(mode).toBe("update"); locks.push(table); return query; },
      limit: async (count: number) => clone(selected.slice(0, count)),
      then: (resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(clone(selected)).then(resolve, reject),
    };
    return query;
  } }),
  insert: (table: AnyPgTable) => ({ values: (values: Row) => {
    if (table !== assistantQuoteIntakeSessions && table !== auditLogs) throw new Error("Unexpected insert");
    let inserted: Row | undefined;
    const perform = () => {
      inserted ??= { id: `synthetic_${rows(table).length + 1}`, status: "draft", ...clone(values) };
      if (!rows(table).includes(inserted)) rows(table).push(inserted);
      return [clone(inserted)];
    };
    return {
      returning: async () => perform(),
      then: (resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(perform).then(resolve, reject),
    };
  } }),
  update: (table: AnyPgTable) => ({ set: (values: Row) => ({ where: (predicate: SQL) => {
    // A subsequent ordinary editor discount change uses the real aggregate
    // calculator. Permit only its exact persisted totals, not arbitrary writes.
    if (table !== assistantQuoteIntakeSessions && !(table === quotes &&
      Object.keys(values).sort().join(",") === "subtotal,taxAmount,taxableSubtotal,totalPrice")) {
      throw new Error("Unexpected direct update");
    }
    let applied: Row[] | undefined;
    const perform = () => {
      if (!applied) {
        applied = matching(table, predicate);
        for (const row of applied) Object.assign(row, clone(values));
      }
      return clone(applied);
    };
    return {
      returning: async () => perform(),
      then: (resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(perform).then(resolve, reject),
    };
  } }) }),
  transaction: async <T,>(callback: (tx: object) => Promise<T>): Promise<T> => {
    const before = new Map<AnyPgTable, Row[]>();
    tables.forEach((values, table) => before.set(table, clone(values)));
    try { return await callback(fakeDb); }
    catch (error) { tables = before; throw error; }
  },
};

function readQuote(organizationId: string, quoteId: string) {
  const row = rows(quotes).find((quote) => quote.organizationId === organizationId && quote.id === quoteId);
  return row ? clone({ ...row, lineItems: rows(quoteLineItems).filter((line) => line.quoteId === row.id) }) : undefined;
}
const updateQuote = jest.fn(async (organizationId: string, quoteId: string, changes: Row) => {
  const row = rows(quotes).find((quote) => quote.organizationId === organizationId && quote.id === quoteId);
  if (!row) throw new Error("Synthetic quote not found");
  Object.assign(row, clone(changes));
  return clone(row);
});
const priceLineItem = jest.fn(async () => { throw new Error("A label edit must not reprice historical lines"); });

jest.unstable_mockModule("../db", () => ({ db: fakeDb }));
jest.unstable_mockModule("../storage", () => ({ storage: { getQuoteById: jest.fn(async (org: string, id: string) => readQuote(org, id)) } }));
jest.unstable_mockModule("../storage/quotes.repo", () => ({ QuotesRepository: class {
  updateQuote = updateQuote;
  getQuoteById = async (org: string, id: string) => readQuote(org, id);
} }));
jest.unstable_mockModule("../services/pricing/PricingService", () => ({ priceLineItem, inspectProductPricing: priceLineItem }));
jest.unstable_mockModule("../tenantContext", () => ({ DEFAULT_ORGANIZATION_ID: "org_synthetic", getRequestOrganizationId: (req: { organizationId: string }) => req.organizationId }));

let createTools: typeof import("../services/assistant/quoteApplicationTools").createQuoteEditorApplicationTools;
let intake: typeof import("../services/assistant/quoteDraftIntakeService").quoteDraftIntakeService;
let registerQuoteRoutes: typeof import("../routes/quotes.routes").registerQuoteRoutes;
beforeAll(async () => {
  ({ createQuoteEditorApplicationTools: createTools } = await import("../services/assistant/quoteApplicationTools"));
  ({ quoteDraftIntakeService: intake } = await import("../services/assistant/quoteDraftIntakeService"));
  ({ registerQuoteRoutes } = await import("../routes/quotes.routes"));
});

const now = new Date("2026-11-20T12:00:00.000Z");
const context = assistantContextEnvelopeSchema.parse({ contextVersion: "v1", route: "/quotes/quote_synthetic", pageTitle: "Quote QT-9001", entityType: "quote", entityId: "quote_synthetic", selectedRecordIds: [], activeFilters: [], capturedAt: now.toISOString(), unsavedChanges: false });
function actor(role = "employee", organizationId = "org_synthetic", userId = "user_synthetic"): ExecutionActorScope {
  const authority = resolveAssistantActorAuthority({ actorUserId: userId, organizationId, organizationRole: role, authenticationSource: "authenticated_request", tenantSource: "tenant_context" });
  return { organizationId, userId, organizationRole: authority.organizationRole, authorityStatus: authority.status, permissions: authority.grants, environment: "test" };
}
const scope = actor();
const edit = { quoteId: "quote_synthetic", header: { label: "Synthetic draft label after review" } };
const nativeBody = { expectedRevision: 7, header: edit.header, lines: { update: [], create: [], delete: [] } };

function seed() {
  tables = new Map<AnyPgTable, Row[]>([
    [quotes, [{ id: edit.quoteId, organizationId: scope.organizationId, userId: scope.userId, quoteNumber: 9001, displayNumber: "QT-9001", status: "draft", revision: 7, label: "Original synthetic label", customerId: null, contactId: null, customerName: "Synthetic walk-in", subtotal: "25.00", taxableSubtotal: "25.00", taxRate: "0", taxAmount: "0.00", discountAmount: "0", shippingCents: 0, totalPrice: "25.00", convertedToOrderId: null, validUntil: null }]],
    [quoteLineItems, [{ id: "line_synthetic", quoteId: edit.quoteId, productId: "product_synthetic", productName: "Synthetic historical Product", quantity: 1, width: "12", height: "12", status: "active", linePrice: "25.00", isTaxableSnapshot: true, pbv2TreeVersionId: "historical_locked_tree", pbv2SnapshotJson: { version: "historical", selectedOptions: [{ optionName: "Finish", value: "Gloss" }] }, optionSelectionsJson: { selected: { finish: "gloss" } }, overridePriceCents: null, specsJson: {} }]],
    [organizations, [{ id: scope.organizationId }]], [assistantQuoteIntakeSessions, []], [auditLogs, []],
  ]);
  locks.length = 0;
}
beforeEach(() => { seed(); jest.clearAllMocks(); });

function planStore(): ExecutionPlanRepository {
  const plans = new Map<string, ExecutionPlanRecord>();
  const confirmations: ExecutionConfirmationRecord[] = [];
  const completed = new Map<string, ExecutionCommandResult>();
  return {
    create: async (plan) => { plans.set(plan.id, clone(plan)); return plan; },
    get: async (actor, id) => { const plan = plans.get(id); return plan?.organizationId === actor.organizationId && plan.userId === actor.userId ? clone(plan) : null; },
    update: async (plan, version) => { if (plans.get(plan.id)?.version !== version) return null; plans.set(plan.id, clone(plan)); return plan; },
    createConfirmation: async (confirmation) => { confirmations.push(clone(confirmation)); },
    consumeConfirmation: async (input) => {
      const found = confirmations.find((confirmation) => confirmation.planId === input.planId && confirmation.organizationId === input.organizationId && confirmation.userId === input.userId && confirmation.tokenHash === input.tokenHash);
      if (!found || found.expiresAt <= input.now) return "invalid";
      if (found.usedAt) return "already_used";
      found.usedAt = input.now; return "consumed";
    },
    acquireIdempotency: async ({ plan }) => { const result = completed.get(plan.id); return result ? { kind: "completed", result } : { kind: "acquired" }; },
    completeIdempotency: async ({ plan, result }) => { completed.set(plan.id, result); },
    recordAudit: async () => undefined, recordSteps: async () => undefined,
  };
}

function executionService() {
  // Mirror production route composition, including metadata's allowedRoles.
  const metadata = createQuoteDraftUpdateCommandDefinition(intake);
  const command = { ...createQuoteDraftUpdateExecutionCommand(intake), allowedRoles: metadata.allowedRoles };
  return new ExecutionPlanningService(planStore(), { get: (name) => name === command.name ? command : undefined, list: () => [command] }, { now: () => now, allowProductionExecution: true });
}

async function review() {
  const tool = createTools().find((tool) => tool.name === "quotes.editor_save")!;
  const trusted: AssistantOperatorTrustedContext = { scope, actor: { userId: scope.userId, email: null }, conversationId: "conversation_synthetic", permissions: scope.permissions, context, correlationId: "correlation_synthetic", goal: `Change only this draft Quote's label to ${edit.header.label}` };
  const prepared = await tool.execute({ arguments: edit, context: trusted });
  expect(prepared.status).toBe("succeeded");
  const card = prepared.presentation?.cards.find((card) => card.kind === "action_proposal");
  if (!card || !("plan" in card)) throw new Error("Expected the real editor tool to return a GO proposal");
  const proposal = card.plan as Record<string, unknown>;
  expect(proposal.action).toBe("quotes.update_draft");
  const service = executionService();
  const { action: _action, ...args } = proposal;
  const plan = await service.createPlan(scope, { conversationId: trusted.conversationId, commandName: "quotes.update_draft", arguments: args, context });
  const issued = await service.issueConfirmation(scope, plan.id, plan.version);
  const go = (current = scope, token = issued.token) => service.confirmAndExecute(current, { planId: plan.id, expectedVersion: issued.plan.version, token, context });
  return { prepared, plan, issued, service, go };
}

function nativeApp(role = "employee", organizationId = scope.organizationId, authenticated = true) {
  const app = express(); app.use(express.json());
  registerQuoteRoutes(app, {
    isAuthenticated: (req: any, res: any, next: any) => { if (!authenticated) return res.sendStatus(401); req.user = { id: scope.userId }; next(); },
    tenantContext: (req: any, _res: any, next: any) => { req.organizationId = organizationId; req.orgRole = role; next(); },
    isAdmin: (_req: any, _res: any, next: any) => next(),
  });
  return app;
}

describe("native Quote label edit through quotes.editor_save and protected quotes.update_draft", () => {
  test("matches the ordinary editor route after GO, preserves historical lines, and replays without a second write", async () => {
    const originalLines = clone(rows(quoteLineItems));
    // Normal application operation runs without constructing an AI tool/plan.
    await request(nativeApp()).patch(`/api/quotes/${edit.quoteId}/editor-save`).send(nativeBody).expect(200);
    const nativeQuote = clone(rows(quotes)[0]);
    const nativeAudit = clone(rows(auditLogs));
    expect(rows(assistantQuoteIntakeSessions)).toEqual([]);
    seed(); updateQuote.mockClear();

    const reviewed = await review();
    expect(reviewed.plan.preview.sideEffects).toContain("label: Original synthetic label → Synthetic draft label after review.");
    expect(reviewed.plan.preview.quoteDraftUpdate).toMatchObject({ totalCentsBefore: 2500, totalCentsAfter: 2500, downstreamActionsExcluded: ["order_creation", "production_job_creation", "inventory_reservation", "invoice_creation", "email_sending", "quote_acceptance_or_conversion"] });
    expect(rows(quotes)[0].label).toBe("Original synthetic label");
    expect(updateQuote).not.toHaveBeenCalled();
    expect(rows(auditLogs)).toEqual([]);
    await expect(reviewed.go(scope, "GO")).rejects.toMatchObject({ code: "INVALID_CONFIRMATION" });
    expect(updateQuote).not.toHaveBeenCalled();

    const executed = await reviewed.go();
    expect(executed.plan.status).toBe("succeeded");
    expect(executed.result).toMatchObject({ status: "succeeded", details: { quote: { id: edit.quoteId, displayNumber: "QT-9001", totalCents: 2500, sourceLink: `/quotes/${edit.quoteId}` } } });
    expect(rows(quotes)[0]).toEqual(nativeQuote);
    expect(rows(auditLogs)).toEqual(nativeAudit);
    expect(rows(auditLogs)[0]).toMatchObject({ organizationId: scope.organizationId, userId: scope.userId, actionType: "UPDATE", entityType: "quote", entityId: edit.quoteId });
    expect(updateQuote).toHaveBeenCalledTimes(1);
    expect(updateQuote).toHaveBeenCalledWith(scope.organizationId, edit.quoteId, edit.header);
    expect(rows(assistantQuoteIntakeSessions)[0].status).toBe("created");
    expect(rows(quoteLineItems)).toEqual(originalLines);
    expect(priceLineItem).not.toHaveBeenCalled();
    expect(locks).toContain(quotes);
    expect(locks).toContain(assistantQuoteIntakeSessions);
    expect((await reviewed.go()).result).toEqual(executed.result);
    expect(updateQuote).toHaveBeenCalledTimes(1);
  });

  test.each([false, true])("rejects a new plan for an applied proposal after a native change (simulated conversion: %s), but replays the original plan's historical result", async (converted) => {
    const reviewed = await review();
    const executed = await reviewed.go();
    const historicalResult = clone(executed.result);
    expect(historicalResult).toMatchObject({ status: "succeeded", details: { quote: { totalCents: 2500 } } });

    // An actual subsequent native editor save changes the label and total using
    // the shared calculator, without going through the assistant proposal.
    await request(nativeApp()).patch(`/api/quotes/${edit.quoteId}/editor-save`).send({
      ...nativeBody, header: { label: "Later native label", discountAmount: 5 },
    }).expect(200);
    expect(rows(quotes)[0]).toMatchObject({ label: "Later native label", totalPrice: "20.00" });
    expect(updateQuote).toHaveBeenCalledTimes(2);
    if (converted) {
      // Fixture the state left by an intervening conversion. This deliberately
      // does NOT exercise Order conversion or claim PostgreSQL workflow parity.
      Object.assign(rows(quotes)[0], { status: "active", convertedToOrderId: "order_synthetic", revision: 8 });
    }
    const currentQuote = clone(rows(quotes));
    const currentLines = clone(rows(quoteLineItems));
    const currentAudit = clone(rows(auditLogs));
    const currentSessions = clone(rows(assistantQuoteIntakeSessions));

    await expect(reviewed.service.createPlan(scope, {
      conversationId: "conversation_synthetic", commandName: "quotes.update_draft",
      arguments: reviewed.plan.sanitizedArguments, context,
    })).rejects.toMatchObject({ code: "QUOTE_PROPOSAL_ALREADY_APPLIED" });

    const replayed = await reviewed.go();
    expect(replayed.plan.id).toBe(executed.plan.id);
    expect(replayed.plan.status).toBe("succeeded");
    expect(replayed.result).toEqual(historicalResult);
    expect(replayed.result?.details?.quote?.totalCents).toBe(2500);
    expect(rows(quotes)).toEqual(currentQuote);
    expect(rows(quoteLineItems)).toEqual(currentLines);
    expect(rows(auditLogs)).toEqual(currentAudit);
    expect(rows(assistantQuoteIntakeSessions)).toEqual(currentSessions);
    expect(updateQuote).toHaveBeenCalledTimes(2);
    expect(priceLineItem).not.toHaveBeenCalled();
  });

  test("enforces ordinary staff access and denies a member at the real GO planning boundary", async () => {
    const endpoint = `/api/quotes/${edit.quoteId}/editor-save`;
    await request(nativeApp("employee", scope.organizationId, false)).patch(endpoint).send(nativeBody).expect(401);
    await request(nativeApp("member")).patch(endpoint).send(nativeBody).expect(403);
    const reviewed = await review();
    await expect(reviewed.service.createPlan(actor("member"), { conversationId: "conversation_synthetic", commandName: "quotes.update_draft", arguments: reviewed.plan.sanitizedArguments, context })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(reviewed.go({ ...scope, permissions: [] })).rejects.toMatchObject({ code: "PERMISSION_CHANGED" });
    expect(updateQuote).not.toHaveBeenCalled();
    expect(rows(auditLogs)).toEqual([]);
  });

  test("rejects injected identity and lifecycle fields before creating a proposal", async () => {
    const tool = createTools().find((tool) => tool.name === "quotes.editor_save")!;
    const trusted: AssistantOperatorTrustedContext = { scope, actor: { userId: scope.userId, email: null }, conversationId: "conversation_synthetic", permissions: scope.permissions, context, correlationId: "correlation_synthetic", goal: "Change label" };
    for (const args of [{ ...edit, organizationId: "foreign_org" }, { ...edit, actorUserId: "foreign_user" }, { ...edit, header: { label: "Attempt", status: "accepted" } }, { ...edit, header: { label: "x".repeat(256) } }]) {
      expect(await tool.execute({ arguments: args, context: trusted })).toMatchObject({ status: "rejected", failureCode: "quote_editor_arguments_invalid" });
    }
    expect(rows(assistantQuoteIntakeSessions)).toEqual([]);
    expect(updateQuote).not.toHaveBeenCalled();
  });

  test("hides foreign-tenant records and binds a prepared GO plan to its original actor", async () => {
    await request(nativeApp("employee", "foreign_org")).patch(`/api/quotes/${edit.quoteId}/editor-save`).send(nativeBody).expect(404);
    const reviewed = await review();
    await expect(reviewed.go(actor("employee", "foreign_org"))).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
    await expect(reviewed.go(actor("employee", scope.organizationId, "foreign_user"))).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
    expect(updateQuote).not.toHaveBeenCalled();
  });

  test("refuses a revision changed after review in both native save and GO", async () => {
    const reviewed = await review();
    rows(quotes)[0].revision += 1;
    const native = await request(nativeApp()).patch(`/api/quotes/${edit.quoteId}/editor-save`).send(nativeBody).expect(409);
    expect(native.body.code).toBe("QUOTE_STALE");
    await expect(reviewed.go()).rejects.toMatchObject({ code: "QUOTE_STALE" });
    expect(updateQuote).not.toHaveBeenCalled();
    expect(rows(auditLogs)).toEqual([]);
  });

  test("refuses a locked/converted Quote instead of applying the label", async () => {
    const reviewed = await review();
    rows(quotes)[0].status = "active";
    rows(quotes)[0].convertedToOrderId = "order_synthetic";
    const native = await request(nativeApp()).patch(`/api/quotes/${edit.quoteId}/editor-save`).send(nativeBody).expect(409);
    expect(native.body.code).toBe("QUOTE_NOT_EDITABLE");
    await expect(reviewed.go()).rejects.toMatchObject({ code: "QUOTE_NOT_EDITABLE" });
    expect(updateQuote).not.toHaveBeenCalled();
  });

  test("propagates native persistence failure instead of reporting a successful edit", async () => {
    const reviewed = await review();
    const before = clone(rows(quotes));
    updateQuote.mockRejectedValueOnce(new Error("Synthetic native persistence failure"));
    await expect(reviewed.go()).rejects.toThrow("Synthetic native persistence failure");
    expect(rows(quotes)).toEqual(before);
    expect(rows(auditLogs)).toEqual([]);
    expect(rows(assistantQuoteIntakeSessions)[0].status).toBe("preview_ready");
  });
});
