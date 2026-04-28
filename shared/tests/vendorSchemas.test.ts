import { describe, expect, test } from '@jest/globals';

import { insertVendorSchema } from '../schema';

describe('vendor schema validation', () => {
  test('accepts a minimal vendor payload', () => {
    const result = insertVendorSchema.safeParse({
      name: 'Acme Supply',
    });

    expect(result.success).toBe(true);
  });

  test('accepts blank optional contact fields', () => {
    const result = insertVendorSchema.safeParse({
      name: 'Acme Supply',
      website: '',
      salesRepEmail: '',
      leadTimeText: '',
      additionalContactInfo: '',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.website).toBeUndefined();
      expect(result.data.salesRepEmail).toBeUndefined();
      expect(result.data.leadTimeText).toBeUndefined();
    }
  });

  test('accepts host-only and full-url website values', () => {
    expect(insertVendorSchema.safeParse({ name: 'Acme Supply', website: 'example.com' }).success).toBe(true);
    expect(insertVendorSchema.safeParse({ name: 'Acme Supply', website: 'www.example.com' }).success).toBe(true);
    expect(insertVendorSchema.safeParse({ name: 'Acme Supply', website: 'https://example.com' }).success).toBe(true);
  });

  test('rejects invalid sales rep email', () => {
    const result = insertVendorSchema.safeParse({
      name: 'Acme Supply',
      salesRepEmail: 'not-an-email',
    });

    expect(result.success).toBe(false);
  });
});