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
