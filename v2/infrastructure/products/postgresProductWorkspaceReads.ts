import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { canonicalJson } from "../../src/modules/shared/commercialValues.js";
import { resolveRuntimeVisibility, validateOptionTreeV2 } from "../../../shared/optionTreeV2Runtime.js";
import type { OptionTreeV2 } from "../../../shared/optionTreeV2.js";
import type { ProductCatalogItem, ProductWorkspaceDetail, ProductWorkspaceReadPort } from "../../src/interfaces/http/productRoutes.js";

type ProductRow = {
  product_id: string; product_name: string; product_type_id: string | null; measurement_mode: "dimensions_required" | "quantity_only";
  tree_id: string; tree_schema_version: number; tree_published_at: Date | null; tree_json: unknown;
  routing_mode: "route_required" | "no_route" | "unconfigured" | null; default_route_template_id: string | null;
};
const hash = (value: unknown) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const version = (row: ProductRow) => row.tree_published_at?.toISOString() ?? `schema-${row.tree_schema_version}`;
const item = (row: ProductRow): ProductCatalogItem => ({
  productId: row.product_id, displayName: row.product_name, measurementMode: row.measurement_mode,
  requiresDimensions: row.measurement_mode === "dimensions_required",
  pricingConfiguration: { id: row.tree_id, version: version(row), contentHash: hash(row.tree_json) },
});

/** Bounded catalog/detail reader; it exposes only active Product + ACTIVE PBV2 facts. */
export class PostgresProductWorkspaceReads implements ProductWorkspaceReadPort {
  constructor(private readonly pool: Pool) {}
  async list(organizationId: string, query = ""): Promise<readonly ProductCatalogItem[]> {
    const result = await this.pool.query<ProductRow>(`${this.select()}
      WHERE p.organization_id=$1 AND p.is_active=TRUE AND p.name ILIKE $2
      ORDER BY p.name,p.id LIMIT 100`, [organizationId, `%${query.trim()}%`]);
    return result.rows.map(item);
  }
  async get(organizationId: string, productId: string): Promise<ProductWorkspaceDetail | null> {
    const result = await this.pool.query<ProductRow>(`${this.select()}
      WHERE p.organization_id=$1 AND p.id=$2 AND p.is_active=TRUE`, [organizationId, productId]);
    const row = result.rows[0];
    if (!row || !validateOptionTreeV2(row.tree_json as OptionTreeV2).ok) return null;
    const tree = row.tree_json as OptionTreeV2;
    const visibility = resolveRuntimeVisibility(tree, {});
    return {
      ...item(row), ...(row.product_type_id ? { productTypeId: row.product_type_id } : {}),
      routePolicy: row.routing_mode === "route_required" && row.default_route_template_id ? "route_required" : row.routing_mode === "no_route" ? "no_route" : "unconfigured",
      activeConfiguration: {
        schemaVersion: row.tree_schema_version, ...(row.tree_published_at ? { publishedAt: row.tree_published_at.toISOString() } : {}),
        fields: visibility.visibleNodeIds.flatMap((id) => {
          const node = tree.nodes[id];
          if (!node || node.kind === "group" || !node.input || typeof node.input.selectionKey !== "string") return [];
          return [{ selectionKey: node.input.selectionKey, label: node.label, inputType: node.input.type, required: Boolean(node.input.required), choices: (node.choices ?? []).map((choice) => ({ value: choice.value, label: choice.label })) }];
        }),
      },
    };
  }
  private select() {
    return `SELECT p.id AS product_id,p.name AS product_name,p.product_type_id,p.measurement_mode,
      t.id AS tree_id,t.schema_version AS tree_schema_version,t.published_at AS tree_published_at,t.tree_json,
      pt.routing_mode,pt.default_route_template_id
      FROM products p JOIN pbv2_tree_versions t ON t.id=p.pbv2_active_tree_version_id AND t.organization_id=p.organization_id AND t.product_id=p.id AND t.status='ACTIVE'
      LEFT JOIN product_types pt ON pt.id=p.product_type_id AND pt.organization_id=p.organization_id`;
  }
}
