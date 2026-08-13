import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { V2PocError } from "../shared/errors";

type Operation = "record_production_outcome.v2_poc" | "record_pickup_handoff.v2_poc" | "finalize_shipment.v2_poc";
export type FulfillmentFailurePoint = "after_request_claim" | "after_physical_write" | "before_commit" | "during_billing_reconciliation";
export type Availability = { ordered: number; produced: number; shipped: number; pickedUp: number; available: number; remainingProduction: number };
export type ProductionOutcomeCommand = { organizationId: string; orderId: string; lineItemId: string; productionRunMemberId: string; successfulQuantity: number; damagedQuantity?: number; requestId: string };
export type PickupHandoffCommand = { organizationId: string; orderId: string; lineItemId: string; quantity: number; requestId: string; notes?: string };
export type ShipmentCommand = { organizationId: string; orderId: string; lineItemId: string; quantity: number; requestId: string; shipmentReference: string };

const ddl = `
CREATE TABLE IF NOT EXISTS v2_poc_fulfillment_requests (id varchar(96) PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, actor_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE, operation varchar(80) NOT NULL, request_id varchar(160) NOT NULL, request_hash varchar(64) NOT NULL, result_json jsonb, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, UNIQUE (organization_id, actor_user_id, operation, request_id));
CREATE TABLE IF NOT EXISTS v2_poc_billing_reconciliations (id varchar(96) PRIMARY KEY, organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, order_id varchar NOT NULL REFERENCES orders(id) ON DELETE CASCADE, fulfillment_event_id varchar NOT NULL REFERENCES fulfillment_events(id) ON DELETE CASCADE, status varchar(16) NOT NULL DEFAULT 'PENDING', attempts integer NOT NULL DEFAULT 0, last_error text, result_json jsonb, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, UNIQUE (organization_id, fulfillment_event_id));`;

const required = <T>(value: T | undefined | null, message: string): T => { if (value == null) throw new V2PocError("NOT_FOUND", message); return value; };
const fail = (actual: FulfillmentFailurePoint | undefined, expected: FulfillmentFailurePoint) => { if (actual === expected) throw new V2PocError("INJECTED_FAILURE", `Injected PostgreSQL failure at ${expected}.`); };
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value);
const hash = (operation: Operation, command: unknown) => createHash("sha256").update(canonical({ version: 1, operation, command })).digest("hex");

class AuthorizationRepository {
  async authorize(client: PoolClient, actorId: string, organizationId: string) {
    const result = await client.query(`select uo.role from user_organizations uo join organizations o on o.id=uo.organization_id where uo.user_id=$1 and uo.organization_id=$2 and o.delete_state='active' and o.is_archived=false`, [actorId, organizationId]);
    const role = result.rows[0]?.role;
    if (!role || !["owner", "admin", "manager"].includes(role)) throw new V2PocError("FORBIDDEN", "Actor lacks the organization-scoped production and fulfillment capability.");
  }
}

class FulfillmentRequestRepository {
  async claim(client: PoolClient, actorId: string, operation: Operation, organizationId: string, requestId: string, requestHash: string): Promise<unknown | null> {
    if (!requestId.trim()) throw new V2PocError("VALIDATION", "A request ID is required.");
    const inserted = await client.query(`insert into v2_poc_fulfillment_requests (id,organization_id,actor_user_id,operation,request_id,request_hash) values ($1,$2,$3,$4,$5,$6) on conflict (organization_id,actor_user_id,operation,request_id) do nothing returning id`, [`v2poc-fulfillment-request-${randomUUID()}`, organizationId, actorId, operation, requestId, requestHash]);
    if (inserted.rowCount) return null;
    const existing = await client.query(`select request_hash,result_json from v2_poc_fulfillment_requests where organization_id=$1 and actor_user_id=$2 and operation=$3 and request_id=$4`, [organizationId, actorId, operation, requestId]);
    const row = required(existing.rows[0], "Idempotency request disappeared.") as { request_hash: string; result_json: unknown };
    if (row.request_hash !== requestHash) throw new V2PocError("IDEMPOTENCY_CONFLICT", "Request ID was already used with different content.");
    return required(row.result_json, "Idempotency request is incomplete.");
  }
  async complete(client: PoolClient, actorId: string, operation: Operation, organizationId: string, requestId: string, requestHash: string, result: unknown) {
    await client.query(`update v2_poc_fulfillment_requests set result_json=$1,completed_at=now() where organization_id=$2 and actor_user_id=$3 and operation=$4 and request_id=$5 and request_hash=$6`, [JSON.stringify(result), organizationId, actorId, operation, requestId, requestHash]);
  }
}

