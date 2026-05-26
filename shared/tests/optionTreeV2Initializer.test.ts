import { describe, test, expect } from '@jest/globals';
import { optionTreeV2Schema } from '../optionTreeV2';
import { buildOptionTreeV2FromLegacyOptions } from '../optionTreeV2Initializer';

describe('Option Tree v2 initializer', () => {
  test('schema accepts formula pricing impacts and numeric selection keys', () => {
    const parsed = optionTreeV2Schema.parse({
      schemaVersion: 2,
      rootNodeIds: ['custom_qty'],
      nodes: {
        custom_qty: {
          id: 'custom_qty',
          kind: 'question',
          label: 'Custom Quantity',
          input: {
            type: 'number',
            selectionKey: 'custom_qty',
            valueType: 'number',
          },
          pricingImpact: [{ mode: 'addFormula', formula: 'custom_qty * 0.25 * q' }],
        },
      },
    });

    expect(parsed.nodes.custom_qty.pricingImpact?.[0]).toEqual({
      mode: 'addFormula',
      formula: 'custom_qty * 0.25 * q',
    });
  });

  test('schema accepts high-precision pricingV2 base and tier rates', () => {
    const parsed = optionTreeV2Schema.parse({
      schemaVersion: 2,
      rootNodeIds: [],
      nodes: {},
      meta: {
        pricingV2: {
          base: {
            perSqftCents: 137.5,
            perPieceCents: 12.345,
            minimumChargeCents: 1000.5,
          },
          qtyTiers: [
            { minQty: 1, perSqftCents: 137.5 },
          ],
        },
      },
    });

    expect(parsed.meta?.pricingV2?.base?.perSqftCents).toBe(137.5);
    expect(parsed.meta?.pricingV2?.qtyTiers?.[0]?.perSqftCents).toBe(137.5);
  });

  test('schema still rejects fractional tier count fields', () => {
    const result = optionTreeV2Schema.safeParse({
      schemaVersion: 2,
      rootNodeIds: [],
      nodes: {},
      meta: {
        pricingV2: {
          qtyTiers: [
            { minQty: 1.5, perSqftCents: 137.5 },
          ],
        },
      },
    });

    expect(result.success).toBe(false);
  });

  test('maps legacy priceMode values to valid v2 pricingImpact modes', () => {
    const legacyOptionsJson = [
      {
        id: 'rush',
        label: 'Rush',
        type: 'toggle',
        priceMode: 'flat',
        amount: 25,
        required: false,
        sortOrder: 1,
        groupKey: 'finishing',
        groupLabel: 'Finishing',
      },
      {
        id: 'grommets',
        label: 'Grommets',
        type: 'quantity',
        priceMode: 'per_qty',
        amount: 0.5,
        required: false,
        sortOrder: 2,
        groupKey: 'finishing',
        groupLabel: 'Finishing',
      },
      {
        id: 'polePockets',
        label: 'Pole Pockets',
        type: 'select',
        priceMode: 'flat_per_item',
        amount: 10,
        required: false,
        sortOrder: 3,
        groupKey: 'finishing',
        groupLabel: 'Finishing',
        choices: [
          { value: 'none', label: 'None' },
          { value: 'top', label: 'Top' },
          { value: 'bottom', label: 'Bottom' },
        ],
        defaultValue: 'none',
      },
      {
        id: 'markup',
        label: 'Markup',
        type: 'toggle',
        priceMode: 'percent_of_base',
        amount: 10,
        required: false,
        sortOrder: 4,
        groupKey: 'pricing',
        groupLabel: 'Pricing',
      },
      {
        id: 'mult',
        label: 'Multiplier',
        type: 'toggle',
        priceMode: 'multiplier',
        amount: 1.2,
        required: false,
        sortOrder: 5,
        groupKey: 'pricing',
        groupLabel: 'Pricing',
      },
    ];

    const tree = buildOptionTreeV2FromLegacyOptions(legacyOptionsJson);

    // Must pass the same schema used by /api/quotes/calculate
    const parsed = optionTreeV2Schema.parse(tree);

    const allModes: string[] = [];
    for (const node of Object.values(parsed.nodes)) {
      for (const impact of node.pricingImpact || []) {
        allModes.push((impact as any).mode);
      }
    }

    // No legacy modes should appear
    expect(allModes).not.toContain('flat');
    expect(allModes).not.toContain('flat_per_item');
    expect(allModes).not.toContain('per_qty');
    expect(allModes).not.toContain('per_sqft');
    expect(allModes).not.toContain('percent_of_base');

    // Only v2 discriminators should appear
    for (const m of allModes) {
      expect(['addFlat', 'addPerQty', 'addPerSqft', 'percentOfBase', 'multiplier']).toContain(m);
    }
  });
});
