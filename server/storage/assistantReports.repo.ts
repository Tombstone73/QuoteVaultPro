import { and, desc, eq, gt, isNull, max, sql } from "drizzle-orm";
import { db } from "../db";
import { aiReportShares, aiReportVersions, aiReports, aiReportViews } from "@shared/schema";
import { reportDefinitionSchema, type ReportDefinition } from "@shared/aiReportingContracts";

export type ReportAudience = "private" | "organization" | "shared_link" | "customer_safe";
export type ReportStatus = "draft" | "ready" | "archived" | "failed";
type JsonRecord = Record<string, unknown>;

const CUSTOMER_SAFE_SNAPSHOT_KEY = /(^id$|(^|_)(cost|margin|internal|admin|source|link|href|url|uuid|user|payment|credential|token|query)(_|$)|(^|_)[a-z]+id$)/i;

function isCustomerSafeSnapshotKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return CUSTOMER_SAFE_SNAPSHOT_KEY.test(key)
    || normalized === "id"
    || normalized.endsWith("id")
    || ["cost", "margin", "internal", "admin", "source", "link", "href", "url", "uuid", "user", "payment", "credential", "token", "query"].some((sensitive) => normalized.includes(sensitive));
}

/**
 * Customer-facing artifacts never retain internal identifiers, source links,
 * query metadata, or financially sensitive fields in their persisted snapshot.
 * The narrow allowlist is deliberately applied recursively because a report
 * dataset may contain nested chart rows as well as tabular rows.
 */
export function sanitizeCustomerSafeSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeCustomerSafeSnapshot);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as JsonRecord)
    .filter(([key]) => !isCustomerSafeSnapshotKey(key))
    .map(([key, nested]) => [key, sanitizeCustomerSafeSnapshot(nested)]));
}

function persistedSnapshot(definition: ReportDefinition, snapshot: JsonRecord): JsonRecord {
  return definition.audience === "customer_safe"
    ? asRecord(sanitizeCustomerSafeSnapshot(snapshot))
    : snapshot;
}

