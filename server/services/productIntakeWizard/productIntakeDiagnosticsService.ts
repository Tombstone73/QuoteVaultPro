import { and, desc, eq, isNull } from "drizzle-orm";
import {
  productIntakeAiDiagnostics,
  type ProductIntakeAiDiagnosticRow,
} from "@shared/schema";
import {
  productIntakeAiDiagnosticSchema,
  type ProductIntakeAiDiagnostic,
  type ProductIntakeAiDiagnosticIssue,
  type ProductIntakeSourceType,
} from "@shared/productIntakeWizardSchemas";
import { db as defaultDb } from "../../db";

export type ProductIntakeAiDiagnosticInput = {
  organizationId: string;
  sessionId?: string | null;
  sourceType: ProductIntakeSourceType;
  sourceFingerprint?: string | null;
  provider: string | null;
  model: string | null;
  rawAiResponse: string;
  validationErrors: ProductIntakeAiDiagnosticIssue[];
  failedSchemaPaths: string[];
  repairActions?: string[];
  promptVersion: string | null;
  createdByUserId: string | null;
};

export interface ProductIntakeAiDiagnosticsStore {
  recordSchemaValidationFailure(input: ProductIntakeAiDiagnosticInput): Promise<void>;
  attachRecentToSession(args: { organizationId: string; sessionId: string; sourceFingerprint: string | null }): Promise<void>;
  listRecent(organizationId: string, filters?: { sessionId?: string | null }): Promise<ProductIntakeAiDiagnostic[]>;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date().toISOString();
}

function mapDiagnostic(row: ProductIntakeAiDiagnosticRow): ProductIntakeAiDiagnostic {
  return productIntakeAiDiagnosticSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    sessionId: row.sessionId ?? null,
    sourceType: row.sourceType,
    sourceFingerprint: row.sourceFingerprint ?? null,
    provider: row.provider,
    model: row.model,
    rawAiResponse: row.rawAiResponse,
    validationErrors: Array.isArray(row.validationErrors) ? row.validationErrors : [],
    failedSchemaPaths: Array.isArray(row.failedSchemaPaths) ? row.failedSchemaPaths : [],
    repairActions: Array.isArray(row.repairActions) ? row.repairActions : [],
    promptVersion: row.promptVersion,
    createdByUserId: row.createdByUserId,
    createdAt: toIso(row.createdAt),
  });
}

export function createDbProductIntakeAiDiagnosticsStore(database: any = defaultDb): ProductIntakeAiDiagnosticsStore {
  return {
    async recordSchemaValidationFailure(input) {
      await database.insert(productIntakeAiDiagnostics).values({
        organizationId: input.organizationId,
        sessionId: input.sessionId ?? null,
        sourceType: input.sourceType,
        sourceFingerprint: input.sourceFingerprint ?? null,
        provider: input.provider,
        model: input.model,
        rawAiResponse: input.rawAiResponse,
        validationErrors: input.validationErrors as any,
        failedSchemaPaths: input.failedSchemaPaths,
        repairActions: input.repairActions ?? [],
        promptVersion: input.promptVersion,
        createdByUserId: input.createdByUserId,
      });
    },

    async attachRecentToSession(args) {
      if (!args.sourceFingerprint) return;
      await database.update(productIntakeAiDiagnostics)
        .set({ sessionId: args.sessionId })
        .where(and(
          eq(productIntakeAiDiagnostics.organizationId, args.organizationId),
          eq(productIntakeAiDiagnostics.sourceFingerprint, args.sourceFingerprint),
          isNull(productIntakeAiDiagnostics.sessionId),
        ));
    },

    async listRecent(organizationId, filters = {}) {
      const conditions = [eq(productIntakeAiDiagnostics.organizationId, organizationId)];
      if (filters.sessionId) conditions.push(eq(productIntakeAiDiagnostics.sessionId, filters.sessionId));
      const rows = await database
        .select()
        .from(productIntakeAiDiagnostics)
        .where(and(...conditions))
        .orderBy(desc(productIntakeAiDiagnostics.createdAt))
        .limit(20);
      return rows.map(mapDiagnostic);
    },
  };
}
