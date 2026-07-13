import { describe, expect, test, jest, beforeAll } from '@jest/globals';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { fetchAllQBEntities, QB_PAGE_SIZE, QB_MAX_RECORDS_CAP } from '../lib/qbPaginationHelper.js';

// ESM-safe __dirname replacement
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(id: number | string): { Id: string; Name: string } {
  return { Id: String(id), Name: `Record-${id}` };
}

/**
 * Build a mock QBPageFetcher that returns pages from a pre-built flat record list.
 * Parses STARTPOSITION and MAXRESULTS out of the query string to simulate QB pagination.
 */
function makePaginatedFetcher(
  allRecords: any[],
  entityName: string,
): (query: string) => Promise<any> {
  return async (query: string) => {
    const startMatch = query.match(/STARTPOSITION\s+(\d+)/i);
    const maxMatch = query.match(/MAXRESULTS\s+(\d+)/i);
    const start = startMatch ? parseInt(startMatch[1], 10) : 1;
    const max = maxMatch ? parseInt(maxMatch[1], 10) : QB_PAGE_SIZE;
    const offset = start - 1;
    const page = allRecords.slice(offset, offset + max);
    return { QueryResponse: { [entityName]: page } };
  };
}

// ---------------------------------------------------------------------------
// Core pagination behaviour
// ---------------------------------------------------------------------------

