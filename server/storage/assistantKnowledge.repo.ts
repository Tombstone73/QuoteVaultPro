import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { aiKnowledgeChunks, aiKnowledgeDocuments, aiKnowledgeFeedback, aiKnowledgeSyncRuns } from "@shared/schema";
import { knowledgeSearchRequestSchema, type KnowledgeSearchRequest, type KnowledgeSearchResult } from "@shared/aiKnowledgeContracts";
import { chunkKnowledgeDocument, discoverKnowledgeDocuments, type ParsedKnowledgeDocument } from "../services/assistant/knowledgeCorpus";

const CURATED_SOURCE_TYPE = "curated_markdown";

export interface KnowledgeDocumentRecord {
  id: string;
  organizationId: string | null;
  slug: string;
  title: string;
  category: string;
  summary: string | null;
  sourceType: string;
  sourcePath: string | null;
  sourceVersion: string;
  content: string;
  status: string;
  audience: string;
  permissionTags: string[];
  routePatterns: string[];
  entityTypes: string[];
  featureTags: string[];
  indexedAt: Date | null;
  deprecatedAt: Date | null;
  updatedAt: Date;
}

export interface KnowledgeSyncSummary {
  discovered: number;
  created: number;
  updated: number;
  deprecated: number;
  chunksWritten: number;
  dryRun: boolean;
}

export interface KnowledgeDocumentListFilter {
  organizationId: string;
  category?: string;
  status?: "draft" | "active" | "deprecated" | "inactive";
  scope?: "global" | "organization" | "all";
  limit?: number;
}

function toDocument(row: typeof aiKnowledgeDocuments.$inferSelect): KnowledgeDocumentRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    slug: row.slug,
    title: row.title,
    category: row.category,
    summary: row.summary,
    sourceType: row.sourceType,
    sourcePath: row.sourcePath,
    sourceVersion: row.sourceVersion,
    content: row.content,
    status: row.status,
    audience: row.audience,
    permissionTags: row.permissionTags,
    routePatterns: row.routePatterns,
    entityTypes: row.entityTypes,
    featureTags: row.featureTags,
    indexedAt: row.indexedAt,
    deprecatedAt: row.deprecatedAt,
    updatedAt: row.updatedAt,
  };
}

function matchesContext(document: Pick<KnowledgeDocumentRecord, "routePatterns" | "entityTypes" | "featureTags" | "permissionTags">, input: KnowledgeSearchRequest): boolean {
  if (input.route && document.routePatterns.length && !document.routePatterns.some((pattern) => input.route!.startsWith(pattern.replace(/\*$/, "")))) return false;
  if (input.entityType && document.entityTypes.length && !document.entityTypes.includes(input.entityType)) return false;
  if (input.featureTag && document.featureTags.length && !document.featureTags.includes(input.featureTag)) return false;
  if (input.permissionTags?.length && document.permissionTags.length && !input.permissionTags.some((tag) => document.permissionTags.includes(tag))) return false;
  return true;
}

/**
 * Tenant-safe access point for System Guide retrieval. The nullable document
 * scope is deliberately handled as `(global OR exact organization)`, never a
 * broad query followed by client-side filtering.
 */
export class DrizzleAssistantKnowledgeRepository {
  constructor(private readonly dbInstance = db) {}

  async getDocument(organizationId: string, documentId: string): Promise<KnowledgeDocumentRecord | null> {
    const [row] = await this.dbInstance.select().from(aiKnowledgeDocuments).where(and(
      eq(aiKnowledgeDocuments.id, documentId),
      or(isNull(aiKnowledgeDocuments.organizationId), eq(aiKnowledgeDocuments.organizationId, organizationId)),
    )).limit(1);
    return row ? toDocument(row) : null;
  }

