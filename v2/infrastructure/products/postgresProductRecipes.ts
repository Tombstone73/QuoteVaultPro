import type { Pool, PoolClient } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import type {
  ProductRecipe,
  ProductRecipeTransaction,
  ProductRecipeTransactionRunner,
  RecipeComponent,
} from "../../src/modules/products/productRecipes.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";

type RecipeRow = {
  product_id: string;
  recipe_id: string;
  product_version_id: string;
  draft_updated_at: Date;
  status: string;
  component_id: string | null;
  material_id: string | null;
  material_name_snapshot: string | null;
  material_sku_snapshot: string | null;
  quantity: string | null;
  quantity_unit: RecipeComponent["unit"] | null;
  quantity_kind: "fixed" | "per_line" | "per_piece" | null;
};

const recipeQuery = `
  SELECT r.id recipe_id,r.product_id,r.product_version_id,v.updated_at draft_updated_at,v.status,
    c.id component_id,c.material_id,c.material_name_snapshot,c.material_sku_snapshot,
    c.quantity::text,c.quantity_unit,c.quantity_kind
  FROM v2_product_recipes r
  JOIN pbv2_tree_versions v ON v.id=r.product_version_id AND v.organization_id=r.organization_id
  LEFT JOIN v2_product_recipe_components c ON c.recipe_id=r.id AND c.organization_id=r.organization_id
  WHERE r.organization_id=$1 AND r.product_id=$2 AND r.product_version_id=$3
  ORDER BY c.position,c.id`;

const toRecipe = (rows: readonly RecipeRow[]): ProductRecipe | null => {
  const first = rows[0];
  if (!first) return null;
  return {
    recipeId: first.recipe_id,
    productId: first.product_id,
    productVersionId: first.product_version_id,
    draftUpdatedAt: first.draft_updated_at.toISOString(),
    lifecycle: first.status === "DRAFT" ? "draft" : first.status === "ACTIVE" ? "active" : "historical",
    components: rows.flatMap((row) => row.component_id ? [{
      componentId: row.component_id,
      materialId: row.material_id!,
      materialName: row.material_name_snapshot!,
      materialSku: row.material_sku_snapshot,
      quantity: row.quantity!,
      unit: row.quantity_unit!,
      quantityKind: row.quantity_kind === "per_piece" ? "per_piece" : "per_line",
    }] : []),
  };
};

export class PostgresProductRecipeReader {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async read(organizationId: string, productId: string, versionId: string): Promise<ProductRecipe | null> {
    return toRecipe((await this.pool.query<RecipeRow>(recipeQuery, [organizationId, productId, versionId])).rows);
  }
}

class Transaction implements ProductRecipeTransaction {
  private readonly requests = new PostgresOperationRequestRepository();

  constructor(private readonly client: PoolClient) {}

  async reserve(input: Parameters<ProductRecipeTransaction["reserve"]>[0]) {
    const reservation = await this.requests.reserve(this.client, input);
    return reservation.kind === "resumed"
      ? { kind: "new" as const, request: reservation.request }
      : { kind: reservation.kind, request: reservation.request };
  }

