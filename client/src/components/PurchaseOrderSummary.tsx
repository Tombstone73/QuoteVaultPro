import { Link } from "react-router-dom";
import type { PurchaseOrder, PurchaseOrderListRow } from "@/hooks/usePurchaseOrders";
import { purchasePaymentMethodLabel, purchasePaymentTermsLabel, purchaseVariance } from "@shared/purchaseOrderWorkflow";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const signedUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", signDisplay: "exceptZero" });
export function purchaseMoney(value: string | null | undefined) {
  return value == null ? "Not available" : usd.format(Number(value));
}

export function purchaseVarianceLabel(po: PurchaseOrderListRow) {
  if (po.actualTotal == null || po.originalTotal == null) return "Not available";
  if (po.actualProvisional) return "Pending confirmation";
  return signedUsd.format(Number(purchaseVariance(po.actualTotal, po.originalTotal)));
}

export function PurchaseOrderLink({ order }: { order: PurchaseOrderListRow["relatedOrder"] }) {
  if (!order) return <span className="text-muted-foreground">No related Order</span>;
  return <Link className="text-titan-accent hover:underline" to={"/orders/" + order.id}>
    {order.displayNumber || order.orderNumber || order.jobNumber || "Open Order"}
  </Link>;
}

export function PurchaseOrderSummary({ po }: { po: PurchaseOrder }) {
  const original = new Map(po.originalLines?.map(line => [line.id, line]));
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
      <div><dt>Actual total</dt><dd>{purchaseMoney(po.actualTotal)}{po.actualTotal !== null && po.actualProvisional ? " (provisional)" : ""}</dd></div>
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
          {(["freight", "tax"] as const).filter(key => Number(key === "freight" ? po.shippingTotal : po.taxTotal) > 0).map(key => {
            const actual = po.actualCosts[key];
            return <tr key={key}>
              <th scope="row" className="py-2 pr-4 font-medium">{key === "freight" ? "Header freight" : "Header tax"}</th><td>—</td>
              <td>{purchaseMoney(key === "freight" ? po.shippingTotal : po.taxTotal)}</td>
              <td>{actual ? purchaseMoney(actual.total) + (actual.final ? "" : " (provisional)") : "Not recorded"}</td><td>—</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </div>;
}