  /** Owner/admin callers can enumerate only their supplemental documents and
   * globally curated documentation. This method intentionally has no
   * unscoped/list-all variant. */
  async listDocuments(input: KnowledgeDocumentListFilter): Promise<KnowledgeDocumentRecord[]> {
    const scope = input.scope === "global"
      ? isNull(aiKnowledgeDocuments.organizationId)
      : input.scope === "organization"
        ? eq(aiKnowledgeDocuments.organizationId, input.organizationId)
        : or(isNull(aiKnowledgeDocuments.organizationId), eq(aiKnowledgeDocuments.organizationId, input.organizationId));
    const rows = await this.dbInstance.select().from(aiKnowledgeDocuments).where(and(
      scope,
      ...(input.category ? [eq(aiKnowledgeDocuments.category, input.category)] : []),
      ...(input.status ? [eq(aiKnowledgeDocuments.status, input.status)] : []),
    )).orderBy(desc(aiKnowledgeDocuments.updatedAt)).limit(Math.min(Math.max(input.limit ?? 100, 1), 250));
    return rows.map(toDocument);
  }

  async search(rawInput: KnowledgeSearchRequest): Promise<KnowledgeSearchResult[]> {
    const input = knowledgeSearchRequestSchema.parse(rawInput);
    const rows = await this.dbInstance.select({
      document: aiKnowledgeDocuments,
      chunk: aiKnowledgeChunks,
      score: sql<number>`ts_rank_cd(${sql.raw("ai_knowledge_chunks.search_vector")}, websearch_to_tsquery('english', ${input.query}))`,
    }).from(aiKnowledgeChunks)
      .innerJoin(aiKnowledgeDocuments, eq(aiKnowledgeChunks.documentId, aiKnowledgeDocuments.id))
      .where(and(
        eq(aiKnowledgeDocuments.status, "active"),
        or(isNull(aiKnowledgeDocuments.organizationId), eq(aiKnowledgeDocuments.organizationId, input.organizationId)),
        ...(input.category ? [eq(aiKnowledgeDocuments.category, input.category)] : []),
        sql`${sql.raw("ai_knowledge_chunks.search_vector")} @@ websearch_to_tsquery('english', ${input.query})`,
      ))
      .orderBy(desc(sql`ts_rank_cd(${sql.raw("ai_knowledge_chunks.search_vector")}, websearch_to_tsquery('english', ${input.query}))`))
      .limit(Math.min(input.limit * 4, 48));

    return rows.filter(({ document }) => matchesContext(toDocument(document), input)).slice(0, input.limit).map(({ document, chunk, score }) => ({
      documentId: document.id,
      title: document.title,
      category: document.category,
      excerpt: chunk.content.slice(0, 900),
      sourceType: document.sourceType,
      sourcePath: document.sourcePath,
      sourceVersion: document.sourceVersion,
      status: document.status as KnowledgeSearchResult["status"],
      tenantScope: document.organizationId ? "organization" : "global",
      score: Number(score ?? 0),
      deprecatedWarning: document.deprecatedAt !== null,
    }));
  }

  async recordFeedback(input: { organizationId: string; userId?: string | null; conversationId?: string | null; documentIds: string[]; questionCategory?: string | null; feedbackType: "helpful" | "not_helpful" | "outdated" | "incorrect"; comment?: string | null }): Promise<void> {
    // Only allow source IDs visible to this organization. This prevents a
    // feedback payload from becoming a cross-tenant document-ID oracle.
    if (input.documentIds.length) {
      const visible = await this.dbInstance.select({ id: aiKnowledgeDocuments.id }).from(aiKnowledgeDocuments).where(and(
        inArray(aiKnowledgeDocuments.id, input.documentIds),
        or(isNull(aiKnowledgeDocuments.organizationId), eq(aiKnowledgeDocuments.organizationId, input.organizationId)),
      ));
      if (visible.length !== new Set(input.documentIds).size) throw new Error("One or more knowledge documents are not visible to this organization");
    }
    await this.dbInstance.insert(aiKnowledgeFeedback).values(input);
  }