describe('fetchAllQBEntities', () => {
  test('returns empty array when QB returns no records', async () => {
    const fetcher = makePaginatedFetcher([], 'Customer');
    const result = await fetchAllQBEntities('Customer', 'SELECT * FROM Customer', fetcher);
    expect(result).toEqual([]);
  });

  test('fetches exactly 100 records (single page, pageSize=100)', async () => {
    const source = Array.from({ length: 100 }, (_, i) => makeRecord(i + 1));
    const fetcher = makePaginatedFetcher(source, 'Customer');
    const result = await fetchAllQBEntities('Customer', 'SELECT * FROM Customer', fetcher, { pageSize: 100 });
    expect(result).toHaveLength(100);
    expect(result[0]).toEqual(makeRecord(1));
    expect(result[99]).toEqual(makeRecord(100));
  });

  test('fetches 250 records across 3 pages (pageSize=100)', async () => {
    const source = Array.from({ length: 250 }, (_, i) => makeRecord(i + 1));
    const fetcher = makePaginatedFetcher(source, 'Invoice');
    const result = await fetchAllQBEntities('Invoice', 'SELECT * FROM Invoice', fetcher, { pageSize: 100 });
    expect(result).toHaveLength(250);
    expect(result[249]).toEqual(makeRecord(250));
  });

  test('handles exact page multiple (200 records, pageSize=100) — stops after 2nd page', async () => {
    const source = Array.from({ length: 200 }, (_, i) => makeRecord(i + 1));
    let callCount = 0;
    const trackingFetcher = async (query: string) => {
      callCount++;
      return makePaginatedFetcher(source, 'Payment')(query);
    };
    const result = await fetchAllQBEntities('Payment', 'SELECT * FROM Payment', trackingFetcher, { pageSize: 100 });
    // Page 1: 100 records (full) → fetch page 2
    // Page 2: 100 records (full) → fetch page 3
    // Page 3: 0 records (empty, < pageSize) → stop
    expect(callCount).toBe(3);
    expect(result).toHaveLength(200);
  });

  test('deduplicates records with duplicate Ids across pages', async () => {
    const rec1 = makeRecord(1);
    const rec2 = makeRecord(2);
    const rec3 = makeRecord(1); // duplicate Id
    let call = 0;
    const fetcher = async (_query: string) => {
      call++;
      if (call === 1) return { QueryResponse: { Customer: [rec1, rec2] } };
      // Simulate a second page that unexpectedly echoes rec1 with the same Id
      return { QueryResponse: { Customer: [rec3] } };
    };
    // With pageSize=2, first page is full so a second page is requested
    const result = await fetchAllQBEntities('Customer', 'SELECT * FROM Customer', fetcher, { pageSize: 2 });
    const ids = result.map((r: any) => r.Id);
    expect(ids).not.toContain('1' + '_dup'); // sanity
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length); // no duplicates
    expect(result).toHaveLength(2); // rec3 (Id=1) deduplicated out
  });

  test('stops at the safety cap and does not throw', async () => {
    // Infinite source: always returns a full page
    const cap = 500;
    let callCount = 0;
    const infiniteFetcher = async (query: string) => {
      const maxMatch = query.match(/MAXRESULTS\s+(\d+)/i);
      const pageSize = maxMatch ? parseInt(maxMatch[1], 10) : 100;
      const startMatch = query.match(/STARTPOSITION\s+(\d+)/i);
      const start = startMatch ? parseInt(startMatch[1], 10) : 1;
      callCount++;
      const page = Array.from({ length: pageSize }, (_, i) => makeRecord(start + i));
      return { QueryResponse: { Item: page } };
    };
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await fetchAllQBEntities('Item', 'SELECT * FROM Item', infiniteFetcher, {
        pageSize: 100,
        maxCap: cap,
      });
      expect(result.length).toBeLessThanOrEqual(cap + 100); // may slightly overshoot by one page
      expect(result.length).toBeGreaterThanOrEqual(cap);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('safety cap'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('passes STARTPOSITION and MAXRESULTS in query string', async () => {
    const queries: string[] = [];
    const source = Array.from({ length: 150 }, (_, i) => makeRecord(i + 1));
    const trackingFetcher = async (query: string) => {
      queries.push(query);
      return makePaginatedFetcher(source, 'Vendor')(query);
    };
    await fetchAllQBEntities('Vendor', 'SELECT * FROM Vendor', trackingFetcher, { pageSize: 100 });
    expect(queries[0]).toMatch(/STARTPOSITION 1/);
    expect(queries[0]).toMatch(/MAXRESULTS 100/);
    expect(queries[1]).toMatch(/STARTPOSITION 101/);
    expect(queries[1]).toMatch(/MAXRESULTS 100/);
  });

  test('returns empty array when QueryResponse entity key is absent', async () => {
    const fetcher = async (_query: string) => ({ QueryResponse: {} });
    const result = await fetchAllQBEntities('SalesReceipt', 'SELECT * FROM SalesReceipt', fetcher);
    expect(result).toEqual([]);
  });

  test('handles records without an Id field (no deduplication crash)', async () => {
    let call = 0;
    const fetcher = async (_query: string) => {
      call++;
      if (call === 1) return { QueryResponse: { Term: [{ Name: 'Net 30' }, { Name: 'Net 60' }] } };
      return { QueryResponse: { Term: [] } };
    };
    const result = await fetchAllQBEntities('Term', 'SELECT * FROM Term', fetcher, { pageSize: 2 });
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Entity-name coverage — verifies helper works for all QB entity keys
// ---------------------------------------------------------------------------

describe('fetchAllQBEntities entity name coverage', () => {
  const entities = ['Customer', 'Invoice', 'Payment', 'Item', 'Vendor', 'SalesReceipt', 'Estimate', 'Term'];

  for (const entityName of entities) {
    test(`works for entity "${entityName}"`, async () => {
      const source = [makeRecord(1), makeRecord(2)];
      const fetcher = makePaginatedFetcher(source, entityName);
      const result = await fetchAllQBEntities(entityName, `SELECT * FROM ${entityName}`, fetcher, { pageSize: 100 });
      expect(result).toHaveLength(2);
    });
  }
});

// ---------------------------------------------------------------------------
// No permanent writes during preview pagination
// ---------------------------------------------------------------------------

describe('preview pagination — no writes', () => {
  test('fetchAllQBEntities is a pure read function (no side-effect APIs called)', async () => {
    // The helper only calls the fetchPage callback; it has no DB or write surface.
    // Verify that the fetcher is the ONLY external call made.
    const fetcherCalls: string[] = [];
    const source = Array.from({ length: 50 }, (_, i) => makeRecord(i + 1));
    const fetcher = async (query: string) => {
      fetcherCalls.push(query);
      return makePaginatedFetcher(source, 'Customer')(query);
    };
    await fetchAllQBEntities('Customer', 'SELECT * FROM Customer', fetcher, { pageSize: 100 });
    // Only one page needed (50 < 100)
    expect(fetcherCalls).toHaveLength(1);
    // No DB or write calls can be verified here since the helper has no DB dependency
  });
});

// ---------------------------------------------------------------------------
// Static source audit — catches regressions where a bulk QB fetch bypasses
// fetchAllQBEntities and goes directly to makeQBRequest with a bare query.
//
// Audit logic:
//   Every QB query that retrieves a variable-sized set of records MUST either:
//     (a) pass its query string as an argument to fetchAllQBEntities, or
//     (b) be a bounded batch using WHERE Id IN (...) with MAXRESULTS ${QB_BATCH_SIZE}
//
//   The only permitted bare makeQBRequest query calls are:
//     - Single-record idempotency lookups: MAXRESULTS 1
//     - Single-record GET by ID:           /customer/{id}, /invoice/{id}, etc.
//
// Flows NOT YET IMPLEMENTED (no bulk import exists for these entities):
//   Payment  — only push (single-record CREATE/UPDATE) and MAXRESULTS 1 idempotency lookup
//   Item     — not implemented
//   Vendor   — not implemented
//   Term     — not implemented
//   Estimate — not implemented
//   Account / AR aging — not implemented
// ---------------------------------------------------------------------------

describe('quickbooksService.ts — static pagination contract audit', () => {
  let lines: string[];

  beforeAll(() => {
    const filePath = path.resolve(__dirname, '../quickbooksService.ts');
    lines = readFileSync(filePath, 'utf-8').split('\n');
  });

  // Returns non-comment source lines matching a pattern.
  function sourceLinesMatching(re: RegExp): string[] {
    return lines.filter(l => re.test(l) && !/^\s*\/\//.test(l));
  }

  // ── Customer ────────────────────────────────────────────────────────────────

  test('Customer preview uses fetchAllQBEntities', () => {
    // fetchQBCustomersForPreview: SELECT * FROM Customer is a string arg, not a makeQBRequest call
    const customerQueryLines = sourceLinesMatching(/SELECT \* FROM Customer/);
    expect(customerQueryLines.length).toBeGreaterThan(0);
    for (const line of customerQueryLines) {
      expect(line).not.toMatch(/makeQBRequest/);
    }
  });

  test('Customer pull sync uses fetchAllQBEntities', () => {
    // processPullCustomers, inspection fallback, and migration source retrieval: same query, also string args
    const customerQueryLines = sourceLinesMatching(/SELECT \* FROM Customer(?!.*WHERE)/);
    // Preview, migration source retrieval, inspection fallback, and pull-sync use the same query text; none should be a bare makeQBRequest
    expect(customerQueryLines.every(l => !l.includes('makeQBRequest'))).toBe(true);
    // Exactly 4 occurrences: preview + migration source retrieval + inspection fallback + pull-sync
    expect(customerQueryLines).toHaveLength(4);
  });

  // ── Invoice ─────────────────────────────────────────────────────────────────

  test('Invoice preview uses fetchAllQBEntities', () => {
    // fetchQBInvoicesForPreview: SELECT * FROM Invoice (no WHERE clause) is a string arg
    const allInvoiceLines = sourceLinesMatching(/SELECT \* FROM Invoice/);
    const unboundedLines = allInvoiceLines.filter(l => !/WHERE Id IN/.test(l));
    expect(unboundedLines.length).toBeGreaterThan(0);
    for (const line of unboundedLines) {
      expect(line).not.toMatch(/makeQBRequest/);
    }
  });

  test('Invoice pull sync uses fetchAllQBEntities', () => {
    // processPullInvoices: SELECT * FROM Invoice (no WHERE clause) — 2 unbounded occurrences: preview + pull-sync
    const allInvoiceLines = sourceLinesMatching(/SELECT \* FROM Invoice/);
    const unboundedLines = allInvoiceLines.filter(l => !/WHERE Id IN/.test(l));
    expect(unboundedLines).toHaveLength(2);
  });

  test('Invoice confirmed import uses bounded WHERE Id IN batches (not full-table scan)', () => {
    // importQBInvoicesByIds: SELECT * FROM Invoice WHERE Id IN (...) — bounded by caller IDs
    const batchLines = sourceLinesMatching(/SELECT \* FROM Invoice.*WHERE Id IN/);
    expect(batchLines.length).toBeGreaterThan(0);
    for (const line of batchLines) {
      // Must use QB_BATCH_SIZE variable, not a hardcoded small number
      expect(line).toMatch(/MAXRESULTS \$\{QB_BATCH_SIZE\}/);
      expect(line).not.toMatch(/MAXRESULTS 200/);
      expect(line).not.toMatch(/MAXRESULTS 100/);
    }
  });

  // ── SalesReceipt / Orders ───────────────────────────────────────────────────

  test('SalesReceipt pull sync uses fetchAllQBEntities', () => {
    const srLines = sourceLinesMatching(/SELECT \* FROM SalesReceipt/);
    expect(srLines.length).toBeGreaterThan(0);
    for (const line of srLines) {
      expect(line).not.toMatch(/makeQBRequest/);
    }
    expect(srLines).toHaveLength(1);
  });

  // ── Intentional MAXRESULTS 1 lookups (single-record idempotency) ─────────────

  test('Customer idempotency lookup uses MAXRESULTS 1 (intentional single-record)', () => {
    const lines = sourceLinesMatching(/SELECT Id.*FROM Customer.*MAXRESULTS 1/);
    expect(lines).toHaveLength(1);
  });

  test('Invoice idempotency lookup uses MAXRESULTS 1 (intentional single-record)', () => {
    const lines = sourceLinesMatching(/SELECT Id.*FROM Invoice.*MAXRESULTS 1/);
    expect(lines).toHaveLength(2);
  });

  test('Payment idempotency lookup uses MAXRESULTS 1 (intentional single-record)', () => {
    const lines = sourceLinesMatching(/SELECT Id FROM Payment.*MAXRESULTS 1/);
    expect(lines).toHaveLength(1);
  });

  // ── No remaining hardcoded MAXRESULTS cap for bulk queries ──────────────────

  test('no hardcoded MAXRESULTS numeric cap (other than 1) exists for bulk queries', () => {
    // All remaining MAXRESULTS usages must be either:
    //   MAXRESULTS 1   — single-record idempotency lookup
    //   MAXRESULTS ${pageSize}    — inside the pagination helper itself
    //   MAXRESULTS ${QB_BATCH_SIZE} — bounded batch import by caller-supplied IDs
    const maxResultsLines = sourceLinesMatching(/MAXRESULTS/);
    for (const line of maxResultsLines) {
      const isIdempotency = /MAXRESULTS 1[^0-9]/.test(line) || /MAXRESULTS 1$/.test(line.trim());
      const isHelperVar = /MAXRESULTS \$\{pageSize\}/.test(line);
      const isBatchVar = /MAXRESULTS \$\{QB_BATCH_SIZE\}/.test(line);
      const isBoundedCustomerSearch = /SELECT \* FROM Customer WHERE (DisplayName|CompanyName|FullyQualifiedName)/.test(line) && /MAXRESULTS 20/.test(line);
      if (!isIdempotency && !isHelperVar && !isBatchVar && !isBoundedCustomerSearch) {
        throw new Error(
          `quickbooksService.ts contains an unexpected MAXRESULTS pattern that may be a first-page-only fetch:\n  ${line.trim()}`
        );
      }
    }
  });

  // ── Not-implemented flows (document absence, catch accidental first-page adds) ──

  test.each(['Payment', 'Item', 'Vendor', 'Term', 'Estimate'])(
    'no unbounded SELECT * FROM %s bulk query exists (flow not yet implemented)',
    (entity) => {
      // There should be no "SELECT * FROM <Entity>" without a WHERE clause.
      // If someone adds one they MUST also use fetchAllQBEntities or this test fails.
      const unboundedBulk = sourceLinesMatching(
        new RegExp(`SELECT \\* FROM ${entity}(?!.*WHERE)`)
      );
      // Filter out lines that are already string args to fetchAllQBEntities
      const bareRequests = unboundedBulk.filter(l => l.includes('makeQBRequest'));
      expect(bareRequests).toHaveLength(0);
    }
  );
});
