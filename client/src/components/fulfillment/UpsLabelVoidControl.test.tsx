jest.mock('@/lib/queryClient', () => ({ apiFetchBlob: jest.fn() }));
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { UpsLabelVoidControl } from './UpsLabelVoidControl';
const api = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock('@/hooks/useFulfillment', () => ({ apiCall: (...args: any[]) => api(...args), toFulfillmentError: (err: Error) => ({ message: err.message }) }));
let host: HTMLDivElement, root: Root;
const base = { id: 'purchase', status: 'PURCHASED', environment: 'live', serviceName: 'UPS Ground', providerShipmentId: '1ZSHIP',
  labels: [{ id: 'a', trackingNumber: '1ZPACKAGE000000001', providerResultOrdinal: 1 }, { id: 'b', trackingNumber: '1ZPACKAGE000000002', providerResultOrdinal: 2 }] };
const button = (label: string) => Array.from(document.querySelectorAll('button')).find(node => node.textContent === label)!;
const posts = () => api.mock.calls.filter(call => call[1]?.method === 'POST');
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  api.mockReset(); api.mockImplementation(async (_url, options) => options?.method === 'POST' ? {} : [base]);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const open = async () => {
  await act(async () => root.render(<UpsLabelVoidControl shipmentId="shipment" shipmentReference="SHIP-QA-10" shipmentStatus="SHIPPED" />));
  await act(async () => button('Void UPS Label').click());
};
test('shows exact shipment and all tracking identities before an explicit confirmation; reads history lazily', async () => {
  await act(async () => root.render(<UpsLabelVoidControl shipmentId="shipment" shipmentReference="SHIP-QA-10" shipmentStatus="SHIPPED" />));
  expect(api).not.toHaveBeenCalled(); await act(async () => button('Void UPS Label').click());
  expect(document.body.textContent).toContain('SHIP-QA-10'); expect(document.body.textContent).toContain(base.labels[1].trackingNumber);
  expect(document.body.textContent).toContain('does not reverse shipped quantities'); expect(posts()).toHaveLength(0);
  await act(async () => button('Confirm void of all 2 UPS labels').click());
  expect(posts()).toHaveLength(1); expect(posts()[0][0]).toBe('/api/fulfillment/shipments/shipment/ups-labels/purchase/void');
  expect(document.body.textContent).toContain('UPS confirmed cancellation');
});
test('double clicks produce one request, disable close during the request, and refresh authoritative history', async () => {
  let release!: () => void;
  api.mockImplementation(async (_url, options) => options?.method === 'POST' ? new Promise<void>(resolve => { release = resolve; }) : [base]);
  await open(); const confirm = button('Confirm void of all 2 UPS labels');
  act(() => { confirm.click(); confirm.click(); }); expect(posts()).toHaveLength(1); expect(button('Close').disabled).toBe(true);
  await act(async () => release()); expect(button('Close').disabled).toBe(false);
});
test('uncertain result remains visible with no automatic retry and requires every carrier confirmation', async () => {
  let current = { ...base, status: 'VOID_UNCERTAIN' };
  api.mockImplementation(async (_url, options) => { if (options?.method === 'POST') { current = { ...current, status: 'EXTERNAL_CANCEL_REPORTED' }; return {}; } return [current]; });
  await open(); expect(button('Confirm void of all 2 UPS labels')).toBeUndefined();
  const record = button('Record UPS-confirmed external cancellation'); expect(record.disabled).toBe(true);
  const inputs = Array.from(document.querySelectorAll('input'));
  act(() => { Simulate.change(inputs[0], { target: { checked: true } } as any); Simulate.change(inputs[2], { target: { value: 'UPS-support-123' } } as any); Simulate.change(inputs[3], { target: { value: 'UPS confirmed all labels voided' } } as any); });
  expect(record.disabled).toBe(true);
  act(() => Simulate.change(inputs[1], { target: { checked: true } } as any)); expect(record.disabled).toBe(false);
  await act(async () => record.click()); expect(posts()).toHaveLength(1);
  expect(JSON.parse(posts()[0][1].body).confirmedTrackingNumbers).toEqual(base.labels.map(label => label.trackingNumber));
  expect(document.body.textContent).toContain('Fulfillment remains unchanged');
});
test('failed post or failed readback cannot silently repeat the void or falsely promise cancellation', async () => {
  await open(); api.mockRejectedValue(new Error('Network unavailable'));
  await act(async () => button('Confirm void of all 2 UPS labels').click());
  expect(posts()).toHaveLength(1); expect(document.querySelector('[role=alert]')?.textContent).toContain('History could not refresh');
  expect(button('Confirm void of all 2 UPS labels').disabled).toBe(true); expect(document.body.textContent).not.toContain('UPS confirmed cancellation.');
});
test('partial results identify each package and do not offer another void request', async () => {
  api.mockResolvedValue([{ ...base, status: 'VOID_UNCERTAIN', voidResult: { packages: [
    { trackingNumber: base.labels[0].trackingNumber, code: '1' }, { trackingNumber: base.labels[1].trackingNumber, code: '0' }] } }]);
  await open(); expect(document.body.textContent).toContain('Voided or already voided'); expect(document.body.textContent).toContain('Not voided');
  expect(button('Confirm void of all 2 UPS labels')).toBeUndefined(); expect(posts()).toHaveLength(0);
});
test('confirmed draft cancellation explains fresh rates and replacement without creating another shipment', async () => {
  api.mockResolvedValue([{ ...base, status: 'VOID_ACCEPTED' }]);
  await act(async () => root.render(<UpsLabelVoidControl shipmentId="shipment" shipmentReference="QA" shipmentStatus="DRAFT" />));
  await act(async () => button('Void UPS Label').click());
  expect(document.body.textContent).toContain('get fresh UPS rates'); expect(posts()).toHaveLength(0);
});


test('a browser timeout ends the spinner, rereads history, and never retries a carrier mutation', async () => {
  jest.useFakeTimers();
  let current = base;
  api.mockImplementation(async (_url, options) => {
    if (options?.method !== 'POST') return [current];
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
      current = { ...base, status: 'VOID_UNCERTAIN' }; reject(new DOMException('Aborted', 'AbortError'));
    }));
  });
  try {
    await open(); act(() => button('Confirm void of all 2 UPS labels').click());
    expect(button('Close').disabled).toBe(true);
    await act(async () => { jest.advanceTimersByTime(45_000); });
    expect(button('Close').disabled).toBe(false); expect(document.querySelector('[role=alert]')?.textContent).toContain('Request timed out');
    expect(posts()).toHaveLength(1); expect(button('Confirm void of all 2 UPS labels')).toBeUndefined();
  } finally { jest.useRealTimers(); }
});
