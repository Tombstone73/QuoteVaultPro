import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, expect, jest, test } from '@jest/globals';
import { BillingOwnershipReviewPanel } from './BillingOwnershipReviewPanel';
import { apiFetch } from '@/lib/queryClient';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const invalidate = jest.fn();
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: invalidate }), useQuery: jest.fn() }));
jest.mock('@/lib/queryClient', () => ({ apiFetch: jest.fn() }));
const hold = { id: 'override', invoiceId: 'invoice', reason: 'Wrong original customer', createdAt: '2026-09-28' };
const mount = (canResolve = true) => {
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<BillingOwnershipReviewPanel hold={hold} canResolve={canResolve} />));
  const button = (text: string) => Array.from(document.querySelectorAll('button')).find(node => node.textContent === text)!;
  return { root, button };
};
afterEach(() => { jest.clearAllMocks(); document.body.innerHTML = ''; });
test('staff see the hold, while ordinary staff cannot acknowledge it', () => {
  const { root, button } = mount(false);
  expect(document.body.textContent).toContain('QuickBooks Update Required');
  expect(document.body.textContent).toContain('Automatic and manual QuickBooks sync are held');
  expect(button('Acknowledge QuickBooks correction')).toBeUndefined();
  act(() => root.unmount());
});
test('acknowledgment needs a note and confirmation, sends the event ID, and refreshes review/Invoice state', async () => {
  (apiFetch as jest.Mock<any>).mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  const { root, button } = mount();
  act(() => button('Acknowledge QuickBooks correction').click());
  expect(button('Confirm QuickBooks was corrected').disabled).toBe(true);
  act(() => Simulate.change(document.querySelector('textarea')!, { target: { value: 'Corrected the customer in QuickBooks.' } } as any));
  await act(async () => button('Confirm QuickBooks was corrected').click());
  expect(apiFetch).toHaveBeenCalledWith('/api/invoices/invoice/billing-ownership-review/resolve', expect.objectContaining({ body: JSON.stringify({ overrideId: 'override', reason: 'Corrected the customer in QuickBooks.', confirmed: true }) }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['billing-ownership-review'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['invoices'] });
  act(() => root.unmount());
});
test('a stale acknowledgment fails visibly and retains the accounting hold', async () => {
  (apiFetch as jest.Mock<any>).mockResolvedValue({ ok: false, json: async () => ({ message: 'Accounting review changed. Reload.' }) });
  const { root, button } = mount();
  act(() => button('Acknowledge QuickBooks correction').click());
  act(() => Simulate.change(document.querySelector('textarea')!, { target: { value: 'Corrected QB' } } as any));
  await act(async () => button('Confirm QuickBooks was corrected').click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Accounting review changed');
  expect(document.body.textContent).toContain('QuickBooks Update Required');
  expect(invalidate).not.toHaveBeenCalled();
  act(() => root.unmount());
});
