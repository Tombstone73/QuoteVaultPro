import { createHash } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { organizations, orderLineItems, orders, productionJobs, productionRunMembers,
  productionStationSteps, products, userOrganizations, users } from "@shared/schema";
import { isCanceledOrder, isTerminalProductionStatus } from "@shared/operationalState";
import { resolveProductionCompletionRoute } from "./productionCompletionRouting";

export const reviewedProductionCompletionScopeSchema = z.object({
  organizationId: z.string().min(1), actorUserId: z.string().min(1),
  orderId: z.string().min(1), lineItemId: z.string().min(1),
}).strict();
const routeSchema = z.object({ stationKey: z.string().min(1), stepKey: z.string().min(1),
  source: z.enum(["step_trigger", "configured_finishing", "default_fulfillment"]) }).strict();
export const reviewedProductionCompletionPreviewSchema = z.object({
  version: z.literal("v1"), scope: reviewedProductionCompletionScopeSchema,
  jobId: z.string().min(1), revision: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.object({ jobStatus: z.literal("in_progress"), stationKey: z.string(), stepKey: z.string(),
    startedAt: z.string().datetime(), orderState: z.string().nullable(), orderStatus: z.string().nullable(),
    lineWorkflowState: z.string().nullable(), lineStatus: z.string().nullable() }).strict(),
  route: routeSchema,
}).strict();
const jobStateSchema = z.object({ id: z.string(), status: z.string(), stationKey: z.string(), stepKey: z.string() }).strict();
const postcommitSchema = z.array(z.object({ triggerKey: z.string(),
  status: z.enum(["applied", "skipped", "unavailable"]), reason: z.string().nullable() }).strict());
export const reviewedProductionCompletionResultSchema = z.object({
  status: z.literal("applied"),
  job: jobStateSchema.extend({ completedAt: z.string().datetime().nullable() }).strict(),
  order: z.object({ id: z.string(), state: z.string().nullable(), status: z.string().nullable() }).strict(),
  line: z.object({ id: z.string(), workflowState: z.string().nullable(), status: z.string().nullable() }).strict(),
  activeSuccessors: z.array(jobStateSchema), postcommit: postcommitSchema,
}).strict();
export type ReviewedProductionCompletionScope = z.infer<typeof reviewedProductionCompletionScopeSchema>;
export type ReviewedProductionCompletionPreview = z.infer<typeof reviewedProductionCompletionPreviewSchema>;
export type ReviewedProductionCompletionResult = z.infer<typeof reviewedProductionCompletionResultSchema>;
export class ReviewedProductionCompletionError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 409) { super(message); }
}
function reject(code: string, message: string, status = 409): never { throw new ReviewedProductionCompletionError(code, message, status); }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const iso = (value: Date | string | null) => value ? new Date(value).toISOString() : null;

// Native HTTP completion requires internal identity and tenant membership, not
// an assistant grant or supervisory role. Lock those persisted facts at execute.
async function assertAuthority(tx: any, scope: ReviewedProductionCompletionScope, lock: boolean) {
  const { isPortalCustomerIdentity } = await import("./customerPortalAccessService");
  let query = tx.select({ userId: users.id, role: users.role, accountType: users.accountType,
    organizationRole: userOrganizations.role, deleteState: organizations.deleteState, isArchived: organizations.isArchived })
    .from(userOrganizations).innerJoin(users, eq(users.id, userOrganizations.userId))
    .innerJoin(organizations, eq(organizations.id, userOrganizations.organizationId))
    .where(and(eq(userOrganizations.organizationId, scope.organizationId), eq(userOrganizations.userId, scope.actorUserId)));
  if (lock) query = query.for("share");
  const [actor] = await query.limit(1);
  if (!actor || actor.deleteState !== "active" || actor.isArchived || isPortalCustomerIdentity(actor)) {
    reject("PRODUCTION_COMPLETION_FORBIDDEN", "Current internal organization access is required.", 403);
  }
  return actor;
}

