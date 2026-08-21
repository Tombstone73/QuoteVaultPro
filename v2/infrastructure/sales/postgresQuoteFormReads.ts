import type { Pool } from "pg";
import type { QuoteFormReadPort } from "../../src/interfaces/http/quoteRoutes.js";
import { resolveRuntimeVisibility, validateOptionTreeV2 } from "../../../shared/optionTreeV2Runtime.js";
import type { OptionTreeV2 } from "../../../shared/optionTreeV2.js";
import { resolveProductionRequirementSnapshot } from "../../src/modules/shared/productionRequirements.js";

/** Read-only, tenant-scoped selection projection for the Quote UI. */
export class PostgresQuoteFormReads implements QuoteFormReadPort {
  constructor(private readonly pool: Pool) {}
  async customers(organizationId: string, query = "") {
    const result = await this.pool.query<{ id: string; display_name: string | null; company_name: string }>(
      `SELECT id,display_name,company_name FROM customers
       WHERE organization_id=$1 AND is_active IS NOT FALSE
       AND COALESCE(status,'active') NOT IN ('archived','superseded','deleted')
       AND merged_into_customer_id IS NULL AND (display_name ILIKE $2 OR company_name ILIKE $2)
       ORDER BY COALESCE(NULLIF(display_name,''),company_name),id LIMIT 50`,
      [organizationId, `%${query.trim()}%`],
    );
    return result.rows.map((row) => ({ customerId: row.id, displayName: row.display_name?.trim() || row.company_name }));
  }
  async contacts(organizationId: string, customerId: string) {
    const result = await this.pool.query<{ id: string; first_name: string; last_name: string }>(
      `SELECT ct.id,ct.first_name,ct.last_name FROM customer_contacts ct
       JOIN customer_contact_links l ON l.organization_id=ct.organization_id AND l.contact_id=ct.id AND l.status='active'
       JOIN customers c ON c.organization_id=ct.organization_id AND c.id=l.customer_id
       WHERE ct.organization_id=$1 AND c.id=$2 AND ct.status='active' AND c.is_active IS NOT FALSE
       AND COALESCE(c.status,'active') NOT IN ('archived','superseded','deleted')
       ORDER BY ct.first_name,ct.last_name,ct.id LIMIT 50`,
      [organizationId, customerId],
    );
    return result.rows.map((row) => ({ contactId: row.id, displayName: `${row.first_name} ${row.last_name}`.trim() }));
  }
  async products(organizationId: string, query = "") {
    const result = await this.pool.query<{ id: string; name: string; measurement_mode: "dimensions_required" | "quantity_only" }>(
      `SELECT p.id,p.name,p.measurement_mode FROM products p
       JOIN pbv2_tree_versions t ON t.id=p.pbv2_active_tree_version_id AND t.organization_id=p.organization_id AND t.product_id=p.id AND t.status='ACTIVE'
       WHERE p.organization_id=$1 AND p.is_active=TRUE AND p.name ILIKE $2 ORDER BY p.name,p.id LIMIT 50`,
      [organizationId, `%${query.trim()}%`],
    );
    return result.rows.map((row) => ({ productId: row.id, displayName: row.name, measurementMode: row.measurement_mode, requiresDimensions: row.measurement_mode === "dimensions_required" }));
  }
  async configuration(organizationId: string, productId: string, selections: Record<string, unknown> = {}) {
    const result = await this.pool.query<{ name: string; measurement_mode: "dimensions_required" | "quantity_only"; tree_json: unknown }>(
      `SELECT p.name,p.measurement_mode,t.tree_json FROM products p JOIN pbv2_tree_versions t ON t.id=p.pbv2_active_tree_version_id AND t.organization_id=p.organization_id AND t.product_id=p.id AND t.status='ACTIVE' WHERE p.organization_id=$1 AND p.id=$2 AND p.is_active=TRUE`, [organizationId, productId]);
    const row = result.rows[0];
    if (!row || !validateOptionTreeV2(row.tree_json as OptionTreeV2).ok) return null;
    const tree = row.tree_json as OptionTreeV2;
    const visibility = resolveRuntimeVisibility(tree, selections as never);
    const productionRequirements = resolveProductionRequirementSnapshot(
      (tree.meta as Readonly<Record<string, unknown>> | undefined)?.productionUnitSpecification,
      visibility.effectiveSelections as never,
    );
    return {
      productId, displayName: row.name, measurementMode: row.measurement_mode,
      requiresDimensions: row.measurement_mode === "dimensions_required", supportedDimensionUnits: ["in"],
      effectiveSelections: visibility.effectiveSelections,
      productionRequirements,
      fields: visibility.visibleNodeIds.flatMap((id) => {
        const node = tree.nodes[id];
        if (!node || node.kind === "group" || !node.input) return [];
        return [{ selectionKey: node.input.selectionKey, label: node.label, inputType: node.input.type, required: Boolean(node.input.required), defaultValue: node.input.defaultValue, choices: (node.choices ?? []).map((choice) => ({ value: choice.value, label: choice.label })) }];
      }),
    };
  }
}
