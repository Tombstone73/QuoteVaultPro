import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StaffInvoiceLineItemsTable } from './StaffInvoiceLineItemsTable';
import type { InvoiceLineItem } from '@shared/schema';

const line = (id: string, orderLineItemId: string | null, parentLineItemId: string | null, sortOrder: number, name: string, unitPrice: string, totalPrice: string): InvoiceLineItem => ({
  id,
  invoiceId: "invoice-1",
  orderLineItemId,
  productId: `product-${id}`,
  productVariantId: null,
  productType: "wide_roll",
  name,
  sku: null,
  parentLineItemId,
  sortOrder,
  description: name,
  quantity: 2,
  unitPrice,
  totalPrice,
  unitPriceCents: Math.round(Number(unitPrice) * 100),
  lineTotalCents: Math.round(Number(totalPrice) * 100),
  width: "27.39",
  height: "24",
  sqft: null,
  specsJson: null,
  optionSelectionsJson: null,
  pbv2SnapshotJson: null,
  lineItemRole: "standalone",
  childDisplayMode: "hidden",
  parentPriceMode: "sum_children",
  childCalculatedTotalCents: null,
  selectedOptions: [],
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const renderTable = (lineItems: InvoiceLineItem[]) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<StaffInvoiceLineItemsTable lineItems={lineItems} isImportedFromQuickBooks={false} formatCurrency={value => `$${Number(value).toFixed(2)}`} />));
  return { host, cleanup: () => { act(() => root.unmount()); host.remove(); } };
};

test('staff Invoice table shows linked child identity and individual prices', () => {
  const rows = [
    line('i-a', 'o-a', null, 0, 'ACM / Dibond / Max Metal', '33.07', '66.13'),
    line('i-a1', 'o-a1', 'o-a', 1, 'Substance 2755 - Sign Vinyl', '15.00', '30.00'),
    line('i-b', 'o-b', null, 2, 'Second ACM', '110.22', '220.44'),
    line('i-b1', 'o-b1', 'o-b', 3, 'Second Vinyl', '54.00', '108.00'),
    line('i-c', 'o-c', null, 4, 'Standalone', '5.00', '10.00'),
  ];
  const { host, cleanup } = renderTable(rows);
  const rendered = Array.from(host.querySelectorAll('tbody tr'));
  expect(rendered).toHaveLength(5);
  expect(rendered[0].textContent).toContain('Group · 1 child item');
  expect(rendered[1].textContent).toContain('Child item · Runs with Line 1');
  expect(rendered[2].textContent).toContain('Line 3');
  expect(rendered[3].textContent).toContain('Child item · Runs with Line 3');
  expect(rendered[4].textContent).not.toMatch(/Child item|Group ·/);
  expect(rendered.map(row => Array.from(row.querySelectorAll('td')).slice(1).map(cell => cell.textContent)))
    .toEqual([
      ['2', '$33.07', '$66.13'], ['2', '$15.00', '$30.00'],
      ['2', '$110.22', '$220.44'], ['2', '$54.00', '$108.00'], ['2', '$5.00', '$10.00'],
    ]);
  expect(rendered[1].querySelector('td > div')?.className).toContain('border-l-2');
  expect(host.firstElementChild?.className).toContain('overflow-x-auto');
  cleanup();
});

test('historical lines without source identity display without a false relationship', () => {
  const { host, cleanup } = renderTable([line('i-a', null, null, 0, 'Old parent', '2.00', '4.00'), line('i-b', null, 'o-a', 1, 'Old child', '3.00', '6.00')]);
  expect(host.textContent).toContain('Old child');
  expect(host.textContent).not.toContain('Runs with Line');
  expect(host.textContent).not.toContain('Group ·');
  cleanup();
});