  async status(organizationId?: string): Promise<{ documents: number; active: number; chunks: number; lastSyncAt: Date | null }> {
    const scope = organizationId
      ? or(isNull(aiKnowledgeDocuments.organizationId), eq(aiKnowledgeDocuments.organizationId, organizationId))
      : isNull(aiKnowledgeDocuments.organizationId);
    const [counts] = await this.dbInstance.select({
      documents: sql<number>`count(distinct ${aiKnowledgeDocuments.id})`,
      active: sql<number>`count(distinct ${aiKnowledgeDocuments.id}) filter (where ${aiKnowledgeDocuments.status} = 'active')`,
      chunks: sql<number>`count(${aiKnowledgeChunks.id})`,
    }).from(aiKnowledgeDocuments).leftJoin(aiKnowledgeChunks, eq(aiKnowledgeChunks.documentId, aiKnowledgeDocuments.id)).where(scope);
    const [sync] = await this.dbInstance.select({ completedAt: aiKnowledgeSyncRuns.completedAt }).from(aiKnowledgeSyncRuns)
      .where(and(isNull(aiKnowledgeSyncRuns.organizationId), eq(aiKnowledgeSyncRuns.sourceType, CURATED_SOURCE_TYPE), eq(aiKnowledgeSyncRuns.status, "succeeded")))
      .orderBy(desc(aiKnowledgeSyncRuns.completedAt)).limit(1);
    return { documents: Number(counts?.documents ?? 0), active: Number(counts?.active ?? 0), chunks: Number(counts?.chunks ?? 0), lastSyncAt: sync?.completedAt ?? null };
  }

  /** Idempotently synchronize only checked-in docs/knowledge Markdown. */
  async syncCuratedCorpus(rootDir: string, options: { dryRun?: boolean; actorUserId?: string | null } = {}): Promise<KnowledgeSyncSummary> {
    const dryRun = options.dryRun ?? false;
    const documents = await discoverKnowledgeDocuments(rootDir);
    const chunksByPath = new Map(documents.map((document) => [document.sourcePath, chunkKnowledgeDocument(document)]));
    const summary: KnowledgeSyncSummary = { discovered: documents.length, created: 0, updated: 0, deprecated: 0, chunksWritten: 0, dryRun };
    if (dryRun) return this.previewSync(documents, chunksByPath, summary);

    const [run] = await this.dbInstance.insert(aiKnowledgeSyncRuns).values({ sourceType: CURATED_SOURCE_TYPE, status: "running", actorUserId: options.actorUserId ?? null, dryRun: false, documentsDiscovered: documents.length }).returning();
    try {
      await this.dbInstance.transaction(async (tx) => {
        const existing = await tx.select().from(aiKnowledgeDocuments).where(and(isNull(aiKnowledgeDocuments.organizationId), eq(aiKnowledgeDocuments.sourceType, CURATED_SOURCE_TYPE)));
        const currentByPathAndVersion = new Map(existing.map((row) => [`${row.sourcePath ?? ""}\u0000${row.sourceVersion}`, row]));
        const seenPaths = new Set(documents.map((document) => document.sourcePath));
        const now = new Date();
        for (const document of documents) {
          const existingDocument = currentByPathAndVersion.get(`${document.sourcePath}\u0000${document.metadata.version}`);
          const chunks = chunksByPath.get(document.sourcePath) ?? [];
          if (existingDocument?.contentHash === document.contentHash && existingDocument.sourceVersion === document.metadata.version && existingDocument.status === document.metadata.status) continue;
          const values = documentValues(document, now);
          let documentId: string;
          if (existingDocument) {
            const [updated] = await tx.update(aiKnowledgeDocuments).set(values).where(eq(aiKnowledgeDocuments.id, existingDocument.id)).returning();
            documentId = updated.id;
            summary.updated++;
            await tx.delete(aiKnowledgeChunks).where(eq(aiKnowledgeChunks.documentId, documentId));
          } else {
            const [created] = await tx.insert(aiKnowledgeDocuments).values(values).returning();
            documentId = created.id;
            summary.created++;
            // Retain an older source version for provenance, but do not let it
            // compete with the current article in normal retrieval.
            const priorActiveIds = existing.filter((row) => row.sourcePath === document.sourcePath && row.sourceVersion !== document.metadata.version && row.status === "active").map((row) => row.id);
            if (priorActiveIds.length) {
              await tx.update(aiKnowledgeDocuments).set({ status: "deprecated", deprecatedAt: now, updatedAt: now }).where(inArray(aiKnowledgeDocuments.id, priorActiveIds));
              summary.deprecated += priorActiveIds.length;
            }
          }
          if (chunks.length) await tx.insert(aiKnowledgeChunks).values(chunks.map((chunk) => ({ documentId, ...chunk })));
          summary.chunksWritten += chunks.length;
        }
        const missing = existing.filter((document) => document.sourcePath && !seenPaths.has(document.sourcePath) && document.status === "active");
        if (missing.length) {
          await tx.update(aiKnowledgeDocuments).set({ status: "deprecated", deprecatedAt: now, updatedAt: now }).where(inArray(aiKnowledgeDocuments.id, missing.map((document) => document.id)));
          summary.deprecated += missing.length;
        }
      });
      await this.dbInstance.update(aiKnowledgeSyncRuns).set({ status: "succeeded", completedAt: new Date(), documentsCreated: summary.created, documentsUpdated: summary.updated, documentsDeprecated: summary.deprecated, chunksWritten: summary.chunksWritten }).where(eq(aiKnowledgeSyncRuns.id, run.id));
      return summary;
    } catch (error) {
      await this.dbInstance.update(aiKnowledgeSyncRuns).set({ status: "failed", completedAt: new Date(), errorSummary: error instanceof Error ? error.message.slice(0, 1000) : "Unknown knowledge sync error" }).where(eq(aiKnowledgeSyncRuns.id, run.id));
      throw error;
    }
  }

