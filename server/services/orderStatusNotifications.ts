import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  customers, customerContacts, customerContactLinks, customerPortalAccess, invoiceEmailCampaigns, invoiceEmailDeliveryJobs,
  orders, orderStatusEvents, orderStatusPills, userOrganizations, users,
} from "@shared/schema";
import {
  renderStatusNotification, statusNotificationKinds, statusNotificationRulesSchema,
  type StatusNotificationKind, type StatusNotificationRules,
} from "@shared/statusNotifications";
import { db } from "../db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Order = typeof orders.$inferSelect;
type Job = typeof invoiceEmailDeliveryJobs.$inferSelect;
type Rule = StatusNotificationRules[StatusNotificationKind];
const email = z.string().email();
const normalizeEmail = (value: string | null) => value?.trim().toLowerCase() || "";
const orderScope = (organizationId: string, orderId: string) =>
  and(eq(orders.organizationId, organizationId), eq(orders.id, orderId));

async function recipients(tx: Transaction, order: Order, kind: StatusNotificationKind, rule: Rule) {
  const { organizationId, customerId, contactId } = order;
  if (kind === "staff_email") {
    const onlyCreator = "recipients" in rule && rule.recipients === "order_creator";
    return (await tx.select({ id: users.id, address: users.email }).from(userOrganizations)
      .innerJoin(users, eq(users.id, userOrganizations.userId))
      .where(and(eq(userOrganizations.organizationId, organizationId),
        inArray(userOrganizations.role, ["owner", "admin"]), eq(users.accountType, "INTERNAL_USER"), ne(users.role, "customer"),
        ...(onlyCreator ? [eq(users.id, order.createdByUserId)] : []))))
      .map(row => ({ id: row.id, address: normalizeEmail(row.address) }))
      .filter(row => email.safeParse(row.address).success);
  }
  if (kind === "customer_portal") {
    if (!customerId) return [];
    const [access] = await tx.select({ id: customerPortalAccess.id }).from(customerPortalAccess)
      .innerJoin(customers, and(eq(customers.id, customerPortalAccess.customerId), eq(customers.organizationId, organizationId)))
      .where(and(eq(customerPortalAccess.organizationId, organizationId),
        eq(customerPortalAccess.customerId, customerId), eq(customerPortalAccess.status, "ACTIVE"))).limit(1);
    return access ? [{ id: customerId, address: "" }] : [];
  }
  if (contactId) {
    const [contact] = await tx.select({ id: customerContacts.id, address: customerContacts.email }).from(customerContacts)
      .where(and(eq(customerContacts.organizationId, organizationId), eq(customerContacts.id, contactId),
        eq(customerContacts.status, "active"), ...(customerId ? [sql`exists (
          select 1 from ${customerContactLinks} where ${customerContactLinks.organizationId} = ${organizationId}
          and ${customerContactLinks.customerId} = ${customerId} and ${customerContactLinks.contactId} = ${contactId}
          and ${customerContactLinks.status} = 'active'
        )`] : [])));
    const address = normalizeEmail(contact?.address ?? null);
    return contact && email.safeParse(address).success ? [{ id: contact.id, address }] : [];
  }
  if (!customerId) return [];
  const [customer] = await tx.select({ id: customers.id, address: customers.email }).from(customers)
    .where(and(eq(customers.organizationId, organizationId), eq(customers.id, customerId)));
  const address = normalizeEmail(customer?.address ?? null);
  return customer && email.safeParse(address).success ? [{ id: customer.id, address }] : [];
}

function allowed(pill: typeof orderStatusPills.$inferSelect, kind: StatusNotificationKind) {
  return pill.isActive && pill.notificationTriggerEligible && (kind === "staff_email" || pill.customerVisible);
}

