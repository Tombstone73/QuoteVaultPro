/**
 * Generic QuickBooks pagination helper.
 *
 * QB's query API is offset-based: STARTPOSITION starts at 1 and
 * MAXRESULTS caps each page. Pagination ends when a page returns
 * fewer records than the requested page size.
 *
 * The helper is decoupled from makeQBRequest so it can be unit-tested
 * without any network or DB setup.
 */

export const QB_PAGE_SIZE = 1000;
export const QB_MAX_RECORDS_CAP = 10_000;

/**
 * Callback that executes a single QB query and returns the raw API response.
 * The full query string (including STARTPOSITION / MAXRESULTS) is passed in.
 */
export type QBPageFetcher = (query: string) => Promise<any>;

/**
 * Fetch every record of a QB entity, transparently walking pages.
 *
 * @param entityName   - QB QueryResponse key, e.g. "Customer", "Invoice"
 * @param baseQuery    - QB SELECT statement WITHOUT STARTPOSITION/MAXRESULTS
 * @param fetchPage    - Calls the QB query endpoint and returns the raw response
 * @param options.pageSize  - Records per page (default: 1000, QB max)
 * @param options.maxCap    - Hard stop to prevent runaway loops (default: 10,000)
 */
export async function fetchAllQBEntities<T = any>(
  entityName: string,
  baseQuery: string,
  fetchPage: QBPageFetcher,
  options?: { pageSize?: number; maxCap?: number },
): Promise<T[]> {
  const pageSize = options?.pageSize ?? QB_PAGE_SIZE;
  const maxCap = options?.maxCap ?? QB_MAX_RECORDS_CAP;
  const tag = `[QB Paginate:${entityName}]`;

  const allRecords: T[] = [];
  const seenIds = new Set<string>();
  let startPosition = 1;

  while (true) {
    const query = `${baseQuery} STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`;
    const response = await fetchPage(query);

    const page: T[] = Array.isArray(response?.QueryResponse?.[entityName])
      ? (response.QueryResponse[entityName] as T[])
      : [];

    console.log(
      `${tag} startPosition=${startPosition} pageSize=${pageSize} returned=${page.length} aggregate=${allRecords.length + page.length}`,
    );

    for (const record of page) {
      const id = (record as any).Id;
      if (id !== undefined && id !== null) {
        const key = String(id);
        if (seenIds.has(key)) continue;
        seenIds.add(key);
      }
      allRecords.push(record);
    }

    if (page.length < pageSize) break;

    startPosition += pageSize;

    if (allRecords.length >= maxCap) {
      console.warn(
        `${tag} reached safety cap of ${maxCap} records — stopping pagination early. ` +
          'There may be additional records in QuickBooks that were not fetched.',
      );
      break;
    }
  }

  return allRecords;
}
