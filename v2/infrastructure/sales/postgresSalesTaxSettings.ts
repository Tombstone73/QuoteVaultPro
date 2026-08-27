import type { Pool, PoolClient } from "pg";
import { createHash } from "node:crypto";
import { principalSubject, staffActorId, type Principal } from "../../src/authorization/principals.js";
import type { HomeBusinessTaxSettings, SalesTaxJurisdiction, SalesTaxSettingsSaveTrace, SaveHomeBusinessTaxSettings } from "../../src/modules/sales/taxSettings.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";

type Row = Readonly<{ id:string; name:string; country_code:string; region_code:string; postal_code:string|null; rate_basis_points:number; active:boolean; home_business:boolean; updated_at:Date }>;
const project = (row: Row): SalesTaxJurisdiction => ({ jurisdictionId:row.id, name:row.name, countryCode:row.country_code, regionCode:row.region_code, ...(row.postal_code?{postalCode:row.postal_code}:{}), rateBasisPoints:row.rate_basis_points, active:row.active, homeBusiness:row.home_business, updatedAt:row.updated_at.toISOString() });

/** Tenant-owned settings adapter. The published partial unique index is the
 * final ambiguity guard for the Pickup authority. */
export class PostgresSalesTaxSettings {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly pool: Pool) {}
  async read(organizationId: string): Promise<HomeBusinessTaxSettings> {
    const result = await this.pool.query<Row>("SELECT id,name,country_code,region_code,postal_code,rate_basis_points,active,home_business,updated_at FROM v2_sales_tax_jurisdictions WHERE organization_id=$1 AND home_business=true", [organizationId]);
    return result.rows[0] ? { homeBusiness: project(result.rows[0]) } : {};
  }
  async save(organizationId: string, input: SaveHomeBusinessTaxSettings, principal: Principal, requestId: string, trace?: SalesTaxSettingsSaveTrace): Promise<HomeBusinessTaxSettings> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      trace?.("repository_transaction_started");
      const operation = "sales.tax.home_business.configure.v1";
      const reservation = await this.requests.reserve(client, { organizationId, operation, businessRequestId:requestId, payloadFingerprint:createHash("sha256").update(JSON.stringify(input)).digest("hex"), principalKind:principal.kind, principalSubject:principalSubject(principal), staffActorUserId:staffActorId(principal) });
      if (reservation.kind === "replay") { await client.query("COMMIT"); trace?.("durable_request_replayed", { resourceId: reservation.request.resultResourceId ?? undefined }); trace?.("transaction_committed"); return reservation.request.resultJson as HomeBusinessTaxSettings; }
      trace?.("durable_request_started");
      const before = await client.query<Row>("SELECT id,name,country_code,region_code,postal_code,rate_basis_points,active,home_business,updated_at FROM v2_sales_tax_jurisdictions WHERE organization_id=$1 AND home_business=true FOR UPDATE", [organizationId]);
      const prior = before.rows[0];
      const saved = await client.query<Row>(
        `INSERT INTO v2_sales_tax_jurisdictions(organization_id,name,country_code,region_code,postal_code,rate_basis_points,active,home_business)
         VALUES($1,$2,$3,$4,$5,$6,$7,true)
         ON CONFLICT (organization_id) WHERE home_business DO UPDATE SET name=EXCLUDED.name,country_code=EXCLUDED.country_code,region_code=EXCLUDED.region_code,postal_code=EXCLUDED.postal_code,rate_basis_points=EXCLUDED.rate_basis_points,active=EXCLUDED.active,updated_at=now()
         RETURNING id,name,country_code,region_code,postal_code,rate_basis_points,active,home_business,updated_at`,
        [organizationId,input.name,input.countryCode,input.regionCode,input.postalCode ?? null,input.rateBasisPoints,input.active],
      );
      const value = project(saved.rows[0]!);
      trace?.("jurisdiction_upserted", { resourceId:value.jurisdictionId });
      await this.requests.recordAttribution(client,{organizationId,operationRequestId:reservation.request.id,operation,resourceType:"sales_tax_jurisdiction",resourceId:value.jurisdictionId,principalKind:principal.kind,principalSubject:principalSubject(principal),staffActorUserId:staffActorId(principal)});
      await client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,$4,'sales_tax_jurisdiction',$5,$6,$7,$8,$9::jsonb)", [organizationId,reservation.request.id,operation,prior?"sales_tax_jurisdiction_updated":"sales_tax_jurisdiction_created",value.jurisdictionId,principal.kind,principalSubject(principal),staffActorId(principal) ?? null,JSON.stringify([{kind:"home_business_tax_configuration",before:prior?project(prior):null,after:value}])]);
      trace?.("audit_written", { resourceId:value.jurisdictionId });
      const result={homeBusiness:value};
      await this.requests.succeed(client,organizationId,reservation.request.id,{resourceType:"sales_tax_jurisdiction",resourceId:value.jurisdictionId,resultJson:result});
      trace?.("durable_request_completed", { resourceId:value.jurisdictionId });
      await client.query("COMMIT");
      trace?.("transaction_committed", { resourceId:value.jurisdictionId });
      return result;
    } catch (error) { await client.query("ROLLBACK"); const errorCode=error instanceof V2ApplicationError?error.code:"INTERNAL_ERROR"; trace?.("repository_failed", { errorCode }); trace?.("transaction_rolled_back", { errorCode }); throw error; } finally { client.release(); }
  }
}
