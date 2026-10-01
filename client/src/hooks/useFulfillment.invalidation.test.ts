const invalidateQueries = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries }),
  useMutation: (options: any) => options,
  useQuery: (options: any) => options,
}));
jest.mock('@/lib/apiConfig', () => ({ getApiUrl: (path: string) => path }));

import { useAddFulfillmentNoteMutation, useCreateShipmentPackageMutation, useMarkShippedMutation, useShippingDocumentSourceQuery, useUpdateShipmentMutation, useVoidShipmentMutation } from './useFulfillment';

afterEach(() => jest.clearAllMocks());

test.each([useUpdateShipmentMutation, useMarkShippedMutation, useVoidShipmentMutation, useCreateShipmentPackageMutation])('shipment mutation refreshes canonical Order/detail/timeline and saved document source', useMutation => {
  const mutation = useMutation('shipment-1') as any;
  mutation.onSuccess();
  for (const queryKey of [['fulfillment', 'shipment', 'shipment-1'], ['fulfillment', 'order'], ['orders', 'detail'], ['orders', 'timeline'], ['orders', 'list'], ['fulfillment', 'shipping-document']]) {
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey });
  }
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
