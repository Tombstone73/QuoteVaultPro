import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProductionDailyReport as DailyReport, ProductionDailyReportClient, ProductionDailyReportRow } from "./productionDailyReportApi";

const recorded = (value: string | null) => value?.trim() || "Not recorded";
const dueLabels = { overdue: "Overdue", today: "Due today", tomorrow: "Due tomorrow", future: "Upcoming", undated: "No due date" };
const states = { ready: "New / ready", active: "In production", held: "On hold", rework_requested: "Prepress rework requested", complete: "Complete" };
const fulfillment = { pickup: "Pickup", shipping: "Ship", local_delivery: "Delivery", not_recorded: "Not recorded" };

const ReportSection = ({ title, rows }: { title: string; rows: readonly ProductionDailyReportRow[] }) => <section className="production-daily-report-section" aria-label={title}>
  <h2>{title} <span>{rows.length} work{rows.length === 1 ? "" : "s"} shown</span></h2>
  {rows.length ? <div className="production-daily-report-table-wrap"><table>
    <caption>{title}: one row per eligible Production work, not per Order or Run</caption>
    <thead><tr><th scope="col">Due</th><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">PO / Job Info</th><th scope="col">Qty</th><th scope="col">Requested Fulfillment</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.productionWorkId} data-work-id={row.productionWorkId} data-due-category={row.dueCategory}>
      <td>{row.dueDate ? <time dateTime={row.dueDate}>{row.dueDate}</time> : "No due date"}<small>{row.dueDate ? dueLabels[row.dueCategory] : "Not recorded"}</small></td>
      <td><strong>{recorded(row.orderNumber)}</strong><small>{states[row.state]}</small><small>{row.replacementObligationId ? `Replacement ${row.replacementObligationId}` : "Original"}{row.reworkCycleId ? " / Rework" : ""}</small><small className="production-daily-report-work">Work {row.productionWorkId}</small></td>
      <td>{recorded(row.customerName)}</td>
      <td><strong>{recorded(row.jobLabel)}</strong><small>PO: {recorded(row.purchaseOrderNumber)}</small><small>{recorded(row.lineDescription)}</small><small>Unit: {row.requirementKey}</small></td>
      <td className="production-daily-report-quantity"><strong>{row.orderedQuantity}</strong><small>{row.remainingGoodQuantity} remaining</small>{row.activeAttemptId && <small>Attempt active</small>}</td>
      <td>{fulfillment[row.requestedFulfillment]}</td>
    </tr>)}</tbody>
  </table></div> : <p>No eligible work shown in this section.</p>}
</section>;

