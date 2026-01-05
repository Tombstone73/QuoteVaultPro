import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { OrderAttachment, InsertOrderAttachment, UpdateOrderAttachment, JobFile, InsertJobFile } from "@shared/schema";
import { orderDetailQueryKey, orderTimelineQueryKey } from "./useOrders";

// Enriched order attachment with user info and signed URLs
export type OrderFileWithUser = OrderAttachment & {
  uploadedByUser?: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  // Signed URLs from server (use these for display/download, not fileUrl)
  originalUrl?: string | null;
  thumbUrl?: string | null;
  previewUrl?: string | null;
};

// Artwork summary response shape
export type OrderArtworkSummary = {
  front?: OrderAttachment | null;
  back?: OrderAttachment | null;
  other: OrderAttachment[];
};

// Job file with file details
export type JobFileWithDetails = JobFile & {
  file?: OrderAttachment | null;
};

// ============================================================
// ORDER FILES HOOKS
// ============================================================

/**
 * Fetch all files for an order with enriched user metadata
 */
export function useOrderFiles(orderId: string | undefined) {
  return useQuery<OrderFileWithUser[]>({
    queryKey: ['/api/orders', orderId, 'files'],
    queryFn: async () => {
      if (!orderId) return [];
      const res = await fetch(`/api/orders/${orderId}/files`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch order files');
      const json = await res.json();
      return json.data || [];
    },
    enabled: !!orderId,
  });
}

/**
 * Fetch artwork summary (primary front/back artwork) for an order
 */
export function useOrderArtworkSummary(orderId: string | undefined) {
  return useQuery<OrderArtworkSummary>({
    queryKey: ['/api/orders', orderId, 'artwork-summary'],
    queryFn: async () => {
      if (!orderId) return { front: null, back: null, other: [] };
      const res = await fetch(`/api/orders/${orderId}/artwork-summary`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch artwork summary');
      const json = await res.json();
      return json.data || { front: null, back: null, other: [] };
    },
    enabled: !!orderId,
  });
}

/**
 * Attach a file to an order (assumes file already uploaded to GCS)
 */
export function useAttachFileToOrder(orderId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<InsertOrderAttachment> & { fileName: string; fileUrl: string }) => {
      const res = await fetch(`/api/orders/${orderId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to attach file');
      }

      const json = await res.json();
      return json.data;
    },
    onSuccess: () => {
      // Invalidate order files query to refetch
      queryClient.invalidateQueries({ queryKey: ['/api/orders', orderId, 'files'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders', orderId, 'artwork-summary'] });
      queryClient.invalidateQueries({ queryKey: orderTimelineQueryKey(orderId) });
    },
  });
}

/**
 * Update file metadata (role, side, isPrimary, description)
 */
export function useUpdateOrderFile(orderId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ fileId, updates }: { fileId: string; updates: UpdateOrderAttachment }) => {
      const res = await fetch(`/api/orders/${orderId}/files/${fileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to update file');
      }

      const json = await res.json();
      return json.data || json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/orders', orderId, 'files'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders', orderId, 'artwork-summary'] });
      queryClient.invalidateQueries({ queryKey: orderTimelineQueryKey(orderId) });
    },
  });
}

/**
 * Delete/detach a file from an order
 */
export function useDetachOrderFile(orderId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fileId: string) => {
      const res = await fetch(`/api/orders/${orderId}/files/${fileId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to delete file');
      }

      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/orders', orderId, 'files'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders', orderId, 'artwork-summary'] });
      queryClient.invalidateQueries({ queryKey: orderTimelineQueryKey(orderId) });
    },
  });
}

// ============================================================
// JOB FILES HOOKS
// ============================================================

/**
 * Fetch all files attached to a job
 */
export function useJobFiles(jobId: string | undefined) {
  return useQuery<JobFileWithDetails[]>({
    queryKey: ['/api/jobs', jobId, 'files'],
    queryFn: async () => {
      if (!jobId) return [];
      const res = await fetch(`/api/jobs/${jobId}/files`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch job files');
      const json = await res.json();
      return json.data || [];
    },
    enabled: !!jobId,
  });
}

/**
 * Attach an existing file to a job
 */
export function useAttachFileToJob(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Omit<InsertJobFile, 'jobId' | 'attachedByUserId'>) => {
      const res = await fetch(`/api/jobs/${jobId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to attach file to job');
      }

      const json = await res.json();
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', jobId, 'files'] });
    },
  });
}

/**
 * Detach a file from a job
 */
export function useDetachJobFile(jobId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fileId: string) => {
      const res = await fetch(`/api/jobs/${jobId}/files/${fileId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to detach file from job');
      }

      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', jobId, 'files'] });
    },
  });
}

// ============================================================
// ORDER LINE ITEM FILES HOOKS
// ============================================================

/**
 * Fetch all files for an order line item
 */
export function useOrderLineItemFiles(orderId: string | undefined, lineItemId: string | undefined) {
  return useQuery<{ data: OrderFileWithUser[]; assets: any[] }>({
    queryKey: ['/api/orders', orderId, 'line-items', lineItemId, 'files'],
    queryFn: async () => {
      if (!orderId || !lineItemId) return { data: [], assets: [] };
      const res = await fetch(`/api/orders/${orderId}/line-items/${lineItemId}/files`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch line item files');
      const json = await res.json();
      return { data: json.data || [], assets: json.assets || [] };
    },
    enabled: !!orderId && !!lineItemId,
  });
}

/**
 * Attach a file to an order line item (assumes file already uploaded)
 */
export function useAttachFileToOrderLineItem(orderId: string, lineItemId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<InsertOrderAttachment> & { fileName: string; fileUrl: string }) => {
      const res = await fetch(`/api/orders/${orderId}/line-items/${lineItemId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to attach file');
      }

      const json = await res.json();
      return json.data;
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['/api/orders', orderId, 'line-items', lineItemId, 'files'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders', orderId, 'files'] });
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
    },
  });
}

/**
 * Delete a file from an order line item
 */
export function useDetachOrderLineItemFile(orderId: string, lineItemId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (fileId: string) => {
      // For now, use the order-level delete endpoint
      // In future, could add line-item-specific endpoint
      const res = await fetch(`/api/orders/${orderId}/files/${fileId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to delete file');
      }

      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/orders', orderId, 'line-items', lineItemId, 'files'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders', orderId, 'files'] });
      queryClient.invalidateQueries({ queryKey: orderDetailQueryKey(orderId) });
    },
  });
}