class AvailabilityRepository {
  async lockLine(client: PoolClient, organizationId: string, orderId: string, lineItemId: string) {
    const line = await client.query(`select l.id,l.quantity from order_line_items l join orders o on o.id=l.order_id where l.id=$1 and l.order_id=$2 and o.organization_id=$3 for update`, [lineItemId, orderId, organizationId]);
    return required(line.rows[0] as { id: string; quantity: number } | undefined, "Order line not found in this organization.");
  }
  async lockOrderLines(client: PoolClient, organizationId: string, orderId: string, lineItemId: string) {
    const lines = await client.query(`select l.id,l.quantity from order_line_items l join orders o on o.id=l.order_id where l.order_id=$1 and o.organization_id=$2 order by l.id for update`, [orderId, organizationId]);
    const line = lines.rows.find((row) => row.id === lineItemId) as { id: string; quantity: number } | undefined;
    return required(line, "Order line not found in this organization.");
  }
  async read(client: PoolClient, organizationId: string, orderId: string, lineItemId: string): Promise<Availability> {
    const result = await client.query(`select l.quantity::int as ordered,
      coalesce((select sum(m.successful_quantity) from production_run_members m join production_runs r on r.id=m.production_run_id where m.organization_id=$1 and m.order_line_item_id=l.id and lower(r.status) not in ('canceled','cancelled')),0)::int as produced,
      coalesce((select sum(si.quantity) from shipment_items si join shipments s on s.id=si.shipment_id where si.organization_id=$1 and si.order_line_item_id=l.id and s.status='SHIPPED'),0)::int as shipped,
      coalesce((select sum(hi.quantity) from pickup_handoff_items hi join pickup_handoffs h on h.id=hi.pickup_handoff_id where hi.organization_id=$1 and hi.order_line_item_id=l.id),0)::int as picked_up
      from order_line_items l join orders o on o.id=l.order_id where l.id=$2 and l.order_id=$3 and o.organization_id=$1`, [organizationId, lineItemId, orderId]);
    const row = required(result.rows[0] as { ordered: number; produced: number; shipped: number; picked_up: number } | undefined, "Order line not found in this organization.");
    const available = Math.max(0, row.produced - row.shipped - row.picked_up);
    return { ordered: Number(row.ordered), produced: Number(row.produced), shipped: Number(row.shipped), pickedUp: Number(row.picked_up), available, remainingProduction: Math.max(0, Number(row.ordered) - row.produced) };
  }
  async orderIsPhysicallyTerminal(client: PoolClient, organizationId: string, orderId: string) {
    const lines = await client.query(`select l.id,l.quantity::int as ordered from order_line_items l join orders o on o.id=l.order_id where o.organization_id=$1 and l.order_id=$2 order by l.id`, [organizationId, orderId]);
    if (!lines.rowCount) throw new V2PocError("NOT_FOUND", "Order has no lines in this organization.");
    for (const line of lines.rows as Array<{ id: string; ordered: number }>) {
      const availability = await this.read(client, organizationId, orderId, line.id);
      if (availability.shipped + availability.pickedUp < availability.ordered) return false;
    }
    return true;
  }
}

