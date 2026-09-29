import { projectStaffInvoiceLineHierarchy } from '../invoiceLinePresentation';

const fixture = [
  { id: 'invoice-a', orderLineItemId: 'order-a', parentLineItemId: null, sortOrder: 0, totalPrice: '66.13' },
  { id: 'invoice-a1', orderLineItemId: 'order-a1', parentLineItemId: 'order-a', sortOrder: 1, totalPrice: '30.00' },
  { id: 'invoice-b', orderLineItemId: 'order-b', parentLineItemId: null, sortOrder: 2, totalPrice: '220.44' },
  { id: 'invoice-b1', orderLineItemId: 'order-b1', parentLineItemId: 'order-b', sortOrder: 3, totalPrice: '108.00' },
];

test('Invoice 20519 style snapshots show two groups while retaining four stored amounts', () => {
  const rows = projectStaffInvoiceLineHierarchy(fixture);
  expect(rows.map(({ line, parentLineNumber, childCount }) => [line.id, parentLineNumber, childCount]))
    .toEqual([['invoice-a', null, 1], ['invoice-a1', 1, 0], ['invoice-b', null, 1], ['invoice-b1', 3, 0]]);
  expect(rows.map(({ line }) => line.totalPrice)).toEqual(['66.13', '30.00', '220.44', '108.00']);
  expect(rows.reduce((sum, { line }) => sum + Math.round(Number(line.totalPrice) * 100), 0)).toBe(42457);
});

test('multiple children group under their linked parent without moving unrelated roots', () => {
  const input = [
    fixture[0],
    { id: 'standalone', orderLineItemId: 'order-standalone', parentLineItemId: null, sortOrder: 1 },
    { id: 'a2', orderLineItemId: 'order-a2', parentLineItemId: 'order-a', sortOrder: 4 },
    fixture[2], fixture[1], fixture[3],
  ];
  const rows = projectStaffInvoiceLineHierarchy(input);
  expect(rows.map(({ line }) => line.id)).toEqual(['invoice-a', 'invoice-a1', 'a2', 'standalone', 'invoice-b', 'invoice-b1']);
  expect(rows.map(({ parentLineNumber, childCount }) => [parentLineNumber, childCount]))
    .toEqual([[null, 2], [1, 0], [1, 0], [null, 0], [null, 1], [5, 0]]);
});

test('historical missing, ambiguous, or cyclic source links do not invent groups', () => {
  const noSource = fixture.map(({ orderLineItemId: _ignored, ...line }) => line);
  expect(projectStaffInvoiceLineHierarchy(noSource).every(row => row.parentLineNumber === null && row.childCount === 0)).toBe(true);
  const orphan = [{ ...fixture[1], parentLineItemId: 'missing' }, fixture[0]];
  expect(projectStaffInvoiceLineHierarchy(orphan).every(row => row.parentLineNumber === null)).toBe(true);
  const ambiguous = [fixture[0], { ...fixture[0], id: 'duplicate' }, fixture[1]];
  expect(projectStaffInvoiceLineHierarchy(ambiguous).every(row => row.parentLineNumber === null)).toBe(true);
  const cycle = [{ ...fixture[0], parentLineItemId: 'order-a1' }, fixture[1]];
  expect(projectStaffInvoiceLineHierarchy(cycle).every(row => row.parentLineNumber === null)).toBe(true);
});
