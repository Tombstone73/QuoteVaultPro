import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, jest, test } from '@jest/globals';
import { ConvertQuoteToOrderDialog } from './convert-quote-to-order-dialog';
import { dateOnlyDeadline } from '@shared/orderDeadline';
jest.mock('@/lib/queryClient', () => ({ apiFetch: jest.fn(async () => ({ ok: true, json: async () => ({ timezone: 'America/New_York' }) })) }));
test('Quote conversion preserves requested EOD but accepts it only after a deliberate action', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const onSubmit = jest.fn();
    const requested = { ...dateOnlyDeadline('2026-11-10', 'November 10 EOD'), kind: 'eod' as const };
    try {
        await act(async () => root.render(<ConvertQuoteToOrderDialog open onOpenChange={() => { }} onSubmit={onSubmit} requestedDeadline={requested}/>));
        const button = (label: string) => Array.from(document.querySelectorAll('button')).find(button => button.textContent === label)!;
        act(() => button('Create Order').click());
        expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ dueDate: '', deadlineJson: { requested, accepted: null } }));
        await act(async () => button('Accept requested deadline').click());
        expect((document.querySelector('input[type=date]') as HTMLInputElement).value).toBe('2026-11-10');
        expect(document.querySelector('select[aria-label="Deadline type"]')?.getAttribute('aria-label')).toBe('Deadline type');
        act(() => button('Create Order').click());
        expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ dueDate: '2026-11-10', deadlineJson: { requested, accepted: requested } }));
    }
    finally {
        act(() => root.unmount());
        host.remove();
    }
});