  async replaceDraftRecipe(input: Parameters<ProductRecipeTransaction["replaceDraftRecipe"]>[0]): Promise<ProductRecipe> {
    const version = (await this.client.query<{ status: string; updated_at: Date }>(
      `SELECT status,updated_at FROM pbv2_tree_versions
       WHERE organization_id=$1 AND product_id=$2 AND id=$3 FOR UPDATE`,
      [input.organizationId, input.productId, input.draftVersionId],
    )).rows[0];
    if (!version || version.status !== "DRAFT") {
      throw new V2ApplicationError("CONFLICT", "Only the current Draft can be edited.");
    }
    if (version.updated_at.toISOString() !== new Date(input.expectedDraftUpdatedAt).toISOString()) {
      throw new V2ApplicationError("STALE_STATE", "This Draft changed elsewhere. Refresh and try again.");
    }

    const materialIds = input.components.map((component) => component.materialId);
    const materials = materialIds.length === 0 ? [] : (await this.client.query<{ id: string; name: string; sku: string | null }>(
      `SELECT id,name,sku FROM materials
       WHERE organization_id=$1 AND is_active=TRUE AND id=ANY($2::varchar[])`,
      [input.organizationId, materialIds],
    )).rows;
    if (materials.length !== materialIds.length) {
      throw new V2ApplicationError("VALIDATION_ERROR", "A recipe material is unavailable.");
    }

    const recipe = (await this.client.query<{ id: string }>(
      `INSERT INTO v2_product_recipes(organization_id,product_id,product_version_id,updated_by_user_id)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(organization_id,product_version_id) DO UPDATE
         SET updated_at=now(),updated_by_user_id=EXCLUDED.updated_by_user_id
       RETURNING id`,
      [input.organizationId, input.productId, input.draftVersionId, input.staffActorUserId ?? null],
    )).rows[0]!;
    const existing = (await this.client.query<{ id: string }>(
      "SELECT id FROM v2_product_recipe_components WHERE organization_id=$1 AND recipe_id=$2 FOR UPDATE",
      [input.organizationId, recipe.id],
    )).rows;
    const existingIds = new Set(existing.map((component) => component.id));
    for (const component of input.components) {
      if (component.componentId && !existingIds.has(component.componentId)) {
        throw new V2ApplicationError("CONFLICT", "A recipe component changed elsewhere. Refresh and try again.");
      }
    }
    const retainedIds = input.components.flatMap((component) => component.componentId ? [component.componentId] : []);
    // Move retained rows out of the user-visible ordering space before applying
    // their next positions, so reordering cannot transiently violate the unique
    // (recipe_id, position) constraint.
    if (existing.length) {
      await this.client.query(
        "UPDATE v2_product_recipe_components SET position=-position-1 WHERE organization_id=$1 AND recipe_id=$2",
        [input.organizationId, recipe.id],
      );
      await this.client.query(
        `DELETE FROM v2_product_recipe_components
         WHERE organization_id=$1 AND recipe_id=$2 AND id=ANY($3::varchar[])
           AND ($4::varchar[] = '{}'::varchar[] OR NOT (id=ANY($4::varchar[])))`,
        [input.organizationId, recipe.id, existing.map((component) => component.id), retainedIds],
      );
    }
    const materialById = new Map(materials.map((material) => [material.id, material]));
    for (const [position, component] of input.components.entries()) {
      const material = materialById.get(component.materialId)!;
      if (component.componentId) {
        await this.client.query(
          `UPDATE v2_product_recipe_components SET material_id=$1,position=$2,quantity=$3::numeric,
            quantity_unit=$4,quantity_kind=$5,material_name_snapshot=$6,material_sku_snapshot=$7,updated_at=now()
           WHERE organization_id=$8 AND recipe_id=$9 AND id=$10`,
          [material.id, position, component.quantity, component.unit, component.quantityKind ?? "per_line", material.name, material.sku,
            input.organizationId, recipe.id, component.componentId],
        );
      } else {
        await this.client.query(
          `INSERT INTO v2_product_recipe_components(
            organization_id,recipe_id,material_id,position,quantity,quantity_unit,quantity_kind,
            material_name_snapshot,material_sku_snapshot
          ) VALUES($1,$2,$3,$4,$5::numeric,$6,$7,$8,$9)`,
          [input.organizationId, recipe.id, material.id, position, component.quantity, component.unit, component.quantityKind ?? "per_line", material.name, material.sku],
        );
      }
    }
    // Keep the revision representable at the same millisecond precision used by
    // the canonical publisher's optimistic-concurrency contract. PostgreSQL
    // now() carries microseconds that a JS Date cannot round-trip exactly.
    const revision = new Date();
    const touched = (await this.client.query<{ updated_at: Date }>(
      `UPDATE pbv2_tree_versions SET updated_at=$1,updated_by_user_id=$2
       WHERE organization_id=$3 AND product_id=$4 AND id=$5 AND status='DRAFT'
       RETURNING updated_at`,
      [revision, input.staffActorUserId ?? null, input.organizationId, input.productId, input.draftVersionId],
    )).rows[0];
    if (!touched) throw new V2ApplicationError("CONFLICT", "Only the current Draft can be edited.");

    const result = toRecipe((await this.client.query<RecipeRow>(recipeQuery, [
      input.organizationId, input.productId, input.draftVersionId,
    ])).rows);
    if (!result) throw new Error("Recipe save could not be read.");
    return result;
  }

  async attribute(input: Parameters<ProductRecipeTransaction["attribute"]>[0]): Promise<void> {
    await this.requests.recordAttribution(this.client, {
      organizationId: input.organizationId,
      operationRequestId: input.requestId,
      operation: input.operation,
      resourceType: "product_recipe",
      resourceId: input.resourceId,
      principalKind: input.principalKind,
      principalSubject: input.principalSubject,
      staffActorUserId: input.staffActorUserId,
    });
  }

  async audit(input: Parameters<ProductRecipeTransaction["audit"]>[0]): Promise<void> {
    await this.client.query(
      `INSERT INTO v2_audit_events(
        organization_id,operation_request_id,operation,event_type,resource_type,resource_id,
        principal_kind,principal_subject,staff_actor_user_id,changes
      ) VALUES($1,$2,$3,'product_draft_recipe_updated','product_recipe',$4,$5,$6,$7,'[]'::jsonb)`,
      [input.organizationId, input.requestId, input.operation, input.resourceId,
        input.principalKind, input.principalSubject, input.staffActorUserId ?? null],
    );
  }

  async succeed(organizationId: string, requestId: string, recipeId: string, result: ProductRecipe): Promise<void> {
    await this.requests.succeed(this.client, organizationId, requestId, {
      resourceType: "product_recipe",
      resourceId: recipeId,
      resultJson: result,
    });
  }
}

export class PostgresProductRecipeTransactionRunner implements ProductRecipeTransactionRunner {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(action: (transaction: ProductRecipeTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await action(new Transaction(client));
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
