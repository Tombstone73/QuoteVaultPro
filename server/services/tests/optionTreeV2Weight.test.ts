import { describe, test, expect } from '@jest/globals';
import { pbv2ToWeightTotal } from '../optionTreeV2Evaluator';
import type { OptionTreeV2, LineItemOptionSelectionsV2 } from '../../../shared/optionTreeV2';

describe('pbv2ToWeightTotal', () => {
  test('calculates base weight only', () => {
    const tree: OptionTreeV2 = {
      schemaVersion: 2,
      rootNodeIds: [],
      nodes: {},
      meta: {
        baseWeightOz: 10.5,
      },
    };

    const selections: LineItemOptionSelectionsV2 = {
      schemaVersion: 2,
      selected: {},
    };

    const result = pbv2ToWeightTotal({
      tree,
      selections,
      quantity: 1,
    });

    expect(result.totalOz).toBe(10.5);
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0]).toEqual({ label: 'Base weight', oz: 10.5 });
  });

  test('calculates addPerQty weight impact', () => {
    const tree: OptionTreeV2 = {
      schemaVersion: 2,
      rootNodeIds: ['node1'],
      nodes: {
        node1: {
          id: 'node1',
          kind: 'question',
          label: 'Grommets',
          input: { type: 'boolean' },
          weightImpact: [{ mode: 'addPerQty', oz: 0.5 }],
        },
      },
    };

    const selections: LineItemOptionSelectionsV2 = {
      schemaVersion: 2,
      selected: {
        node1: { value: true },
      },
    };

    const result = pbv2ToWeightTotal({
      tree,
      selections,
      quantity: 10,
    });

    expect(result.totalOz).toBe(5); // 0.5 * 10
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0]).toEqual({ label: 'Weight: Grommets', oz: 5 });
  });

  test('calculates addPerSqft weight impact', () => {
    const tree: OptionTreeV2 = {
      schemaVersion: 2,
      rootNodeIds: ['node1'],
      nodes: {
        node1: {
          id: 'node1',
          kind: 'question',
          label: 'Lamination',
          input: { type: 'boolean' },
          weightImpact: [{ mode: 'addPerSqft', oz: 2 }],
        },
      },
    };

    const selections: LineItemOptionSelectionsV2 = {
      schemaVersion: 2,
      selected: {
        node1: { value: true },
      },
    };

    const result = pbv2ToWeightTotal({
      tree,
      selections,
      widthIn: 24,
      heightIn: 48,
      quantity: 1,
    });

    // 24 * 48 = 1152 sq in = 8 sq ft
    // 2 oz/sqft * 8 sqft = 16 oz
    expect(result.totalOz).toBe(16);
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0]).toEqual({ label: 'Weight: Lamination', oz: 16 });
  });

  test('calculates choice weightOz with quantity', () => {
    const tree: OptionTreeV2 = {
      schemaVersion: 2,
      rootNodeIds: ['node1'],
      nodes: {
        node1: {
          id: 'node1',
          kind: 'question',
          label: 'Material',
          input: { type: 'select' },
          choices: [
            { value: 'vinyl', label: 'Vinyl', weightOz: 2.5 },
            { value: 'fabric', label: 'Fabric', weightOz: 1.8 },
          ],
        },
      },
    };

    const selections: LineItemOptionSelectionsV2 = {
      schemaVersion: 2,
      selected: {
        node1: { value: 'vinyl' },
      },
    };

    const result = pbv2ToWeightTotal({
      tree,
      selections,
      quantity: 5,
    });

    expect(result.totalOz).toBe(12.5); // 2.5 * 5
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0]).toEqual({ label: 'Material: Vinyl', oz: 12.5 });
  });

  test('combines base weight, impacts, and choice weights', () => {
    const tree: OptionTreeV2 = {
      schemaVersion: 2,
      rootNodeIds: ['node1', 'node2'],
      nodes: {
        node1: {
          id: 'node1',
          kind: 'question',
          label: 'Grommets',
          input: { type: 'boolean' },
          weightImpact: [{ mode: 'addPerQty', oz: 0.5 }],
        },
        node2: {
          id: 'node2',
          kind: 'question',
          label: 'Material',
          input: { type: 'select' },
          choices: [
            { value: 'vinyl', label: 'Vinyl', weightOz: 2 },
          ],
        },
      },
      meta: {
        baseWeightOz: 5,
      },
    };

    const selections: LineItemOptionSelectionsV2 = {
      schemaVersion: 2,
      selected: {
        node1: { value: true },
        node2: { value: 'vinyl' },
      },
    };

    const result = pbv2ToWeightTotal({
      tree,
      selections,
      quantity: 3,
    });

    // Base: 5, Grommets: 0.5*3=1.5, Material: 2*3=6
    expect(result.totalOz).toBe(12.5);
    expect(result.breakdown).toHaveLength(3);
    expect(result.breakdown[0]).toEqual({ label: 'Base weight', oz: 5 });
    expect(result.breakdown[1]).toEqual({ label: 'Weight: Grommets', oz: 1.5 });
    expect(result.breakdown[2]).toEqual({ label: 'Material: Vinyl', oz: 6 });
  });

  test('handles missing dimensions for addPerSqft (safe default to 0)', () => {
    const tree: OptionTreeV2 = {
      schemaVersion: 2,
      rootNodeIds: ['node1'],
      nodes: {
        node1: {
          id: 'node1',
          kind: 'question',
          label: 'Lamination',
          input: { type: 'boolean' },
          weightImpact: [{ mode: 'addPerSqft', oz: 2 }],
        },
      },
    };

    const selections: LineItemOptionSelectionsV2 = {
      schemaVersion: 2,
      selected: {
        node1: { value: true },
      },
    };

    const result = pbv2ToWeightTotal({
      tree,
      selections,
      quantity: 1,
      // No dimensions provided
    });

    // areaSqft = 0, so contribution = 0
    expect(result.totalOz).toBe(0);
    expect(result.breakdown).toHaveLength(0);
  });

  test('respects custom label on weightImpact', () => {
    const tree: OptionTreeV2 = {
      schemaVersion: 2,
      rootNodeIds: ['node1'],
      nodes: {
        node1: {
          id: 'node1',
          kind: 'question',
          label: 'Rush',
          input: { type: 'boolean' },
          weightImpact: [{ mode: 'addFlat', oz: 3, label: 'Extra packaging' }],
        },
      },
    };

    const selections: LineItemOptionSelectionsV2 = {
      schemaVersion: 2,
      selected: {
        node1: { value: true },
      },
    };

    const result = pbv2ToWeightTotal({
      tree,
      selections,
      quantity: 1,
    });

    expect(result.totalOz).toBe(3);
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0]).toEqual({ label: 'Extra packaging', oz: 3 });
  });
});