async function loadSnapshot(tx: any, scope: ReviewedProductionCompletionScope, lock: boolean) {
  let orderQuery = tx.select().from(orders).where(and(eq(orders.organizationId, scope.organizationId), eq(orders.id, scope.orderId)));
  if (lock) orderQuery = orderQuery.for("update");
  const [order] = await orderQuery.limit(1);
  if (!order) reject("PRODUCTION_COMPLETION_TARGET_NOT_FOUND", "Order not found.", 404);
  const lines = await tx.select().from(orderLineItems).where(eq(orderLineItems.orderId, scope.orderId)).orderBy(orderLineItems.id);
  const line = lines.find((row: any) => row.id === scope.lineItemId);
  if (!line) reject("PRODUCTION_COMPLETION_TARGET_NOT_FOUND", "Line does not belong to this Order.", 404);
  let jobsQuery = tx.select().from(productionJobs).where(and(eq(productionJobs.organizationId, scope.organizationId),
    eq(productionJobs.lineItemId, scope.lineItemId))).orderBy(productionJobs.id);
  if (lock) jobsQuery = jobsQuery.for("update");
  const jobs: (typeof productionJobs.$inferSelect)[] = await jobsQuery;
  const active = jobs.filter(job => !isTerminalProductionStatus(job.status));
  const productIds = Array.from(new Set(lines.map((row: any) => row.productId).filter(Boolean))) as string[];
  let productQuery = productIds.length ? tx.select().from(products).where(and(eq(products.organizationId, scope.organizationId), inArray(products.id, productIds))).orderBy(products.id) : null;
  if (lock && productQuery) productQuery = productQuery.for("share");
  const productRows = productQuery ? await productQuery : [];
  return { order, line, lines, jobs, active, productRows };
}

async function buildPreview(tx: any, scope: ReviewedProductionCompletionScope, lock: boolean,
  snapshot: Awaited<ReturnType<typeof loadSnapshot>>, authority: Awaited<ReturnType<typeof assertAuthority>>) {
  const [{ isDesignOwnershipJob, isPrepressOwnershipJob }, { getProductionConfigForOrganization }] = await Promise.all([
    import("./productionOwnership"), import("../routes/production.shared"),
  ]);
  const { order, line, active } = snapshot;
  if (active.length !== 1) reject("PRODUCTION_COMPLETION_INDIVIDUAL_REQUIRED", "Select a line with exactly one active individual production job.");
  const job = active[0];
  if (job.orderId !== scope.orderId) reject("PRODUCTION_COMPLETION_STATE_CHANGED", "The active job does not belong to this Order line.");
  if (job.status !== "in_progress" || !job.startedAt) reject("PRODUCTION_COMPLETION_STARTED_REQUIRED", "Only a started, in-progress production job can be reviewed for completion.");
  if (isDesignOwnershipJob(job) || isPrepressOwnershipJob(job) || ["proofing", "fulfillment", "done", "completed"].includes(job.stationKey.trim().toLowerCase())) {
    reject("PRODUCTION_MANAGED_COMPLETION_REQUIRED", "Complete this work from its owning workspace.");
  }
  if (isCanceledOrder(order) || order.state !== "open" || order.status !== "in_production" ||
    line.productionBypassed || ["completed", "canceled", "cancelled", "void"].includes(String(line.workflowState)) ||
    ["complete", "completed", "canceled", "cancelled", "void"].includes(String(line.status))) {
    reject("PRODUCTION_COMPLETION_STATE_CHANGED", "Current Order and line state does not permit ordinary individual completion.");
  }
  const [member] = await tx.select({ id: productionRunMembers.id }).from(productionRunMembers).where(and(
    eq(productionRunMembers.organizationId, scope.organizationId),
    or(eq(productionRunMembers.orderLineItemId, scope.lineItemId), eq(productionRunMembers.productionJobId, job.id)),
  )).limit(1);
  if (member) reject("COMBINED_RUN_COMPLETION_REQUIRED", "Complete run-owned work through its Production run workflow.");
  let stepQuery = tx.select().from(productionStationSteps).where(and(eq(productionStationSteps.organizationId, scope.organizationId),
    eq(productionStationSteps.stationKey, job.stationKey), eq(productionStationSteps.key, job.stepKey), eq(productionStationSteps.active, true)));
  if (lock) stepQuery = stepQuery.for("share");
  const [step] = await stepQuery.limit(1);
  const config = await getProductionConfigForOrganization(scope.organizationId, tx);
  const route = resolveProductionCompletionRoute({ stationKey: job.stationKey, stepKey: job.stepKey,
    finishingMode: config.finishingMode, triggers: step?.triggers ?? [] });
  if (route.kind !== "route") reject("PRODUCTION_COMPLETION_ROUTE_REQUIRED", "Configure this production step's native completion route before completing it.");
  return reviewedProductionCompletionPreviewSchema.parse({ version: "v1", scope, jobId: job.id,
    revision: hash({ scope, authority, order, line, job, lines: snapshot.lines, products: snapshot.productRows, step: step ?? null, config }),
    state: { jobStatus: job.status, stationKey: job.stationKey, stepKey: job.stepKey, startedAt: iso(job.startedAt),
      orderState: order.state, orderStatus: order.status, lineWorkflowState: line.workflowState, lineStatus: line.status }, route: route.route });
}

