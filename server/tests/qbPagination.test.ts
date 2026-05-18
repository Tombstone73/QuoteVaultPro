import { describe, expect, test, jest } from '@jest/globals';
import { fetchAllQBEntities, QB_PAGE_SIZE, QB_MAX_RECORDS_CAP } from '../lib/qbPaginationHelper.js';

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
