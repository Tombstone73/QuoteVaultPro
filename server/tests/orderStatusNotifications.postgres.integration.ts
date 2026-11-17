import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, expect, jest, test } from "@jest/globals";
import { and, eq, sql } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { auditLogs, customers, customerPortalAccess, fulfillmentEvents, invoices, invoiceEmailDeliveryJobs as jobs, orders, organizations,
  orderStatusEvents, orderStatusPills, payments, productionJobs, userOrganizations, users } from "@shared/schema";
import { statusNotificationRulesSchema } from "@shared/statusNotifications";
import type { StatusEmailReviewCommand, StatusEmailOutcome } from "@shared/statusEmailReview";
import { db } from "../db";
import { assignOrderStatusPill, seedDefaultPillsForOrg } from "../services/orderStatusPillService";
import { beginOrderStatusDelivery, listPortalStatusNotifications, scheduleOrderStatusNotifications,
  updateOrderStatusNotificationRules } from "../services/orderStatusNotifications";
import { markInvoiceEmailDeliveryFailure, runBulkInvoiceEmailQueueWorker } from "../services/invoiceBulkEmailQueue.service";
import { emailService } from "../emailService";
import { registerMvpInvoicingRoutes } from "../routes/mvpInvoicing.routes";

let organizationId: string;
let otherOrg: string;
let staffId: string;
let adminId: string;
let foreignId: string;
let nonStaffId: string;
let portalId: string;
let customerId: string;
let pillA: string;
let pillB: string;
const staffEmail = "synthetic-owner@example.invalid";
const customerEmail = "synthetic-customer@example.invalid";
const whereOrder = (id: string) => eq(jobs.statusOrderId, id);
const rows = (id: string) => db.select().from(jobs).where(whereOrder(id));
const tick = () => runBulkInvoiceEmailQueueWorker();
const orderIds: string[] = [];
const app = express();
app.use(express.json());

beforeAll(async () => {
  [{ id: organizationId }, { id: otherOrg }] = await db.insert(organizations).values(
    ["status-test", "status-foreign"].map(name => ({ name, slug: name + randomUUID() }))).returning();
  await seedDefaultPillsForOrg(organizationId);
  const [staff, nonStaff, foreign, admin, portal] = await db.insert(users).values([
    { email: staffEmail }, { email: "synthetic-member@example.invalid" }, { email: "synthetic-foreign@example.invalid" },
    { email: "synthetic-reviewer@example.invalid" },
    { email: "synthetic-portal@example.invalid", accountType: "PORTAL_CUSTOMER" },
  ]).returning();
  staffId = staff.id;
  adminId = admin.id;
  nonStaffId = nonStaff.id;
  foreignId = foreign.id;
  portalId = portal.id;
  await db.insert(userOrganizations).values([
    { organizationId, userId: staffId, role: "owner" },
    { organizationId, userId: nonStaff.id, role: "member" },
    { organizationId: otherOrg, userId: foreign.id, role: "admin" },
    { organizationId, userId: portalId, role: "admin" },
  ]);
  [{ id: customerId }] = await db.insert(customers).values({ organizationId,
    companyName: "Synthetic customer", email: customerEmail }).returning();
  await db.insert(customerPortalAccess).values({ organizationId, customerId, status: "ACTIVE", email: customerEmail });
  const pills = await db.select().from(orderStatusPills).where(eq(orderStatusPills.organizationId, organizationId));
  pillA = pills.find(pill => pill.key === "prepress")!.id;
  pillB = pills.find(pill => pill.key === "needs_review")!.id;
  await db.update(orderStatusPills).set({ customerVisible: true }).where(eq(orderStatusPills.id, pillA));
  await registerMvpInvoicingRoutes(app, {
    isAuthenticated: (req: any, res: any, next: any) => {
      const id = req.header("x-test-user");
      if (!id) return res.sendStatus(401);
      req.user = { id, firstName: "Synthetic", lastName: "Reviewer" };
      next();
    },
    tenantContext: (req: any, _res: any, next: any) => {
      req.organizationId = req.header("x-other-org") ? otherOrg : organizationId;
      next();
    },
  });
});

