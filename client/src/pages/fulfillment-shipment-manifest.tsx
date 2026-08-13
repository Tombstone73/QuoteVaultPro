import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { getOrderDetails, useShipmentDetailQuery } from "@/hooks/useFulfillment";

/** Print-friendly, read-only document over canonical shipment/package data. */
export default function FulfillmentShipmentManifestPage() {
  const { shipmentId } = useParams<{ shipmentId: string }>();
  const shipmentQuery = useShipmentDetailQuery(shipmentId);
  const shipment = shipmentQuery.data;
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!shipment) return;
    void Promise.all(shipment.orders.map((order) => getOrderDetails(order.orderId))).then((orders) => {
      const next: Record<string, string> = {};
      for (const order of orders) for (const line of order.lineItems ?? []) next[line.id] = line.product?.name || line.description || "Line item";
      setLabels(next);
    });
  }, [shipment]);
  const packageGroups = useMemo(() => (shipment?.packages ?? []).map((pkg) => ({ pkg, items: shipment?.items.filter((item) => item.packageId === pkg.id) ?? [] })), [shipment]);
  if (!shipment) return <main className="p-8">Loading shipment manifest…</main>;
  return <main className="mx-auto max-w-3xl bg-white p-8 text-black print:max-w-none">
    <header className="mb-8 border-b-2 border-black pb-4"><h1 className="text-2xl font-bold">Shipment Manifest · {shipment.shipmentReference || "Shipment"}</h1><p>{shipment.orders.map((order) => `Order #${order.orderNumber} · ${order.customerName || "Customer"}`).join(" | ")}</p><p>Carrier: {shipment.carrier || "Not assigned"} · Tracking: {shipment.trackingNumber || "Not assigned"} · Ship date: {shipment.shipDate || "Not set"}</p></header>
    {packageGroups.map(({ pkg, items }) => <section key={pkg.id} className="mb-6 break-inside-avoid border p-4"><h2 className="text-lg font-bold">Package Ticket · {pkg.packageReference}</h2><p className="text-sm">{[pkg.weightLbs && `${pkg.weightLbs} lb`, pkg.dimLengthIn && `${pkg.dimLengthIn} × ${pkg.dimWidthIn || "?"} × ${pkg.dimHeightIn || "?"} in`].filter(Boolean).join(" · ") || "Dimensions / weight not recorded"}</p><table className="mt-3 w-full border-collapse text-sm"><thead><tr className="border-b"><th className="py-1 text-left">Item</th><th className="py-1 text-left">Order</th><th className="py-1 text-right">Qty</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b"><td className="py-1">{labels[item.orderLineItemId] || item.orderLineItemId}</td><td className="py-1">{shipment.orders.find((order) => order.orderId === item.orderId)?.orderNumber || "—"}</td><td className="py-1 text-right">{item.quantity}</td></tr>)}</tbody></table>{pkg.notes ? <p className="mt-2 text-sm">Notes: {pkg.notes}</p> : null}</section>)}
    <section className="border p-4"><h2 className="font-bold">Unpacked shipment items</h2>{shipment.items.filter((item) => !item.packageId).length ? <p className="text-sm">{shipment.items.filter((item) => !item.packageId).map((item) => `${labels[item.orderLineItemId] || item.orderLineItemId} × ${item.quantity}`).join(", ")}</p> : <p className="text-sm">All allocated items are assigned to packages.</p>}</section>
  </main>;
}
