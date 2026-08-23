/**
 * Read-only, tenant-scoped planning report for freezing legacy Formula sources
 * onto immutable Formula revisions. It intentionally never creates an
 * identity, revision, or ProductVersion binding.
 *
 * Usage:
 *   FORMULA_FREEZE_INVENTORY_DATABASE_URL=... npm run v2:formula:freeze:inventory -- --organization-id <tenant-id>
 */
import { Pool } from "pg";
import { planLegacyFormulaFreezeInventory, type LegacyFormulaEvidence, type LegacyFormulaFreezeCandidate } from "../src/modules/pricing/legacyFormulaFreezeInventory.js";
import { selectFormulaFreezeInventoryConnection } from "../src/modules/pricing/formulaFreezeTargetIdentity.js";

type Row = Readonly<{
  organization_id: string;
  product_id: string;
  product_name: string;
  product_version_id: string;
  status: "ACTIVE" | "DEPRECATED" | "DRAFT";
  tree_json: unknown;
  legacy_formula_id: string | null;
  legacy_formula_expression: string | null;
  legacy_formula_config: unknown;
  legacy_product_formula: string | null;
  legacy_product_pricing_config: unknown;
  bound_formula_id: string | null;
  bound_formula_revision_id: string | null;
  bound_input_values: unknown;
  bound_revision_number: number | null;
  bound_revision_expression: string | null;
  bound_declared_inputs: unknown;
}>;

const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? text(process.argv[index + 1]) : undefined;
};

const candidateFrom = (row: Row): LegacyFormulaFreezeCandidate => {
  const meta = object(object(row.tree_json)?.meta);
  const formulaVariables = meta?.formulaVariables ?? meta?.pricingFormulaVariables;
  const evidence: LegacyFormulaEvidence[] = [];
  if (row.bound_formula_revision_id || row.bound_formula_id || row.bound_revision_expression) evidence.push({
    source: "formula_revision_binding",
    formulaId: row.bound_formula_id,
    formulaRevisionId: row.bound_formula_revision_id,
    expression: row.bound_revision_expression,
    declaredInputs: row.bound_declared_inputs,
    inputValues: row.bound_input_values,
  });
  if (row.legacy_formula_id || text(row.legacy_formula_expression)) evidence.push({
    source: "legacy_formula_library",
    formulaId: row.legacy_formula_id,
    expression: row.legacy_formula_expression,
    // `config.variables` is legacy value/configuration evidence, not a typed
    // Formula input declaration. Only an explicit structured declaration is
    // reported as declaration evidence.
    declaredInputs: object(row.legacy_formula_config)?.declaredInputs,
    inputValues: formulaVariables,
  });
  if (text(meta?.pricingFormula)) evidence.push({
    source: "embedded_product_version",
    expression: text(meta?.pricingFormula),
    inputValues: formulaVariables,
  });
  if (text(row.legacy_product_formula)) evidence.push({
    source: "legacy_product_formula",
    expression: row.legacy_product_formula,
    inputValues: object(row.legacy_product_pricing_config)?.formulaVariables,
  });
  return {
    organizationId: row.organization_id,
    productId: row.product_id,
    productName: row.product_name,
    productVersionId: row.product_version_id,
    lifecycle: row.status,
    evidence,
  };
};

async function main(): Promise<void> {
  const organizationId = argument("--organization-id") ?? process.env.FORMULA_FREEZE_INVENTORY_ORGANIZATION_ID;
  if (!organizationId) throw new Error("Provide --organization-id (or FORMULA_FREEZE_INVENTORY_ORGANIZATION_ID) to keep the report tenant-scoped.");
  const connection = selectFormulaFreezeInventoryConnection(process.env);
  // Deliberately emits no URL, username, password, token, or other credential.
  // This happens before a Pool exists so mismatch cannot open a connection.
  process.stdout.write(`${JSON.stringify({ target: connection.target, connectionSource: connection.source, connection: "not_opened" })}\n`);
  const pool = new Pool({ connectionString: connection.connectionString, max: 1 });
  try {
    const client = await pool.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN READ ONLY");
      transactionOpen = true;
      const rows = (await client.query<Row>(`
        SELECT
          version.organization_id,
          version.product_id,
          product.name AS product_name,
          version.id AS product_version_id,
          version.status,
          version.tree_json,
          product.pricing_formula_id AS legacy_formula_id,
          legacy_formula.expression AS legacy_formula_expression,
          legacy_formula.config AS legacy_formula_config,
          product.pricing_formula AS legacy_product_formula,
          product.pricing_profile_config AS legacy_product_pricing_config,
          binding.formula_id AS bound_formula_id,
          binding.formula_revision_id AS bound_formula_revision_id,
          binding.input_values AS bound_input_values,
          revision.revision_number AS bound_revision_number,
          revision.expression AS bound_revision_expression,
          revision.declared_inputs AS bound_declared_inputs
        FROM pbv2_tree_versions version
        JOIN products product
          ON product.organization_id=version.organization_id
         AND product.id=version.product_id
        LEFT JOIN v2_product_version_formula_revision_bindings binding
          ON binding.organization_id=version.organization_id
         AND binding.product_id=version.product_id
         AND binding.product_version_id=version.id
        LEFT JOIN formula_revisions revision
          ON revision.organization_id=binding.organization_id
         AND revision.formula_id=binding.formula_id
         AND revision.id=binding.formula_revision_id
        LEFT JOIN pricing_formulas legacy_formula
          ON legacy_formula.organization_id=product.organization_id
         AND legacy_formula.id=product.pricing_formula_id
        WHERE version.organization_id=$1
          AND version.status IN ('DRAFT','ACTIVE','DEPRECATED')
        ORDER BY product.name,version.updated_at,version.id
      `, [organizationId])).rows;
      await client.query("ROLLBACK");
      transactionOpen = false;
      const plans = planLegacyFormulaFreezeInventory(rows.map(candidateFrom));
      const summary = plans.reduce<Record<string, number>>((counts, plan) => ({ ...counts, [plan.disposition]: (counts[plan.disposition] ?? 0) + 1 }), {});
      process.stdout.write(`${JSON.stringify({ organizationId, dryRun: true, sourceRows: rows.length, summary, plans }, null, 2)}\n`);
    } finally {
      if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  process.stderr.write(`[formula-freeze-inventory] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
