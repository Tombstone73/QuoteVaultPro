import { describe, expect, test } from '@jest/globals';
import {
  validatePricingPreviewRequest,
  zodIssuesToPreviewDetails,
  buildPreviewErrorEnvelope,
  PBV2_INVALID_PREVIEW_PAYLOAD,
} from '../services/pricing/pricingPreviewValidation';

describe('validatePricingPreviewRequest', () => {
  const validTree = { nodes: {} };

  // Regression guard: a valid preview payload must continue to normalize and
  // must NOT be rejected, so valid previews still calculate downstream.
  test('accepts and normalizes a valid payload', () => {
    const result = validatePricingPreviewRequest({
      treeJson: validTree,
      width: 24,
      height: 36,
      quantity: 2,
      optionSelectionsJson: { grommets: { value: 'corners' } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized.widthNum).toBe(24);
      expect(result.normalized.heightNum).toBe(36);
      expect(result.normalized.quantityNum).toBe(2);
      expect(result.normalized.pbv2ExplicitSelections).toEqual({ grommets: { value: 'corners' } });
    }
  });

  test('invalid preview payload returns structured details', () => {
    const result = validatePricingPreviewRequest({ width: 0, height: -2, quantity: 'abc' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.envelope.success).toBe(false);
      expect(result.envelope.message).toBe('Invalid preview payload');
      expect(result.envelope.errorCode).toBe(PBV2_INVALID_PREVIEW_PAYLOAD);

      const paths = result.envelope.details.map((d) => d.path);
      expect(paths).toEqual(expect.arrayContaining(['treeJson', 'width', 'height', 'quantity']));

      const widthDetail = result.envelope.details.find((d) => d.path === 'width');
      expect(widthDetail?.message).toMatch(/positive number/i);
      expect(widthDetail?.expected).toBeDefined();
      expect(widthDetail?.received).toBe('0');
    }
  });

  test('rejects malformed optionSelectionsJson string with a detail', () => {
    const result = validatePricingPreviewRequest({
      treeJson: validTree,
      width: 10,
      height: 10,
      quantity: 1,
      optionSelectionsJson: '{not json',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.envelope.details.some((d) => d.path === 'optionSelectionsJson')).toBe(true);
    }
  });

  test('parses optionSelectionsJson supplied as a JSON string', () => {
    const result = validatePricingPreviewRequest({
      treeJson: validTree,
      width: 10,
      height: 10,
      quantity: 1,
      optionSelectionsJson: JSON.stringify({ size: { value: 'large' } }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized.pbv2ExplicitSelections).toEqual({ size: { value: 'large' } });
    }
  });

  test('normalizes PBV2 preview payload without legacy variant or product-option data', () => {
    const result = validatePricingPreviewRequest({
      treeJson: validTree,
      width: 24,
      height: 18,
      quantity: 10,
      optionSelectionsJson: { rate: { value: 'standard' } },
      variants: [{ id: 'legacy_variant', basePricePerSqft: 999 }],
      productOptions: [{ id: 'legacy_option', setupCost: 999 }],
      optionsJson: [{ id: 'legacy_inline_option', defaultValue: true }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized).toEqual({
        treeJson: validTree,
        widthNum: 24,
        heightNum: 18,
        quantityNum: 10,
        pbv2ExplicitSelections: { rate: { value: 'standard' } },
      });
      expect(result.normalized).not.toHaveProperty('variants');
      expect(result.normalized).not.toHaveProperty('productOptions');
      expect(result.normalized).not.toHaveProperty('optionsJson');
    }
  });

  test('derives dimensions from fixed-size PBV2 metadata when width and height are omitted', () => {
    const result = validatePricingPreviewRequest({
      treeJson: {
        ...validTree,
        meta: {
          requiresDimensions: false,
          fixedDimensions: { widthIn: 24, heightIn: 18, unit: "in", label: '24" x 18"' },
        },
      },
      quantity: 25,
      optionSelectionsJson: { printed_sides: { value: 'single_sided' } },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized.widthNum).toBe(24);
      expect(result.normalized.heightNum).toBe(18);
      expect(result.normalized.quantityNum).toBe(25);
    }
  });

  test('accepts a per-piece matrix preview with no dimensions and no square-foot base rate', () => {
    const result = validatePricingPreviewRequest({
      treeJson: {
        ...validTree,
        meta: {
          pricingProfileKey: "qty_only",
          pricingV2: { optionMatrixPricingUnit: "per_piece", base: { perSqftCents: null } },
        },
      },
      quantity: 2,
      optionSelectionsJson: { thickness: { value: "3mm" }, printed_sides: { value: "Single-sided" } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized.widthNum).toBe(0);
      expect(result.normalized.heightNum).toBe(0);
    }
  });

  test('continues to require dimensions for a square-foot preview', () => {
    const result = validatePricingPreviewRequest({
      treeJson: { ...validTree, meta: { pricingV2: { optionMatrixPricingUnit: "per_square_foot", base: { perSqftCents: 500 } } } },
      quantity: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.envelope.details.map((detail) => detail.path)).toEqual(expect.arrayContaining(["width", "height"]));
  });
});

describe('zodIssuesToPreviewDetails', () => {
  test('maps zod issues to dotted paths and messages', () => {
    const details = zodIssuesToPreviewDetails([
      { path: ['selections', 'grommets'], message: 'Required', expected: 'string', received: 'undefined' },
    ]);
    expect(details).toHaveLength(1);
    expect(details[0].path).toBe('selections.grommets');
    expect(details[0].message).toBe('Required');
    expect(details[0].expected).toBe('string');
  });

  test('returns an empty array for non-array input', () => {
    expect(zodIssuesToPreviewDetails(undefined)).toEqual([]);
    expect(zodIssuesToPreviewDetails(null)).toEqual([]);
  });
});

describe('buildPreviewErrorEnvelope', () => {
  test('produces the preferred error envelope shape', () => {
    const envelope = buildPreviewErrorEnvelope('Invalid preview payload', [
      { path: 'width', message: 'Width must be a positive number.' },
    ]);
    expect(envelope).toMatchObject({
      success: false,
      message: 'Invalid preview payload',
      errorCode: PBV2_INVALID_PREVIEW_PAYLOAD,
    });
    expect(envelope.details).toHaveLength(1);
  });
});