class ProductionRepository {
  async recordOutcome(client: PoolClient, command: ProductionOutcomeCommand, actorId: string) {
    const member = await client.query(`select m.id,m.allocated_quantity,m.successful_quantity,m.damaged_quantity,m.production_job_id,m.production_run_id from production_run_members m join production_jobs j on j.id=m.production_job_id join production_runs r on r.id=m.production_run_id where m.id=$1 and m.organization_id=$2 and m.order_line_item_id=$3 and j.order_id=$4 and r.organization_id=$2 for update`, [command.productionRunMemberId, command.organizationId, command.lineItemId, command.orderId]);
    const row = required(member.rows[0] as any, "Production run member not found in this organization.");
    const damaged = command.damagedQuantity ?? Number(row.damaged_quantity);
    if (![command.successfulQuantity, damaged].every(Number.isInteger) || command.successfulQuantity < Number(row.successful_quantity) || damaged < Number(row.damaged_quantity) || command.successfulQuantity < 0 || damaged < 0 || command.successfulQuantity + damaged > Number(row.allocated_quantity)) throw new V2PocError("VALIDATION", "Production outcomes are cumulative, non-negative, and cannot exceed the allocation.");
    const completed = command.successfulQuantity + damaged;
    const outcome = completed === Number(row.allocated_quantity) ? "completed" : completed > 0 ? "partially_completed" : "pending";
    await client.query(`update production_run_members set successful_quantity=$1,damaged_quantity=$2,completed_quantity=$3,remaining_quantity=$4,outcome_status=$5,last_outcome_idempotency_key=$6,last_outcome_at=now(),updated_at=now() where id=$7`, [command.successfulQuantity, damaged, completed, Number(row.allocated_quantity) - completed, outcome, command.requestId, row.id]);
    await client.query(`update production_runs set status=$1::varchar,completed_at=case when $1::varchar='completed' then now() else null end,updated_at=now() where id=$2`, [outcome === "completed" ? "completed" : "partially_completed", row.production_run_id]);
    await client.query(`insert into production_events (id,organization_id,production_job_id,order_id,order_line_item_id,actor_user_id,type,payload) values ($1,$2,$3,$4,$5,$6,'v2_poc_outcome_recorded',$7::jsonb)`, [`v2poc-production-event-${randomUUID()}`, command.organizationId, row.production_job_id, command.orderId, command.lineItemId, actorId, JSON.stringify({ successfulQuantity: command.successfulQuantity, damagedQuantity: damaged, source: "v2_poc" })]);
  }
}

class PhysicalFulfillmentRepository {
  async pickupTicket(client: PoolClient, organizationId: string, orderId: string, actorId: string) {
    const existing = await client.query(`select id from pickup_tickets where organization_id=$1 and order_id=$2 for update`, [organizationId, orderId]);
    if (existing.rowCount) return existing.rows[0].id as string;
    const id = `v2poc-pickup-ticket-${randomUUID()}`;
    await client.query(`insert into pickup_tickets (id,organization_id,order_id,status,ready_at,created_by_user_id) values ($1,$2,$3,'READY_FOR_PICKUP',now(),$4)`, [id, organizationId, orderId, actorId]);
    return id;
  }
  async handoff(client: PoolClient, actorId: string, command: PickupHandoffCommand) {
    const ticketId = await this.pickupTicket(client, command.organizationId, command.orderId, actorId);
    const handoffId = `v2poc-pickup-handoff-${randomUUID()}`;
    await client.query(`insert into pickup_handoffs (id,organization_id,pickup_ticket_id,order_id,handed_off_by_user_id,notes) values ($1,$2,$3,$4,$5,$6)`, [handoffId, command.organizationId, ticketId, command.orderId, actorId, command.notes ?? null]);
    await client.query(`insert into pickup_handoff_items (id,organization_id,pickup_handoff_id,order_id,order_line_item_id,quantity) values ($1,$2,$3,$4,$5,$6)`, [`v2poc-pickup-handoff-item-${randomUUID()}`, command.organizationId, handoffId, command.orderId, command.lineItemId, command.quantity]);
    const eventId = `v2poc-fulfillment-event-${randomUUID()}`;
    await client.query(`insert into fulfillment_events (id,organization_id,actor_user_id,entity_type,entity_id,event_type,payload_json) values ($1,$2,$3,'PICKUP_TICKET',$4,'PICKUP_PICKED_UP',$5::jsonb)`, [eventId, command.organizationId, actorId, ticketId, JSON.stringify({ handoffId, orderId: command.orderId, lineItemId: command.lineItemId, quantity: command.quantity })]);
    return { handoffId, eventId };
  }
  async shipment(client: PoolClient, actorId: string, command: ShipmentCommand) {
    const shipmentId = `v2poc-shipment-${randomUUID()}`;
    await client.query(`insert into shipments (id,organization_id,order_id,primary_order_id,status,scope,shipment_reference,carrier,created_by_user_id,shipped_at) values ($1,$2,$3,$3,'SHIPPED','SINGLE_ORDER',$4,'V2 POC',$5,now())`, [shipmentId, command.organizationId, command.orderId, command.shipmentReference, actorId]);
    await client.query(`insert into shipment_items (id,organization_id,shipment_id,order_id,order_line_item_id,quantity) values ($1,$2,$3,$4,$5,$6)`, [`v2poc-shipment-item-${randomUUID()}`, command.organizationId, shipmentId, command.orderId, command.lineItemId, command.quantity]);
    const eventId = `v2poc-fulfillment-event-${randomUUID()}`;
    await client.query(`insert into fulfillment_events (id,organization_id,actor_user_id,entity_type,entity_id,event_type,payload_json) values ($1,$2,$3,'SHIPMENT',$4,'SHIPMENT_SHIPPED',$5::jsonb)`, [eventId, command.organizationId, actorId, shipmentId, JSON.stringify({ orderId: command.orderId, lineItemId: command.lineItemId, quantity: command.quantity })]);
    return { shipmentId, eventId };
  }
}

