import { shippingPartyAddressLines, shippingPartyValidationErrors, shippingDocumentTypeSchema, type ShippingDocumentLine, type ShippingDocumentSource, type ShippingDocumentType, type ShippingParty } from "./shippingDocuments";

const escape = (value: unknown): string => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const display = (value: unknown): string => escape(value) || "Not recorded";

/** All interpolated source text is escaped; customer documents use an explicit whitelist. */
export function renderShippingDocumentHtml(
  source: ShippingDocumentSource,
  type: ShippingDocumentType,
  options?: { packageId?: string },
): string {
  shippingDocumentTypeSchema.parse(type);
  if (source.blindShipping && shippingPartyValidationErrors(source.sender).length) {
    throw new Error("Blind shipping requires a confirmed alternate sender identity and address.");
  }
  const selectedPackage = options?.packageId ? source.packages.find((pkg) => pkg.id === options.packageId) : undefined;
  if (options?.packageId && !selectedPackage) throw new Error("Package does not belong to this shipment.");
  if (options?.packageId && type !== "package_ticket") throw new Error("Package selection is only supported for Package Tickets.");
  const titles: Record<ShippingDocumentType, string> = { packing_slip: "Packing Slip", shipment_manifest: "Shipment Manifest", package_ticket: "Package Ticket" };
  const party = (label: string, value: ShippingParty) => `<section><h2>${escape(label)}</h2><p>${shippingPartyAddressLines(value).map(escape).join("<br>") || "Not recorded"}</p></section>`;
  const orderLabel = (id: string) => source.orders.find((order) => order.id === id)?.orderNumber ?? "Not recorded";
  const items = (lines: ShippingDocumentLine[]) => `<table><thead><tr><th>Item</th><th>Order</th><th>Size</th><th>Material</th><th class="qty">Qty</th></tr></thead><tbody>${lines.length ? lines.map((line) => `<tr><td>${display(line.description)}</td><td>${display(orderLabel(line.orderId))}</td><td>${display(line.size)}</td><td>${display(line.material)}</td><td class="qty">${display(line.quantity)}</td></tr>`).join("") : '<tr><td colspan="5">No saved allocated items.</td></tr>'}</tbody></table>`;
  const orderSummary = (selectedOrders: ShippingDocumentSource["orders"]) => selectedOrders.map((order) => `<p><strong>Order ${display(order.orderNumber)}</strong>${order.poNumber ? ` | PO ${escape(order.poNumber)}` : ""}</p>`).join("");
  const orders = orderSummary(source.orders);
  const header = (title: string) => `<header><h1>${escape(title)}</h1>${source.basis === "draft" ? '<p class="notice">DRAFT PREVIEW | Saved allocations only | Not shipped</p>' : ""}</header>`;
  const logistics = `<p>Carrier: ${display(source.carrier)} | Service: ${display(source.serviceLevel)}<br>Tracking: ${display(source.trackingNumber)} | Ship date: ${display(source.shipDate)}</p>`;
  const packageBody = (pkg: ShippingDocumentSource["packages"][number], ticket: boolean) => `<section class="${ticket ? "ticket" : "package"}">
    ${ticket ? header("Package Ticket") : ""}<h2>Package ${display(pkg.packageReference)} | ${display(pkg.ordinal)} of ${display(source.packages.length)}</h2>
    <p>Shipment: ${display(source.shipmentReference)}</p>
    ${ticket ? orderSummary(source.orders.filter((order) => pkg.lines.some((line) => line.orderId === order.id))) : ""}<p>Weight: ${display(pkg.weightLbs)} lb | Dimensions: ${display(pkg.dimLengthIn)} x ${display(pkg.dimWidthIn)} x ${display(pkg.dimHeightIn)} in</p>
    ${items(pkg.lines)}${!ticket && pkg.internalNotes ? `<p class="notes">Internal package notes: ${escape(pkg.internalNotes)}</p>` : ""}</section>`;
  let body: string;
  if (type === "packing_slip") {
    // No customer/organization identity, IDs, logistics, notes, prices or history projection.
    const packingItems = source.lines.map((line) => `<section class="line-item"><strong>${display(line.description)}</strong><p>Order ${display(orderLabel(line.orderId))}</p><div class="line-meta"><div><strong>Qty</strong><p>${display(line.quantity)}</p></div><div><strong>Size</strong><p>${display(line.size)}</p></div></div><p><strong>Material</strong><br>${display(line.material)}</p></section>`).join("");
    body = `${header("Packing Slip")}<p class="notice">Not an invoice</p><div class="parties">${party("From", source.sender)}${party("Ship To", source.destination)}</div>${orders}<h2>Line items</h2>${packingItems || "<p>No saved allocated items.</p>"}<footer>Generated for packing only. Amounts are intentionally omitted.</footer>`;
  } else if (type === "package_ticket") {
    const packages = selectedPackage ? [selectedPackage] : source.packages;
    if (!packages.length) throw new Error("No saved packages are available for Package Tickets.");
    body = packages.map((pkg) => packageBody(pkg, true)).join("");
  } else {
    const unpacked = source.lines.flatMap((line) => {
      const packedQuantity = source.packages.reduce((sum, pkg) => sum + pkg.lines.filter((part) => part.orderLineItemId === line.orderLineItemId && part.orderId === line.orderId).reduce((qty, part) => qty + part.quantity, 0), 0);
      return line.quantity > packedQuantity ? [{ ...line, quantity: line.quantity - packedQuantity }] : [];
    });
    body = `${header("Shipment Manifest")}<p>Shipment: ${display(source.shipmentReference)}</p>${orders}${source.orders.map((order) => `<p>Customer: ${display(order.customerName)} | Order ID: ${display(order.id)}</p>`).join("")}${logistics}<div class="parties">${party("Effective sender", source.sender)}${party("Ship To", source.destination)}</div><h2>Actual shipment items</h2>${items(source.lines)}${source.packages.map((pkg) => packageBody(pkg, false)).join("")}<h2>Unpacked shipment items</h2>${unpacked.length ? items(unpacked) : "<p>All saved allocated items are assigned to packages.</p>"}${source.internalNotes ? `<section class="notes"><h2>Internal shipment notes</h2><p>${escape(source.internalNotes)}</p></section>` : ""}`;
  }
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(titles[type])}</title><style>
    @page { size: ${type === "packing_slip" ? "80mm auto; margin: 0" : "letter portrait; margin: 12mm"}; }
    * { box-sizing: border-box; } html, body { background: white; color: black; margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; }
    body { max-width: ${type === "packing_slip" ? "80mm" : "190mm"}; margin: 0 auto; padding: ${type === "packing_slip" ? "3mm" : "8mm"}; font-size: ${type === "packing_slip" ? "14px" : "12px"}; line-height: 1.35; overflow-wrap: anywhere; }
    header { border-bottom: 2px solid black; margin-bottom: 5mm; padding-bottom: 3mm; } h1 { font-size: 26px; margin: 0; text-transform: uppercase; } h2 { font-size: 15px; margin: 4mm 0 2mm; }
    p { margin: 2mm 0; white-space: pre-wrap; } .notice { font-weight: bold; } .parties { display: grid; grid-template-columns: ${type === "packing_slip" ? "1fr" : "1fr 1fr"}; gap: 4mm; }
    .line-item { border-bottom: 1px dashed black; padding: 2mm 0; break-inside: avoid; } .line-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm; }
    table { width: 100%; border-collapse: collapse; margin: 3mm 0; table-layout: fixed; } th, td { text-align: left; border-bottom: 1px solid black; padding: 2mm 1mm; vertical-align: top; } th:first-child { width: 34%; } .qty { text-align: right; width: 10%; }
    thead { display: table-header-group; } tr, .parties, header { break-inside: avoid; } .package { margin-top: 5mm; border: 1px solid black; padding: 3mm; } .notes, footer { margin-top: 5mm; border-top: 1px dashed black; padding-top: 2mm; }
    .ticket { break-inside: avoid; break-after: page; page-break-after: always; } .ticket:last-child { break-after: auto; page-break-after: auto; }
    @media print { body { max-width: none; ${type === "packing_slip" ? "width: 80mm; padding: 3mm;" : "padding: 0;"} } html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    @media screen and (max-width: 600px) { body { padding: 4mm; } .parties { gap: 4mm; } }
  </style></head><body>${body}</body></html>`;
}
