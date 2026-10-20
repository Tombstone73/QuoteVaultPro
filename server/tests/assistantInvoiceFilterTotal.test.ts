import { describe, expect, jest, test } from '@jest/globals';
import { createAssistantInvoiceFilterTotalToolAdapters } from '../services/assistant/invoiceFilterTotalTools';
import type { AssistantTrustedToolContext } from '../services/assistant/toolRegistry';
import type { listInvoicesPageForOrganization } from '../invoicesService';

jest.mock('../invoicesService', () => ({ listInvoicesPageForOrganization: jest.fn() }));

const context = (overrides: Partial<AssistantTrustedToolContext> = {}): AssistantTrustedToolContext => ({
  scope: { organizationId: 'org_one', userId: 'staff_one' },
  actor: { userId: 'staff_one', email: null }, permissions: ['finance.read'], correlationId: 'corr_one',
  signal: new AbortController().signal,
  context: { contextVersion: 1, route: '/invoices', pageTitle: 'Invoices', entityType: 'invoice', entityId: null,
    activeFilters: [], selectedRecordIds: [], capturedAt: new Date().toISOString() } as AssistantTrustedToolContext['context'],
  ...overrides,
});

function tool(listPage: typeof listInvoicesPageForOrganization) {
  return createAssistantInvoiceFilterTotalToolAdapters({ listPage })['analytics.invoice_filter_total'];
}

describe('assistant Invoice filter total', () => {
  test('uses the canonical named preset and full pre-pagination aggregate, including more than 200 rows', async () => {
    const listPage = jest.fn<typeof listInvoicesPageForOrganization>().mockResolvedValue({
      items: [], page: 1, pageSize: 1, totalCount: 251, totalPages: 251, totalValueCents: 25100,
      totalsByCurrency: [{ currency: 'USD', count: 251, totalCents: 25100 }],
    });
    const result = await tool(listPage).execute({ scope: 'named_filter', namedFilter: 'ready_to_finalize' }, context());
    expect(listPage).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org_one', limit: 1, offset: 0,
      columnFilters: expect.objectContaining({ sendStatus: ['never_sent'], jobStatus: ['job_complete', 'fulfillment_complete'] }) }));
    expect(result.data).toMatchObject({ metric: 'invoice_total', count: 251,
      totalsByCurrency: [{ currency: 'USD', count: 251, totalCents: 25100 }] });
    expect(result.provenance?.sourceLinks[0].href).toContain('sendStatus=never_sent');
  });

  test('uses page filters and keeps currency totals separate from balances', async () => {
    const listPage = jest.fn<typeof listInvoicesPageForOrganization>().mockResolvedValue({
      items: [], page: 1, pageSize: 1, totalCount: 2, totalPages: 2, totalValueCents: 15000,
      totalsByCurrency: [{ currency: 'USD', count: 1, totalCents: 12000 }, { currency: 'CAD', count: 1, totalCents: 3000 }],
    });
    const current = context({ context: { ...context().context, activeFilters: [
      { key: 'jobStatus', value: 'job_complete,fulfillment_complete' }, { key: 'sendStatus', value: 'never_sent' },
      { key: 'search', value: 'DMDS' }, { key: 'page', value: '3' }, { key: 'pageSize', value: '50' },
    ] } });
    const result = await tool(listPage).execute({ scope: 'current_filtered' }, current);
    expect(listPage).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org_one', search: 'DMDS', limit: 1,
      columnFilters: expect.objectContaining({ sendStatus: ['never_sent'], jobStatus: ['job_complete', 'fulfillment_complete'] }) }));
    expect(result.data).toMatchObject({ count: 2, totalsByCurrency: [
      { currency: 'USD', totalCents: 12000 }, { currency: 'CAD', totalCents: 3000 },
    ] });
  });

  test('checks finance permission before any Invoice read', async () => {
    const listPage = jest.fn<typeof listInvoicesPageForOrganization>();
    await expect(tool(listPage).execute({ scope: 'named_filter', namedFilter: 'ready_to_finalize' },
      context({ permissions: [] }))).rejects.toThrow('Finance read permission');
    expect(listPage).not.toHaveBeenCalled();
  });

  test('current page uses its sort and only visible rows; selected scope uses exact selected IDs', async () => {
    const listPage = jest.fn<typeof listInvoicesPageForOrganization>().mockResolvedValue({
      items: [{ id: 'invoice_a', currency: 'USD', totalCents: 7000 },
        { id: 'invoice_a', currency: 'USD', totalCents: 7000 },
        { id: 'invoice_b', currency: 'USD', totalCents: 3000 }] as any,
      page: 2, pageSize: 25, totalCount: 70, totalPages: 3, totalValueCents: 70000,
      totalsByCurrency: [{ currency: 'USD', count: 70, totalCents: 70000 }],
    });
    const current = context({ context: { ...context().context, activeFilters: [
      { key: 'page', value: '2' }, { key: 'pageSize', value: '25' },
      { key: 'sortBy', value: 'invoiceNumber' }, { key: 'sortDir', value: 'asc' },
    ], selectedRecordIds: ['invoice_a'] } });
    const page = await tool(listPage).execute({ scope: 'current_page' }, current);
    expect(listPage).toHaveBeenCalledWith(expect.objectContaining({ limit: 25, offset: 25,
      sortBy: 'invoiceNumber', sortDir: 'asc' }));
    expect(page.data).toMatchObject({ count: 2, totalsByCurrency: [{ totalCents: 10000 }] });
    await tool(listPage).execute({ scope: 'selected_rows' }, current);
    expect(listPage).toHaveBeenLastCalledWith(expect.objectContaining({ organizationId: 'org_one', invoiceIds: ['invoice_a'] }));
  });
});
