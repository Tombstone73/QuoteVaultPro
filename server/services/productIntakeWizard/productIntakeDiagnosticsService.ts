import { and, desc, eq } from "drizzle-orm";
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
  sourceType: ProductIntakeSourceType;
  provider: string | null;
  model: string | null;
  rawAiResponse: string;
  validationErrors: ProductIntakeAiDiagnosticIssue[];
  failedSchemaPaths: string[];
  promptVersion: string | null;
  createdByUserId: string | null;
};

export interface ProductIntakeAiDiagnosticsStore {
  recordSchemaValidationFailure(input: ProductIntakeAiDiagnosticInput): Promise<void>;
  listRecent(organizationId: string): Promise<ProductIntakeAiDiagnostic[]>;
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
    sourceType: row.sourceType,
    provider: row.provider,
    model: row.model,
    rawAiResponse: row.rawAiResponse,
    validationErrors: Array.isArray(row.validationErrors) ? row.validationErrors : [],
    failedSchemaPaths: Array.isArray(row.failedSchemaPaths) ? row.failedSchemaPaths : [],
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
        sourceType: input.sourceType,
        provider: input.provider,
        model: input.model,
        rawAiResponse: input.rawAiResponse,
        validationErrors: input.validationErrors as any,
        failedSchemaPaths: input.failedSchemaPaths,
        promptVersion: input.promptVersion,
        createdByUserId: input.createdByUserId,
      });
    },

    async listRecent(organizationId) {
      const rows = await database
        .select()
        .from(productIntakeAiDiagnostics)
        .where(and(eq(productIntakeAiDiagnostics.organizationId, organizationId)))
        .orderBy(desc(productIntakeAiDiagnostics.createdAt))
        .limit(20);
      return rows.map(mapDiagnostic);
    },
  };
}
