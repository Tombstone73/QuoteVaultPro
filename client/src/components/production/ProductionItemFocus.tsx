import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/queryClient";
import { useProductionJob, useProductionRuns, type ProductionJobListItem } from "@/hooks/useProduction";
import ProductionViewRenderer from "@/features/production/ProductionViewRenderer";
import { productionItemBoardLink, type ProductionItemLocation } from "@shared/productionItemLocation";

/** The existing station view, scoped to one canonical item (or its owning run).
 * Saved search, printer filters, status tabs and list pagination cannot hide it. */
export function ProductionItemFocus({ jobId }: { jobId: string }) {
  const navigate = useNavigate();
  const route = useLocation();
  const location = useQuery<ProductionItemLocation>({
    queryKey: ["/api/production/jobs", jobId, "location"],
    queryFn: async () => {
      const response = await apiFetch(`/api/production/jobs/${encodeURIComponent(jobId)}/location`, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("The current production item could not be located. Refresh the Order.");
      return (await response.json()).data;
    },
    staleTime: 0, retry: false, refetchInterval: 5_000,
  });
  const current = location.data;
  const target = current ? productionItemBoardLink(current) : null;
  useEffect(() => {
    if (target && `${route.pathname}${route.search}` !== target) navigate(target, { replace: true });
  }, [navigate, route.pathname, route.search, target]);
  if (location.isError) return <div role="alert" className="p-6">{location.error.message} <Link to="/production" className="underline">Open Production</Link></div>;
  if (!current) return <p role="status" className="p-6">Locating the current production item…</p>;
  if (current.prepress) return <p role="status" className="p-6">Opening the returned Prepress item…</p>;
  if (!target) return <div role="status" className="p-6">This item is currently owned by {current.stationKey}. <Link className="underline" to={`/orders/${encodeURIComponent(current.orderId)}`}>Open its Order</Link></div>;
  return <FocusedStation key={`${current.jobId}:${current.runId ?? "job"}`} item={current} />;
}

function FocusedStation({ item }: { item: ProductionItemLocation }) {
  const station = item.stationKey === "wide_roll" ? "roll" : item.stationKey;
  const job = useProductionJob(item.runId ? undefined : item.jobId);
  const runs = useProductionRuns({ station, orderId: item.orderId }, { enabled: !!item.runId });
  const run = runs.data?.find(candidate => candidate.id === item.runId);
  const jobs: ProductionJobListItem[] = job.data ? [{ ...job.data, view: station }] : [];
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let row: HTMLElement | undefined;
    const highlight = () => {
      row = Array.from(host.current?.querySelectorAll<HTMLElement>("[data-production-job-id]") ?? []).find(node => node.dataset.productionJobId === item.jobId);
      row?.classList.add("ring-2", "ring-primary", "bg-primary/10");
      row?.scrollIntoView?.({ block: "center" });
      return !!row;
    };
    // The existing station view selects its item in an effect; its Run panel
    // can mount after this effect, so wait for that panel rather than guessing.
    const observer = new MutationObserver(() => { if (highlight()) observer.disconnect(); });
    if (!highlight() && host.current) observer.observe(host.current, { childList: true, subtree: true });
    return () => { observer.disconnect(); row?.classList.remove("ring-2", "ring-primary", "bg-primary/10"); };
  }, [item.jobId, run]);
  const missing = item.runId ? !run : !job.data;
  const failed = item.runId ? runs.isError : job.isError;
  return <div ref={host} className="p-4" data-testid="focused-production-item">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary p-3">
      <div><h1 className="font-semibold">Open in Production · {station === "roll" ? "Roll" : "Flatbed"}</h1><p className="text-sm text-muted-foreground">Showing the linked item{item.runId ? " inside its Combined Run" : ""}. Other queue filters are temporarily bypassed.</p></div>
      <Link className="text-sm underline" to={`/production/${station}`}>Show full board</Link>
    </div>
    {failed ? <p role="alert">The item details could not be loaded. Refresh before using production actions.</p>
      : missing ? <p role="status">{(item.runId ? runs.isLoading : job.isLoading) ? "Loading the linked item…" : "The linked item has moved or is no longer available on this board. Refresh to locate its current owner."}</p>
      : <ProductionViewRenderer viewKey={station} status="all" jobs={jobs} runs={run ? [run] : []} />}
  </div>;
}
