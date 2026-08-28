import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { principalSubject, staffActorId, type Principal } from "../../src/authorization/principals.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { DestinationTaxMethod, HomeBusinessTaxSettings, SalesTaxJurisdiction, SalesTaxSettingsSaveTrace, SaveDestinationTaxJurisdiction, SaveHomeBusinessTaxSettings, TaxModeReadiness } from "../../src/modules/sales/taxSettings.js";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";

type JurisdictionRow = Readonly<{ id: string; name: string; country_code: string; region_code: string; postal_code: string | null; rate_basis_points: number; active: boolean; home_business: boolean; destination_methods: DestinationTaxMethod[]; updated_at: Date }>;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scope = (row: Pick<JurisdictionRow, "country_code" | "region_code" | "postal_code">) => [row.country_code.trim().toUpperCase(), row.region_code.trim().toUpperCase(), row.postal_code?.trim().toUpperCase() ?? ""].join("|");
const overlaps = (left: readonly DestinationTaxMethod[], right: readonly DestinationTaxMethod[]) => left.some((method) => right.includes(method));
const project = (row: JurisdictionRow): SalesTaxJurisdiction => ({ jurisdictionId: row.id, name: row.name, countryCode: row.country_code, regionCode: row.region_code, ...(row.postal_code ? { postalCode: row.postal_code } : {}), rateBasisPoints: row.rate_basis_points, active: row.active, homeBusiness: row.home_business, ...(!row.home_business ? { destinationMethods: row.destination_methods } : {}), updatedAt: row.updated_at.toISOString() });
const revision = (rows: readonly JurisdictionRow[]) => digest(rows.map((row) => [row.id, row.updated_at.toISOString(), row.active, row.name, row.country_code, row.region_code, row.postal_code, row.rate_basis_points, row.home_business, row.destination_methods]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
const destinationReadiness = (rows: readonly JurisdictionRow[], method: DestinationTaxMethod): TaxModeReadiness => {
  const candidates = rows.filter((row) => !row.home_business && row.active && row.destination_methods.includes(method));
  const seen = new Set<string>();
  if (candidates.some((row) => { const key = scope(row); if (seen.has(key)) return true; seen.add(key); return false; })) return { status: "conflict", reason: `More than one active destination jurisdiction applies to ${method === "shipping" ? "Shipping" : "Local Delivery"} at the same geographic scope.` };
  const candidate = candidates[0];
  return candidate ? { status: "ready", jurisdictionName: candidate.name, rateBasisPoints: candidate.rate_basis_points } : { status: "not_configured", reason: `No active destination jurisdiction applies to ${method === "shipping" ? "Shipping" : "Local Delivery"}.` };
};
const snapshot = (rows: readonly JurisdictionRow[]): HomeBusinessTaxSettings => {
  const home = rows.find((row) => row.home_business);
  const pickup: TaxModeReadiness = home?.active ? { status: "ready", jurisdictionName: home.name, rateBasisPoints: home.rate_basis_points } : { status: "not_configured", reason: "No active Home / Business jurisdiction is configured for Pickup." };
  const shipping = destinationReadiness(rows, "shipping");
  const localDelivery = destinationReadiness(rows, "local_delivery");
  return { ...(home ? { homeBusiness: project(home) } : {}), destinationJurisdictions: rows.filter((row) => !row.home_business).map(project), readiness: { status: pickup.status === "ready" && shipping.status === "ready" && localDelivery.status === "ready" ? "ready" : "needs_attention", pickup, shipping, localDelivery }, revision: revision(rows) };
};

/** One tenant-owned jurisdiction table serves Pickup and destination rules. */
export class PostgresSalesTaxSettings {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly pool: Pool) {}
  async read(organizationId: string): Promise<HomeBusinessTaxSettings> { return snapshot(await this.rows(this.pool, organizationId)); }
  async listDestinationJurisdictions(organizationId: string): Promise<readonly SalesTaxJurisdiction[]> { return (await this.rows(this.pool, organizationId)).filter((row) => !row.home_business).map(project); }

  async save(organizationId: string, input: SaveHomeBusinessTaxSettings, principal: Principal, requestId: string, trace?: SalesTaxSettingsSaveTrace): Promise<HomeBusinessTaxSettings> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN"); trace?.("repository_transaction_started");
      const operation = "sales.tax.home_business.configure.v1";
      const reservation = await this.requests.reserve(client, { organizationId, operation, businessRequestId: requestId, payloadFingerprint: digest(input), principalKind: principal.kind, principalSubject: principalSubject(principal), staffActorUserId: staffActorId(principal) });
      if (reservation.kind === "replay") { await client.query("COMMIT"); trace?.("durable_request_replayed", { resourceId: reservation.request.resultResourceId ?? undefined }); trace?.("transaction_committed"); return reservation.request.resultJson as HomeBusinessTaxSettings; }
      trace?.("durable_request_started");
      const before = await this.rows(client, organizationId, true); const previous = before.find((row) => row.home_business);
      const saved = await client.query<JurisdictionRow>(`INSERT INTO v2_sales_tax_jurisdictions (organization_id,name,country_code,region_code,postal_code,rate_basis_points,active,home_business,destination_methods) VALUES($1,$2,$3,$4,$5,$6,$7,true,ARRAY['shipping','local_delivery']::varchar[]) ON CONFLICT (organization_id) WHERE home_business DO UPDATE SET name=EXCLUDED.name,country_code=EXCLUDED.country_code,region_code=EXCLUDED.region_code,postal_code=EXCLUDED.postal_code,rate_basis_points=EXCLUDED.rate_basis_points,active=EXCLUDED.active,updated_at=now() RETURNING id,name,country_code,region_code,postal_code,rate_basis_points,active,home_business,destination_methods,updated_at`, [organizationId, input.name, input.countryCode, input.regionCode, input.postalCode ?? null, input.rateBasisPoints, input.active]);
      const value = project(saved.rows[0]!); trace?.("jurisdiction_upserted", { resourceId: value.jurisdictionId });
      const result = snapshot(await this.rows(client, organizationId, true));
      await this.audit(client, organizationId, reservation.request.id, operation, previous ? "sales_tax_jurisdiction_updated" : "sales_tax_jurisdiction_created", value.jurisdictionId, principal, [{ kind: "home_business_tax_configuration", before: previous ? project(previous) : null, after: value }]);
      trace?.("audit_written", { resourceId: value.jurisdictionId });
      await this.requests.succeed(client, organizationId, reservation.request.id, { resourceType: "sales_tax_jurisdiction", resourceId: value.jurisdictionId, resultJson: result }); trace?.("durable_request_completed", { resourceId: value.jurisdictionId }); await client.query("COMMIT"); trace?.("transaction_committed", { resourceId: value.jurisdictionId }); return result;
    } catch (cause) { await client.query("ROLLBACK"); const errorCode = cause instanceof V2ApplicationError ? cause.code : "INTERNAL_ERROR"; trace?.("repository_failed", { errorCode }); trace?.("transaction_rolled_back", { errorCode }); throw cause; } finally { client.release(); }
  }

  async createDestinationJurisdiction(organizationId: string, input: SaveDestinationTaxJurisdiction, principal: Principal, requestId: string): Promise<HomeBusinessTaxSettings> { return this.mutateDestination("create", organizationId, undefined, input, principal, requestId); }
  async updateDestinationJurisdiction(organizationId: string, jurisdictionId: string, input: SaveDestinationTaxJurisdiction, principal: Principal, requestId: string): Promise<HomeBusinessTaxSettings> { return this.mutateDestination("update", organizationId, jurisdictionId, input, principal, requestId); }
  private async mutateDestination(kind: "create" | "update", organizationId: string, jurisdictionId: string | undefined, input: SaveDestinationTaxJurisdiction, principal: Principal, requestId: string): Promise<HomeBusinessTaxSettings> {
    const client = await this.pool.connect(); const operation = `sales.tax.destination.${kind}.v1`;
    try {
      await client.query("BEGIN");
      const reservation = await this.requests.reserve(client, { organizationId, operation, businessRequestId: requestId, payloadFingerprint: digest({ jurisdictionId, input }), principalKind: principal.kind, principalSubject: principalSubject(principal), staffActorUserId: staffActorId(principal) });
      if (reservation.kind === "replay") { await client.query("COMMIT"); return reservation.request.resultJson as HomeBusinessTaxSettings; }
      const before = await this.rows(client, organizationId, true);
      if (revision(before) !== input.expectedRevision) throw new V2ApplicationError("STALE_STATE", "Sales Tax settings changed elsewhere. Reload and try again.");
      const prior = jurisdictionId ? before.find((row) => row.id === jurisdictionId && !row.home_business) : undefined;
      if (kind === "update" && !prior) throw new V2ApplicationError("NOT_FOUND", "Destination tax jurisdiction was not found.");
      const inputScope = scope({ country_code: input.countryCode, region_code: input.regionCode, postal_code: input.postalCode ?? null });
      if (before.some((row) => !row.home_business && row.id !== jurisdictionId && scope(row) === inputScope && overlaps(row.destination_methods, input.destinationMethods))) throw new V2ApplicationError("CONFLICT", "A destination jurisdiction already applies to that geographic scope.");
      let saved: JurisdictionRow;
      try {
        const result = kind === "create"
          ? await client.query<JurisdictionRow>(`INSERT INTO v2_sales_tax_jurisdictions (organization_id,name,country_code,region_code,postal_code,rate_basis_points,active,home_business,destination_methods) VALUES($1,$2,$3,$4,$5,$6,$7,false,$8::varchar[]) RETURNING id,name,country_code,region_code,postal_code,rate_basis_points,active,home_business,destination_methods,updated_at`, [organizationId, input.name, input.countryCode, input.regionCode, input.postalCode ?? null, input.rateBasisPoints, input.active, input.destinationMethods])
          : await client.query<JurisdictionRow>(`UPDATE v2_sales_tax_jurisdictions SET name=$3,country_code=$4,region_code=$5,postal_code=$6,rate_basis_points=$7,active=$8,destination_methods=$9::varchar[],updated_at=now() WHERE organization_id=$1 AND id=$2 AND home_business=false RETURNING id,name,country_code,region_code,postal_code,rate_basis_points,active,home_business,destination_methods,updated_at`, [organizationId, jurisdictionId!, input.name, input.countryCode, input.regionCode, input.postalCode ?? null, input.rateBasisPoints, input.active, input.destinationMethods]);
        saved = result.rows[0]!;
      } catch (cause: unknown) { if ((cause as { code?: string }).code === "23505") throw new V2ApplicationError("CONFLICT", "A destination jurisdiction already exists for that geographic scope."); throw cause; }
      const value = project(saved); const result = snapshot(await this.rows(client, organizationId, true));
      await this.audit(client, organizationId, reservation.request.id, operation, kind === "create" ? "destination_tax_jurisdiction_created" : "destination_tax_jurisdiction_updated", value.jurisdictionId, principal, [{ kind: "destination_tax_jurisdiction", before: prior ? project(prior) : null, after: value, futureOnly: true }]);
      await this.requests.succeed(client, organizationId, reservation.request.id, { resourceType: "sales_tax_jurisdiction", resourceId: value.jurisdictionId, resultJson: result }); await client.query("COMMIT"); return result;
    } catch (cause) { await client.query("ROLLBACK"); throw cause; } finally { client.release(); }
  }
  private async rows(client: Pool | PoolClient, organizationId: string, lock = false): Promise<JurisdictionRow[]> { const result = await client.query<JurisdictionRow>(`SELECT id,name,country_code,region_code,postal_code,rate_basis_points,active,home_business,destination_methods,updated_at FROM v2_sales_tax_jurisdictions WHERE organization_id=$1 ORDER BY home_business DESC,country_code,region_code,postal_code NULLS FIRST,id${lock ? " FOR UPDATE" : ""}`, [organizationId]); return result.rows; }
  private async audit(client: PoolClient, organizationId: string, requestId: string, operation: string, eventType: string, resourceId: string, principal: Principal, changes: unknown) { await this.requests.recordAttribution(client, { organizationId, operationRequestId: requestId, operation, resourceType: "sales_tax_jurisdiction", resourceId, principalKind: principal.kind, principalSubject: principalSubject(principal), staffActorUserId: staffActorId(principal) }); await client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,$4,'sales_tax_jurisdiction',$5,$6,$7,$8,$9::jsonb)", [organizationId, requestId, operation, eventType, resourceId, principal.kind, principalSubject(principal), staffActorId(principal) ?? null, JSON.stringify(changes)]); }
}
