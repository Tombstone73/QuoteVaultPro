import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { evaluatePricingPreviewFromTree, priceLineItem } from '../PricingService';
import { db } from '../../../db';
import { validateCanonicalProductPublishTarget } from '../../products/canonicalProductPublishOperations';
import { validateTreeHasBasePrice } from '@shared/pbv2/validator/validateBasePrice';
import { validateTreeForPublish, DEFAULT_VALIDATE_OPTS } from '@shared/pbv2/validator';
import { resolveRuntimeVisibility } from '@shared/optionTreeV2Runtime';
import { optionTreeV2Schema } from '@shared/optionTreeV2';
import { productImportV2RequestSchema } from '@shared/importExportSchemas';
import { buildPbv2ImportProductValues } from '../../pbv2ImportMapper';
import { exportProducts } from '../../pbv2ExportMapper';
import { updateProductSchema } from '@shared/schema';

const document = () => JSON.parse(readFileSync(resolve(process.cwd(), '3m-680cr-reflective-vinyl-draft.json'), 'utf8'));
const tree = () => document().products[0].optionTreeJson;
function price(selected: Record<string, string> = {}, source = tree(), width = 10, height = 10, quantity = 100) {
  return evaluatePricingPreviewFromTree({ treeJson: source, widthIn: width, heightIn: height, quantity, pbv2ExplicitSelections: selected, debug: true });
}