afterEach(async () => {
  jest.restoreAllMocks();
  for (const id of orderIds.splice(0)) await db.delete(orders).where(eq(orders.id, id));
  await db.update(orderStatusPills).set({ isActive: true, name: "Prepress", customerVisible: true }).where(eq(orderStatusPills.id, pillA));
  await updateOrderStatusNotificationRules(organizationId, pillA, statusNotificationRulesSchema.parse({}));
  await updateOrderStatusNotificationRules(organizationId, pillB, statusNotificationRulesSchema.parse({}));
});

async function fixture() {
  const [order] = await db.insert(orders).values({ organizationId, customerId,
    createdByUserId: staffId, orderNumber: "ST-" + randomUUID().slice(0, 8) }).returning();
  orderIds.push(order.id);
  return order.id;
}
const enter = (orderId: string, statusPillId: string) => assignOrderStatusPill({
  organizationId, orderId, statusPillId, actorUserId: staffId, scheduleProductionJobs: false,
});
const portalRules = (delaySeconds = 60) => statusNotificationRulesSchema.parse({
  customer_portal: { enabled: true, template: "order_update", delaySeconds },
});
const allowPortal = (delaySeconds = 60) => updateOrderStatusNotificationRules(organizationId, pillA, portalRules(delaySeconds));

test.each([10, 30, 59])("leaving at %i seconds cancels the unsent 60 second notice", async (elapsedSeconds) => {
  await allowPortal();
  const orderId = await fixture();
  const { eventId } = await enter(orderId, pillA);
  const [event] = await db.select().from(orderStatusEvents).where(eq(orderStatusEvents.id, eventId!));
  const [scheduled] = await rows(orderId);
  expect(scheduled.sendAfter!.getTime() - event.changedAt.getTime()).toBe(60000);
  // Move the durable clock relative to database time without sleeping.
  await db.update(jobs).set({ sendAfter: sql`now() + (${60 - elapsedSeconds} * interval '1 second')`,
    availableAt: sql`now() + (${60 - elapsedSeconds} * interval '1 second')` }).where(whereOrder(orderId));
  expect((await tick()).sent).toBe(0);
  await enter(orderId, pillB);
  expect(await rows(orderId)).toEqual([expect.objectContaining({ id: scheduled.id, status: "canceled" })]);
});

test("rapid A → B → A starts a distinct delay and a repeated save or event leaves it intact", async () => {
  await allowPortal();
  await updateOrderStatusNotificationRules(organizationId, pillB, statusNotificationRulesSchema.parse({
    staff_email: { enabled: true, delaySeconds: 37, template: "staff_status" },
  }));
  const id = await fixture();
  const first = await enter(id, pillA);
  const middle = await enter(id, pillB);
  const last = await enter(id, pillA);
  expect((await enter(id, pillA)).eventId).toBeNull();
  await db.transaction(tx => scheduleOrderStatusNotifications(tx, organizationId, id, last.eventId!));
  const deliveries = await rows(id);
  expect(deliveries).toHaveLength(3);
  expect(deliveries.find(job => job.statusEventId === first.eventId)?.status).toBe("canceled");
  expect(deliveries.find(job => job.statusEventId === middle.eventId)).toMatchObject({
    status: "canceled", metadata: { rule: { delaySeconds: 37 } },
  });
  expect(deliveries.find(job => job.statusEventId === last.eventId)?.status).toBe("queued");
  // A fresh worker tick sees the persisted deadline and leaves it queued.
  expect((await tick()).sent).toBe(0);
});

test("zero seconds dispatches through existing worker, then status change preserves sent portal evidence", async () => {
  await allowPortal(0);
  const id = await fixture();
  await enter(id, pillA);
  expect((await tick()).sent).toBe(1);
  await enter(id, pillB);
  expect(await rows(id)).toEqual([expect.objectContaining({ status: "sent" })]);
  expect(await listPortalStatusNotifications(otherOrg, customerId)).toEqual([]);
  expect((await listPortalStatusNotifications(organizationId, customerId)).find(n => n.orderId === id)).toMatchObject({
    body: "The status of your order has changed.",
  });
  expect((await tick()).sent).toBe(0);
});

