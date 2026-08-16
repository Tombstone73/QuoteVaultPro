import type { TransactionalClient } from "../persistence/types.js";

export type BillingPhysicalPostcondition = Readonly<{ id: string; passed: boolean; detail: string }>;

const tables = ["v2_billing_invoices", "v2_billing_invoice_lines"] as const;
const constraints = [
  "v2_billing_invoices_order_tenant_fk", "v2_billing_invoices_customer_tenant_fk",
  "v2_billing_invoices_contact_tenant_fk", "v2_billing_invoices_total_chk",
  "v2_billing_invoice_lines_invoice_tenant_fk", "v2_billing_invoice_lines_source_sales_line_tenant_fk",
] as const;
const indexes = ["v2_billing_invoices_one_draft_per_order_uidx", "v2_billing_invoice_lines_invoice_position_uidx"] as const;

/** Physical checks deliberately prove Billing's separate ownership and order-scoped draft uniqueness. */
export async function checkV2BillingPhysicalPostconditions(client: TransactionalClient): Promise<BillingPhysicalPostcondition[]> {
  const [foundTables, foundConstraints, foundIndexes] = await Promise.all([
    client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1::text[])", [tables]),
    client.query<{ conname: string }>("SELECT conname FROM pg_constraint WHERE conname=ANY($1::text[])", [constraints]),
    client.query<{ indexname: string; indexdef: string }>("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND indexname=ANY($1::text[])", [indexes]),
  ]);
  const tableSet = new Set(foundTables.rows.map((row) => row.table_name));
  const constraintSet = new Set(foundConstraints.rows.map((row) => row.conname));
  const indexMap = new Map(foundIndexes.rows.map((row) => [row.indexname, row.indexdef]));
  return [
    ...tables.map((id) => ({ id: `table:${id}`, passed: tableSet.has(id), detail: "Billing-owned M1.9 persistence table" })),
    ...constraints.map((id) => ({ id: `constraint:${id}`, passed: constraintSet.has(id), detail: "Billing tenant/integrity constraint" })),
    ...indexes.map((id) => ({ id: `index:${id}`, passed: indexMap.has(id), detail: "Billing draft/line index" })),
    { id: "unique-index:v2_billing_invoices_one_draft_per_order_uidx", passed: /UNIQUE/i.test(indexMap.get("v2_billing_invoices_one_draft_per_order_uidx") ?? "") && /WHERE[\s\S]*invoice_state[\s\S]*draft/i.test(indexMap.get("v2_billing_invoices_one_draft_per_order_uidx") ?? ""), detail: "one current Draft Invoice per Order" },
  ];
}

export function assertV2BillingPhysicalPostconditions(findings: readonly BillingPhysicalPostcondition[]): void {
  const failed = findings.filter((finding) => !finding.passed);
  if (failed.length) throw new Error(`V2 Billing physical postconditions failed: ${failed.map((finding) => finding.id).join(", ")}`);
}
