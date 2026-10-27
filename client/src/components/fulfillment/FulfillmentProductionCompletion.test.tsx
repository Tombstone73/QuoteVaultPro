import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, 'crypto', { configurable: true,
  value: { randomUUID: () => '00000000-0000-4000-8000-000000000001' } });
const save = jest.fn<(value: any) => Promise<any>>(async () => ({ lineItems: [{ id: 'line-1', production: { readyWaitingQuantity: 100 } }] }));
const toast = jest.fn();
jest.mock('@/hooks/useFulfillment', () => ({
  useCompleteProductionFromFulfillmentMutation: () => ({ mutateAsync: save, isPending: false }),
  toFulfillmentError: (error: any) => ({ message: error?.message || 'Failed' }),
}));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
jest.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: any) => open ? <div role="dialog">{children}</div> : null,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogCancel: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

const { FulfillmentProductionCompletion, canOfferFulfillmentProductionCompletion } = require('./FulfillmentProductionCompletion') as typeof import('./FulfillmentProductionCompletion');
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const line: any = { id: 'line-1', productName: 'Signs', production: { productionRequired: true,
  orderedQuantity: 100, productionCompleteQuantity: 0, readyWaitingQuantity: 0,
  availableForAllocationQuantity: 0, activeOwnerJobId: 'job-1', activeOwnerStatus: 'queued', stationKey: 'roll' } };
const completed = jest.fn<() => void>(() => {});

beforeEach(() => { container = document.createElement('div'); document.body.append(container);
  root = createRoot(container); save.mockClear(); toast.mockClear(); completed.mockClear(); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
function button(label: string) { return Array.from(container.querySelectorAll('button')).find((node) => node.textContent === label)!; }
function change(value: string) { const input = container.querySelector('input[type="number"]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => { setter?.call(input, value); Simulate.change(input, { target: { value } } as any); }); }

describe('Fulfillment production completion confirmation', () => {
  test('offers only active physical production work to an authorized operator', () => {
    expect(canOfferFulfillmentProductionCompletion(line, true)).toBe(true);
    expect(canOfferFulfillmentProductionCompletion(line, false)).toBe(false);
    expect(canOfferFulfillmentProductionCompletion({ ...line, production: { ...line.production, stationKey: 'fulfillment' } }, true)).toBe(false);
    expect(canOfferFulfillmentProductionCompletion({ ...line, production: { ...line.production, productionCompleteQuantity: 100 } }, true)).toBe(false);
  });

  test('requires explicit full-line confirmation and sends a stable operation ID', async () => {
    act(() => root.render(<FulfillmentProductionCompletion orderId="order-1" line={line} onCompleted={completed} />));
    act(() => Simulate.click(button('Mark Ready for Fulfillment')));
    expect(save).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Remaining production: 100');
    expect(container.textContent).toContain('Available for new allocation: 0');
    change('60');
    expect((button('Confirm completion') as HTMLButtonElement).disabled).toBe(true);
    change('100');
    await act(async () => { Simulate.click(button('Confirm completion')); });
    expect(save).toHaveBeenCalledWith({ lineItemId: 'line-1', jobId: 'job-1', quantity: 100,
      clientRequestId: '00000000-0000-4000-8000-000000000001' });
    expect(completed).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('Physically completed now');
  });

  test('keeps the operation ID when the response fails so the operator can retry safely', async () => {
    save.mockRejectedValueOnce(new Error('Response interrupted'));
    act(() => root.render(<FulfillmentProductionCompletion orderId="order-1" line={line} />));
    act(() => Simulate.click(button('Mark Ready for Fulfillment')));
    await act(async () => { Simulate.click(button('Confirm completion')); });
    expect(container.textContent).toContain('Physically completed now');
    await act(async () => { Simulate.click(button('Confirm completion')); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][0].clientRequestId).toBe(save.mock.calls[1][0].clientRequestId);
  });
});
