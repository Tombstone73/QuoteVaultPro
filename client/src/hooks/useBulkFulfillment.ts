import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiCall, invalidateFulfillment } from './useFulfillment';
import type { BulkFulfillmentAction, BulkFulfillmentExecute, BulkFulfillmentOrderContext, BulkFulfillmentPreview, BulkFulfillmentResult, BulkFulfillmentSelection } from '@shared/bulkFulfillment';

export function useBulkFulfillmentPermissions() {
  return useQuery({ queryKey: ['fulfillment', 'bulk-permissions'], queryFn: () => apiCall<{ canOperate: boolean; canReconcileLegacy: boolean }>('/api/fulfillment/bulk/permissions'), staleTime: 30000 });
}
export function useBulkFulfillmentContext(orderId: string) {
  return useQuery({ queryKey: ['fulfillment', 'bulk-context', orderId], queryFn: () => apiCall<BulkFulfillmentOrderContext>(`/api/fulfillment/orders/${orderId}/bulk-context`) });
}
export function useBulkFulfillmentPreview() {
  return useMutation({ mutationFn: (input: { action: BulkFulfillmentAction; selection: BulkFulfillmentSelection }) =>
    apiCall<BulkFulfillmentPreview>('/api/fulfillment/bulk/preview', { method: 'POST', body: JSON.stringify(input) }) });
}
export function useBulkFulfillmentExecute() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (input: BulkFulfillmentExecute) => apiCall<BulkFulfillmentResult>('/api/fulfillment/bulk/execute', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => { invalidateFulfillment(client); void client.invalidateQueries({ queryKey: ['fulfillment'] }); } });
}