describe('680CR canonical roll integration', () => {
  test('inactive import has valid schema, defaults, root reachability and zero scalar pricing', () => {
    const parsed = productImportV2RequestSchema.parse(document());
    const product = parsed.products[0];
    expect(product.isActive).toBe(false);
    expect(product.productTypeName).toBe('Roll');
    expect(product.primaryMaterialSku).toBeUndefined();
    expect(updateProductSchema.safeParse(buildPbv2ImportProductValues(product, {})).success).toBe(true);
    expect(optionTreeV2Schema.safeParse(product.optionTreeJson).success).toBe(true);
    expect(validateTreeHasBasePrice(product.optionTreeJson).errors).toEqual([]);
    expect(validateCanonicalProductPublishTarget({ product: { ...product, primaryMaterialId: null },
      tree: { schemaVersion: 2, treeJson: product.optionTreeJson }, materials: [], pricingFormula: null,
    } as any).errors).toEqual([]);
    const validation = validateTreeForPublish(product.optionTreeJson, DEFAULT_VALIDATE_OPTS);
    expect(validation.errors).toEqual([]);
    expect(validation.warnings.filter(f => f.code === 'PBV2_W_NODE_UNREACHABLE')).toEqual([]);
    const visibility = resolveRuntimeVisibility(product.optionTreeJson, {});
    expect(visibility.effectiveSelections).toMatchObject({ printing: 'unprinted', contour_cutting: 'no' });
    expect(visibility.visibleNodeIds).not.toContain('opt_lamination');
    expect(visibility.visibleNodeIds).not.toContain('opt_weed_tape');
  });

  test('the production line-pricing path uses the same canonical roll option charges', async () => {
    const product = { ...document().products[0], id: 'product-1', organizationId: 'org', pbv2ActiveTreeVersionId: 'tree-1' };
    const source = tree(); source.status = 'ACTIVE';
    const rows = [[product], [{ id: 'tree-1', productId: 'product-1', organizationId: 'org', status: 'ACTIVE', schemaVersion: 2, treeJson: source }]];
    const select = jest.spyOn(db, 'select').mockImplementation((() => ({ from: () => ({ where: () => ({ limit: async () => rows.shift() ?? [] }) }) })) as any);
    try {
      const result = await priceLineItem({ organizationId: 'org', productId: 'product-1', widthIn: 10, heightIn: 10, quantity: 100,
        pbv2ExplicitSelections: { printing: 'printed', lamination: 'laminated', contour_cutting: 'yes', weed_tape: 'yes' },
      });
      expect(result.breakdown).toMatchObject({ baseCents: 73500, optionsCents: 52500, totalCents: 126000 });
      expect(result.lineTotalCents).toBe(126000);
      expect(rows).toHaveLength(0);
    } finally { select.mockRestore(); }
  });

  test.each([
    [{}, 35], [{ printing: 'printed' }, 45], [{ printing: 'printed', lamination: 'laminated' }, 50],
    [{ contour_cutting: 'yes' }, 40], [{ contour_cutting: 'yes', weed_tape: 'yes' }, 45],
    [{ printing: 'printed', contour_cutting: 'yes' }, 50],
    [{ printing: 'printed', lamination: 'laminated', contour_cutting: 'yes' }, 55],
    [{ printing: 'printed', lamination: 'laminated', contour_cutting: 'yes', weed_tape: 'yes' }, 60],
  ] as Array<[Record<string, string>, number]>)('prices %j at $%i per canonical billed LF', (selected, rate) => {
    const result = price(selected);
    // 4 across, 25 rows x 10 inches = 250 inches consumed, rounded to 252.
    expect(result.derived?.consumedLinearFeet).toBeCloseTo(250 / 12, 5);
    expect(result.derived?.billedLinearFeet).toBe(21);
    expect(result.debug?.variables.linear_foot_rate).toBe(35);
    expect(result.breakdown.basePrice).toBe(735);
    expect(result.breakdown.optionsPrice).toBe(21 * (rate - 35));
    expect(result.totalPrice).toBe(21 * rate);
    expect(result.totalPrice).not.toBe((100 * 10 / 12) * rate);
  });

  test('rotation and product variable overrides reach base and option formulas together', () => {
    const source = tree();
    source.meta.formulaVariables.allow_rotation = false;
    expect(price({ printing: 'printed' }, source, 30, 10, 4).totalPrice).toBe(4 * 45);
    source.meta.formulaVariables.allow_rotation = true;
    expect(price({ printing: 'printed' }, source, 30, 10, 4).totalPrice).toBe(3 * 45);
    const result = evaluatePricingPreviewFromTree({ treeJson: source, widthIn: 10, heightIn: 10, quantity: 100,
      pbv2ExplicitSelections: { printing: 'printed' }, pricingProfileConfig: { formulaVariables: { linear_foot_rate: 40 } }, debug: true });
    expect(result.totalPrice).toBe(21 * 50);
  });

  test.each(['linear_foot_rate', 'printable_width', 'billing_width_increment', 'billing_length_increment'])('missing %s fails save and runtime safely', key => {
    const source = tree(); delete source.meta.formulaVariables[key];
    expect(validateTreeHasBasePrice(source).ok).toBe(false);
    expect(() => price({}, source)).toThrow();
  });
  test.each([-1, NaN, Infinity, null, ''])('invalid roll rate %s cannot bypass base validation', value => {
    const source = tree(); source.meta.formulaVariables.linear_foot_rate = value;
    expect(validateTreeHasBasePrice(source).ok).toBe(false);
  });
  test('zero rate remains valid under the existing non-negative roll-rate contract', () => {
    const source = tree(); source.meta.formulaVariables.linear_foot_rate = 0;
    expect(validateTreeHasBasePrice(source).ok).toBe(true);
    expect(price({}, source).totalPrice).toBe(0);
  });
  test.each(['total_sqft * base_price', 'quantity * base_price', 'linear_foot_rate', 'custom_billed_linear_feet * linear_foot_rate'])('unrelated formula %s still requires its base pricing', formula => {
    const source = tree(); source.meta.pricingFormula = formula;
    expect(validateTreeHasBasePrice(source).ok).toBe(false);
    expect(() => price({}, source)).toThrow();
  });
  test('consumed LF is also a valid canonical base and derived quantities cannot be overridden', () => {
    const source = tree(); source.meta.pricingFormula = 'consumed_linear_feet * linear_foot_rate';
    source.meta.formulaVariables.billed_linear_feet = 999;
    source.meta.formulaVariables.consumed_linear_feet = 999;
    expect(validateTreeHasBasePrice(source).ok).toBe(true);
    const result = price({ printing: 'printed' }, source);
    expect(result.breakdown.basePrice).toBeCloseTo(729.17, 2);
    expect(result.breakdown.optionsPrice).toBe(210);
  });
  test('portable import/export/re-import retains defaults, formulas, roll configuration and price', async () => {
    const item = productImportV2RequestSchema.parse(document()).products[0];
    const imported = buildPbv2ImportProductValues(item, { productTypeId: 'type-roll' });
    const exported = await exportProducts({ db: {} as any, organizationId: 'test' }, [{ ...imported, id: 'test-product' }], new Map(), [{ id: 'type-roll', name: 'Roll' }], []);
    const reimported = buildPbv2ImportProductValues(productImportV2RequestSchema.parse(exported).products[0], { productTypeId: 'type-roll' });
    expect(reimported.pricingProfileConfig).toEqual(imported.pricingProfileConfig);
    expect(reimported.optionTreeJson).toEqual(imported.optionTreeJson);
    expect(reimported.isActive).toBe(false);
    expect(price({ printing: 'printed' }, reimported.optionTreeJson).totalPrice).toBe(945);
  });
});
