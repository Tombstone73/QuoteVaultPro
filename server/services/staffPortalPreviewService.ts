import type { Request } from "express";
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { auditLogs, customers } from "@shared/schema";
import { isPortalCustomerIdentity } from "./customerPortalAccessService";

export const STAFF_PORTAL_PREVIEW_TTL_MS = 30 * 60 * 1000;

export type StaffPortalPreviewSessionState = "ACTIVE";

export type StaffPortalPreviewSession = {
  state: StaffPortalPreviewSessionState;
  actorUserId: string;
  organizationId: string;
  customerId: string;
  customerName: string;
  startedAt: string;
  expiresAt: string;
  returnTo: string;
};

export type StaffPortalPreviewCustomer = Pick<
  typeof customers.$inferSelect,
  "id" | "organizationId" | "companyName" | "email"
>;

declare module "express-session" {
  interface SessionData {
    staffPortalPreview?: StaffPortalPreviewSession;
  }
}

export function canStartStaffPortalPreview(user: unknown): boolean {
  const candidate = user as { id?: string } | null | undefined;
  return Boolean(candidate?.id) && !isPortalCustomerIdentity(user);
}

export function isStaffPortalPreviewExpired(
  preview: StaffPortalPreviewSession | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!preview || preview.state !== "ACTIVE") return true;
  const expiresAt = new Date(preview.expiresAt).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
}

export function isCustomerInPreviewOrganization(
  customer: Pick<StaffPortalPreviewCustomer, "organizationId"> | null | undefined,
  organizationId: string,
): boolean {
  return Boolean(customer?.organizationId && customer.organizationId === organizationId);
}

export function isStaffPortalPreviewReadMethod(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized === "GET" || normalized === "HEAD";
}

export function sanitizeStaffPortalPreviewReturnTo(value: unknown, customerId: string): string {
  const fallback = `/customers/${encodeURIComponent(customerId)}`;
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return fallback;
  if (candidate.startsWith("/portal")) return fallback;
  return candidate;
}

export function buildStaffPortalPreviewSession(input: {
  actorUserId: string;
  organizationId: string;
  customerId: string;
  customerName: string;
  returnTo?: string | null;
  now?: Date;
}): StaffPortalPreviewSession {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + STAFF_PORTAL_PREVIEW_TTL_MS);

  return {
    state: "ACTIVE",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    customerId: input.customerId,
    customerName: input.customerName,
    startedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    returnTo: sanitizeStaffPortalPreviewReturnTo(input.returnTo, input.customerId),
  };
}

export async function loadCustomerForStaffPortalPreview(
  organizationId: string,
  customerId: string,
): Promise<StaffPortalPreviewCustomer | null> {
  const [customer] = await db
    .select({
      id: customers.id,
      organizationId: customers.organizationId,
      companyName: customers.companyName,
      email: customers.email,
    })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId)))
    .limit(1);

  return customer ?? null;
}

export async function writeStaffPortalPreviewAudit(input: {
  req?: Request;
  actionType: "STAFF_PORTAL_PREVIEW_STARTED" | "STAFF_PORTAL_PREVIEW_ENDED" | "STAFF_PORTAL_PREVIEW_EXPIRED";
  actorUserId: string;
  organizationId: string;
  customerId: string;
  customerName: string;
  startedAt?: string;
  expiresAt?: string;
}): Promise<void> {
  const actor = input.req?.user as any;
  const userName = `${actor?.firstName || ""} ${actor?.lastName || ""}`.trim() || actor?.email || null;

  await db.insert(auditLogs).values({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    userName,
    actionType: input.actionType,
    entityType: "staff_portal_preview_session",
    entityId: input.customerId,
    entityName: input.customerName,
    description: `Staff portal preview ${input.actionType.replace("STAFF_PORTAL_PREVIEW_", "").toLowerCase()} for ${input.customerName}`,
    newValues: {
      customerId: input.customerId,
      startedAt: input.startedAt ?? null,
      expiresAt: input.expiresAt ?? null,
    },
    ipAddress: input.req?.ip,
    userAgent: input.req?.get?.("user-agent"),
  });
}

export async function saveRequestSession(req: Request): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function startStaffPortalPreview(input: {
  req: Request;
  actorUserId: string;
  organizationId: string;
  customerId: string;
  returnTo?: string | null;
}): Promise<StaffPortalPreviewSession> {
  const customer = await loadCustomerForStaffPortalPreview(input.organizationId, input.customerId);
  if (!customer || !isCustomerInPreviewOrganization(customer, input.organizationId)) {
    throw Object.assign(new Error("Customer is not available in the active organization"), {
      status: 403,
      code: "STAFF_PORTAL_PREVIEW_CUSTOMER_SCOPE_DENIED",
    });
  }

  const preview = buildStaffPortalPreviewSession({
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    customerId: customer.id,
    customerName: customer.companyName,
    returnTo: input.returnTo,
  });

  input.req.session.staffPortalPreview = preview;
  await writeStaffPortalPreviewAudit({
    req: input.req,
    actionType: "STAFF_PORTAL_PREVIEW_STARTED",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    customerId: customer.id,
    customerName: customer.companyName,
    startedAt: preview.startedAt,
    expiresAt: preview.expiresAt,
  });
  await saveRequestSession(input.req);

  return preview;
}

export async function endStaffPortalPreview(
  req: Request,
  actionType: "STAFF_PORTAL_PREVIEW_ENDED" | "STAFF_PORTAL_PREVIEW_EXPIRED" = "STAFF_PORTAL_PREVIEW_ENDED",
): Promise<StaffPortalPreviewSession | null> {
  const preview = req.session.staffPortalPreview ?? null;
  if (!preview) return null;

  delete req.session.staffPortalPreview;
  await writeStaffPortalPreviewAudit({
    req,
    actionType,
    actorUserId: preview.actorUserId,
    organizationId: preview.organizationId,
    customerId: preview.customerId,
    customerName: preview.customerName,
    startedAt: preview.startedAt,
    expiresAt: preview.expiresAt,
  });
  await saveRequestSession(req);

  return preview;
}

export async function resolveActiveStaffPortalPreview(req: Request): Promise<{
  preview: StaffPortalPreviewSession;
  customer: StaffPortalPreviewCustomer;
} | null> {
  const user = req.user as any;
  const preview = req.session.staffPortalPreview;

  if (!preview) return null;
  if (!canStartStaffPortalPreview(user) || preview.actorUserId !== user.id) {
    await endStaffPortalPreview(req, "STAFF_PORTAL_PREVIEW_ENDED");
    return null;
  }

  if (isStaffPortalPreviewExpired(preview)) {
    await endStaffPortalPreview(req, "STAFF_PORTAL_PREVIEW_EXPIRED");
    throw Object.assign(new Error("Staff portal preview has expired"), {
      status: 403,
      code: "STAFF_PORTAL_PREVIEW_EXPIRED",
    });
  }

  const customer = await loadCustomerForStaffPortalPreview(preview.organizationId, preview.customerId);
  if (!customer) {
    await endStaffPortalPreview(req, "STAFF_PORTAL_PREVIEW_ENDED");
    throw Object.assign(new Error("Staff portal preview customer is no longer available"), {
      status: 403,
      code: "STAFF_PORTAL_PREVIEW_CUSTOMER_SCOPE_DENIED",
    });
  }

  return { preview, customer };
}