test("tenant scope, disabled rules, failed transition, and repair-style writes cannot enqueue deliveries", async () => {
  const id = await fixture();
  await enter(id, pillA);
  expect(await rows(id)).toEqual([]);
  await expect(updateOrderStatusNotificationRules(otherOrg, pillA, portalRules())).rejects.toThrow("not found");
  await allowPortal(0);
  await expect(enter(id, "foreign-pill")).rejects.toThrow("does not exist");
  await db.update(orders).set({ statusPillId: pillB }).where(eq(orders.id, id));
  await db.update(orders).set({ statusPillId: pillA }).where(eq(orders.id, id));
  expect(await rows(id)).toEqual([]);
  await updateOrderStatusNotificationRules(organizationId, pillB, statusNotificationRulesSchema.parse({
    staff_email: { enabled: true, delaySeconds: 0, template: "staff_status" },
  }));
  await expect(db.transaction(async tx => {
    await tx.update(orders).set({ statusPillId: pillB }).where(eq(orders.id, id));
    const [event] = await tx.insert(orderStatusEvents).values({ organizationId, orderId: id,
      eventType: "status_pill_changed", fromStatusPillId: pillA, toStatusPillId: pillB }).returning();
    await updateInsideThenFail(tx, event.id);
  })).rejects.toThrow("rollback");
  expect(await rows(id)).toEqual([]);

  async function updateInsideThenFail(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], eventId: string) {
    await scheduleOrderStatusNotifications(tx, organizationId, id, eventId);
    expect(await tx.select().from(jobs).where(whereOrder(id))).toHaveLength(1);
    throw new Error("rollback");
  }
});

test("rename keeps pending work; disabling a pill or a rule cancels without reviving jobs", async () => {
  await allowPortal();
  const id = await fixture();
  await enter(id, pillA);
  await db.update(orderStatusPills).set({ name: "Renamed prepress" }).where(eq(orderStatusPills.id, pillA));
  expect((await rows(id))[0].status).toBe("queued");
  await db.update(orderStatusPills).set({ isActive: false }).where(eq(orderStatusPills.id, pillA));
  await db.update(orderStatusPills).set({ isActive: true }).where(eq(orderStatusPills.id, pillA));
  await enter(id, pillB);
  await enter(id, pillA);
  await updateOrderStatusNotificationRules(organizationId, pillA, statusNotificationRulesSchema.parse({}));
  await allowPortal();
  expect((await rows(id)).map(job => job.status)).toEqual(["canceled", "canceled"]);
});

test("removing a custom status cancels delivery and preserves its history", async () => {
  const [custom] = await db.insert(orderStatusPills).values({
    organizationId, name: "Custom hold", key: "test_custom_hold", stateScope: "open", customerVisible: true,
  }).returning();
  await updateOrderStatusNotificationRules(organizationId, custom.id, portalRules());
  const id = await fixture();
  await enter(id, custom.id);
  await db.delete(orderStatusPills).where(eq(orderStatusPills.id, custom.id));
  expect(await rows(id)).toEqual([expect.objectContaining({ status: "canceled", statusPillId: custom.id })]);
});

test("dispatch and cancellation contend on the order lock, and a canceled claim never publishes", async () => {
  await allowPortal();
  const id = await fixture();
  await enter(id, pillA);
  const [job] = await rows(id);
  await db.update(jobs).set({ status: "processing", claimedByWorkerId: "test-worker",
    availableAt: new Date(0), claimExpiresAt: new Date(Date.now() + 60_000),
    metadata: { ...job.metadata, queueStage: "preparing" } }).where(eq(jobs.id, job.id));
  let begin!: () => void;
  const waiting = new Promise<void>(resolve => { begin = resolve; });
  const cancel = db.transaction(async tx => {
    await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, id)).for("update");
    begin();
    await tx.update(orders).set({ statusPillId: pillB }).where(eq(orders.id, id));
  });
  await waiting;
  const [, dispatch] = await Promise.all([cancel, beginOrderStatusDelivery({ id: job.id, organizationId, claimedByWorkerId: "test-worker" })]);
  expect(dispatch).toBe("canceled");
  expect((await rows(id))[0].status).toBe("canceled");
});