/** Read-only native review. The caller must persist this server-created artifact;
 * a provider is never trusted to invent the reviewed revision or actor scope. */
export async function previewReviewedProductionCompletion(rawScope: ReviewedProductionCompletionScope): Promise<ReviewedProductionCompletionPreview> {
  const { db } = await import("../db");
  const scope = reviewedProductionCompletionScopeSchema.parse(rawScope);
  return db.transaction(async tx => {
    const authority = await assertAuthority(tx, scope, false);
    return buildPreview(tx, scope, false, await loadSnapshot(tx, scope, false), authority);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

type OrdinaryCompletionInput = { organizationId: string; userId: string; jobId: string; skipProduction: boolean;
  auditUserName?: string | null; ipAddress?: string | null; userAgent?: string | null };

/** The ordinary POST's existing fail-soft hooks, shared without changing UI
 * request semantics. These may schedule configured status notifications. */
async function runPostcommit(input: OrdinaryCompletionInput, job: any): Promise<ReviewedProductionCompletionResult["postcommit"]> {
  const results: ReviewedProductionCompletionResult["postcommit"] = [];
  // Import failures also happen after commit and must not hide the applied result.
  let applyWorkflowStatusPillFailSoft: typeof import("./workflowStatusPillService").applyWorkflowStatusPillFailSoft;
  try { ({ applyWorkflowStatusPillFailSoft } = await import("./workflowStatusPillService")); }
  catch { return [{ triggerKey: "completion_hooks", status: "unavailable", reason: null }]; }
  const apply = async (triggerKey: "sent_to_fulfillment" | "production_completed", reason: string, metadata: Record<string, unknown>) => {
    try {
      const result = await applyWorkflowStatusPillFailSoft({ organizationId: input.organizationId, orderId: job.orderId,
        triggerKey, actorUserId: input.userId, source: "system", reason, metadata });
      results.push({ triggerKey, status: result?.status ?? "unavailable", reason: result?.status === "skipped" ? result.reason : null });
    } catch { results.push({ triggerKey, status: "unavailable", reason: null }); }
  };
  if (job?.orderId && job.nextStationKey === "fulfillment") await apply("sent_to_fulfillment",
    "Production completion routed work to fulfillment", { workflowEvent: "sent_to_fulfillment", productionJobId: job.id,
      lineItemId: job.lineItemId, previousStationKey: job.stationKey });
  if (job?.orderId && String(job.stationKey ?? "").toLowerCase() === "fulfillment") {
    try {
      const { db } = await import("../db");
      const [remaining] = await db.select({ id: productionJobs.id }).from(productionJobs).where(and(
        eq(productionJobs.organizationId, input.organizationId), eq(productionJobs.orderId, job.orderId),
        sql`lower(coalesce(${productionJobs.status}, '')) not in ('done', 'void', 'canceled', 'cancelled')`,
      )).limit(1);
      if (!remaining) await apply("production_completed", "All production and fulfillment work completed",
        { workflowEvent: "production_completed", productionJobId: job.id, lineItemId: job.lineItemId });
    } catch { results.push({ triggerKey: "production_completed", status: "unavailable", reason: null }); }
  }
  return results;
}

function readback(snapshot: Awaited<ReturnType<typeof loadSnapshot>>, jobId: string): Omit<ReviewedProductionCompletionResult, "postcommit"> {
  const job = snapshot.jobs.find(row => row.id === jobId);
  if (!job || job.status !== "done") reject("PRODUCTION_COMPLETION_READBACK_MISMATCH", "Production completion was not persisted; no changes were saved.");
  const state = (row: typeof productionJobs.$inferSelect) => ({ id: row.id, status: row.status, stationKey: row.stationKey, stepKey: row.stepKey });
  return { status: "applied", job: { ...state(job), completedAt: iso(job.completedAt) },
    order: { id: snapshot.order.id, state: snapshot.order.state, status: snapshot.order.status },
    line: { id: snapshot.line.id, workflowState: snapshot.line.workflowState, status: snapshot.line.status },
    activeSuccessors: snapshot.active.filter(row => row.id !== jobId).map(state) };
}

/** Both native POST and reviewed execution enter here. Optional review is an
 * optimistic precondition, not a second production/fulfillment engine. */
export async function completeOrdinaryProductionJob(input: OrdinaryCompletionInput,
  reviewed?: { scope: ReviewedProductionCompletionScope; preview: ReviewedProductionCompletionPreview }) {
  const [{ db }, { lockOrderProductionOverrideLines }] = await Promise.all([import("../db"), import("./orderProductionOverrideBoundary")]);
  if (reviewed) reviewed = { scope: reviewedProductionCompletionScopeSchema.parse(reviewed.scope),
    preview: reviewedProductionCompletionPreviewSchema.parse(reviewed.preview) };
  if (reviewed && (input.organizationId !== reviewed.scope.organizationId || input.userId !== reviewed.scope.actorUserId ||
    input.jobId !== reviewed.preview.jobId || input.skipProduction !== false || hash(reviewed.scope) !== hash(reviewed.preview.scope))) {
    reject("PRODUCTION_COMPLETION_SCOPE_MISMATCH", "Ordinary completion arguments must match the reviewed scope without skip or override.", 403);
  }
  const committed = await db.transaction(async tx => {
    const authority = reviewed ? await assertAuthority(tx, reviewed.scope, true) : null;
    // Match the line-before-parent workflow lock order for BOTH callers, so a
    // normal UI click cannot deadlock a reviewed completion holding its line.
    const [reference] = await tx.select({ orderId: productionJobs.orderId }).from(productionJobs)
      .where(and(eq(productionJobs.organizationId, input.organizationId), eq(productionJobs.id, input.jobId))).limit(1);
    if (reference?.orderId) {
      await lockOrderProductionOverrideLines(tx, input.organizationId, reference.orderId);
      await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.organizationId, input.organizationId),
        eq(orders.id, reference.orderId))).for("update").limit(1);
    }
    if (reviewed) {
      const { scope, preview } = reviewed;
      if (reference?.orderId !== scope.orderId) reject("PRODUCTION_COMPLETION_REVIEW_STALE", "Production job ownership changed after review.");
      const before = await loadSnapshot(tx, scope, true);
      // Same-plan replay belongs to the existing protected GO receipt. Never
      // attribute a generic done job to this actor/review or append new history.
      const current = await buildPreview(tx, scope, true, before, authority);
      if (hash(current) !== hash(preview)) reject("PRODUCTION_COMPLETION_REVIEW_STALE", "Production state changed after review. Review the current job before completing it.");
    }
    const { completeProductionJobWorkflow } = await import("../routes/productionJobs.routes");
    const completedJob = await completeProductionJobWorkflow(tx, input);
    if (!reviewed) return { completedJob, actual: null };
    const after = await loadSnapshot(tx, reviewed.scope, true);
    const actual = readback(after, reviewed.preview.jobId);
    const expected = reviewed.preview.route;
    if (actual.activeSuccessors.length !== 1 || actual.activeSuccessors[0].stationKey !== expected.stationKey ||
      actual.activeSuccessors[0].stepKey !== expected.stepKey || completedJob.nextStationKey !== expected.stationKey || completedJob.nextStepKey !== expected.stepKey) {
      reject("PRODUCTION_COMPLETION_READBACK_MISMATCH", "Native routing did not produce the reviewed successor; no changes were saved.");
    }
    return { completedJob, actual };
  });
  // Never turn a committed production operation into a reported rollback because
  // an automatic pill/read failed. The native UI and reviewed caller share this.
  const postcommit = await runPostcommit(input, committed.completedJob);
  return { ...committed, postcommit };
}

export async function executeReviewedProductionCompletion(rawScope: ReviewedProductionCompletionScope,
  rawPreview: ReviewedProductionCompletionPreview): Promise<ReviewedProductionCompletionResult> {
  const scope = reviewedProductionCompletionScopeSchema.parse(rawScope);
  const preview = reviewedProductionCompletionPreviewSchema.parse(rawPreview);
  if (hash(scope) !== hash(preview.scope)) reject("PRODUCTION_COMPLETION_SCOPE_MISMATCH", "Reviewed actor, organization, Order and line must match the current request.", 403);
  const result = await completeOrdinaryProductionJob({ organizationId: scope.organizationId, userId: scope.actorUserId,
    jobId: preview.jobId, skipProduction: false }, { scope, preview });
  return reviewedProductionCompletionResultSchema.parse({ ...result.actual, postcommit: result.postcommit });
}
