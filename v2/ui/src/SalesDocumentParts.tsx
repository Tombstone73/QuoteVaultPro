import { money, type InvoiceRead } from "./api";

const stateLabel = (value: string) =>
  value
    .replaceAll("_", " ")
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());

export const LifecycleBadge = ({ value }: { value: string }) => (
  <span
    className={`badge ${value === "accepted" || value === "converted" || value === "open" ? "success" : ""}`}
  >
    {stateLabel(value)}
  </span>
);

export const SalesTotals = ({
  calculated,
  selling,
}: Readonly<{
  calculated: { cents: number; currency: string };
  selling: { cents: number; currency: string };
}>) => (
  <div className="totals">
    Calculated total: {money(calculated)} · Selling total: {money(selling)}
  </div>
);

export const RouteSummary = ({
  route,
}: Readonly<{
  route?: {
    routeInstanceId?: string;
    state: string;
    currentStepId?: string;
    steps: readonly { routeInstanceStepId: string; kind: string }[];
  };
}>) =>
  route ? (
    <div className="route-summary">
      <strong>Routing</strong>:{" "}
      {route.steps.map((step) => stateLabel(step.kind)).join(" → ")}
      <span className="muted">
        {" "}
        · Current:{" "}
        {stateLabel(
          route.steps.find(
            (step) => step.routeInstanceStepId === route.currentStepId,
          )?.kind ?? route.state,
        )}
      </span>
    </div>
  ) : (
    <div className="muted">No route required</div>
  );

export const DraftInvoiceSummary = ({
  invoice,
  detail,
}: Readonly<{
  invoice?: {
    invoiceId: string;
    lifecycle: "draft";
    total: { cents: number; currency: string };
  };
  detail?: InvoiceRead;
}>) =>
  invoice ? (
    <section className="card compact-summary">
      <h3>Draft Invoice</h3>
      <p>
        {stateLabel(invoice.lifecycle)} · {money(invoice.total)}
      </p>
      <p className="muted">Synchronized with this Order.</p>
      {detail && (
        <p className="muted">
          {detail.lines.length} line{detail.lines.length === 1 ? "" : "s"} ·{" "}
          {money(detail.total)}
        </p>
      )}
    </section>
  ) : null;
