import { describe, test, expect } from '@jest/globals';
import { optionTreeV2Schema } from '../optionTreeV2';
import { buildOptionTreeV2FromLegacyOptions } from '../optionTreeV2Initializer';

describe('Option Tree v2 initializer', () => {
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