test("separate customer and authorized staff templates deliver once with a safe retry", async () => {
  await updateOrderStatusNotificationRules(organizationId, pillA, statusNotificationRulesSchema.parse({
    customer_email: { enabled: true, delaySeconds: 0, template: "order_activity" },
    staff_email: { enabled: true, delaySeconds: 0, template: "staff_review", recipients: "administrators" },
  }));
  const delivered: Array<{ to: unknown; subject: string; text?: string }> = [];
  let failOnce = true;
  jest.spyOn(emailService, "sendEmail").mockImplementation(async (_org, options) => {
    if (options.to === customerEmail && failOnce) {
      failOnce = false;
      throw markInvoiceEmailDeliveryFailure(new Error("Synthetic token outage"), "retryable");
    }
    await options.beforeProviderSubmission?.();
    delivered.push(options);
    return `mock-receipt-${delivered.length}`;
  });
  const id = await fixture();
  await enter(id, pillA);
  await tick();
  expect((await rows(id)).find(job => job.recipientEmail === customerEmail)?.status).toBe("retrying");
  await db.update(jobs).set({ availableAt: new Date(0) })
    .where(and(whereOrder(id), eq(jobs.recipientEmail, customerEmail)));
  while ((await tick()).processed > 0) { /* drain this fixture's eligible deliveries */ }
  expect(delivered).toHaveLength(2);
  expect(delivered).toEqual(expect.arrayContaining([
    expect.objectContaining({ to: customerEmail, subject: expect.stringContaining("New activity"), text: "There is a new status update on your order." }),
    expect.objectContaining({ to: staffEmail, subject: expect.stringContaining("Review Order"), text: expect.stringContaining("Prepress") }),
  ]));
  expect((await rows(id)).every(job => job.status === "sent")).toBe(true);
});

test("a worker restart after the Gmail boundary does not send an uncertain delivery again", async () => {
  await updateOrderStatusNotificationRules(organizationId, pillA, statusNotificationRulesSchema.parse({
    customer_email: { enabled: true, delaySeconds: 0, template: "order_update" },
  }));
  const send = jest.spyOn(emailService, "sendEmail").mockRejectedValue(new Error("Unexpected send"));
  const id = await fixture();
  await enter(id, pillA);
  const [job] = await rows(id);
  await db.update(jobs).set({ status: "processing", claimedByWorkerId: "stopped-worker", claimExpiresAt: new Date(0),
    attemptCount: 1, metadata: { ...job.metadata, queueStage: "provider_submitting" } }).where(eq(jobs.id, job.id));
  await tick();
  expect((await rows(id))[0].status).toBe("needs_review");
  expect(send).not.toHaveBeenCalled();
});

const reviewCommand = (outcome: StatusEmailOutcome, evidence = "Synthetic evidence independently verified for this test.") =>
  ({ action: "record", requestId: randomUUID(), outcome, evidence } as const);
const reviewUrl = (jobId: string) => `/api/invoices/email-queue/${jobId}/status-review`;
const submitReview = (jobId: string, command: StatusEmailReviewCommand, actor = staffId, foreign = false) =>
  request(app).post(reviewUrl(jobId)).set("x-test-user", actor).set("x-other-org", foreign ? "1" : "").send(command);
const resend = { action: "resend", confirmed: true } as const;

async function uncertainEmail() {
  await updateOrderStatusNotificationRules(organizationId, pillA, statusNotificationRulesSchema.parse({
    customer_email: { enabled: true, delaySeconds: 0, template: "order_update" },
  }));
  const orderId = await fixture();
  await enter(orderId, pillA);
  const [job] = await rows(orderId);
  const claimedAt = new Date("2026-11-17T15:00:00Z");
  await db.update(jobs).set({ status: "needs_review", claimedAt, attemptCount: 1, failureReason: "Gmail response was unavailable.",
    metadata: { ...job.metadata, queueStage: "provider_submitting", providerSubmissionStartedAt: claimedAt.toISOString() } })
    .where(eq(jobs.id, job.id));
  return { orderId, job: (await rows(orderId))[0] };
}

