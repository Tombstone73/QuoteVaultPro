import type { Request } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLogs, customerContactLinks, customerContacts, customerPortalAccess, customers, organizations, userOrganizations, users } from "@shared/schema";
import { getActivePortalContext, isPortalCustomerIdentity } from "./customerPortalAccessService";

function safeReturnTo(value: string | null | undefined, customerId: string): string {
  const fallback = `/customers/${encodeURIComponent(customerId)}`;
  const candidate = value?.trim() ?? "";
  return candidate === fallback || candidate.startsWith(`${fallback}?`) ? candidate : fallback;
}

async function saveRequestSession(req: Request): Promise<void> {
  await new Promise<void>((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
}

export const DEVELOPER_PORTAL_IMPERSONATION_TTL_MS = 15 * 60 * 1000;

export type DeveloperPortalImpersonation = {
  actorUserId: string;
  organizationId: string;
  customerId: string;
  accessId: string;
  targetUserId: string;
  roleAtStart: string;
  startedAt: string;
  expiresAt: string;
  returnTo: string;
};

declare module "express-session" {
  interface SessionData {
    developerPortalImpersonation?: DeveloperPortalImpersonation;
  }
}

export class DeveloperPortalImpersonationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function denied(code: string, message: string, status = 403): never {
  throw new DeveloperPortalImpersonationError(status, code, message);
}

export async function auditDeveloperPortalImpersonation(req: Request, marker: DeveloperPortalImpersonation, actionType: string, details: Record<string, unknown> = {}): Promise<void> {
  await db.insert(auditLogs).values({
    organizationId: marker.organizationId,
    userId: marker.actorUserId,
    actionType,
    entityType: "customer_portal_impersonation",
    entityId: marker.accessId,
    description: `Developer portal diagnostic ${actionType.toLowerCase().replaceAll("_", " ")}`,
    newValues: {
      customerId: marker.customerId,
      portalAccessId: marker.accessId,
      targetUserId: marker.targetUserId,
      startedAt: marker.startedAt,
      expiresAt: marker.expiresAt,
      ...details,
    },
    ipAddress: req.ip,
    userAgent: req.get?.("user-agent"),
  });
}

export async function activeDeveloperMembership(actorUserId: string, organizationId: string): Promise<boolean> {
  const [row] = await db.select({
    accountType: users.accountType,
    isPlatformDeveloper: users.isPlatformDeveloper,
    membershipActive: sql<boolean>`user_organizations.is_active`,
    deleteState: organizations.deleteState,
    isArchived: organizations.isArchived,
  }).from(users)
    .innerJoin(userOrganizations, and(eq(userOrganizations.userId, users.id), eq(userOrganizations.organizationId, organizationId)))
    .innerJoin(organizations, eq(organizations.id, userOrganizations.organizationId))
    .where(eq(users.id, actorUserId)).limit(1);
  return row?.accountType === "INTERNAL_USER" && row.isPlatformDeveloper === true && row.membershipActive === true && row.deleteState === "active" && row.isArchived === false;
}

export async function auditDeniedDeveloperPortalImpersonation(req: Request, reason: string): Promise<void> {
  const actorUserId = (req.user as { id?: string } | undefined)?.id;
  if (!actorUserId || !req.organizationId) return;
  await db.insert(auditLogs).values({
    organizationId: req.organizationId,
    userId: actorUserId,
    actionType: "DEVELOPER_PORTAL_IMPERSONATION_DENIED",
    entityType: "customer_portal_impersonation",
    description: "Developer portal diagnostic access denied",
    newValues: { reason },
    ipAddress: req.ip,
    userAgent: req.get?.("user-agent"),
  });
}

export async function resolveDeveloperPortalImpersonation(req: Request, marker: DeveloperPortalImpersonation) {
  const actor = req.user as { id?: string } | undefined;
  if (!actor?.id || actor.id !== marker.actorUserId || isPortalCustomerIdentity(actor)) denied("IMPERSONATION_ACTOR_DENIED", "Developer session is unavailable.");
  if (!Number.isFinite(Date.parse(marker.expiresAt)) || Date.parse(marker.expiresAt) <= Date.now()) denied("IMPERSONATION_EXPIRED", "Customer diagnostic session expired.");
  if (!await activeDeveloperMembership(marker.actorUserId, marker.organizationId)) denied("IMPERSONATION_ACTOR_DENIED", "Developer access is no longer available.");

  const [target] = await db.select({ access: customerPortalAccess, user: users, contact: customerContacts, link: customerContactLinks })
    .from(customerPortalAccess)
    .innerJoin(users, eq(users.id, customerPortalAccess.userId))
    .innerJoin(customerContacts, eq(customerContacts.id, customerPortalAccess.contactId))
    .innerJoin(customerContactLinks, and(
      eq(customerContactLinks.organizationId, customerPortalAccess.organizationId),
      eq(customerContactLinks.customerId, customerPortalAccess.customerId),
      eq(customerContactLinks.contactId, customerPortalAccess.contactId),
    ))
    .where(and(
      eq(customerPortalAccess.id, marker.accessId),
      eq(customerPortalAccess.organizationId, marker.organizationId),
      eq(customerPortalAccess.customerId, marker.customerId),
      eq(customerPortalAccess.userId, marker.targetUserId),
      eq(customerPortalAccess.status, "ACTIVE"),
      eq(customerContacts.organizationId, marker.organizationId),
      eq(customerContacts.status, "active"),
      eq(customerContactLinks.status, "active"),
    )).limit(1);
  if (!target || !isPortalCustomerIdentity(target.user)) denied("IMPERSONATION_TARGET_INACTIVE", "The selected customer login is no longer active.");
  const canonical = await getActivePortalContext(marker.targetUserId);
  if (!canonical || canonical.access.id !== marker.accessId || canonical.customer.id !== marker.customerId || canonical.customer.organizationId !== marker.organizationId) {
    denied("IMPERSONATION_TARGET_INACTIVE", "The selected customer login is no longer active.");
  }
  return { ...target, customer: canonical.customer, contactName: `${target.contact.firstName} ${target.contact.lastName}`.trim() || target.access.displayName || target.access.email };
}

export async function startDeveloperPortalImpersonation(req: Request, customerId: string, accessId: string, returnTo?: string | null) {
  const actor = req.user as { id?: string } | undefined;
  const organizationId = req.organizationId;
  if (!actor?.id || !organizationId || isPortalCustomerIdentity(actor)) denied("IMPERSONATION_ACTOR_DENIED", "Developer session is unavailable.");
  if (req.session.staffPortalPreview || req.session.developerPortalImpersonation) denied("IMPERSONATION_SESSION_CONFLICT", "Exit the current portal view before logging in as a customer.", 409);
  if (!await activeDeveloperMembership(actor.id, organizationId)) denied("IMPERSONATION_ACTOR_DENIED", "Developer access is required.");
  const marker: DeveloperPortalImpersonation = {
    actorUserId: actor.id, organizationId, customerId, accessId, targetUserId: "", roleAtStart: "",
    startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + DEVELOPER_PORTAL_IMPERSONATION_TTL_MS).toISOString(),
    returnTo: safeReturnTo(returnTo, customerId),
  };
  const [access] = await db.select({ userId: customerPortalAccess.userId, accessRole: customerPortalAccess.accessRole })
    .from(customerPortalAccess).innerJoin(customers, and(eq(customers.id, customerPortalAccess.customerId), eq(customers.organizationId, organizationId)))
    .where(and(eq(customerPortalAccess.id, accessId), eq(customerPortalAccess.customerId, customerId), eq(customerPortalAccess.organizationId, organizationId), eq(customerPortalAccess.status, "ACTIVE"))).limit(1);
  if (!access?.userId) denied("IMPERSONATION_TARGET_INACTIVE", "Select an active customer portal login.");
  marker.targetUserId = access.userId;
  marker.roleAtStart = access.accessRole;
  const target = await resolveDeveloperPortalImpersonation(req, marker);
  await auditDeveloperPortalImpersonation(req, marker, "DEVELOPER_PORTAL_IMPERSONATION_STARTED");
  req.session.developerPortalImpersonation = marker;
  await saveRequestSession(req);
  return { marker, target };
}

export async function endDeveloperPortalImpersonation(req: Request, reason: "ENDED" | "EXPIRED" | "REVOKED" = "ENDED") {
  const marker = req.session.developerPortalImpersonation;
  if (!marker) return null;
  delete req.session.developerPortalImpersonation;
  await saveRequestSession(req);
  await auditDeveloperPortalImpersonation(req, marker, `DEVELOPER_PORTAL_IMPERSONATION_${reason}`);
  return marker;
}
