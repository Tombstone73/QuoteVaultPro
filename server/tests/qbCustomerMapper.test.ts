/**
 * Unit tests for QB customer mapper helpers.
 * All functions under test are pure (no DB / network calls).
 */

import { isSuspiciousContactName, deriveQBContactName } from '../lib/qbContactHelpers.js';

// ---------------------------------------------------------------------------
// isSuspiciousContactName
// ---------------------------------------------------------------------------

describe('isSuspiciousContactName', () => {
  it.each([
    ['Primary Contact', ''],
    ['primary contact', ''],
    ['  PRIMARY CONTACT  ', ''],
    ['Contact', ''],
    ['contact', ''],
    ['Main Contact', ''],
    ['Customer Contact', ''],
    ['Unknown', ''],
    ['N/A', ''],
    ['na', ''],
    ['None', ''],
    ['No Name', ''],
    ['No Contact', ''],
    ['', ''],
  ])('flags "%s %s" as suspicious', (first, last) => {
    expect(isSuspiciousContactName(first, last)).toBe(true);
  });

  it.each([
    ['John', 'Smith'],
    ['Jane', ''],
    ['Smith', ''],
    ['Alice', 'Johnson'],
    ['Bob', 'Primary'],   // "Bob Primary" is not in the set
    ['', 'Smith'],        // empty first + real last → full = "smith", not in set
  ])('does not flag "%s %s" as suspicious', (first, last) => {
    expect(isSuspiciousContactName(first, last)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deriveQBContactName — helpers for building QB customer objects
// ---------------------------------------------------------------------------

function makeQBCustomer(overrides: Record<string, any> = {}): any {
  return {
    Id: '1',
    DisplayName: '',
    CompanyName: '',
    GivenName: '',
    FamilyName: '',
    ...overrides,
  };
}

describe('deriveQBContactName', () => {
  it('returns null when no name fields are present', () => {
    expect(deriveQBContactName(makeQBCustomer())).toBeNull();
  });

  it('returns null when DisplayName equals CompanyName (company-only record)', () => {
    const qb = makeQBCustomer({ DisplayName: 'Acme Corp', CompanyName: 'Acme Corp' });
    expect(deriveQBContactName(qb)).toBeNull();
  });

  it('returns null when DisplayName equals CompanyName case-insensitively', () => {
    const qb = makeQBCustomer({ DisplayName: 'acme corp', CompanyName: 'Acme Corp' });
    expect(deriveQBContactName(qb)).toBeNull();
  });

  it('uses GivenName + FamilyName when both present', () => {
    const qb = makeQBCustomer({ GivenName: 'John', FamilyName: 'Smith' });
    expect(deriveQBContactName(qb)).toEqual({ firstName: 'John', lastName: 'Smith' });
  });

  it('uses GivenName alone when FamilyName is absent', () => {
    const qb = makeQBCustomer({ GivenName: 'John' });
    expect(deriveQBContactName(qb)).toEqual({ firstName: 'John', lastName: '' });
  });

  it('uses FamilyName as firstName when GivenName is absent (no "Contact" placeholder)', () => {
    const qb = makeQBCustomer({ FamilyName: 'Smith' });
    const result = deriveQBContactName(qb);
    expect(result).toEqual({ firstName: 'Smith', lastName: '' });
    // Crucially: the old code produced { firstName: 'Contact', lastName: 'Smith' }
    expect(result?.firstName).not.toBe('Contact');
  });

  it('falls back to DisplayName when it differs from CompanyName', () => {
    const qb = makeQBCustomer({ DisplayName: 'John Smith', CompanyName: 'Acme Corp' });
    expect(deriveQBContactName(qb)).toEqual({ firstName: 'John Smith', lastName: '' });
  });

  it('does not produce a name when all fields are blank/whitespace', () => {
    const qb = makeQBCustomer({ GivenName: '  ', FamilyName: '\t', DisplayName: '', CompanyName: '' });
    expect(deriveQBContactName(qb)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Regression: records that previously produced "Primary Contact"
// ---------------------------------------------------------------------------

describe('regression — no "Primary Contact" name produced', () => {
  it('company-only record with email returns null name (no contact row will be created)', () => {
    const qb = makeQBCustomer({
      DisplayName: 'Acme Corp',
      CompanyName: 'Acme Corp',
      PrimaryEmailAddr: { Address: 'billing@acme.com' },
    });
    const name = deriveQBContactName(qb);
    // No person name → mapper must return null for contact, not "Primary Contact"
    expect(name).toBeNull();
  });

  it('company-only record with phone returns null name', () => {
    const qb = makeQBCustomer({
      DisplayName: 'Widgets Inc',
      CompanyName: 'Widgets Inc',
      PrimaryPhone: { FreeFormNumber: '555-0100' },
    });
    expect(deriveQBContactName(qb)).toBeNull();
  });

  it('derived name is never the literal "Primary Contact"', () => {
    // Try a variety of inputs that could previously have resulted in the placeholder
    const inputs = [
      makeQBCustomer({ DisplayName: 'Acme', CompanyName: 'Acme' }),
      makeQBCustomer({}),
      makeQBCustomer({ FamilyName: 'Smith' }),
      makeQBCustomer({ GivenName: 'Bob' }),
    ];
    for (const qb of inputs) {
      const result = deriveQBContactName(qb);
      if (result) {
        expect(result.firstName).not.toBe('Primary Contact');
        expect(isSuspiciousContactName(result.firstName, result.lastName)).toBe(false);
      }
    }
  });

  it('existing good contact name is detected as non-suspicious', () => {
    expect(isSuspiciousContactName('John', 'Smith')).toBe(false);
    expect(isSuspiciousContactName('Alice', 'Johnson')).toBe(false);
  });
});
