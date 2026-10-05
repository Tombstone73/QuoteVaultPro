import type { PoolClient } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { OrderingCustomerSender } from "../../src/modules/fulfillment/shipmentSender.js";
import { resolveShipmentSender, type ShipmentSenderIntent } from "../../src/modules/fulfillment/shipmentSender.js";
import type { OrganizationId } from "../../src/modules/shared/commercialValues.js";

export async function captureShipmentSender(client:PoolClient,organizationId:OrganizationId,orderIds:readonly string[],intents?:readonly ShipmentSenderIntent[]){
  return resolveShipmentSender(await readOrderingCustomerSenders(client,organizationId,orderIds),intents);
}

/** Scoped Customers projection only. No CRM writes and no Ship-To address fallback. */
export async function readOrderingCustomerSenders(client: PoolClient, organizationId: string, orderIds: readonly string[]): Promise<readonly OrderingCustomerSender[]> {
  const ids = [...new Set(orderIds)].sort();
  const result = await client.query<{ order_id: string; customer_id: string|null; sender_customer_id:string|null; blind_shipping: boolean | null; company_name: string | null; billing_street1: string | null; billing_street2: string | null; billing_city: string | null; billing_state: string | null; billing_postal_code: string | null; billing_country: string | null; phone: string | null; email: string | null }>(`SELECT d.id order_id,d.customer_id,c.id sender_customer_id,c.blind_shipping,c.company_name,c.billing_street1,c.billing_street2,c.billing_city,c.billing_state,c.billing_postal_code,c.billing_country,c.phone,c.email
    FROM v2_sales_documents d LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id
    WHERE d.organization_id=$1 AND d.document_kind='order' AND d.id=ANY($2::text[]) ORDER BY d.id`, [organizationId, ids]);
  if (result.rows.length !== ids.length||result.rows.some(row=>row.customer_id!==null&&row.sender_customer_id!==row.customer_id)) throw new V2ApplicationError("NOT_FOUND", "Ordering Customer sender context was not found.");
  return result.rows.map(row => ({ orderId: row.order_id, customerId: row.customer_id, defaultBlindShipping: row.blind_shipping === true, billingSender: {
    company: row.company_name, addressLine1: row.billing_street1, addressLine2: row.billing_street2, city: row.billing_city, region: row.billing_state, postalCode: row.billing_postal_code, country: row.billing_country, phone: row.phone, email: row.email,
  } }));
}