export interface AssistantReportRecord {
  id: string;
  organizationId: string;
  ownerUserId: string;
  conversationId: string | null;
  sourceTurnId: string | null;
  title: string;
  description: string | null;
  status: ReportStatus;
  reportType: string;
  audience: ReportAudience;
  definition: ReportDefinition;
  queryPlan: JsonRecord;
  dataSnapshot: JsonRecord;
  snapshotMetadata: JsonRecord;
  dataSnapshotAt: Date;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssistantReportVersionRecord {
  id: string;
  reportId: string;
  organizationId: string;
  versionNumber: number;
  definition: ReportDefinition;
  dataSnapshot: JsonRecord;
  createdByUserId: string | null;
  changeSummary: string | null;
  createdAt: Date;
}

export interface AssistantReportShareRecord {
  id: string;
  reportId: string;
  organizationId: string;
  tokenHash: string;
  audience: "shared_link" | "customer_safe";
  expiresAt: Date;
  revokedAt: Date | null;
  downloadAllowed: boolean;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface PublicSharedReportRecord {
  share: AssistantReportShareRecord;
  report: AssistantReportRecord;
}

export interface AssistantReportViewRecord {
  id: string;
  organizationId: string;
  reportId: string;
  shareId: string;
  viewedAt: Date;
  viewerHash: string | null;
}

export interface CreateAssistantReportInput {
  organizationId: string;
  ownerUserId: string;
  conversationId?: string | null;
  sourceTurnId?: string | null;
  title: string;
  description?: string | null;
  status?: ReportStatus;
  reportType?: string;
  audience?: ReportAudience;
  definition: ReportDefinition;
  queryPlan?: JsonRecord;
  dataSnapshot: JsonRecord;
  snapshotMetadata?: JsonRecord;
  dataSnapshotAt: Date;
}

export interface CreateAssistantReportVersionInput {
  organizationId: string;
  reportId: string;
  createdByUserId: string;
  definition: ReportDefinition;
  dataSnapshot: JsonRecord;
  changeSummary?: string | null;
  dataSnapshotAt: Date;
}

export interface CreateAssistantReportShareInput {
  organizationId: string;
  reportId: string;
  tokenHash: string;
  audience: "shared_link" | "customer_safe";
  expiresAt: Date;
  downloadAllowed: boolean;
  createdByUserId: string;
}

function reportAudience(value: string): ReportAudience {
  if (value === "private" || value === "organization" || value === "shared_link" || value === "customer_safe") return value;
  return "private";
}

function reportStatus(value: string): ReportStatus {
  if (value === "draft" || value === "ready" || value === "archived" || value === "failed") return value;
  return "failed";
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function toReport(row: typeof aiReports.$inferSelect): AssistantReportRecord {
  return {
    id: row.id, organizationId: row.organizationId, ownerUserId: row.ownerUserId,
    conversationId: row.conversationId, sourceTurnId: row.sourceTurnId, title: row.title,
    description: row.description, status: reportStatus(row.status), reportType: row.reportType,
    audience: reportAudience(row.audience), definition: reportDefinitionSchema.parse(row.definitionJson),
    queryPlan: asRecord(row.queryPlanJson), dataSnapshot: asRecord(row.dataSnapshotJson),
    snapshotMetadata: asRecord(row.snapshotMetadata), dataSnapshotAt: row.dataSnapshotAt,
    archivedAt: row.archivedAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function toVersion(row: typeof aiReportVersions.$inferSelect): AssistantReportVersionRecord {
  return {
    id: row.id, reportId: row.reportId, organizationId: row.organizationId,
    versionNumber: row.versionNumber, definition: reportDefinitionSchema.parse(row.definitionJson),
    dataSnapshot: asRecord(row.dataSnapshotJson), createdByUserId: row.createdByUserId,
    changeSummary: row.changeSummary, createdAt: row.createdAt,
  };
}

function toShare(row: typeof aiReportShares.$inferSelect): AssistantReportShareRecord {
  const audience = row.audience === "shared_link" ? "shared_link" : "customer_safe";
  return {
    id: row.id, reportId: row.reportId, organizationId: row.organizationId,
    tokenHash: row.tokenHash, audience, expiresAt: row.expiresAt, revokedAt: row.revokedAt,
    downloadAllowed: row.downloadAllowed, createdByUserId: row.createdByUserId, createdAt: row.createdAt,
  };
}

function toView(row: typeof aiReportViews.$inferSelect): AssistantReportViewRecord {
  return { id: row.id, organizationId: row.organizationId, reportId: row.reportId, shareId: row.shareId, viewedAt: row.viewedAt, viewerHash: row.viewerHash };
}

/**
 * Persistence for generated reporting artifacts. All lookup/update methods take
 * an organization id, including token resolution, so a share cannot bridge a
 * tenant boundary even if a foreign key were ever corrupted.
 */
export class AssistantReportsRepository {
  constructor(private readonly dbInstance = db) {}

  async create(input: CreateAssistantReportInput): Promise<AssistantReportRecord> {
    const definition = reportDefinitionSchema.parse(input.definition);
    const dataSnapshot = persistedSnapshot(definition, input.dataSnapshot);
    return this.dbInstance.transaction(async (tx) => {
      const [report] = await tx.insert(aiReports).values({
        organizationId: input.organizationId, ownerUserId: input.ownerUserId,
        conversationId: input.conversationId ?? null, sourceTurnId: input.sourceTurnId ?? null,
        title: input.title.trim(), description: input.description?.trim() || null,
        status: input.status ?? "ready", reportType: input.reportType?.trim() || "analytical",
        audience: input.audience ?? definition.audience, definitionJson: definition,
        queryPlanJson: input.queryPlan ?? {}, dataSnapshotJson: dataSnapshot,
        snapshotMetadata: input.snapshotMetadata ?? {}, dataSnapshotAt: input.dataSnapshotAt,
      }).returning();
      if (!report) throw new Error("Failed to create report.");
      await tx.insert(aiReportVersions).values({
        reportId: report.id, organizationId: input.organizationId, versionNumber: 1,
        definitionJson: definition, dataSnapshotJson: dataSnapshot,
        createdByUserId: input.ownerUserId, changeSummary: "Initial report",
      });
      return toReport(report);
    });
  }

  async get(organizationId: string, reportId: string): Promise<AssistantReportRecord | null> {
    const [row] = await this.dbInstance.select().from(aiReports)
      .where(and(eq(aiReports.organizationId, organizationId), eq(aiReports.id, reportId))).limit(1);
    return row ? toReport(row) : null;
  }

  async listForOwner(organizationId: string, ownerUserId: string, includeArchived = false): Promise<AssistantReportRecord[]> {
    const rows = await this.dbInstance.select().from(aiReports).where(and(
      eq(aiReports.organizationId, organizationId), eq(aiReports.ownerUserId, ownerUserId),
      ...(includeArchived ? [] : [isNull(aiReports.archivedAt)]),
    )).orderBy(desc(aiReports.updatedAt)).limit(100);
    return rows.map(toReport);
  }

  async updateMetadata(input: { organizationId: string; reportId: string; title?: string; description?: string | null; audience?: ReportAudience }): Promise<AssistantReportRecord | null> {
    const [row] = await this.dbInstance.update(aiReports).set({
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.audience !== undefined ? { audience: input.audience } : {}),
      updatedAt: new Date(),
    }).where(and(eq(aiReports.organizationId, input.organizationId), eq(aiReports.id, input.reportId))).returning();
    return row ? toReport(row) : null;
  }

  async archive(organizationId: string, reportId: string): Promise<AssistantReportRecord | null> {
    const now = new Date();
    const [row] = await this.dbInstance.update(aiReports).set({ status: "archived", archivedAt: now, updatedAt: now })
      .where(and(eq(aiReports.organizationId, organizationId), eq(aiReports.id, reportId))).returning();
    return row ? toReport(row) : null;
  }

  /** Versions are append-only; the current report is updated only after its immutable version is inserted. */
  async createVersion(input: CreateAssistantReportVersionInput): Promise<AssistantReportVersionRecord | null> {
    const definition = reportDefinitionSchema.parse(input.definition);
    const dataSnapshot = persistedSnapshot(definition, input.dataSnapshot);
    return this.dbInstance.transaction(async (tx) => {
      const [report] = await tx.select({ id: aiReports.id }).from(aiReports).where(and(
        eq(aiReports.organizationId, input.organizationId), eq(aiReports.id, input.reportId), isNull(aiReports.archivedAt),
      )).limit(1);
      if (!report) return null;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${report.id}))`);
      const [latest] = await tx.select({ versionNumber: max(aiReportVersions.versionNumber) }).from(aiReportVersions)
        .where(and(eq(aiReportVersions.organizationId, input.organizationId), eq(aiReportVersions.reportId, report.id)));
      const versionNumber = Number(latest?.versionNumber ?? 0) + 1;
      const [version] = await tx.insert(aiReportVersions).values({
        reportId: report.id, organizationId: input.organizationId, versionNumber,
        definitionJson: definition, dataSnapshotJson: dataSnapshot,
        createdByUserId: input.createdByUserId, changeSummary: input.changeSummary?.trim() || null,
      }).returning();
      if (!version) throw new Error("Failed to create report version.");
      await tx.update(aiReports).set({
        title: definition.title, description: definition.description ?? null, audience: definition.audience,
        definitionJson: definition, dataSnapshotJson: dataSnapshot,
        dataSnapshotAt: input.dataSnapshotAt, updatedAt: new Date(),
      }).where(and(eq(aiReports.organizationId, input.organizationId), eq(aiReports.id, report.id)));
      return toVersion(version);
    });
  }

  async createShare(input: CreateAssistantReportShareInput): Promise<AssistantReportShareRecord | null> {
    const [report] = await this.dbInstance.select({ id: aiReports.id, archivedAt: aiReports.archivedAt })
      .from(aiReports).where(and(eq(aiReports.organizationId, input.organizationId), eq(aiReports.id, input.reportId))).limit(1);
    if (!report || report.archivedAt) return null;
    const [share] = await this.dbInstance.insert(aiReportShares).values(input).returning();
    return share ? toShare(share) : null;
  }

  async revokeShare(organizationId: string, reportId: string, shareId: string, now = new Date()): Promise<boolean> {
    const rows = await this.dbInstance.update(aiReportShares).set({ revokedAt: now }).where(and(
      eq(aiReportShares.organizationId, organizationId), eq(aiReportShares.reportId, reportId),
      eq(aiReportShares.id, shareId), isNull(aiReportShares.revokedAt),
    )).returning({ id: aiReportShares.id });
    return rows.length === 1;
  }

  async resolveActiveShare(tokenHash: string, now = new Date()): Promise<PublicSharedReportRecord | null> {
    const [row] = await this.dbInstance.select({ share: aiReportShares, report: aiReports }).from(aiReportShares)
      .innerJoin(aiReports, and(eq(aiReports.id, aiReportShares.reportId), eq(aiReports.organizationId, aiReportShares.organizationId)))
      .where(and(eq(aiReportShares.tokenHash, tokenHash), isNull(aiReportShares.revokedAt), gt(aiReportShares.expiresAt, now),
        eq(aiReports.status, "ready"), isNull(aiReports.archivedAt))).limit(1);
    return row ? { share: toShare(row.share), report: toReport(row.report) } : null;
  }

  async recordShareView(input: { organizationId: string; reportId: string; shareId: string; viewerHash?: string | null; viewedAt?: Date }): Promise<AssistantReportViewRecord> {
    const [view] = await this.dbInstance.insert(aiReportViews).values({
      organizationId: input.organizationId, reportId: input.reportId, shareId: input.shareId,
      viewerHash: input.viewerHash ?? null, viewedAt: input.viewedAt ?? new Date(),
    }).returning();
    if (!view) throw new Error("Failed to record report share view.");
    return toView(view);
  }
}

export const assistantReportsRepository = new AssistantReportsRepository();