test("review requires staff authority in the active tenant and cannot use the invoice retry shortcut", async () => {
  const { job } = await uncertainEmail();
  const command = reviewCommand("confirmed_sent");
  expect((await request(app).post(reviewUrl(job.id)).send(command)).status).toBe(401);
  expect((await submitReview(job.id, command, nonStaffId)).status).toBe(403);
  expect((await submitReview(job.id, command, portalId)).status).toBe(403);
  expect((await submitReview(job.id, command, foreignId)).status).toBe(403);
  expect((await submitReview(job.id, command, foreignId, true)).status).toBe(404);
  const legacy = await request(app).post(`/api/invoices/email-queue/${job.id}/resolve`)
    .set("x-test-user", staffId).send({ retryThroughQueue: true });
  expect(legacy.status).toBe(409);
  expect((await rows(job.statusOrderId!))[0].status).toBe("needs_review");
});

test("Confirmed Sent records reviewer verification without changing provider evidence or any workflow", async () => {
  const { job, orderId } = await uncertainEmail();
  const [orderBefore] = await db.select().from(orders).where(eq(orders.id, orderId));
  const orderEventsBefore = await db.select().from(orderStatusEvents).where(eq(orderStatusEvents.orderId, orderId));
  const send = jest.spyOn(emailService, "sendEmail").mockRejectedValue(new Error("Unexpected send"));
  const command = { ...reviewCommand("confirmed_sent"), gmailMessageId: "synthetic-verified-gmail-id" };
  const result = await submitReview(job.id, command);
  expect(result.status).toBe(200);
  expect(result.body.data).toMatchObject({ status: "sent", replayed: false, review: { entries: [
    expect.objectContaining({ outcome: "confirmed_sent", reviewerId: staffId, gmailMessageId: command.gmailMessageId }),
  ] } });
  expect((await submitReview(job.id, command)).body.data.replayed).toBe(true);
  expect((await submitReview(job.id, resend)).status).toBe(409);
  expect(await rows(orderId)).toEqual([expect.objectContaining({ id: job.id, status: "sent",
    claimedAt: job.claimedAt, sendAfter: job.sendAfter, providerMessageId: null, sentAt: null, failureReason: job.failureReason,
    metadata: expect.objectContaining({ providerSubmissionStartedAt: job.metadata.providerSubmissionStartedAt }) })]);
  expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, job.id))).toHaveLength(1);
  expect((await db.select().from(orders).where(eq(orders.id, orderId)))[0]).toEqual(orderBefore);
  expect(await db.select().from(orderStatusEvents).where(eq(orderStatusEvents.orderId, orderId))).toEqual(orderEventsBefore);
  expect(await db.select().from(productionJobs).where(eq(productionJobs.orderId, orderId))).toEqual([]);
  expect(await db.select().from(fulfillmentEvents).where(eq(fulfillmentEvents.organizationId, organizationId))).toEqual([]);
  expect(await db.select().from(invoices).where(eq(invoices.orderId, orderId))).toEqual([]);
  expect(await db.select().from(payments).where(eq(payments.organizationId, organizationId))).toEqual([]);
  await tick();
  expect(send).not.toHaveBeenCalled();
});

test("Unresolved review keeps retries blocked and can be followed by a later final review", async () => {
  const { job, orderId } = await uncertainEmail();
  const send = jest.spyOn(emailService, "sendEmail").mockRejectedValue(new Error("Unexpected send"));
  const command = reviewCommand("unresolved", "Mailbox receipt unavailable. Acceptance remains uncertain.");
  expect((await submitReview(job.id, command)).body.data.status).toBe("needs_review");
  expect((await submitReview(job.id, command)).body.data.replayed).toBe(true);
  expect((await submitReview(job.id, resend)).status).toBe(409);
  expect((await tick()).processed).toBe(0);
  expect(send).not.toHaveBeenCalled();
  expect((await submitReview(job.id, reviewCommand("confirmed_not_sent"))).body.data).toMatchObject({
    status: "failed", review: { entries: [{ outcome: "unresolved" }, { outcome: "confirmed_not_sent" }] },
  });
  expect(await rows(orderId)).toHaveLength(1);
});

