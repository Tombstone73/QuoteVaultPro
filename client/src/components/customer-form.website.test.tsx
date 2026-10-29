jest.mock("@/hooks/useAuth", () => ({ useAuth: jest.fn() }));

import { customerSchema } from './customer-form';

const websiteSchema = customerSchema.pick({ website: true });

describe('Customer website input', () => {
  it.each(['www.lloydwaters.com', 'example.com', 'https://example.com', 'http://example.com', '  example.com  ', '', undefined])('accepts %s without rewriting submitted text', website => {
    const parsed = websiteSchema.safeParse({ website });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.website).toBe(website);
  });

  it.each(['notawebsite', 'example..com', 'javascript:alert(1)', 'https://user:secret@example.com'])('rejects invalid or unsafe website %s with a field error', website => {
    const parsed = websiteSchema.safeParse({ website });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).toEqual(['website']);
      expect(parsed.error.issues[0].message).toContain('Enter a valid website');
    }
  });
});