  private async previewSync(documents: ParsedKnowledgeDocument[], chunksByPath: Map<string, ReturnType<typeof chunkKnowledgeDocument>>, summary: KnowledgeSyncSummary): Promise<KnowledgeSyncSummary> {
    const existing = await this.dbInstance.select().from(aiKnowledgeDocuments).where(and(isNull(aiKnowledgeDocuments.organizationId), eq(aiKnowledgeDocuments.sourceType, CURATED_SOURCE_TYPE)));
    const currentByPathAndVersion = new Map(existing.map((row) => [`${row.sourcePath ?? ""}\u0000${row.sourceVersion}`, row]));
    const seenPaths = new Set(documents.map((document) => document.sourcePath));
    for (const document of documents) {
      const current = currentByPathAndVersion.get(`${document.sourcePath}\u0000${document.metadata.version}`);
      if (!current) summary.created++;
      else if (current.contentHash !== document.contentHash || current.sourceVersion !== document.metadata.version || current.status !== document.metadata.status) summary.updated++;
      if (!current || current.contentHash !== document.contentHash || current.sourceVersion !== document.metadata.version || current.status !== document.metadata.status) summary.chunksWritten += (chunksByPath.get(document.sourcePath) ?? []).length;
    }
    summary.deprecated = existing.filter((document) => document.sourcePath && !seenPaths.has(document.sourcePath) && document.status === "active").length
      + documents.reduce((count, document) => count + existing.filter((row) => row.sourcePath === document.sourcePath && row.sourceVersion !== document.metadata.version && row.status === "active").length, 0);
    return summary;
  }
}

function documentValues(document: ParsedKnowledgeDocument, now: Date) {
  return {
    organizationId: null,
    slug: document.metadata.slug,
    title: document.metadata.title,
    category: document.metadata.category,
    summary: document.metadata.summary ?? null,
    sourceType: CURATED_SOURCE_TYPE,
    sourcePath: document.sourcePath,
    sourceVersion: document.metadata.version,
    contentHash: document.contentHash,
    content: document.content,
    status: document.metadata.status,
    audience: document.metadata.audience,
    permissionTags: document.metadata.permission_tags,
    routePatterns: document.metadata.route_patterns,
    entityTypes: document.metadata.entity_types,
    featureTags: document.metadata.feature_tags,
    effectiveFrom: document.metadata.effective_from ? new Date(document.metadata.effective_from) : null,
    deprecatedAt: document.metadata.status === "deprecated" ? now : null,
    indexedAt: now,
    updatedAt: now,
  };
}