/** Same renderer and server population for on-screen and full-snapshot browser print. */
export const ProductionDailyReportDocument = ({ report }: { report: DailyReport }) => <>
  <header className="production-daily-report-heading">
    <div><p>Production management</p><h1>Daily Production Report</h1><p>Calendar date {report.calendar.todayDate} ({report.calendar.timeZone})</p></div>
    <div className="production-daily-report-asof">Snapshot as of <time dateTime={report.calendar.asOf}>{report.calendar.asOf}</time></div>
  </header>
  {report.coverage.truncated && <p className="production-daily-report-warning" role="status">Partial report: limited to the first {report.coverage.candidateLimit} candidate works. Counts cover only the eligible population in this bounded snapshot, not all active work.</p>}
  {report.blockedWork.length > 0 && <p className="production-daily-report-warning" role="status">Partial report: {report.blockedWork.length} work{report.blockedWork.length === 1 ? " is" : "s are"} blocked with unresolved eligibility or frozen facts. Blocked work is excluded from every summary count, not classified as original or replacement, and listed separately below. Counts are not complete.</p>}
  <dl className="production-daily-report-summary">
    {([ ["Active works", report.summary.totalActive], ["Overdue", report.summary.overdue], ["Due today", report.summary.dueToday], ["Due tomorrow", report.summary.dueTomorrow], ["Roll", report.summary.roll], ["Flatbed", report.summary.flatbed] ] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}
  </dl>
  <p className="production-daily-report-count-note">{report.summary.distinctOrders} distinct Orders; {report.summary.activeAttempts} active attempts; {report.summary.noDue} works without a due date. Counts are unique Production works and do not combine original and replacement output.</p>
  <ReportSection title="Roll" rows={report.rows.filter(row => row.destination === "roll")} />
  <ReportSection title="Flatbed" rows={report.rows.filter(row => row.destination === "flatbed")} />
  {report.summary.unknownDestination > 0 && <><p className="production-daily-report-warning">{report.summary.unknownDestination} work{report.summary.unknownDestination === 1 ? " has" : "s have"} no recorded Production destination. Included in Active works, not assigned to Roll or Flatbed.</p><ReportSection title="Destination not recorded" rows={report.rows.filter(row => row.destination === "unknown")} /></>}
  {report.blockedWork.length > 0 && <section className="production-daily-report-section production-daily-report-blocked" aria-label="Blocked work">
    <h2>Blocked work <span>{report.blockedWork.length} excluded from counts</span></h2>
    <ul>{report.blockedWork.map(work => <li key={work.productionWorkId} data-blocked-work-id={work.productionWorkId}>
      <strong>Work {work.productionWorkId}</strong><p>Order {work.orderId}; line {work.orderLineId}; unit {work.requirementKey}</p><p>{work.reason}</p>
    </li>)}</ul>
  </section>}
</>;

export const ProductionDailyReport = ({ organizationId, sessionScope, canView, client }: {
  organizationId: string;
  sessionScope: string;
  canView: boolean;
  client: ProductionDailyReportClient;
}) => {
  const scope = JSON.stringify([organizationId, sessionScope]);
  const [paging, setPaging] = useState({ scope, page: 1 });
  const page = paging.scope === scope ? paging.page : 1;
  const [printRequest, setPrintRequest] = useState<{ scope: string; nonce: number } | null>(null);
  const serial = useRef(0), printed = useRef(0);
  const enabled = Boolean(organizationId && sessionScope && canView);
  const currentContext = useRef({ scope, enabled });
  currentContext.current = { scope, enabled };
  const report = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "production", "daily-report", page, 25],
    queryFn: async ({ signal }) => {
      try { return await client.dailyReport(organizationId, { page, pageSize: 25, mode: "page" }, signal); }
      catch (error) {
        if (currentContext.current.scope === scope) {
          // Fence pending print completions before React processes the denied read.
          serial.current++;
          setPrintRequest(null);
        }
        throw error;
      }
    },
    enabled, retry: false,
  });
  const printing = useQuery({
    queryKey: ["v2", sessionScope, organizationId, "production", "daily-report-print", printRequest?.nonce ?? 0],
    queryFn: ({ signal }) => client.dailyReport(organizationId, { mode: "print" }, signal),
    enabled: enabled && printRequest?.scope === scope, retry: false, staleTime: Infinity, gcTime: 0,
  });
  useEffect(() => { setPrintRequest(null); }, [organizationId, sessionScope, canView]);
  const printReport = enabled && !report.isError && printRequest?.scope === scope && printRequest.nonce === serial.current ? printing.data : undefined;
  const printReady = !printing.isFetching && !printing.isError && printReport?.mode === "print" && printReport.rows.length === printReport.summary.totalActive;
  useEffect(() => {
    if (!printReady || !printRequest || !currentContext.current.enabled || currentContext.current.scope !== printRequest.scope || serial.current !== printRequest.nonce || printed.current === printRequest.nonce) return;
    printed.current = printRequest.nonce;
    window.print();
  }, [printReady, printRequest]);

  if (!organizationId || !sessionScope) return <p role="status">An authenticated organization and session are required for the Production daily report.</p>;
  if (!canView) return <p role="status">You do not have permission to view the Production daily report.</p>;
  return <div className="production-daily-report">
    <div className="production-daily-report-screen">
      <div className="production-daily-report-controls"><button type="button" onClick={() => void report.refetch()} disabled={report.isFetching}>Refresh</button><button type="button" onClick={() => setPrintRequest({ scope, nonce: ++serial.current })} disabled={!report.data || report.isError || printing.isFetching}>Print full report</button></div>
      {report.isPending && <p role="status">Loading the Production daily report...</p>}
      {report.isError && <p role="alert">{report.error instanceof Error ? report.error.message : "The Production daily report is unavailable."}</p>}
      {printRequest && printing.isFetching && <p role="status">Preparing the full report snapshot for printing...</p>}
      {printRequest && (printing.isError || (printReport && !printReady)) && <p role="alert">The full print snapshot is unavailable. Nothing has been printed.</p>}
      {report.data && !report.isError && <><ProductionDailyReportDocument report={report.data} />
        {report.data.summary.totalActive === 0 && <p role="status">{!report.data.coverage.countsComplete ? "No eligible work in the resolved population. Unresolved or unscanned work is not included; this is not a complete report." : "No active Production work requires attention."}</p>}
        <nav className="production-daily-report-pager" aria-label="Daily report pages"><p>Page {report.data.pagination.page} of {Math.max(1, report.data.pagination.totalPages)}. Summary counts cover all eligible works in this snapshot, before page slicing.</p><button type="button" disabled={page <= 1 || report.isFetching} onClick={() => setPaging({ scope, page: page - 1 })}>Previous page</button><button type="button" disabled={page >= report.data.pagination.totalPages || report.isFetching} onClick={() => setPaging({ scope, page: page + 1 })}>Next page</button></nav>
      </>}
    </div>
    <div className="production-daily-report-print" aria-hidden="true">{printReady && printReport ? <ProductionDailyReportDocument report={printReport} /> : <p>Use Print full report to prepare a matching report snapshot with coverage warnings before printing.</p>}</div>
  </div>;
};
