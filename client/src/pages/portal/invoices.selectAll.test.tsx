import React, { act } from 'react';
import { TextDecoder, TextEncoder } from 'node:util';
import type { PortalInvoiceDto } from '@/hooks/usePortal';
Object.assign(globalThis, { TextDecoder, TextEncoder, IS_REACT_ACT_ENVIRONMENT: true });
let mockInvoices: PortalInvoiceDto[] = [];
let mockSession = { userId: 'portal-user', customerId: 'customer-a', staffPreview: { active: false, canExecutePayments: false } };
let mockCheckout: any;
const mockInvalidate = jest.fn();
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
jest.mock('@/hooks/usePortal', () => ({
  portalInvoiceKeys: { all: ['portal', 'invoices'] }, portalInvoicePdfUrl: jest.fn(),
  usePortalInvoices: () => ({ data: mockInvoices }), usePortalSession: () => ({ data: mockSession }),
}));
jest.mock('@/hooks/usePortalDownload', () => ({ usePortalDownload: () => ({ download: jest.fn(), downloading: false }) }));
jest.mock('@/components/payments/StripePayDialog', () => ({ __esModule: true, default: (props: any) => { mockCheckout = props; return props.open ? <div role="dialog" aria-label="Existing checkout">Existing checkout</div> : null; } }));
const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
const { MemoryRouter } = require('react-router-dom') as typeof import('react-router-dom');
const PortalInvoicesPage = require('./invoices').default;
let root: ReturnType<typeof createRoot>;
const invoice = (id: string, amountDue: number, payable: boolean, status = 'billed', blockedReason: string | null = null) => ({
  id, invoiceNumber: Number(id), displayNumber: id, status, total: amountDue || 50, amountPaid: amountDue ? 0 : 50,
  amountDue, currency: 'USD', paymentStatusLabel: amountDue ? 'Unpaid' : 'Paid', paymentEligibility: { payable, blockedReason },
  pdfAvailable: false, issueDate: '2026-09-01', dueDate: '2026-09-30',
} as PortalInvoiceDto);
const fixture = () => [invoice('1',0,false,'paid'),invoice('2',0,false,'paid'),invoice('3',100,true),invoice('4',250,true),invoice('5',75,true),invoice('6',60,false,'billed','Awaiting approval')];
const render = () => act(() => root.render(<MemoryRouter><PortalInvoicesPage /></MemoryRouter>));
const button = (name: string) => Array.from(document.querySelectorAll('button')).find(x => x.textContent === name)!;
const checkbox = (id: string, mobile = false) => document.querySelector(`${mobile ? 'article' : 'table'} input[aria-label="Select invoice ${id}"]`) as HTMLInputElement;
beforeEach(() => {
  localStorage.clear(); mockInvalidate.mockClear(); mockInvoices = fixture(); mockCheckout = null;
  mockSession = { userId: 'portal-user', customerId: 'customer-a', staffPreview: { active: false, canExecutePayments: false } };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); render();
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });
test('one visible control selects only canonical eligible invoices and immediately totals their balances', () => {
  act(() => button('Select All Open Invoices').click());
  expect(document.body.textContent).toContain('3 open invoices selected · 3 paid/ineligible invoices excluded');
  expect(document.body.textContent).toContain('Total Due: $425.00');
  for (const mobile of [false,true]) {
    for (const id of ['1','2','6']) { expect(checkbox(id,mobile).disabled).toBe(true); expect(checkbox(id,mobile).checked).toBe(false); }
    for (const id of ['3','4','5']) expect(checkbox(id,mobile).checked).toBe(true);
  }
  expect(button('Select All Open Invoices').disabled).toBe(true);
});
test.each([false,true])('individual deselection remains available after select all (mobile=%s)', mobile => {
  act(() => button('Select All Open Invoices').click()); act(() => checkbox('4',mobile).click());
  expect(document.body.textContent).toContain('2 open invoices selected');
  expect(document.body.textContent).toContain('Total Due: $175.00');
  expect(button('Select All Open Invoices').disabled).toBe(false);
  act(() => button('Select All Open Invoices').click()); expect(document.body.textContent).toContain('Total Due: $425.00');
});
test('zero-balance, void and canceled projections remain visible and excluded', () => {
  mockInvoices = [...fixture(),invoice('7',0,false,'billed'),invoice('8',90,false,'void'),invoice('9',80,false,'canceled')]; render();
  act(() => button('Select All Open Invoices').click());
  expect(document.body.textContent).toContain('3 open invoices selected · 6 paid/ineligible invoices excluded');
  for (const id of ['7','8','9']) { expect(checkbox(id).checked).toBe(false); expect(checkbox(id).disabled).toBe(true); }
});
test('all ineligible has no active select-all or checkout action', () => {
  mockInvoices = fixture().filter(x => !x.paymentEligibility?.payable); render();
  expect(button('Select All Open Invoices').disabled).toBe(true);
  expect(button('Pay Selected Invoices')).toBeUndefined();
});
test('a refreshed canonical projection removes newly ineligible selections and changes the total', () => {
  act(() => button('Select All Open Invoices').click());
  mockInvoices = mockInvoices.map(x => x.id === '3' ? invoice('3',0,false,'paid') : x); render();
  expect(document.body.textContent).toContain('2 open invoices selected · 4 paid/ineligible invoices excluded');
  expect(document.body.textContent).toContain('Total Due: $325.00'); expect(checkbox('3').checked).toBe(false);
});
test('passes one selection to existing grouped checkout and refreshes without optimistic paid writes', async () => {
  act(() => button('Select All Open Invoices').click()); act(() => button('Pay Selected Invoices').click());
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(mockCheckout).toMatchObject({ open: true, groupedInitiation: true, invoiceIds: ['3','4','5'], apiBasePath: '/api/portal/invoices' });
  await act(async () => mockCheckout.onSettled({ serverConfirmed: true, paymentIntentId: 'pi_fixture' }));
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['portal','invoices'] });
  expect(mockInvoices.filter(x => x.paymentEligibility?.payable)).toHaveLength(3);
  expect(button('Pay Selected Invoices')).toBeUndefined();
  mockInvoices = mockInvoices.map(x => ['3','4','5'].includes(x.id) ? invoice(x.id,0,false,'paid') : x); render();
  expect(document.body.textContent).toContain('0 open invoices selected · 6 paid/ineligible invoices excluded');
});
test('switching the active Customer starts with a fresh selection scoped to that group', () => {
  act(() => button('Select All Open Invoices').click());
  mockSession = { ...mockSession, customerId: 'customer-b' }; mockInvoices = [invoice('10',20,true),invoice('11',0,false,'paid')]; render();
  expect(button('Pay Selected Invoices')).toBeUndefined();
  act(() => button('Select All Open Invoices').click());
  expect(document.body.textContent).toContain('1 open invoice selected · 1 paid/ineligible invoice excluded');
  expect(document.body.textContent).toContain('Total Due: $20.00');
});
test('staff preview retains the existing no-payment capability flags', () => {
  mockSession = { ...mockSession, staffPreview: { active: true, canExecutePayments: false } }; render();
  act(() => button('Select All Open Invoices').click()); act(() => button('Pay Selected Invoices').click());
  expect(mockCheckout).toMatchObject({ previewMode: true, previewPaymentAuthorized: false });
});