/** Called only by live transition writers, inside the transaction that persisted the status event. */
export async function scheduleOrderStatusNotifications(tx: Transaction, organizationId: string, orderId: string, eventId: string) {
  const [order] = await tx.select().from(orders).where(orderScope(organizationId, orderId)).for("update");
  if (!order?.statusPillId || order.statusNotificationEventId === eventId) return;
  const [event] = await tx.update(orderStatusEvents).set({ notificationEvaluated: true }).where(and(
    eq(orderStatusEvents.organizationId, organizationId), eq(orderStatusEvents.orderId, orderId),
    eq(orderStatusEvents.id, eventId), eq(orderStatusEvents.toStatusPillId, order.statusPillId),
    eq(orderStatusEvents.eventType, "status_pill_changed"),
    eq(orderStatusEvents.notificationEvaluated, false),
  )).returning();
  if (!event || event.fromStatusPillId === event.toStatusPillId) return;
  const [pill] = await tx.select().from(orderStatusPills).where(and(
    eq(orderStatusPills.organizationId, organizationId), eq(orderStatusPills.id, order.statusPillId),
  )).for("share");
  if (!pill) return;
  const parsed = statusNotificationRulesSchema.safeParse(pill.notificationRules);
  if (!parsed.success) return;
  const campaignKey = `order-status:${eventId}`;
  const jobs: Omit<typeof invoiceEmailDeliveryJobs.$inferInsert, "campaignId">[] = [];
  for (const kind of statusNotificationKinds) {
    const rule = parsed.data[kind];
    if (!rule.enabled || !allowed(pill, kind)) continue;
    const sendAfter = new Date(event.changedAt.getTime() + rule.delaySeconds * 1000);
    const content = renderStatusNotification(rule.template, String(order.displayNumber ?? order.orderNumber), pill.name);
    for (const recipient of await recipients(tx, order, kind, rule)) {
      const recipientKey = `${kind}:${recipient.address || recipient.id}`;
      if (jobs.some(job => job.recipientKey === recipientKey)) continue;
      jobs.push({
        organizationId, invoiceVersion: 1, deliveryType: "order_status",
        statusOrderId: orderId, statusPillId: pill.id, statusEventId: eventId,
        recipientEmail: recipient.address, recipientKey, idempotencyKey: `${campaignKey}:${kind}:${recipient.id}`,
        sendAfter, availableAt: sendAfter,
        metadata: { kind, rule, recipientId: recipient.id, orderNumber: order.displayNumber ?? order.orderNumber,
          statusLabel: pill.name, ...content },
      });
    }
  }
  if (!jobs.length) return;
  const [campaign] = await tx.insert(invoiceEmailCampaigns).values({
    organizationId, idempotencyKey: campaignKey, requestedInvoiceIds: [],
    selectedInvoiceCount: 0, skippedInvoiceCount: 0, recipientGroupCount: jobs.length,
    metadata: { source: "order_status" },
  }).onConflictDoNothing().returning({ id: invoiceEmailCampaigns.id });
  if (!campaign) return;
  await tx.insert(invoiceEmailDeliveryJobs).values(jobs.map(job => ({ ...job, campaignId: campaign.id })));
  await tx.update(orders).set({ statusNotificationEventId: eventId }).where(orderScope(organizationId, orderId));
}

export async function updateOrderStatusNotificationRules(organizationId: string, pillId: string, rules: StatusNotificationRules) {
  return db.transaction(async tx => {
    const [pill] = await tx.select().from(orderStatusPills).where(and(
      eq(orderStatusPills.organizationId, organizationId), eq(orderStatusPills.id, pillId),
    )).for("update");
    if (!pill) throw Object.assign(new Error("Status pill not found"), { statusCode: 404 });
    if (statusNotificationKinds.some(kind => rules[kind].enabled && !allowed(pill, kind))) {
      throw Object.assign(new Error("Enable the status and its notification eligibility first. Customer channels also require Customer visible."), { statusCode: 400 });
    }
    await tx.update(orderStatusPills).set({ notificationRules: rules, updatedAt: new Date().toISOString() }).where(and(
      eq(orderStatusPills.organizationId, organizationId), eq(orderStatusPills.id, pillId),
    ));
    return rules;
  });
}

type DispatchClaim = { organizationId: string; id: string; claimedByWorkerId?: string };
const kinds = z.enum(statusNotificationKinds);
const validPayload = (job: Job) => z.object({
  kind: kinds, recipientId: z.string(), subject: z.string(), body: z.string(), rule: z.unknown(),
}).safeParse(job.metadata);

/** Establishes the point of no return under the same order lock used by invalidation.
 * Portal publication is a database write and is committed inside the lock.
 */
