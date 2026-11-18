import { Link } from "react-router-dom";
import type { PurchaseOrder, PurchaseOrderListRow } from "@/hooks/usePurchaseOrders";
import { purchaseHeaderCharges, purchasePaymentMethodLabel, purchasePaymentTermsLabel, purchaseVariance } from "@shared/purchaseOrderWorkflow";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const signedUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", signDisplay: "exceptZero" });
export function purchaseMoney(value: string | null | undefined) {
  return value == null ? "Not available" : usd.format(Number(value));
}

export function purchaseVarianceLabel(po: PurchaseOrderListRow) {
  if (po.actualTotal == null || po.originalTotal == null) return "Not available";
  if (po.status === "partially_received") return "Partial receipts";
  if (po.actualProvisional) return "Pending confirmation";
  return signedUsd.format(Number(purchaseVariance(po.actualTotal, po.originalTotal)));
}

export function purchaseActualTotalLabel(po: PurchaseOrderListRow) {
  const total = purchaseMoney(po.actualTotal);
  if (po.actualTotal === null) return total;
  if (po.status === "partially_received") return total + " (partial receipts)";
  return total + (po.actualProvisional ? " (provisional)" : " (final)");
}

export function PurchaseOrderLink({ order }: { order: PurchaseOrderListRow["relatedOrder"] }) {
  if (!order) return <span className="text-muted-foreground">No related Order</span>;
  return <Link className="text-titan-accent hover:underline" to={"/orders/" + order.id}>
    {order.displayNumber || order.orderNumber || order.jobNumber || "Open Order"}
  </Link>;
}

