import type { PoolClient } from "pg";
import { PostgresProductRecipeReader } from "../products/postgresProductRecipes.js";
import { resolveMaterialRequirements } from "../../src/modules/materials/materialRequirementResolver.js";
import type { SalesLineSnapshot } from "../../src/modules/sales/contracts.js";

export class PostgresOrderMaterialRequirements {
  private readonly recipes: PostgresProductRecipeReader;

  constructor(private readonly client: PoolClient) {
    this.recipes = new PostgresProductRecipeReader(client);
  }

  async freeze(organizationId: string, orderId: string, lines: readonly SalesLineSnapshot[]): Promise<void> {
    for (const line of lines) {
      const recipe = await this.recipes.read(
        organizationId,
        line.productId,
        line.resolvedConfiguration.pricingConfigurationId,
      );
      const requirements = resolveMaterialRequirements(recipe, line);
      for (const requirement of requirements) {
        await this.client.query(
          `INSERT INTO v2_order_line_material_requirements(
            organization_id,order_document_id,order_line_id,source_product_version_id,source_recipe_id,
            source_recipe_component_id,source_configuration_id,material_id,material_name_snapshot,
            material_sku_snapshot,quantity,quantity_unit,quantity_mode,resolution_version
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::numeric,$12,$13,$14)
          ON CONFLICT(organization_id,order_line_id,source_recipe_component_id) DO NOTHING`,
          [organizationId, orderId, line.lineId, requirement.productVersionId, requirement.recipeId,
            requirement.recipeComponentId, requirement.configurationId, requirement.materialId,
            requirement.materialName, requirement.materialSku, requirement.quantity, requirement.unit,
            requirement.quantityMode, requirement.resolutionVersion],
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
