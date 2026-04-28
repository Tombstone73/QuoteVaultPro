import { describe, expect, test } from '@jest/globals';

import { insertVendorSchema, updateVendorSchema } from '../schema';

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

  test('normalizes host-only and full-url website values', () => {
    const hostOnly = insertVendorSchema.safeParse({ name: 'Acme Supply', website: 'example.com' });
    const wwwOnly = insertVendorSchema.safeParse({ name: 'Acme Supply', website: 'www.example.com' });
    const httpsUrl = insertVendorSchema.safeParse({ name: 'Acme Supply', website: 'https://example.com' });
    const httpUrl = insertVendorSchema.safeParse({ name: 'Acme Supply', website: 'http://example.com' });

    expect(hostOnly.success).toBe(true);
    expect(wwwOnly.success).toBe(true);
    expect(httpsUrl.success).toBe(true);
    expect(httpUrl.success).toBe(true);

    if (hostOnly.success) {
      expect(hostOnly.data.website).toBe('https://example.com/');
    }
    if (wwwOnly.success) {
      expect(wwwOnly.data.website).toBe('https://www.example.com/');
    }
    if (httpsUrl.success) {
      expect(httpsUrl.data.website).toBe('https://example.com/');
    }
    if (httpUrl.success) {
      expect(httpUrl.data.website).toBe('http://example.com/');
    }
  });

  test('rejects invalid website with a helpful message', () => {
    const result = insertVendorSchema.safeParse({ name: 'Acme Supply', website: 'notawebsite' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Website must be a valid domain or URL');
    }
  });

  test('rejects invalid sales rep email', () => {
    const result = insertVendorSchema.safeParse({
      name: 'Acme Supply',
      salesRepEmail: 'not-an-email',
    });

    expect(result.success).toBe(false);
  });

  test('update schema accepts and normalizes website values', () => {
    const result = updateVendorSchema.safeParse({
      website: 'example.com',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.website).toBe('https://example.com/');
    }
  });
});