export async function beginOrderStatusDelivery(claim: DispatchClaim): Promise<"send" | "sent" | "canceled"> {
  return db.transaction(async tx => {
    const owned = and(eq(invoiceEmailDeliveryJobs.organizationId, claim.organizationId),
      eq(invoiceEmailDeliveryJobs.id, claim.id), eq(invoiceEmailDeliveryJobs.deliveryType, "order_status"));
    const [candidate] = await tx.select().from(invoiceEmailDeliveryJobs).where(owned);
    if (!candidate?.statusOrderId || !claim.claimedByWorkerId) return "canceled";
    const [order] = await tx.select().from(orders).where(orderScope(claim.organizationId, candidate.statusOrderId)).for("update");
    const [pill] = order?.statusPillId ? await tx.select().from(orderStatusPills).where(and(
      eq(orderStatusPills.organizationId, claim.organizationId), eq(orderStatusPills.id, order.statusPillId),
    )).for("share") : [];
    const [job] = await tx.select().from(invoiceEmailDeliveryJobs).where(owned).for("update");
    if (job?.status !== "processing" || job.claimedByWorkerId !== claim.claimedByWorkerId ||
        job.metadata.queueStage !== "preparing" || !job.claimExpiresAt || job.claimExpiresAt <= new Date()) return "canceled";
    const payload = validPayload(job);
    const current = statusNotificationRulesSchema.safeParse(pill?.notificationRules);
    const rule = payload.success && current.success ? current.data[payload.data.kind] : null;
    const eventMatches = order && order.statusNotificationEventId === job.statusEventId &&
      order.statusPillId === job.statusPillId;
    const [event] = eventMatches && job.statusEventId && job.statusPillId ? await tx.select({ id: orderStatusEvents.id })
      .from(orderStatusEvents).where(and(eq(orderStatusEvents.id, job.statusEventId),
        eq(orderStatusEvents.organizationId, claim.organizationId), eq(orderStatusEvents.orderId, order.id),
        eq(orderStatusEvents.toStatusPillId, job.statusPillId), eq(orderStatusEvents.notificationEvaluated, true))) : [];
    const sameRule = rule && payload.success && (await tx.execute(sql`
      select ${JSON.stringify(rule)}::jsonb = ${JSON.stringify(payload.data.rule ?? null)}::jsonb as matches
    `)).rows[0]?.matches === true;
    if (!event || !pill || !order || !payload.success || !rule?.enabled || !sameRule ||
        !allowed(pill, payload.data.kind) ||
        !(await recipients(tx, order, payload.data.kind, rule)).some(recipient =>
          recipient.id === payload.data.recipientId && recipient.address === job.recipientEmail)) {
      await tx.update(invoiceEmailDeliveryJobs).set({ status: "canceled", claimExpiresAt: null,
        failureReason: "Order, rule, or recipient is no longer eligible.", updatedAt: new Date() }).where(owned);
      return "canceled";
    }
    if (payload.data.kind === "customer_portal") {
      await tx.update(invoiceEmailDeliveryJobs).set({ status: "sent", sentAt: new Date(),
        failureReason: null, claimExpiresAt: null, updatedAt: new Date() }).where(owned);
      return "sent";
    }
    await tx.update(invoiceEmailDeliveryJobs).set({
      metadata: { ...job.metadata, queueStage: "provider_submitting", providerSubmissionStartedAt: new Date().toISOString() },
      updatedAt: new Date(),
    }).where(owned);
    return "send";
  });
}

export async function listPortalStatusNotifications(organizationId: string, customerId: string) {
  return db.select({ id: invoiceEmailDeliveryJobs.id, orderId: orders.id, sentAt: invoiceEmailDeliveryJobs.sentAt,
    label: sql<string>`${invoiceEmailDeliveryJobs.metadata}->>'subject'`,
    body: sql<string>`${invoiceEmailDeliveryJobs.metadata}->>'body'`,
  }).from(invoiceEmailDeliveryJobs).innerJoin(orders, and(
    eq(orders.organizationId, organizationId), eq(orders.id, invoiceEmailDeliveryJobs.statusOrderId),
    eq(orders.customerId, customerId),
  )).where(and(eq(invoiceEmailDeliveryJobs.organizationId, organizationId),
    eq(invoiceEmailDeliveryJobs.deliveryType, "order_status"), eq(invoiceEmailDeliveryJobs.status, "sent"),
    sql`${invoiceEmailDeliveryJobs.metadata}->>'kind' = 'customer_portal'`,
    sql`${invoiceEmailDeliveryJobs.metadata}->>'recipientId' = ${customerId}`,
  )).orderBy(sql`${invoiceEmailDeliveryJobs.sentAt} desc`).limit(8);
}
