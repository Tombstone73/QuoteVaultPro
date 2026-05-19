import { afterAll, beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import { sql } from "drizzle-orm";

import { db } from "../../../db";
import { evaluatePricingPreviewFromTree, priceLineItem } from "../PricingService";

const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
const organizationId = `org_pbv2_snapshot_${suffix}`;
const productId = `prod_pbv2_snapshot_${suffix}`;
const treeVersionId = `tree_pbv2_snapshot_${suffix}`;

function makeAcmTree(matrixBasePriceForDouble = 575, base: Record<string, number> = { perSqftCents: 100 }) {
  return {
    schemaVersion: 2,
    rootNodeIds: ["thickness", "sides"],
    pricingMatrix: {
      dimensions: ["thickness", "sides"],
      rows: [
        { id: "3mm_single", when: { thickness: "choice_3mm", sides: "choice_single" }, variables: { base_price: 500 } },
        { id: "3mm_double", when: { thickness: "choice_3mm", sides: "choice_double" }, variables: { base_price: matrixBasePriceForDouble } },
      ],
    },
    nodes: {
      thickness: {
        id: "thickness",
        kind: "question",
        label: "Thickness",
        input: { type: "select", selectionKey: "thickness" },
        choices: [
          { value: "choice_3mm", label: "3mm" },
          { value: "choice_6mm", label: "6mm" },
        ],
      },
      sides: {
        id: "sides",
        kind: "question",
        label: "Sides",
        input: { type: "select", selectionKey: "sides" },
        choices: [
          { value: "choice_single", label: "Single sided" },
          { value: "choice_double", label: "Double sided" },
        ],
      },
    },
    meta: {
      pricingV2: {
        base,
      },
      pricingFormula: "sheet_consumption_sqft(w, h, q, sheet_width, sheet_length, usable_drop_min, billable_length_increment, minimum_billable_sqft) * base_price",
      formulaVariables: {
        sheet_width: 48,
        sheet_length: 96,
        usable_drop_min: 0,
        billable_length_increment: 1,
        minimum_billable_sqft: 0,
      },
    },
  };
}

beforeAll(async () => {
  await db.execute(sql`
    insert into organizations (id, name, slug)
    values (${organizationId}, ${`PBV2 Snapshot ${suffix}`}, ${`pbv2-snapshot-${suffix}`})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into products (id, organization_id, name, description, pricing_profile_key)
    values (${productId}, ${organizationId}, ${"PBV2 Snapshot ACM"}, ${"snapshot test"}, ${"default"})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into pbv2_tree_versions (id, organization_id, product_id, status, schema_version, tree_json, published_at)
    values (${treeVersionId}, ${organizationId}, ${productId}, ${"ACTIVE"}, ${2}, ${JSON.stringify(makeAcmTree())}::jsonb, now())
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    update products
    set pbv2_active_tree_version_id = ${treeVersionId}
    where id = ${productId}
  `);
});

afterAll(async () => {
  await db.execute(sql`delete from pbv2_tree_versions where organization_id = ${organizationId}`);
  await db.execute(sql`delete from products where id = ${productId}`);
  await db.execute(sql`delete from organizations where id = ${organizationId}`);
});

beforeEach(async () => {
  await db.execute(sql`
    update pbv2_tree_versions
    set tree_json = ${JSON.stringify(makeAcmTree())}::jsonb
    where id = ${treeVersionId}
  `);
});

describe("PricingService PBV2 pricing snapshot persistence payload", () => {
  test("captures raw selections, effective selections, matrix variables, formula scope, and price", async () => {
    const result = await priceLineItem({
      organizationId,
      productId,
      quantity: 1,
      widthIn: 24,
      heightIn: 36,
      pbv2ExplicitSelections: {
        thickness: { value: "choice_3mm" },
        sides: { value: "choice_double" },
      },
    });

    const snapshot = result.pbv2SnapshotJson.pbv2PricingSnapshot;
    const preview = evaluatePricingPreviewFromTree({
      treeJson: makeAcmTree(),
      widthIn: 24,
      heightIn: 36,
      quantity: 1,
      pbv2ExplicitSelections: {
        thickness: { value: "choice_3mm" },
        sides: { value: "choice_double" },
      },
      formulaVariables: (makeAcmTree() as any).meta.formulaVariables,
      debug: true,
    });

    expect(result.lineTotalCents).toBe(3450);
    expect(result.lineTotalCents / 100).toBeCloseTo(preview.totalPrice, 2);
    expect(snapshot).toEqual(expect.objectContaining({
      rawSelections: { thickness: "choice_3mm", sides: "choice_double" },
      effectiveSelections: { thickness: "choice_3mm", sides: "choice_double" },
      resolvedMatrixRowId: "3mm_double",
      resolvedMatrixVariables: { base_price: 5.75 },
      basePriceSource: "pricing_matrix.base_price",
      rateUsedSource: "pricing_matrix.base_price",
      minimumApplied: false,
      calculatedPrice: result.lineTotalCents / 100,
      formula: expect.stringContaining("sheet_consumption_sqft"),
    }));
    expect(snapshot?.formulaVariables.base_price).toBe(5.75);
    expect(snapshot?.formulaScopeUsed?.base_price).toBe(5.75);
    expect(snapshot?.formulaVariables.sheet_width).toBe(48);
    expect(typeof snapshot?.capturedAt).toBe("string");
  });

  test("matrix base_price prices order entry when base rate is blank", async () => {
    await db.execute(sql`
      update pbv2_tree_versions
      set tree_json = ${JSON.stringify(makeAcmTree(575, {}))}::jsonb
      where id = ${treeVersionId}
    `);

    const result = await priceLineItem({
      organizationId,
      productId,
      quantity: 1,
      widthIn: 24,
      heightIn: 36,
      pbv2ExplicitSelections: {
        thickness: { value: "choice_3mm" },
        sides: { value: "choice_double" },
      },
    });

    expect(result.lineTotalCents).toBe(3450);
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.resolvedMatrixVariables).toEqual({ base_price: 5.75 });
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.basePriceSource).toBe("pricing_matrix.base_price");
  });

  test("minimum charge applies only after matrix formula result", async () => {
    await db.execute(sql`
      update pbv2_tree_versions
      set tree_json = ${JSON.stringify(makeAcmTree(575, { minimumChargeCents: 4000 }))}::jsonb
      where id = ${treeVersionId}
    `);

    const belowMinimum = await priceLineItem({
      organizationId,
      productId,
      quantity: 1,
      widthIn: 24,
      heightIn: 36,
      pbv2ExplicitSelections: {
        thickness: { value: "choice_3mm" },
        sides: { value: "choice_double" },
      },
    });
    const aboveMinimum = await priceLineItem({
      organizationId,
      productId,
      quantity: 2,
      widthIn: 24,
      heightIn: 36,
      pbv2ExplicitSelections: {
        thickness: { value: "choice_3mm" },
        sides: { value: "choice_double" },
      },
    });

    expect(belowMinimum.lineTotalCents).toBe(4000);
    expect(belowMinimum.pbv2SnapshotJson.pbv2PricingSnapshot?.minimumApplied).toBe(true);
    expect(aboveMinimum.lineTotalCents).toBe(6900);
    expect(aboveMinimum.pbv2SnapshotJson.pbv2PricingSnapshot?.minimumApplied).toBe(false);
  });

  test("returned snapshot remains stable after product tree pricing matrix changes", async () => {
    const result = await priceLineItem({
      organizationId,
      productId,
      quantity: 1,
      widthIn: 24,
      heightIn: 36,
      pbv2ExplicitSelections: {
        thickness: { value: "choice_3mm" },
        sides: { value: "choice_double" },
      },
    });

    await db.execute(sql`
      update pbv2_tree_versions
      set tree_json = ${JSON.stringify(makeAcmTree(999))}::jsonb
      where id = ${treeVersionId}
    `);

    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.resolvedMatrixVariables).toEqual({ base_price: 5.75 });
    expect(result.pbv2SnapshotJson.pbv2PricingSnapshot?.resolvedMatrixRowId).toBe("3mm_double");
  });
});