test("competing reviewers cannot overwrite a final review", async () => {
  await db.insert(userOrganizations).values({ organizationId, userId: adminId, role: "admin" });
  const { job, orderId } = await uncertainEmail();
  try {
    const results = await Promise.all([
      submitReview(job.id, reviewCommand("confirmed_sent")),
      submitReview(job.id, reviewCommand("confirmed_not_sent"), adminId),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect((await rows(orderId))[0].metadata.statusDeliveryReview).toMatchObject({ entries: [expect.any(Object)] });
    expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, job.id))).toHaveLength(1);
  } finally {
    await db.delete(userOrganizations).where(and(eq(userOrganizations.organizationId, organizationId), eq(userOrganizations.userId, adminId)));
  }
});

test("Confirmed Not Sent requires evidence and is blocked by a recorded Gmail receipt", async () => {
  const { job, orderId } = await uncertainEmail();
  expect((await submitReview(job.id, reviewCommand("confirmed_not_sent", " "))).status).toBe(400);
  await db.update(jobs).set({ providerMessageId: "synthetic-existing-gmail-receipt" }).where(eq(jobs.id, job.id));
  expect((await submitReview(job.id, reviewCommand("confirmed_not_sent"))).status).toBe(409);
  expect((await rows(orderId))[0]).toMatchObject({ status: "needs_review", providerMessageId: "synthetic-existing-gmail-receipt" });
});

test("one separately confirmed resend creates a new job and the existing worker delivers it once", async () => {
  const { job, orderId } = await uncertainEmail();
  const send = jest.spyOn(emailService, "sendEmail").mockImplementation(async (_organizationId, options) => {
    await options.beforeProviderSubmission?.();
    return "synthetic-new-gmail-id";
  });
  expect((await submitReview(job.id, reviewCommand("confirmed_not_sent"))).body.data.status).toBe("failed");
  expect(await rows(orderId)).toHaveLength(1);
  expect((await request(app).post(reviewUrl(job.id)).set("x-test-user", staffId).send({ action: "resend" })).status).toBe(400);
  const responses = await Promise.all([submitReview(job.id, resend), submitReview(job.id, resend)]);
  expect(responses.map(response => response.status)).toEqual([200, 200]);
  expect(responses.map(response => response.body.data.replayed).sort()).toEqual([false, true]);
  const replacementId = responses[0].body.data.review.replacement.jobId;
  expect(responses[1].body.data.review.replacement.jobId).toBe(replacementId);
  const deliveries = await rows(orderId);
  expect(deliveries).toHaveLength(2);
  expect(deliveries.find(row => row.id === job.id)).toMatchObject({ status: "failed", attemptCount: 1, failureReason: job.failureReason });
  expect(deliveries.find(row => row.id === replacementId)).toMatchObject({ status: "queued", attemptCount: 0,
    metadata: { replacesStatusEmailJobId: job.id, subject: job.metadata.subject, body: job.metadata.body } });
  expect(deliveries.find(row => row.id === replacementId)?.metadata.providerSubmissionStartedAt).toBeUndefined();
  await tick();
  await tick();
  expect(send).toHaveBeenCalledTimes(1);
  expect((await rows(orderId)).find(row => row.id === replacementId)).toMatchObject({ status: "sent", providerMessageId: "synthetic-new-gmail-id" });
});

test.each(["status changed", "rule disabled", "sibling sent", "sibling active"] as const)("rejects a new send when %s", async reason => {
  const { job, orderId } = await uncertainEmail();
  await submitReview(job.id, reviewCommand("confirmed_not_sent"));
  if (reason === "status changed") await enter(orderId, pillB);
  else if (reason === "rule disabled") await updateOrderStatusNotificationRules(organizationId, pillA, statusNotificationRulesSchema.parse({}));
  else {
    const { id: _id, ...duplicate } = job;
    await db.insert(jobs).values({ ...duplicate, idempotencyKey: randomUUID(), status: reason === "sibling sent" ? "sent" : "queued" });
  }
  expect((await submitReview(job.id, resend)).status).toBe(409);
  expect((await rows(orderId)).some(row => row.metadata.replacesStatusEmailJobId === job.id)).toBe(false);
});
