const invalidateQueries = jest.fn();
let savedCache: any;
const setQueryData = jest.fn((_key: unknown, update: (previous: any) => unknown) => { savedCache = update(savedCache); });
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries, setQueryData }),
  useMutation: (options: any) => options,
  useQuery: (options: any) => options,
}));
jest.mock('@/lib/apiConfig', () => ({ getApiUrl: (path: string) => path }));

import { useAddFulfillmentNoteMutation, useCreateShipmentPackageMutation, useMarkShippedMutation, useShippingDocumentSourceQuery, useUpdateShipmentMutation, useVoidShipmentMutation } from './useFulfillment';

afterEach(() => { jest.clearAllMocks(); savedCache = undefined; });

test.each([useUpdateShipmentMutation, useMarkShippedMutation, useVoidShipmentMutation, useCreateShipmentPackageMutation])('shipment mutation refreshes canonical Order/detail/timeline and saved document source', useMutation => {
  const mutation = useMutation('shipment-1') as any;
  mutation.onSuccess({ id: 'shipment-1', updatedAt: '2026-10-29T12:00:00Z' });
  for (const queryKey of [['fulfillment', 'shipment', 'shipment-1'], ['fulfillment', 'order'], ['orders', 'detail'], ['orders', 'timeline'], ['orders', 'list'], ['fulfillment', 'shipping-document'], ['invoices']]) {
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey });
  }
});

test('draft acknowledgement updates its query cache without an older response replacing a newer revision', () => {
  const mutation = useUpdateShipmentMutation('shipment-1') as any;
  savedCache = { id: 'shipment-1', updatedAt: '2026-10-29T12:00:00Z', lineAvailability: ['kept'] };
  mutation.onSuccess({ id: 'shipment-1', updatedAt: '2026-10-29T12:00:02Z', trackingNumber: 'new' });
  expect(savedCache).toMatchObject({ trackingNumber: 'new', lineAvailability: ['kept'] });
  mutation.onSuccess({ id: 'shipment-1', updatedAt: '2026-10-29T12:00:01Z', trackingNumber: 'old' });
  expect(savedCache.trackingNumber).toBe('new');
  expect(invalidateQueries.mock.calls.some(([options]) => options.predicate?.({ queryKey: ['production', 'overview'] }))).toBe(true);
});

test('Order notes refresh the owning canonical Order and timeline, not just workspace data', () => {
  const mutation = useAddFulfillmentNoteMutation('order-1') as any;
  mutation.onSuccess();
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['orders', 'detail', 'order-1'] });
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['orders', 'timeline', 'order-1'] });
});

test('shipping source queries are disabled without a shipment and have a document-specific read-only key', () => {
  expect(useShippingDocumentSourceQuery(undefined)).toMatchObject({ enabled: false, retry: false });
  expect(useShippingDocumentSourceQuery('shipment-1', 'shipment_manifest')).toMatchObject({ enabled: true, queryKey: ['fulfillment', 'shipping-document', 'shipment-1', 'shipment_manifest'] });
});
