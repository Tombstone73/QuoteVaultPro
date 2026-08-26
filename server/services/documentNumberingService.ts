import { and, eq, sql } from "drizzle-orm";
import { globalVariables, type GlobalVariable } from "@shared/schema";
import {
  DEFAULT_DOCUMENT_NUMBER_PREFIXES,
  DOCUMENT_NUMBER_PREFIX_VARIABLES,
  POSTGRES_INTEGER_MAX,
  type DocumentNumberType,
  formatDocumentNumber,
  sanitizeDocumentNumberPrefix,
} from "@shared/documentNumbering";
import { db } from "../db";

type DbExecutor = typeof db | any;
const DEFAULT_SEQUENCE_START = 1000;
const JOB_NUMBER_SEQUENCE_VARIABLE = "next_job_number";
const JOB_NUMBER_SEQUENCE_DESCRIPTION = "Next shared commercial job number sequence (auto-initialized)";

const DOCUMENT_NUMBER_SEQUENCE_VARIABLES: Record<DocumentNumberType, string> = {
  quote: "next_quote_number",
  order: "next_order_number",
  invoice: "next_invoice_number",
  purchase_order: "next_purchase_order_number",
};

const DOCUMENT_NUMBER_SEQUENCE_DESCRIPTIONS: Record<DocumentNumberType, string> = {
  quote: "Next quote number sequence (auto-initialized)",
  order: "Next order number sequence (auto-initialized)",
  invoice: "Next invoice number sequence (auto-initialized)",
  purchase_order: "Next purchase order number sequence (auto-initialized)",
};

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
    row = created;
  }

  try {
    return sanitizeDocumentNumberPrefix(row?.value);
  } catch {
    return DEFAULT_DOCUMENT_NUMBER_PREFIXES[documentType];
  }
}

export function isDocumentNumberUniqueViolation(error: unknown): boolean {
  const err = error as any;
  if (err?.code !== "23505") return false;
  const constraint = String(err?.constraint || err?.message || "");
  return /(?:display_number|number_core).*unique|(?:quotes|orders|invoices|purchase_orders)_org_.*unique/i.test(constraint);
}

export function toDocumentNumberConflictError(error: unknown): Error {
  const wrapped = new Error("A document number was already assigned. Please retry the operation.");
  (wrapped as any).statusCode = 409;
  (wrapped as any).code = "DOCUMENT_NUMBER_CONFLICT";
  (wrapped as any).cause = error;
  return wrapped;
}

export async function allocateDocumentNumber(
  organizationId: string,
  documentType: DocumentNumberType,
  executor: DbExecutor = db,
): Promise<{ numberCore: number; displayNumber: string }> {
  const name = DOCUMENT_NUMBER_SEQUENCE_VARIABLES[documentType];
  const description = DOCUMENT_NUMBER_SEQUENCE_DESCRIPTIONS[documentType];
  const initialValue = String(DEFAULT_SEQUENCE_START + 1);

  const result = await executor.execute(sql`
    INSERT INTO global_variables (
      id,
      organization_id,
      name,
      value,
      description,
      category,
      is_active,
      created_at,
      updated_at
    )
    VALUES (
      gen_random_uuid(),
      ${organizationId},
      ${name},
      ${initialValue},
      ${description},
      'numbering',
      true,
      NOW(),
      NOW()
    )
    ON CONFLICT (organization_id, name) DO UPDATE
    SET
      value = (
        CASE
          WHEN global_variables.value ~ '^[0-9]+$' THEN global_variables.value::integer
          ELSE ${DEFAULT_SEQUENCE_START}
        END + 1
      )::text,
      updated_at = NOW()
    RETURNING (value::integer - 1) AS number_core
  `);

  const rows = Array.isArray(result) ? result : ((result as any)?.rows ?? []);
  const rawCore = rows[0]?.number_core ?? rows[0]?.numberCore;
  const numberCore = Math.floor(Number(rawCore));
  if (!Number.isFinite(numberCore)) {
    throw new Error(`Failed to allocate ${documentType} number`);
  }

  return buildDocumentNumberParts(organizationId, documentType, numberCore, executor);
}

/**
 * Atomically allocates the human-facing number shared by a prospective
 * Quote, its converted Order, and its invoice(s). It intentionally does not
 * use document prefixes: document type is supplied by presentation context.
 */
export async function allocateJobNumber(
  organizationId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const initialValue = String(DEFAULT_SEQUENCE_START + 1);
  const result = await executor.execute(sql`
    INSERT INTO global_variables (
      id, organization_id, name, value, description, category, is_active, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), ${organizationId}, ${JOB_NUMBER_SEQUENCE_VARIABLE}, ${initialValue},
      ${JOB_NUMBER_SEQUENCE_DESCRIPTION}, 'numbering', true, NOW(), NOW()
    )
    ON CONFLICT (organization_id, name) DO UPDATE
    SET value = (
      global_variables.value::numeric + 1
    )::text,
    updated_at = NOW()
    WHERE global_variables.value ~ '^[0-9]{1,10}$'
      AND global_variables.value::numeric BETWEEN 1 AND ${POSTGRES_INTEGER_MAX}
    RETURNING (value::numeric - 1) AS job_number
  `);
  const rows = Array.isArray(result) ? result : ((result as any)?.rows ?? []);
  if (!rows[0]) {
    throw new Error("Shared Job Number sequence is invalid or exhausted.");
  }
  const jobNumber = Math.floor(Number(rows[0]?.job_number ?? rows[0]?.jobNumber));
  if (!Number.isSafeInteger(jobNumber) || jobNumber < 1 || jobNumber > POSTGRES_INTEGER_MAX) {
    throw new Error("Failed to allocate shared job number");
  }
  return jobNumber;
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
