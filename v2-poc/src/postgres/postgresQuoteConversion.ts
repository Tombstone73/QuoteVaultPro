import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AuthorityPolicy, type Principal, principalSubject, staffActor } from "../authorization/authorityPolicy";
import { PostgresPrincipalContext } from "../authorization/postgresPrincipalContext";
import { V2PocError } from "../shared/errors";

export type QuoteConversionFailurePoint = "after_request_claim" | "after_quote_lock" | "after_order_insert" | "after_line_insert" | "after_artwork_copy" | "after_invoice_insert" | "after_invoice_line_insert" | "after_conversion_link" | "before_commit";
export type QuoteConversionCommand = { organizationId: string; quoteId: string; requestId: string };
export type QuoteConversionResult = { quoteId: string; orderId: string; invoiceId: string; idempotentReplay: boolean };

const ddl = `
  ALTER TABLE orders ALTER COLUMN created_by_user_id DROP NOT NULL;
  ALTER TABLE invoices ALTER COLUMN created_by_user_id DROP NOT NULL;
  CREATE TABLE IF NOT EXISTS v2_poc_operation_attributions (
    id varchar(96) PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    operation varchar(64) NOT NULL, resource_type varchar(32) NOT NULL, resource_id varchar NOT NULL,
    principal_kind varchar(16) NOT NULL, principal_id varchar(160) NOT NULL,
    staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, operation, resource_type, resource_id)
  );
  CREATE TABLE IF NOT EXISTS v2_poc_quote_conversion_requests (
    id varchar(96) PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL, request_id varchar(160) NOT NULL,
    request_hash varchar(64) NOT NULL, quote_id varchar NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    order_id varchar REFERENCES orders(id) ON DELETE SET NULL, invoice_id varchar REFERENCES invoices(id) ON DELETE SET NULL,
    result_json jsonb, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
    principal_kind varchar(16) NOT NULL DEFAULT 'staff', principal_subject varchar(160) NOT NULL DEFAULT '',
    staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(organization_id, actor_user_id, request_id)
  );
  ALTER TABLE v2_poc_quote_conversion_requests ALTER COLUMN actor_user_id DROP NOT NULL;
  ALTER TABLE v2_poc_quote_conversion_requests ADD COLUMN IF NOT EXISTS principal_kind varchar(16) NOT NULL DEFAULT 'staff';
  ALTER TABLE v2_poc_quote_conversion_requests ADD COLUMN IF NOT EXISTS principal_subject varchar(160) NOT NULL DEFAULT '';
  ALTER TABLE v2_poc_quote_conversion_requests ADD COLUMN IF NOT EXISTS staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS v2_poc_quote_request_principal_unique
    ON v2_poc_quote_conversion_requests(organization_id, principal_kind, principal_subject, request_id);
  CREATE TABLE IF NOT EXISTS v2_poc_quote_order_conversions (
    id varchar(96) PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    quote_id varchar NOT NULL REFERENCES quotes(id) ON DELETE CASCADE, order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL, snapshot_hash varchar(64) NOT NULL,
    principal_kind varchar(16) NOT NULL DEFAULT 'staff', principal_subject varchar(160) NOT NULL DEFAULT '',
    staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,quote_id), UNIQUE(organization_id,order_id)
  );
  ALTER TABLE v2_poc_quote_order_conversions ALTER COLUMN actor_user_id DROP NOT NULL;
  ALTER TABLE v2_poc_quote_order_conversions ADD COLUMN IF NOT EXISTS principal_kind varchar(16) NOT NULL DEFAULT 'staff';
  ALTER TABLE v2_poc_quote_order_conversions ADD COLUMN IF NOT EXISTS principal_subject varchar(160) NOT NULL DEFAULT '';
  ALTER TABLE v2_poc_quote_order_conversions ADD COLUMN IF NOT EXISTS staff_actor_user_id varchar REFERENCES users(id) ON DELETE SET NULL;
`;
const need = <T>(value: T | undefined | null, message: string): T => { if (value == null) throw new V2PocError("NOT_FOUND", message); return value; };
const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const digest = (value: any) => createHash("sha256").update(canonical(value)).digest("hex");
const cents = (value: any) => Math.round(Number(value) * 100);
const fail = (actual: QuoteConversionFailurePoint | undefined, expected: QuoteConversionFailurePoint) => { if (actual === expected) throw new V2PocError("INJECTED_FAILURE", `Injected PostgreSQL failure at ${expected}.`); };

