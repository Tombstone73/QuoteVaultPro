import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { principalSubject, staffActorId, type Principal } from "../../src/authorization/principals.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import {
  displayFor,
  assertFutureNextNumber,
  nativeNumberingDefaults,
  nativeNumberingKinds,
  type NativeNumberingKind,
  type NumberingConfiguration,
  type NumberingSettings,
  type SaveNumberingSettings,
} from "../../src/modules/organization/documentNumbering.js";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";

type CounterRow = Readonly<{ document_kind: NativeNumberingKind; next_number: string; display_prefix: string; revision: string }>;
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const revisionFor = (rows: readonly CounterRow[]) => nativeNumberingKinds.map((kind) => `${kind}:${rows.find((row) => row.document_kind === kind)?.revision ?? "0"}`).join("|");

/**
 * Settings controls the shared V2 Quote / Order-Job allocation primitive.
 * Retained compatibility writers use that primitive too. Native V2 Invoices
 * derive their issued display number from the locked Order / Job; the legacy
 * internal vendor-purchase-order allocator remains separately managed.
 */
export class PostgresDocumentNumberingSettings {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly pool: Pool) {}

  async read(organizationId: string): Promise<NumberingSettings> {
    return this.snapshot(this.pool, organizationId);
  }

  async save(organizationId: string, input: SaveNumberingSettings, principal: Principal, businessRequestId: string): Promise<NumberingSettings> {
    if (!businessRequestId.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "businessRequestId is required.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const operation = "document_numbering.configure.v1";
      const reservation = await this.requests.reserve(client, {
        organizationId,
        operation,
        businessRequestId,
        payloadFingerprint: fingerprint({ input }),
        principalKind: principal.kind,
        principalSubject: principalSubject(principal),
        staffActorUserId: staffActorId(principal),
      });
      if (reservation.kind === "replay") {
        await client.query("COMMIT");
        return reservation.request.resultJson as NumberingSettings;
      }
      const rows = await this.ensureAndLock(client, organizationId);
      if (revisionFor(rows) !== input.expectedRevision) throw new V2ApplicationError("STALE_STATE", "Numbering settings changed elsewhere. Reload and try again.");
      for (const kind of nativeNumberingKinds) {
        const desired = input[kind];
        const current = rows.find((row) => row.document_kind === kind)!;
        const currentNext = BigInt(current.next_number);
        const maximum = await this.maximumAllocatedCore(client, organizationId, kind);
        assertFutureNextNumber(kind, desired.nextNumber, currentNext, maximum);
        const prospectiveDisplay = displayFor(desired.prefix, desired.nextNumber);
        const collision = await client.query("SELECT 1 FROM v2_sales_documents WHERE organization_id=$1 AND document_kind=$2 AND display_number=$3 LIMIT 1", [organizationId, kind, prospectiveDisplay]);
        if (collision.rows[0]) throw new V2ApplicationError("CONFLICT", `The next ${kind} display number is already in use.`);
        await client.query("UPDATE v2_sales_document_number_counters SET next_number=$3,display_prefix=$4,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND document_kind=$2", [organizationId, kind, desired.nextNumber.toString(), desired.prefix]);
      }
      const result = await this.snapshot(client, organizationId, true);
      await this.requests.recordAttribution(client, { organizationId, operation, operationRequestId: reservation.request.id, resourceType: "document_numbering", resourceId: organizationId, principalKind: principal.kind, principalSubject: principalSubject(principal), staffActorUserId: staffActorId(principal) });
      await client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,'document_numbering_configured','document_numbering',$4,$5,$6,$7,$8::jsonb)", [organizationId, reservation.request.id, operation, organizationId, principal.kind, principalSubject(principal), staffActorId(principal) ?? null, JSON.stringify([{ kind: operation, futureOnly: true }])]);
      await this.requests.succeed(client, organizationId, reservation.request.id, { resourceType: "document_numbering", resourceId: organizationId, resultJson: result });
      await client.query("COMMIT");
      return result;
    } catch (cause) {
      await client.query("ROLLBACK");
      throw cause;
    } finally {
      client.release();
    }
  }

  private async maximumAllocatedCore(client: PoolClient, organizationId: string, kind: NativeNumberingKind): Promise<bigint> {
    const result = await client.query<{ maximum: string }>(
      kind === "quote"
        ? `SELECT GREATEST(
             COALESCE((SELECT MAX(business_number) FROM v2_sales_documents WHERE organization_id=$1 AND document_kind='quote'),0),
             COALESCE((SELECT MAX(COALESCE(number_core,quote_number)) FROM quotes WHERE organization_id=$1),0)
           )::text maximum`
        : `SELECT GREATEST(
             COALESCE((SELECT MAX(business_number) FROM v2_sales_documents WHERE organization_id=$1 AND document_kind='order'),0),
             COALESCE((SELECT MAX(COALESCE(number_core,CASE WHEN order_number ~ '^[0-9]+$' THEN order_number::bigint END)) FROM orders WHERE organization_id=$1),0)
           )::text maximum`,
      [organizationId],
    );
    return BigInt(result.rows[0]?.maximum ?? "0");
  }

  private async ensureAndLock(client: PoolClient, organizationId: string): Promise<CounterRow[]> {
    for (const kind of nativeNumberingKinds) {
      const defaults = nativeNumberingDefaults[kind];
      await client.query("INSERT INTO v2_sales_document_number_counters(organization_id,document_kind,next_number,display_prefix,revision) VALUES($1,$2,$3,$4,1) ON CONFLICT(organization_id,document_kind) DO NOTHING", [organizationId, kind, defaults.nextNumber.toString(), defaults.prefix]);
    }
    const result = await client.query<CounterRow>("SELECT document_kind,next_number::text,display_prefix,revision::text FROM v2_sales_document_number_counters WHERE organization_id=$1 AND document_kind IN ('quote','order') ORDER BY document_kind FOR UPDATE", [organizationId]);
    if (result.rows.length !== nativeNumberingKinds.length) throw new V2ApplicationError("CONFLICT", "Numbering counters could not be initialized.");
    return result.rows;
  }

  private async snapshot(client: Pool | PoolClient, organizationId: string, locked = false): Promise<NumberingSettings> {
    const result = await client.query<CounterRow>(`SELECT document_kind,next_number::text,display_prefix,revision::text FROM v2_sales_document_number_counters WHERE organization_id=$1 AND document_kind IN ('quote','order') ORDER BY document_kind${locked ? " FOR UPDATE" : ""}`, [organizationId]);
    const documents: NumberingConfiguration[] = nativeNumberingKinds.map((kind) => {
      const row = result.rows.find((item) => item.document_kind === kind);
      const defaults = nativeNumberingDefaults[kind];
      const nextNumber = row ? BigInt(row.next_number) : defaults.nextNumber;
      const prefix = row?.display_prefix ?? defaults.prefix;
      return { kind, prefix, nextNumber: nextNumber.toString(), nextDisplayNumber: displayFor(prefix, nextNumber), status: "ready", adoption: row ? "native_v2" : "lazy_native_default" };
    });
    return {
      revision: revisionFor(result.rows),
      documents,
      sharedJobNumber: { owner: "order_number", behavior: "order_display_number", configurableSeparately: false },
      compatibility: { legacyQuoteOrder: "converged", legacyInvoice: "native_job_derived", legacyPurchaseOrder: "compatibility_managed", importedHistoricalDocuments: "preserved" },
      readiness: { status: "migration_required", reasons: ["Internal vendor Purchase Order allocation remains compatibility-managed. Native V2 Invoice numbers derive from the canonical Order / Job at issuance; historical imported identifiers are preserved and are never renumbered."] },
    };
  }
}
