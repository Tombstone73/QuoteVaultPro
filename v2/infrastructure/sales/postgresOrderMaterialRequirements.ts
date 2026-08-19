import type { PoolClient } from "pg";
import { PostgresProductRecipeReader } from "../products/postgresProductRecipes.js";
import { resolveMaterialRequirements, type MaterialRequirementMaterial, type Pbv2MaterialRequirementContext } from "../../src/modules/materials/materialRequirementResolver.js";
import type { SalesLineSnapshot } from "../../src/modules/sales/contracts.js";
import type { OptionTreeV2 } from "../../../shared/optionTreeV2.js";

const inventoryMaterialIds = (value: unknown): string[] => {
  const ids = new Set<string>();
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) { current.forEach(visit); return; }
    if (!current || typeof current !== "object") return;
    const record = current as Record<string, unknown>;
    if (Array.isArray(record.inventoryConsumption)) {
      for (const entry of record.inventoryConsumption) {
        const id = entry && typeof entry === "object" ? String((entry as Record<string, unknown>).materialId ?? "").trim() : "";
        if (id) ids.add(id);
      }
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return [...ids];
};

export class PostgresOrderMaterialRequirements {
  private readonly recipes: PostgresProductRecipeReader;

  constructor(private readonly client: PoolClient) {
    this.recipes = new PostgresProductRecipeReader(client);
  }

  private async pbv2(organizationId: string, line: SalesLineSnapshot): Promise<Pbv2MaterialRequirementContext | undefined> {
    const tree = (await this.client.query<{ tree_json: unknown }>(
      "SELECT tree_json FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 AND id=$3",
      [organizationId, line.productId, line.resolvedConfiguration.pricingConfigurationId],
    )).rows[0]?.tree_json;
    if (!tree || typeof tree !== "object") return undefined;
    const ids = inventoryMaterialIds(tree);
    if (!ids.length) return undefined;
    const rows = (await this.client.query<MaterialRequirementMaterial>(
      `SELECT id,name,sku,material_form AS "materialForm",inventory_unit AS "inventoryUnit",consumption_unit AS "consumptionUnit",
        width,height,roll_length_ft AS "rollLengthFt",edge_waste_in_per_side AS "edgeWasteInPerSide",
        lead_waste_ft AS "leadWasteFt",tail_waste_ft AS "tailWasteFt"
       FROM materials WHERE organization_id=$1 AND is_active=TRUE AND id=ANY($2::varchar[])`,
      [organizationId, ids],
    )).rows;
    // PBV2 trees can retain an inactive Material on an unselected historical
    // choice. The resolver below only accepts Material IDs reached by the
    // frozen selection; rejecting the entire tree here would make that valid
    // production catalog shape impossible to convert.
    return { tree: tree as OptionTreeV2, materials: rows };
  }

  async freeze(organizationId: string, orderId: string, lines: readonly SalesLineSnapshot[]): Promise<void> {
    for (const line of lines) {
      const recipe = await this.recipes.read(
        organizationId,
        line.productId,
        line.resolvedConfiguration.pricingConfigurationId,
      );
      const requirements = resolveMaterialRequirements(recipe, line, await this.pbv2(organizationId, line));
      for (const requirement of requirements) {
        await this.client.query(
          `INSERT INTO v2_order_line_material_requirements(
            organization_id,order_document_id,order_line_id,source_product_version_id,source_recipe_id,
            source_recipe_component_id,source_configuration_id,material_id,material_name_snapshot,
            material_sku_snapshot,quantity,quantity_unit,quantity_mode,resolution_version,source_definition_kind,source_definition_id
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::numeric,$12,$13,$14,$15,$16)
          ON CONFLICT(organization_id,order_line_id,source_definition_id) DO NOTHING`,
          [organizationId, orderId, line.lineId, requirement.productVersionId, requirement.recipeId ?? null,
            requirement.recipeComponentId ?? null, requirement.configurationId, requirement.materialId,
            requirement.materialName, requirement.materialSku, requirement.quantity, requirement.unit,
            requirement.quantityMode, requirement.resolutionVersion, requirement.sourceKind, requirement.sourceDefinitionId],
        );
      }
    }
  }

  async hasFrozen(organizationId: string, orderLineId: string): Promise<boolean> {
    const result = await this.client.query<{ id: string }>(
      "SELECT id FROM v2_order_line_material_requirements WHERE organization_id=$1 AND order_line_id=$2 LIMIT 1",
      [organizationId, orderLineId],
    );
    return Boolean(result.rows[0]);
  }
}