class BillingReconciliationRepository {
  async enqueueTerminal(client: PoolClient, organizationId: string, orderId: string, eventId: string, isOrderTerminal: boolean) {
    if (!isOrderTerminal) return null;
    const id = `v2poc-billing-reconciliation-${randomUUID()}`;
    await client.query(`insert into v2_poc_billing_reconciliations (id,organization_id,order_id,fulfillment_event_id) values ($1,$2,$3,$4) on conflict (organization_id,fulfillment_event_id) do nothing`, [id, organizationId, orderId, eventId]);
    return id;
  }
  async reconcile(client: PoolClient, organizationId: string, orderId: string, failurePoint?: FulfillmentFailurePoint) {
    const pending = await client.query(`select id,status from v2_poc_billing_reconciliations where organization_id=$1 and order_id=$2 and status='PENDING' order by created_at,id for update`, [organizationId, orderId]);
    if (!pending.rowCount) return { reconciled: 0, draftInvoiceId: null };
    const invoice = await client.query(`select id from invoices where organization_id=$1 and order_id=$2 and status='draft' order by created_at,id limit 2`, [organizationId, orderId]);
    if (invoice.rowCount !== 1) throw new V2PocError("VALIDATION", "Terminal fulfillment requires exactly one V2 draft invoice to reconcile.");
    fail(failurePoint, "during_billing_reconciliation");
    for (const row of pending.rows) await client.query(`update v2_poc_billing_reconciliations set status='COMPLETED',attempts=attempts+1,last_error=null,result_json=$1,completed_at=now() where id=$2`, [JSON.stringify({ action: "ensure_draft_invoice", invoiceId: invoice.rows[0].id }), row.id]);
    return { reconciled: pending.rowCount, draftInvoiceId: invoice.rows[0].id as string };
  }
  async pending(client: PoolClient, organizationId: string, orderId: string) { const result = await client.query(`select id,status,attempts,last_error from v2_poc_billing_reconciliations where organization_id=$1 and order_id=$2 order by created_at,id`, [organizationId, orderId]); return result.rows; }
}

