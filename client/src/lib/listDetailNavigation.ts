import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/lib/queryClient";
import { buildListDetailPath, parseListDetailContext, type ListNavigationEntity } from "@/lib/listDetailNavigationContext";
export {
  buildDetailReturnPath,
  buildOrderDetailReturnPath,
  buildListDetailPath,
  parseDetailReturnPath,
  parseOrderDetailReturnPath,
  parseListDetailContext,
  resolveDetailBackPath,
  resolveOrderDetailBackPath,
  type ListDetailContext,
  type ListNavigationEntity,
} from "@/lib/listDetailNavigationContext";

type ListRecord = { id: string };
type InvoiceResponse = { data?: ListRecord[]; pagination?: { totalCount?: number } };
type OrderResponse = { items?: ListRecord[]; totalCount?: number };


function requestForIndex(entity: ListNavigationEntity, source: string, index: number) {
  const sourceUrl = new URL(source, window.location.origin);
  const params = new URLSearchParams(sourceUrl.search);
  // The list routes remain the sole authority for predicates and sort order.
  // Override only pagination, so this is a constant-size request.
  params.delete("page");
  params.delete("pageSize");
  params.delete("offset");
  if (entity === "invoice") {
    params.delete("includeSummary");
    params.set("offset", String(Math.max(0, index)));
    params.set("pageSize", "1");
  } else {
    params.set("page", String(Math.max(0, index) + 1));
    params.set("pageSize", "1");
    params.set("includeThumbnails", "false");
  }
  return `/api/${entity === "invoice" ? "invoices" : "orders"}?${params.toString()}`;
}

async function fetchRecordAt(entity: ListNavigationEntity, source: string, index: number) {
  const response = await apiFetch(requestForIndex(entity, source, index), { credentials: "include" });
  if (!response.ok) throw new Error(`Unable to load ${entity} navigation`);
  const payload = await response.json() as InvoiceResponse & OrderResponse;
  const item = entity === "invoice" ? payload.data?.[0] : payload.items?.[0];
  const total = entity === "invoice" ? payload.pagination?.totalCount : payload.totalCount;
  return { item: item ?? null, total: Math.max(0, Number(total ?? 0)) };
}

/**
 * Resolves adjacency through the ordinary paginated list APIs.  It never
 * downloads an ID collection and therefore stays aligned with list filters,
 * sorting, tenant scoping, and future server-side list changes.
 */
export function useListDetailNavigation(entity: ListNavigationEntity, recordId: string | undefined) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const context = parseListDetailContext(entity, params);
  const current = useQuery({
    queryKey: ["list-detail-navigation", entity, recordId, context?.source, context?.index],
    enabled: Boolean(recordId && context),
    queryFn: () => fetchRecordAt(entity, context!.source, context!.index),
    staleTime: 0,
  });

  const go = async (direction: -1 | 1) => {
    if (!context || !recordId) return;
    const snapshot = await fetchRecordAt(entity, context.source, context.index);
    const currentStillMatches = snapshot.item?.id === recordId;
    // If an action removed the record from its working set (for example Send
    // in Never Sent), the following record shifted into the old position.
    const targetIndex = currentStillMatches
      ? context.index + direction
      : direction === 1
        ? context.index
        : context.index - 1;
    if (targetIndex < 0 || targetIndex >= snapshot.total) return;
    const target = await fetchRecordAt(entity, context.source, targetIndex);
    if (!target.item) return;
    navigate(buildListDetailPath(entity, target.item.id, context.source, targetIndex, context.returnTo));
  };

  const total = current.data?.total ?? 0;
  const currentMatches = current.data?.item?.id === recordId;
  return {
    context,
    backPath: context?.returnTo ?? context?.source ?? null,
    position: currentMatches && context ? context.index + 1 : null,
    total,
    isLoading: current.isLoading,
    canPrevious: Boolean(context && (currentMatches ? context.index > 0 : context.index > 0)),
    canNext: Boolean(context && (currentMatches ? context.index + 1 < total : context.index < total)),
    go,
  };
}
