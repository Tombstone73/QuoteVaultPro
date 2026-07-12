import { and, eq, ne } from "drizzle-orm";
import { db } from "../db";
import { organizations } from "@shared/schema";
import { slugify } from "./orgOnboardingService";

const RESERVED_ORGANIZATION_SLUGS = new Set([
  "api",
  "admin",
  "app",
  "assets",
  "auth",
  "dashboard",
  "developer",
  "login",
  "logout",
  "platform",
  "settings",
  "static",
  "www",
]);

export class OrganizationEditorError extends Error {
  statusCode: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(message: string, code: string, statusCode = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = "OrganizationEditorError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const updateOrganizationBodyShape = {
  name: "optional trimmed non-empty string",
  slug: "optional lowercase url-safe string",
  isArchived: "optional boolean",
} as const;

export interface UpdateOrganizationInput {
  organizationId: string;
  actorUserId: string;
  name?: string;
  slug?: string;
  isArchived?: boolean;
}

export interface EditableOrganization {
  id: string;
  name: string;
  slug: string;
  status: string;
  deleteState: string;
  isArchived: boolean;
  archivedAt: Date | null;
  archivedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationUpdateResult {
  previous: EditableOrganization;
  organization: EditableOrganization;
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new OrganizationEditorError("Organization name is required.", "ORG_NAME_REQUIRED", 400);
  }
  if (trimmed.length > 255) {
    throw new OrganizationEditorError("Organization name must be 255 characters or less.", "ORG_NAME_TOO_LONG", 400);
  }
  return trimmed;
}

export function normalizeEditableOrganizationSlug(rawSlug: string, fallbackName?: string): string {
  const trimmed = rawSlug.trim();
  const normalized = trimmed ? trimmed.toLowerCase() : slugify(fallbackName ?? "");
  if (!normalized) {
    throw new OrganizationEditorError("Organization slug is required.", "ORG_SLUG_REQUIRED", 400);
  }
  if (normalized.length > 100) {
    throw new OrganizationEditorError("Organization slug must be 100 characters or less.", "ORG_SLUG_TOO_LONG", 400);
  }
  if (!/^[a-z0-9-]+$/.test(normalized)) {
    throw new OrganizationEditorError("Slug must use lowercase letters, numbers, and hyphens only.", "ORG_SLUG_INVALID", 400);
  }
  if (RESERVED_ORGANIZATION_SLUGS.has(normalized)) {
    throw new OrganizationEditorError("That slug is reserved.", "ORG_SLUG_RESERVED", 400, { slug: normalized });
  }
  return normalized;
}

export async function getEditableOrganizations(): Promise<EditableOrganization[]> {
  return await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      status: organizations.status,
      deleteState: organizations.deleteState,
      isArchived: organizations.isArchived,
      archivedAt: organizations.archivedAt,
      archivedByUserId: organizations.archivedByUserId,
      createdAt: organizations.createdAt,
      updatedAt: organizations.updatedAt,
    })
    .from(organizations)
    .orderBy(organizations.name);
}

export async function updateOrganizationForPlatform(input: UpdateOrganizationInput): Promise<OrganizationUpdateResult> {
  const [previous] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      status: organizations.status,
      deleteState: organizations.deleteState,
      isArchived: organizations.isArchived,
      archivedAt: organizations.archivedAt,
      archivedByUserId: organizations.archivedByUserId,
      createdAt: organizations.createdAt,
      updatedAt: organizations.updatedAt,
    })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);

  if (!previous) {
    throw new OrganizationEditorError("Organization not found.", "ORG_NOT_FOUND", 404);
  }

  const updateValues: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) {
    updateValues.name = normalizeName(input.name);
  }

  if (input.slug !== undefined) {
    const normalizedSlug = normalizeEditableOrganizationSlug(input.slug, String(updateValues.name ?? previous.name));
    const [conflict] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.slug, normalizedSlug), ne(organizations.id, input.organizationId)))
      .limit(1);
    if (conflict) {
      throw new OrganizationEditorError("Another organization already uses that slug.", "ORG_SLUG_CONFLICT", 409, {
        slug: normalizedSlug,
      });
    }
    updateValues.slug = normalizedSlug;
  }

  if (input.isArchived !== undefined && input.isArchived !== previous.isArchived) {
    updateValues.isArchived = input.isArchived;
    updateValues.archivedAt = input.isArchived ? new Date() : null;
    updateValues.archivedByUserId = input.isArchived ? input.actorUserId : null;
  }

  const [organization] = await db
    .update(organizations)
    .set(updateValues)
    .where(eq(organizations.id, input.organizationId))
    .returning({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      status: organizations.status,
      deleteState: organizations.deleteState,
      isArchived: organizations.isArchived,
      archivedAt: organizations.archivedAt,
      archivedByUserId: organizations.archivedByUserId,
      createdAt: organizations.createdAt,
      updatedAt: organizations.updatedAt,
    });

  if (!organization) {
    throw new OrganizationEditorError("Organization update failed.", "ORG_UPDATE_FAILED", 500);
  }

  return { previous, organization };
}