export class PostgresProductionFulfillmentApplication {
  private readonly authorization = new AuthorizationRepository(); private readonly requests = new FulfillmentRequestRepository(); private readonly availability = new AvailabilityRepository(); private readonly production = new ProductionRepository(); private readonly fulfillment = new PhysicalFulfillmentRepository(); private readonly billing = new BillingReconciliationRepository();
  constructor(private readonly pool: Pool) {}
  async installExperimentalSchema() { await this.pool.query(ddl); }
  private async mutate<T extends { organizationId: string; requestId: string }>(actorId: string, operation: Operation, command: T, fn: (client: PoolClient) => Promise<unknown>, failurePoint?: FulfillmentFailurePoint): Promise<any> {
    const client = await this.pool.connect(); try { await client.query("begin"); await this.authorization.authorize(client, actorId, command.organizationId); const requestHash = hash(operation, command); const replay = await this.requests.claim(client, actorId, operation, command.organizationId, command.requestId, requestHash); if (replay) { await client.query("commit"); return { ...(replay as object), idempotentReplay: true }; } fail(failurePoint, "after_request_claim"); const result = await fn(client); fail(failurePoint, "after_physical_write"); await this.requests.complete(client, actorId, operation, command.organizationId, command.requestId, requestHash, result); fail(failurePoint, "before_commit"); await client.query("commit"); return { ...(result as object), idempotentReplay: false }; } catch (error) { try { await client.query("rollback"); } catch {} throw error; } finally { client.release(); } }
  async recordProductionOutcome(actorId: string, command: ProductionOutcomeCommand, failurePoint?: FulfillmentFailurePoint) { return this.mutate(actorId, "record_production_outcome.v2_poc", command, async (client) => { await this.availability.lockLine(client, command.organizationId, command.orderId, command.lineItemId); await this.production.recordOutcome(client, command, actorId); return { availability: await this.availability.read(client, command.organizationId, command.orderId, command.lineItemId) }; }, failurePoint); }
  async recordPickupHandoff(actorId: string, command: PickupHandoffCommand, failurePoint?: FulfillmentFailurePoint) { return this.mutate(actorId, "record_pickup_handoff.v2_poc", command, async (client) => { if (!Number.isInteger(command.quantity) || command.quantity <= 0) throw new V2PocError("VALIDATION", "Pickup quantity must be a positive integer."); await this.availability.lockOrderLines(client, command.organizationId, command.orderId, command.lineItemId); const before = await this.availability.read(client, command.organizationId, command.orderId, command.lineItemId); if (command.quantity > before.available) throw new V2PocError("VALIDATION", "Pickup quantity exceeds available produced inventory."); const physical = await this.fulfillment.handoff(client, actorId, command); const after = await this.availability.read(client, command.organizationId, command.orderId, command.lineItemId); const reconciliationId = await this.billing.enqueueTerminal(client, command.organizationId, command.orderId, physical.eventId, await this.availability.orderIsPhysicallyTerminal(client, command.organizationId, command.orderId)); return { ...physical, reconciliationId, availability: after }; }, failurePoint); }
  async finalizeShipment(actorId: string, command: ShipmentCommand, failurePoint?: FulfillmentFailurePoint) { return this.mutate(actorId, "finalize_shipment.v2_poc", command, async (client) => { if (!Number.isInteger(command.quantity) || command.quantity <= 0 || !command.shipmentReference.trim()) throw new V2PocError("VALIDATION", "Shipment quantity and reference are required."); await this.availability.lockOrderLines(client, command.organizationId, command.orderId, command.lineItemId); const before = await this.availability.read(client, command.organizationId, command.orderId, command.lineItemId); if (command.quantity > before.available) throw new V2PocError("VALIDATION", "Shipment quantity exceeds available produced inventory."); const physical = await this.fulfillment.shipment(client, actorId, command); const after = await this.availability.read(client, command.organizationId, command.orderId, command.lineItemId); const reconciliationId = await this.billing.enqueueTerminal(client, command.organizationId, command.orderId, physical.eventId, await this.availability.orderIsPhysicallyTerminal(client, command.organizationId, command.orderId)); return { ...physical, reconciliationId, availability: after }; }, failurePoint); }
  async getAvailability(actorId: string, organizationId: string, orderId: string, lineItemId: string) { const client = await this.pool.connect(); try { await this.authorization.authorize(client, actorId, organizationId); return await this.availability.read(client, organizationId, orderId, lineItemId); } finally { client.release(); } }
  async reconcileTerminalBilling(actorId: string, organizationId: string, orderId: string, failurePoint?: FulfillmentFailurePoint) { const client = await this.pool.connect(); try { await client.query("begin"); await this.authorization.authorize(client, actorId, organizationId); const result = await this.billing.reconcile(client, organizationId, orderId, failurePoint); await client.query("commit"); return result; } catch (error) { try { await client.query("rollback"); } catch {} throw error; } finally { client.release(); } }
  async pendingBilling(actorId: string, organizationId: string, orderId: string) { const client = await this.pool.connect(); try { await this.authorization.authorize(client, actorId, organizationId); return await this.billing.pending(client, organizationId, orderId); } finally { client.release(); } }
}