export function PurchaseOrderSummary({ po }: { po: PurchaseOrder }) {
  const original = new Map(po.originalLines?.map(line => [line.id, line]));
  const originalCharges = new Map(po.originalCharges ? purchaseHeaderCharges(po.originalCharges).map(charge => [charge.key, charge]) : []);
  const currentCharges = new Map(purchaseHeaderCharges(po).map(charge => [charge.key, charge]));
  const chargeRows = new Map([...originalCharges].map(([key, charge]) => [key, { ...charge, amount: "0" }]));
  for (const [key, charge] of currentCharges) chargeRows.set(key, charge);
  const expected = po.expectedLandedCosts;
  const actualLanded = po.actualLandedCosts;
  const actualByLine = new Map(actualLanded?.lines.map(line => [line.index, line]));
  return <div className="space-y-4">
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <div><dt>Vendor</dt><dd className="font-medium">{po.vendor?.name ?? "Vendor unavailable"}</dd></div>
      <div><dt>Related Order</dt><dd><PurchaseOrderLink order={po.relatedOrder} /></dd></div>
      <div><dt>Expected delivery</dt><dd>{po.expectedDate?.slice(0, 10) || "Not set"}</dd></div>
      <div><dt>Payment terms</dt><dd>{purchasePaymentTermsLabel(po.paymentTerms)}</dd></div>
      <div><dt>Payment method</dt><dd>{purchasePaymentMethodLabel(po.paymentMethod)}</dd></div>
      {po.paymentInstructions && <div className="col-span-2"><dt>Payment instructions</dt><dd className="break-words">{po.paymentInstructions}</dd></div>}
      <div><dt>Original total</dt><dd>{purchaseMoney(po.originalTotal)}</dd></div>
      <div><dt>Current expected total</dt><dd className="font-semibold">{purchaseMoney(po.grandTotal)}</dd></div>
      <div><dt>Actual total</dt><dd>{purchaseActualTotalLabel(po)}</dd></div>
      <div><dt>Cost variance</dt><dd>{purchaseVarianceLabel(po)}</dd></div>
    </dl>
    <div className="overflow-x-auto">
      <table className="min-w-[640px] w-full text-left text-sm">
        <thead className="border-b"><tr>
          <th scope="col" className="py-2 pr-4">Line item</th><th scope="col" className="pr-4">Original</th>
          <th scope="col" className="pr-4">Current expected</th><th scope="col" className="pr-4">Actual</th><th scope="col">Variance</th>
        </tr></thead>
        <tbody className="divide-y">
          {po.lineItems.map(line => {
            const baseline = original.get(line.id);
            const actual = po.actualCosts[line.id];
            return <tr key={line.id}>
              <th scope="row" className="py-2 pr-4 font-medium">{line.description}</th>
              <td className="pr-4">{baseline ? baseline.quantityOrdered + " × $" + baseline.unitCost + " = $" + baseline.lineTotal : "—"}</td>
              <td className="pr-4">{line.quantityOrdered} × ${line.unitCost} = ${line.lineTotal}</td>
              <td className="pr-4">
                {actual ? <>{actual.quantity && actual.unitCost !== null ? actual.quantity + " × $" + actual.unitCost + " = " : ""}{purchaseMoney(actual.total)}{actual.final ? "" : " (provisional)"}</> : "Not recorded"}
              </td>
              <td>{actual && baseline ? signedUsd.format(Number(purchaseVariance(actual.total, baseline.lineTotal, 4))) + (actual.final ? "" : " (provisional)") : "—"}</td>
            </tr>;
          })}
          {[...chargeRows.values()].filter(charge => Number(charge.amount) > 0 || po.actualCosts[charge.key] || Number(originalCharges.get(charge.key)?.amount) > 0).map(({ key, description, amount }) => {
            const actual = po.actualCosts[key];
            const originalAmount = po.originalCharges ? originalCharges.get(key)?.amount ?? "0" : null;
            return <tr key={key}>
              <th scope="row" className="py-2 pr-4 font-medium">{description}</th><td>{originalAmount !== null ? purchaseMoney(originalAmount) : "—"}</td>
              <td>{purchaseMoney(amount)}</td>
              <td>{actual ? purchaseMoney(actual.total) + (actual.final ? " (final)" : " (provisional)") : "Not recorded"}</td>
              <td>{actual && originalAmount !== null
                ? signedUsd.format(Number(purchaseVariance(actual.total, originalAmount))) + (actual.final ? "" : " (provisional)") : "—"}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    {expected && (expected.lines.length > 0 || Number(expected.unallocatedTotal) > 0) && <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-semibold">Landed costs</summary>
      <div className="mt-2 space-y-2 text-sm">
        <p>Expected allocation {purchaseMoney(expected.allocatedTotal)}
          {actualLanded ? ` · Actual allocation ${purchaseMoney(actualLanded.allocatedTotal)} (${actualLanded.final ? "final" : "provisional"})` : ""}</p>
        {Number(expected.unallocatedTotal) > 0 && <p className="text-amber-800 dark:text-amber-300">{purchaseMoney(expected.unallocatedTotal)} in expected freight and other charges is unallocated.</p>}
        {actualLanded && Number(actualLanded.unallocatedTotal) > 0 && <p className="text-amber-800 dark:text-amber-300">{purchaseMoney(actualLanded.unallocatedTotal)} in recorded actual charges is unallocated.</p>}
        {expected.error && <p className="text-destructive">{expected.error}</p>}
        {expected.lines.length > 0 && <>
          <p className="text-xs text-muted-foreground">
            {actualLanded ? "Includes recorded acquisition charges. Tax is excluded."
              : "Actual landed unit costs appear after material receiving is complete and the applicable vendor costs are recorded."}
            {" "}Landed costs shown here are for review and do not post to inventory.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-[640px] w-full text-left text-sm">
              <thead className="border-b"><tr>
                <th scope="col" className="py-2 pr-3">Material</th>
                <th scope="col" className="pr-3">Vendor / purchase unit</th>
                <th scope="col" className="pr-3">Expected landed / purchase unit</th>
                <th scope="col" className="pr-3">Actual landed / purchase unit</th>
                <th scope="col">Landed / inventory unit (expected · actual)</th>
              </tr></thead>
              <tbody className="divide-y">{expected.lines.map(line => {
                const orderLine = po.lineItems[line.index];
                const actual = actualByLine.get(line.index);
                return <tr key={orderLine.id}>
                  <th scope="row" className="py-2 pr-3 font-medium">{orderLine.description}</th>
                  <td className="pr-3">${orderLine.unitCost}</td>
                  <td className="pr-3">{!expected.error && line.purchaseUnitCost ? "$" + line.purchaseUnitCost : "—"}</td>
                  <td className="pr-3">{actual?.purchaseUnitCost ? "$" + actual.purchaseUnitCost : "—"}</td>
                  <td>{!expected.error && line.inventoryUnitCost ? "$" + line.inventoryUnitCost : "—"} · {actual?.inventoryUnitCost ? "$" + actual.inventoryUnitCost : "—"}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </>}
      </div>
    </details>}
  </div>;
}
