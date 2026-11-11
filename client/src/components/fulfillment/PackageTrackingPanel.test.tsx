import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import type { ShipmentDetail } from '@/hooks/useFulfillment';
import { PackageTrackingPanel, ReversedShipmentHistory, upsVoidStatus } from './PackageTrackingPanel';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const shipment = {
  id: 'replacement', shipmentReference: 'SHIP-NEW', status: 'DRAFT', trackingPackages: [],
  packages: [1, 2, 3].map(ordinal => ({ id: `box-${ordinal}`, ordinal, packageReference: `NEW-${ordinal}` })),
  items: [{ packageId: 'box-1', quantity: 4 }, { packageId: 'box-2', quantity: 5 }],
} as unknown as ShipmentDetail;
const label = { id: 'label-1', packageId: 'box-1', providerResultOrdinal: 1, trackingNumber: 'OLDUPS001' };
const purchase = { id: 'purchase-1', labels: [label], voidAcceptedAt: null, status: 'VOID_REQUESTING' };

test('the previous shipment has independent void status and a link to history', () => {
  const host = document.createElement('div'); const root = createRoot(host); const open = jest.fn();
  const reversal = { originalShipmentId: 'original', replacementShipmentId: 'replacement', reversedAt: '2026-11-10T12:00:00Z', reversedBy: 'Synthetic Staff' };
  try {
    act(() => root.render(<ReversedShipmentHistory reversal={reversal} shipment={{ ...shipment, status: 'VOIDED', shipmentReference: 'SHIP-OLD' }} purchases={[purchase]} loading={false} error={false} onOpen={open} />));
    expect(host.textContent).toContain('Previous shipment SHIP-OLD · Reversed');
    expect(host.textContent).toContain('Historical tracking OLDUPS001');
    expect(host.textContent).toContain('Void pending');
    expect(host.textContent).not.toContain('UPS confirmed');
    expect(host.textContent).toContain('Synthetic Staff');
    act(() => Simulate.click(host.querySelector('button')!)); expect(open).toHaveBeenCalledTimes(1);
  } finally { act(() => root.unmount()); }
});

test('only persisted carrier confirmation displays Voided', () => {
  expect(upsVoidStatus({ ...purchase, status: 'VOID_ACCEPTED', voidAcceptedAt: '2026-11-10T12:00:00Z' }, label.trackingNumber)).toBe('Voided · UPS confirmed');
  expect(upsVoidStatus({ ...purchase, status: 'VOID_ACCEPTED' }, label.trackingNumber)).toBe('Void status unknown');
  expect(upsVoidStatus({ ...purchase, status: 'VOID_UNCERTAIN', voidResult: { packages: [{ trackingNumber: label.trackingNumber, code: '1' }] } }, label.trackingNumber)).toBe('Void status unknown');
  expect(upsVoidStatus({ ...purchase, status: 'EXTERNAL_CANCEL_REPORTED' }, label.trackingNumber)).toContain('confirmation unavailable');
});

test('manual editing supports three boxes, preserves their identity, and waits for saved readback', async () => {
  const host = document.createElement('div'); const root = createRoot(host);
  let finish!: () => void;
  const onSave = jest.fn(() => new Promise<void>(resolve => { finish = resolve; })); const onDirty = jest.fn();
  try {
    act(() => root.render(<PackageTrackingPanel shipment={shipment} editable busy={false} onDirty={onDirty} onSave={onSave} />));
    expect(host.textContent).toContain('Current shipment SHIP-NEW');
    expect(host.textContent).toContain('Box 1 · NEW-1 · 4 allocated units');
    const selectors = [...host.querySelectorAll('select')]; const inputs = [...host.querySelectorAll('input')];
    expect(inputs).toHaveLength(3);
    for (let i = 0; i < inputs.length; i++) {
      act(() => Simulate.change(selectors[i], { target: { value: i === 1 ? 'FedEx' : 'UPS' } } as any));
      act(() => Simulate.change(inputs[i], { target: { value: `external-100${i}` } } as any));
    }
    act(() => Simulate.click(host.querySelector('button')!));
    expect(onSave).toHaveBeenCalledWith([0, 1, 2].map(i => ({ packageId: `box-${i + 1}`, carrier: i === 1 ? 'FedEx' : 'UPS',
      trackingNumber: `EXTERNAL100${i}`, before: { carrier: null, trackingNumber: null } })));
    expect(host.textContent).not.toContain('Package tracking saved.');
    await act(async () => finish());
    expect(host.textContent).toContain('Package tracking saved.');
    expect(onDirty).toHaveBeenLastCalledWith(false);
  } finally { act(() => root.unmount()); }
});