class Numbering {
  async take(client: PoolClient, organizationId: string, type: "order" | "invoice") {
    const name = `next_${type}_number`, prefix = type === "order" ? "ORD-" : "INV-";
    const result = await client.query(`insert into global_variables(id,organization_id,name,value,description,category,is_active,created_at,updated_at)
      values(gen_random_uuid(),$1,$2,'1001',$3,'numbering',true,now(),now())
      on conflict(organization_id,name) do update set value=(case when global_variables.value~'^[0-9]+$' then global_variables.value::int else 1000 end+1)::text,updated_at=now()
      returning(value::int-1) n`, [organizationId, name, `V2 POC ${type} numbering`]);
    const n = Number(result.rows[0].n); return { n, display: `${prefix}${n}` };
  }
}

/** One quote conversion implementation for staff, delegated AI, portal, and service principals. */
export class PostgresQuoteConversionApplication {
  private readonly authority = new AuthorityPolicy();
  private readonly principals = new PostgresPrincipalContext();
  private readonly numbers = new Numbering();
  constructor(private readonly pool: Pool) {}

  async installExperimentalSchema() { await this.pool.query(ddl); }

  /** Legacy staff boundary retained only for existing callers; canonical callers use convertPrincipal. */
  async convert(actor: string, command: QuoteConversionCommand, point?: QuoteConversionFailurePoint): Promise<QuoteConversionResult> {
    const client = await this.pool.connect();
    try {
      const principal: Principal = { kind: "staff", organizationId: command.organizationId, actorId: actor, capabilities: ["quotes.convert"] };
      return await this.convertInTransaction(client, principal, command, point);
    } finally { client.release(); }
  }

  async convertPrincipal(principal: Principal, command: QuoteConversionCommand, point?: QuoteConversionFailurePoint): Promise<QuoteConversionResult> {
    const client = await this.pool.connect();
    try { return await this.convertInTransaction(client, principal, command, point); }
    finally { client.release(); }
  }

