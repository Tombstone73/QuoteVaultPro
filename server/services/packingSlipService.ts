import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "../db";
import { customerContacts, customers, materials, orderLineItems, orders, products } from "@shared/schema";
import {
  collectLineItemProductionMaterialIds,
  resolveLineItemMaterialDisplayLabel,
} from "../routes/flatStockNesting.shared";

const EMPTY = "&mdash;";

type PackingSlipLineItem = {
  description?: string | null;
  quantity?: number | string | null;
  size?: string | null;
  material?: string | null;
};

type PackingSlipHtmlInput = {
  orderNumber?: string | null;
  customerName?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  poNumber?: string | null;
  shipToLines?: string[];
  lineItems?: PackingSlipLineItem[];
};

function cleanText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function escapeHtml(value: unknown): string {
  const text = cleanText(value);
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function display(value: unknown): string {
  const text = escapeHtml(value);
  return text || EMPTY;
}

function formatSize(width: unknown, height: unknown): string | null {
  const w = cleanText(width);
  const h = cleanText(height);
  if (!w || !h) return null;
  return `${w}&quot; &times; ${h}&quot;`;
}

function uniqueCleanLines(lines: Array<unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const text = cleanText(line);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function shippingAddressLines(order: any): string[] {
  const jsonAddress = order.shippingAddress && typeof order.shippingAddress === "object"
    ? order.shippingAddress
    : {};

  const name = cleanText(order.shipToName) ?? cleanText(jsonAddress.name);
  const company = cleanText(order.shipToCompany) ?? cleanText(jsonAddress.company);
  const line1 = cleanText(order.shipToAddress1) ?? cleanText(jsonAddress.address1);
  const line2 = cleanText(order.shipToAddress2) ?? cleanText(jsonAddress.address2);
  const city = cleanText(order.shipToCity) ?? cleanText(jsonAddress.city);
  const state = cleanText(order.shipToState) ?? cleanText(jsonAddress.state);
  const postal = cleanText(order.shipToPostalCode) ?? cleanText(jsonAddress.zip);
  const country = cleanText(order.shipToCountry) ?? cleanText(jsonAddress.country);
  const phone = cleanText(order.shipToPhone) ?? cleanText(jsonAddress.phone);
  const cityState = uniqueCleanLines([city, state]).join(", ");
  const cityStatePostal = uniqueCleanLines([cityState, postal]).join(" ");

  return uniqueCleanLines([
    company,
    name && name !== company ? name : null,
    line1,
    line2,
    cityStatePostal,
    country,
    phone ? `Phone: ${phone}` : null,
  ]);
}

export function buildPackingSlipHtml(input: PackingSlipHtmlInput): string {
  const shipToLines = input.shipToLines?.map(escapeHtml).filter(Boolean) ?? [];
  const contactParts = uniqueCleanLines([
    input.contactName,
    input.contactEmail,
    input.contactPhone,
  ]);
  const lineItems = input.lineItems ?? [];

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Packing Slip ${display(input.orderNumber)}</title>
  <style>
    body { color: #111827; font-family: Arial, sans-serif; margin: 0; padding: 28px; }
    .header { border-bottom: 2px solid #111827; display: flex; justify-content: space-between; margin-bottom: 24px; padding-bottom: 12px; }
    h1 { font-size: 28px; letter-spacing: 0; margin: 0; }
    .order-number { color: #4b5563; font-size: 16px; margin-top: 4px; }
    .section-grid { display: grid; gap: 18px; grid-template-columns: 1fr 1fr; margin-bottom: 24px; }
    .label { color: #6b7280; font-size: 11px; font-weight: 700; letter-spacing: .04em; margin-bottom: 6px; text-transform: uppercase; }
    .value { font-size: 14px; line-height: 1.45; }
    table { border-collapse: collapse; margin-top: 14px; width: 100%; }
    th, td { border: 1px solid #d1d5db; font-size: 13px; padding: 10px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; font-weight: 700; }
    .qty { text-align: right; width: 84px; }
    .footer { border-top: 1px solid #d1d5db; color: #6b7280; font-size: 12px; margin-top: 32px; padding-top: 12px; text-align: center; }
    @media print { body { padding: 18px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Packing Slip</h1>
      <div class="order-number">Order ${display(input.orderNumber)}</div>
    </div>
    <div class="value">This is not an invoice.</div>
  </div>

  <div class="section-grid">
    <div>
      <div class="label">Customer</div>
      <div class="value">${display(input.customerName)}</div>
    </div>
    <div>
      <div class="label">PO Number</div>
      <div class="value">${display(input.poNumber)}</div>
    </div>
    <div>
      <div class="label">Contact</div>
      <div class="value">${contactParts.length ? contactParts.map(escapeHtml).join("<br>") : EMPTY}</div>
    </div>
    <div>
      <div class="label">Ship To</div>
      <div class="value">${shipToLines.length ? shipToLines.join("<br>") : EMPTY}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Line Item</th>
        <th class="qty">Qty</th>
        <th>Size</th>
        <th>Material</th>
      </tr>
    </thead>
    <tbody>
      ${lineItems.length
        ? lineItems.map((item) => `
      <tr>
        <td>${display(item.description)}</td>
        <td class="qty">${display(item.quantity)}</td>
        <td>${item.size ? item.size : EMPTY}</td>
        <td>${display(item.material)}</td>
      </tr>`).join("")
        : `<tr><td colspan="4">${EMPTY}</td></tr>`}
    </tbody>
  </table>

  <div class="footer">Generated for packing only. Amounts are intentionally omitted.</div>
</body>
</html>`;
}

export async function generatePackingSlipHtmlForOrder(organizationId: string, orderId: string): Promise<string | null> {
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      displayNumber: orders.displayNumber,
      poNumber: orders.poNumber,
      customerId: orders.customerId,
      contactId: orders.contactId,
      shipToName: orders.shipToName,
      shipToCompany: orders.shipToCompany,
      shipToAddress1: orders.shipToAddress1,
      shipToAddress2: orders.shipToAddress2,
      shipToCity: orders.shipToCity,
      shipToState: orders.shipToState,
      shipToPostalCode: orders.shipToPostalCode,
      shipToCountry: orders.shipToCountry,
      shipToPhone: orders.shipToPhone,
      shippingAddress: orders.shippingAddress,
      customerName: customers.companyName,
    })
    .from(orders)
    .leftJoin(customers, and(eq(orders.customerId, customers.id), eq(customers.organizationId, organizationId)))
    .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
    .limit(1);

  if (!order) return null;

  const contact = order.contactId
    ? (await db
      .select({
        firstName: customerContacts.firstName,
        lastName: customerContacts.lastName,
        email: customerContacts.email,
        phone: customerContacts.phone,
      })
      .from(customerContacts)
      .where(and(eq(customerContacts.customerId, order.customerId), eq(customerContacts.id, order.contactId)))
      .limit(1))[0]
    : null;

  const lineItemRows = await db
    .select({
      id: orderLineItems.id,
      description: orderLineItems.description,
      quantity: orderLineItems.quantity,
      width: orderLineItems.width,
      height: orderLineItems.height,
      materialId: orderLineItems.materialId,
      productPrimaryMaterialId: products.primaryMaterialId,
      pbv2SnapshotJson: orderLineItems.pbv2SnapshotJson,
      materialUsageJson: orderLineItems.materialUsageJson,
      materialUsages: orderLineItems.materialUsages,
      specsJson: orderLineItems.specsJson,
      optionSelectionsJson: orderLineItems.optionSelectionsJson,
      selectedOptions: orderLineItems.selectedOptions,
      sortOrder: orderLineItems.sortOrder,
      createdAt: orderLineItems.createdAt,
    })
    .from(orderLineItems)
    .leftJoin(products, and(eq(orderLineItems.productId, products.id), eq(products.organizationId, organizationId)))
    .where(eq(orderLineItems.orderId, orderId))
    .orderBy(asc(orderLineItems.sortOrder), asc(orderLineItems.createdAt));

  const materialIds = Array.from(
    new Set(lineItemRows.flatMap((li) => collectLineItemProductionMaterialIds({
      lineItem: li,
      productPrimaryMaterialId: li.productPrimaryMaterialId ?? null,
    }))),
  );
  const materialNameById = new Map<string, string>();
  if (materialIds.length > 0) {
    const materialRows = await db
      .select({ id: materials.id, name: materials.name })
      .from(materials)
      .where(and(eq(materials.organizationId, organizationId), inArray(materials.id, materialIds)));
    for (const material of materialRows) materialNameById.set(material.id, material.name);
  }

  const contactName = contact
    ? uniqueCleanLines([contact.firstName, contact.lastName]).join(" ") || null
    : null;

  return buildPackingSlipHtml({
    orderNumber: order.displayNumber ?? order.orderNumber,
    customerName: order.customerName,
    contactName,
    contactEmail: contact?.email ?? null,
    contactPhone: contact?.phone ?? null,
    poNumber: order.poNumber,
    shipToLines: shippingAddressLines(order),
    lineItems: lineItemRows.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      size: formatSize(li.width, li.height),
      material: resolveLineItemMaterialDisplayLabel({
        lineItem: li,
        materialName: li.materialId ? materialNameById.get(li.materialId) ?? null : null,
        materialById: materialNameById,
        productPrimaryMaterialId: li.productPrimaryMaterialId ?? null,
        primaryMaterialName: li.productPrimaryMaterialId ? materialNameById.get(li.productPrimaryMaterialId) ?? null : null,
      }),
    })),
  });
}
