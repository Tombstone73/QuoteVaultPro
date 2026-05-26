import { and, eq } from "drizzle-orm";
import { globalVariables, type GlobalVariable } from "@shared/schema";
import {
  DEFAULT_DOCUMENT_NUMBER_PREFIXES,
  DOCUMENT_NUMBER_PREFIX_VARIABLES,
  type DocumentNumberType,
  formatDocumentNumber,
  sanitizeDocumentNumberPrefix,
} from "@shared/documentNumbering";
import { db } from "../db";

type DbExecutor = typeof db | any;

export async function getDocumentNumberPrefix(
  organizationId: string,
  documentType: DocumentNumberType,
  executor: DbExecutor = db,
): Promise<string> {
  const name = DOCUMENT_NUMBER_PREFIX_VARIABLES[documentType];
  let row: GlobalVariable | undefined = await executor
    .select()
    .from(globalVariables)
    .where(and(eq(globalVariables.organizationId, organizationId), eq(globalVariables.name, name)))
    .limit(1)
    .then((rows: GlobalVariable[]) => rows[0]);

  if (!row) {
    const [created] = await executor
      .insert(globalVariables)
      .values({
        organizationId,
        name,
        value: DEFAULT_DOCUMENT_NUMBER_PREFIXES[documentType],
        description: `${documentType[0].toUpperCase()}${documentType.slice(1)} number prefix`,
        category: "numbering",
        isActive: true,
      })
      .returning();
    row = created[0];
  }

  try {
    return sanitizeDocumentNumberPrefix(row?.value);
  } catch {
    return DEFAULT_DOCUMENT_NUMBER_PREFIXES[documentType];
  }
}

export async function buildDocumentNumberParts(
  organizationId: string,
  documentType: DocumentNumberType,
  numberCore: number,
  executor: DbExecutor = db,
): Promise<{ numberCore: number; displayNumber: string }> {
  const core = Math.floor(Number(numberCore));
  const prefix = await getDocumentNumberPrefix(organizationId, documentType, executor);
  return {
    numberCore: core,
    displayNumber: formatDocumentNumber(prefix, core),
  };
}