  private async convertInTransaction(client: PoolClient, supplied: Principal, command: QuoteConversionCommand, point?: QuoteConversionFailurePoint): Promise<QuoteConversionResult> {
    try {
      await client.query("begin");
      const { principal } = await this.principals.resolve(client, supplied, command.organizationId);
      if (!command.requestId.trim()) throw new V2PocError("VALIDATION", "A request ID is required.");
      const quote = need((await client.query(`select * from quotes where id=$1 and organization_id=$2 for update`, [command.quoteId, command.organizationId])).rows[0] as any, "Quote not found in this organization.");
      const { customerId, contactId } = await this.customerScope(client, quote, command.organizationId);
      this.authority.authorize(principal, "quotes.convert", { organizationId: command.organizationId, customerId });
      const actor = staffActor(principal), subject = principalSubject(principal);
      const requestHash = digest({ operation: "convert_quote_to_order.v2", organizationId: command.organizationId, quoteId: command.quoteId });
      const claim = await client.query(`insert into v2_poc_quote_conversion_requests(id,organization_id,actor_user_id,request_id,request_hash,quote_id,principal_kind,principal_subject,staff_actor_user_id)
        values($1,$2,$3,$4,$5,$6,$7,$8,$3) on conflict(organization_id,principal_kind,principal_subject,request_id) do nothing returning id`,
        [`v2poc-q-request-${randomUUID()}`, command.organizationId, actor, command.requestId, requestHash, command.quoteId, principal.kind, subject]);
      if (!claim.rowCount) {
        const existing = need((await client.query(`select request_hash,result_json,quote_id from v2_poc_quote_conversion_requests where organization_id=$1 and principal_kind=$2 and principal_subject=$3 and request_id=$4`, [command.organizationId, principal.kind, subject, command.requestId])).rows[0] as any, "Idempotency request disappeared.");
        if (existing.request_hash !== requestHash || existing.quote_id !== command.quoteId) throw new V2PocError("IDEMPOTENCY_CONFLICT", "Request ID was already used with different content.");
        if (existing.result_json) { await client.query("commit"); return { ...existing.result_json, idempotentReplay: true }; }
      }
      fail(point, "after_request_claim");
      if (quote.converted_to_order_id) {
        const result = await this.existing(client, command.organizationId, command.quoteId);
        await this.complete(client, principal, command, requestHash, result);
        await client.query("commit"); return result;
      }
      if (quote.status !== "active" || quote.valid_until && new Date(quote.valid_until) < new Date()) throw new V2PocError("VALIDATION", "Only unexpired approved quotes may be converted.");
      const lines = (await client.query(`select l.* from quote_line_items l join quotes q on q.id=l.quote_id and q.organization_id=$2 where l.quote_id=$1 and l.status='active' order by l.display_order,l.id for update`, [command.quoteId, command.organizationId])).rows as any[];
      if (!lines.length) throw new V2PocError("VALIDATION", "A convertible quote needs an active line.");
      fail(point, "after_quote_lock");
      if (!customerId && !contactId) throw new V2PocError("VALIDATION", "Quote needs a customer or contact.");
      const orderNumber = await this.numbers.take(client, command.organizationId, "order"), orderId = `v2poc-q-order-${randomUUID()}`;
      await client.query(`insert into orders(id,organization_id,order_number,display_number,number_core,quote_id,source_quote_number,customer_id,contact_id,status,state,priority,fulfillment_status,subtotal,tax,tax_rate,tax_amount,taxable_subtotal,total,discount,shipping_method,shipping_cents,created_by_user_id)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,'new','open','normal','pending',$10,$11,$12,$11,$13,$14,$15,$16,$17,$18)`, [orderId, command.organizationId, String(orderNumber.n), orderNumber.display, orderNumber.n, quote.id, quote.quote_number, customerId, contactId, quote.subtotal, quote.tax_amount, quote.tax_rate, quote.taxable_subtotal, quote.total_price, quote.discount_amount, quote.shipping_method, quote.shipping_cents ?? 0, actor]);
      fail(point, "after_order_insert");
      const ids = new Map<string, string>();
      for (const [index, line] of lines.entries()) {
        const id = `v2poc-q-line-${randomUUID()}`, workflow = line.requires_proof_approval ? "awaiting_proof" : line.requires_design_snapshot ? "needs_design" : line.requires_prepress === false ? "ready_for_production" : "ready_for_prepress";
        await client.query(`insert into order_line_items(id,order_id,quote_line_item_id,product_id,product_type,description,width,height,quantity,unit_price,total_price,status,specs_json,option_selections_json,selected_options,pbv2_tree_version_id,pbv2_snapshot_json,priced_at,tax_amount,is_taxable_snapshot,sort_order,workflow_state,requires_design_snapshot,requires_design,requires_prepress,requires_proof_approval,parent_line_item_id,line_item_role,child_display_mode,parent_price_mode,child_calculated_total_cents)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'new',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,null,$26,$27,$28,$29)`, [id, orderId, line.id, line.product_id, line.product_type, line.product_name, line.width, line.height, line.quantity, (Number(line.line_price) / line.quantity).toFixed(2), line.line_price, JSON.stringify(line.specs_json ?? {}), JSON.stringify(line.option_selections_json ?? {}), JSON.stringify(line.selected_options ?? []), line.pbv2_tree_version_id, JSON.stringify(line.pbv2_snapshot_json), line.priced_at, line.tax_amount, line.is_taxable_snapshot, index, workflow, line.requires_design_snapshot, line.requires_design, line.requires_prepress ?? true, line.requires_proof_approval ?? false, line.line_item_role, line.child_display_mode, line.parent_price_mode, line.child_calculated_total_cents]);
        ids.set(line.id, id);
      }
      for (const line of lines) if (line.parent_line_item_id) await client.query(`update order_line_items set parent_line_item_id=$1 where id=$2`, [ids.get(line.parent_line_item_id), ids.get(line.id)]);
      fail(point, "after_line_insert");
      const attachments = (await client.query(`select * from quote_attachments where organization_id=$1 and quote_id=$2 order by id`, [command.organizationId, command.quoteId])).rows as any[];
      for (const attachment of attachments) await client.query(`insert into order_attachments(id,order_id,order_line_item_id,quote_id,file_record_id,file_name,file_url,file_size,mime_type,description,original_filename,stored_filename,relative_path,storage_provider,extension,size_bytes,checksum,production_quantity,production_group_id,role,customer_visible)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`, [`v2poc-q-attachment-${randomUUID()}`, orderId, attachment.quote_line_item_id ? ids.get(attachment.quote_line_item_id) : null, command.quoteId, attachment.file_record_id, attachment.file_name, attachment.file_url, attachment.file_size, attachment.mime_type, attachment.description, attachment.original_filename, attachment.stored_filename, attachment.relative_path, attachment.storage_provider, attachment.extension, attachment.size_bytes, attachment.checksum, attachment.production_quantity, attachment.production_group_id, attachment.production_role ?? "artwork", attachment.customer_visible]);
      fail(point, "after_artwork_copy");
      const invoiceNumber = await this.numbers.take(client, command.organizationId, "invoice"), invoiceId = `v2poc-q-invoice-${randomUUID()}`;
      await client.query(`insert into invoices(id,organization_id,invoice_number,display_number,number_core,order_id,customer_id,status,terms,subtotal,tax,total,subtotal_cents,tax_cents,shipping_cents,total_cents,amount_paid,balance_due,created_by_user_id)
        values($1,$2,$3,$4,$5,$6,$7,'draft','due_on_receipt',$8,$9,$10,$11,$12,$13,$14,0,$10,$15)`, [invoiceId, command.organizationId, invoiceNumber.n, invoiceNumber.display, invoiceNumber.n, orderId, customerId, quote.subtotal, quote.tax_amount, quote.total_price, cents(quote.subtotal), cents(quote.tax_amount), Number(quote.shipping_cents ?? 0), cents(quote.total_price), actor]);
      fail(point, "after_invoice_insert");
      for (const [index, line] of lines.entries()) await client.query(`insert into invoice_line_items(id,invoice_id,order_line_item_id,product_id,product_type,description,quantity,unit_price,total_price,unit_price_cents,line_total_cents,sort_order,option_selections_json,selected_options)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [`v2poc-q-inv-line-${randomUUID()}`, invoiceId, ids.get(line.id), line.product_id, line.product_type, line.product_name, line.quantity, (cents(line.line_price) / line.quantity / 100).toFixed(2), line.line_price, Math.round(cents(line.line_price) / line.quantity), cents(line.line_price), index, JSON.stringify(line.option_selections_json ?? {}), JSON.stringify(line.selected_options ?? [])]);
      fail(point, "after_invoice_line_insert");
      const snapshotHash = digest({ quote, lines });
      await client.query(`insert into v2_poc_quote_order_conversions(id,organization_id,quote_id,order_id,actor_user_id,snapshot_hash,principal_kind,principal_subject,staff_actor_user_id)
        values($1,$2,$3,$4,$5,$6,$7,$8,$5)`, [`v2poc-q-conversion-${randomUUID()}`, command.organizationId, command.quoteId, orderId, actor, snapshotHash, principal.kind, subject]);
      await client.query(`insert into v2_poc_operation_attributions(id,organization_id,operation,resource_type,resource_id,principal_kind,principal_id,staff_actor_user_id)
        values($1,$2,'quotes.convert','quote_conversion',$3,$4,$5,$6)`, [`v2poc-q-attribution-${randomUUID()}`, command.organizationId, command.quoteId, principal.kind, subject, actor]);
      await client.query(`update quotes set converted_to_order_id=$1 where id=$2 and organization_id=$3`, [orderId, command.quoteId, command.organizationId]);
      fail(point, "after_conversion_link");
      const result = { quoteId: command.quoteId, orderId, invoiceId, idempotentReplay: false };
      await this.complete(client, principal, command, requestHash, result);
      fail(point, "before_commit"); await client.query("commit"); return result;
    } catch (error) { try { await client.query("rollback"); } catch {} throw error; }
  }

  private async customerScope(client: PoolClient, quote: any, organizationId: string): Promise<{ customerId: string | null; contactId: string | null }> {
    let customerId = quote.customer_id as string | null, contactId = quote.contact_id as string | null;
    if (contactId) {
      const contact = need((await client.query(`select customer_id from customer_contacts where id=$1 and organization_id=$2`, [contactId, organizationId])).rows[0] as any, "Contact not found in this organization.");
      const link = (await client.query(`select customer_id from customer_contact_links where organization_id=$1 and contact_id=$2 and status='active' order by is_primary desc,customer_id limit 1`, [organizationId, contactId])).rows[0] as any;
      customerId = link?.customer_id ?? contact.customer_id ?? customerId;
    }
    if (customerId) need((await client.query(`select id from customers where id=$1 and organization_id=$2 and is_active=true`, [customerId, organizationId])).rows[0], "Customer not found in this organization.");
    return { customerId, contactId };
  }

  private async complete(client: PoolClient, principal: Principal, command: QuoteConversionCommand, hash: string, result: QuoteConversionResult) {
    await client.query(`update v2_poc_quote_conversion_requests set order_id=$1,invoice_id=$2,result_json=$3,completed_at=now()
      where organization_id=$4 and principal_kind=$5 and principal_subject=$6 and request_id=$7 and request_hash=$8`, [result.orderId, result.invoiceId, JSON.stringify(result), command.organizationId, principal.kind, principalSubject(principal), command.requestId, hash]);
  }

  private async existing(client: PoolClient, organizationId: string, quoteId: string): Promise<QuoteConversionResult> {
    const row = need((await client.query(`select o.id order_id,i.id invoice_id from orders o join invoices i on i.order_id=o.id and i.organization_id=o.organization_id and i.status='draft' where o.organization_id=$1 and o.quote_id=$2 order by i.created_at,i.id limit 1`, [organizationId, quoteId])).rows[0] as any, "Quote conversion linkage is invalid.");
    return { quoteId, orderId: row.order_id, invoiceId: row.invoice_id, idempotentReplay: true };
  }

  async read(actor: string, organizationId: string, quoteId: string) {
    const client = await this.pool.connect();
    try { const principal: Principal = { kind: "staff", organizationId, actorId: actor, capabilities: ["quotes.convert"] }; return await this.readPrincipalWithClient(client, principal, organizationId, quoteId); }
    finally { client.release(); }
  }
  async readPrincipal(principal: Principal, organizationId: string, quoteId: string) {
    const client = await this.pool.connect();
    try { return await this.readPrincipalWithClient(client, principal, organizationId, quoteId); }
    finally { client.release(); }
  }
  private async readPrincipalWithClient(client: PoolClient, supplied: Principal, organizationId: string, quoteId: string) {
    const { principal } = await this.principals.resolve(client, supplied, organizationId);
    const quote = need((await client.query(`select * from quotes where id=$1 and organization_id=$2`, [quoteId, organizationId])).rows[0] as any, "Quote not found in this organization.");
    const { customerId } = await this.customerScope(client, quote, organizationId);
    this.authority.authorize(principal, "quotes.convert", { organizationId, customerId });
    const conversion = await this.existing(client, organizationId, quoteId);
    const [order, lines, invoice] = await Promise.all([client.query(`select * from orders where id=$1 and organization_id=$2`, [conversion.orderId, organizationId]), client.query(`select * from order_line_items where order_id=$1 order by sort_order,id`, [conversion.orderId]), client.query(`select * from invoices where id=$1 and organization_id=$2`, [conversion.invoiceId, organizationId])]);
    return { conversion, order: need(order.rows[0], "Order not found."), lines: lines.rows, invoice: need(invoice.rows[0], "Invoice not found.") };
  }
}
