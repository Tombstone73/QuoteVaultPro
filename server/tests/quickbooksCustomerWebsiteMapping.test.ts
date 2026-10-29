import { describe, expect, jest, test, afterEach } from '@jest/globals';
import { mapLocalCustomerToQB } from '../lib/quickbooksCustomerMapping';
import { normalizeOptionalWebsite } from '../../shared/vendorWebsite';

const customer = { id: 'customer-1', organizationId: 'org-1', companyName: 'Lloyd Waters', email: 'synthetic@example.test', externalAccountingId: 'qb-existing' };
afterEach(() => { jest.restoreAllMocks(); });

describe('QuickBooks optional website normalization', () => {
  test.each([
    ['www.lloydwaters.com', 'https://www.lloydwaters.com/'],
    ['https://example.com', 'https://example.com/'],
    ['http://example.com', 'http://example.com/'],
    ['example.com', 'https://example.com/'],
    ['  www.lloydwaters.com  ', 'https://www.lloydwaters.com/'],
    ['https://example.com/path?one=1#section', 'https://example.com/path?one=1#section'],
    ['HTTPS://EXAMPLE.COM', 'https://example.com/'],
  ])('maps %s without mutating the stored website or identity', (website, expected) => {
    const source = { ...customer, website } as any;
    const original = structuredClone(source);
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mapLocalCustomerToQB(source)).toMatchObject({ DisplayName: customer.companyName, CompanyName: customer.companyName, WebAddr: { URI: expected } });
    expect(source).toEqual(original);
    expect(warning).not.toHaveBeenCalled();
  });

  test.each([undefined, null, '', '   '])('omits a blank website (%s) without a warning', website => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mapLocalCustomerToQB({ ...customer, website } as any)).not.toHaveProperty('WebAddr');
    expect(warning).not.toHaveBeenCalled();
  });

  test.each([
    'not a website', 'notawebsite', 'example..com', 'https://-bad.example.com', 'https:///example.com',
    'ftp://example.com', 'javascript:alert(1)', 'data:text/html,example.com',
    'https://user:secret@example.com', 'https://@example.com', 'someone@example.com',
    '//example.com', 'https://%65xample.com', 'https://example.com:', 'example.com\n.evil.com',
    'https://example.com\\@evil.com', 'https://localhost', 'http://127.1',
  ])('omits malformed or unsafe input without logging its value: %s', website => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mapLocalCustomerToQB({ ...customer, website } as any)).not.toHaveProperty('WebAddr');
    expect(warning).toHaveBeenCalledWith('[QuickBooks] Optional customer website omitted', {
      code: 'QB_CUSTOMER_WEBSITE_OMITTED', organizationId: customer.organizationId, customerId: customer.id, reason: 'invalid_or_unsafe_website',
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(website);
  });

  test('does not interpret non-text input as a website', () => {
    expect(normalizeOptionalWebsite({ URI: 'https://example.com/' })).toBeUndefined();
  });
});
