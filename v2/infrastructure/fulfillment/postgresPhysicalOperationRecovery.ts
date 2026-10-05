import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { requireOperationPrincipalScope, type OperationContext } from "../../src/application/operation.js";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../src/authorization/principals.js";
import { failure, success, V2ApplicationError, type ApplicationResult } from "../../src/errors/applicationError.js";
import { canonicalJson } from "../../src/modules/shared/commercialValues.js";
import { physicalOperations, type PhysicalIntent, type PhysicalOperation, type PhysicalOperationRecoveryPort, type PhysicalRecoveryResult } from "../../src/modules/fulfillment/physicalOperationRecovery.js";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";

const admissionOperation = (operation:PhysicalOperation) => `fulfillment.physical-intent.admit.v1:${operation}`;
const withdrawalOperation = (operation:PhysicalOperation) => `fulfillment.physical-intent.withdraw.v1:${operation}`;
const hash = (value: unknown) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
type Scope = Readonly<{ orderId: string; replacementObligationId?: string }>;
type Admission = PhysicalIntent & Readonly<{ scopes: readonly Scope[] }>;
type Row = { business_request_id: string; initiated_principal_kind: string; initiated_principal_subject: string; result_json: Admission; admission_fingerprint?:string; outcome_fingerprint?:string|null; outcome_status: string | null; outcome_result: unknown; recorded_at?:Date|string; withdrawal_result?:unknown };
const actor = (c: OperationContext) => ({ principalKind: c.principal.kind, principalSubject: principalSubject(c.principal), staffActorUserId: staffActorId(c.principal) });
const pending = (row: Row) => row.outcome_status !== "succeeded" && row.outcome_status !== "permanent_failure";
const sameActor = (row: Row, c: OperationContext) => row.initiated_principal_kind === c.principal.kind && row.initiated_principal_subject === principalSubject(c.principal);
const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new V2ApplicationError("VALIDATION_ERROR", "A physical intent object is required."); return value as Record<string, unknown>; };

async function lock(client: PoolClient, organizationId: string) {
  // Admission and execution share this short transaction lock. A failed-intent
  // resolution cannot race a still-committing handoff or a late exact retry.
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext('fulfillment.physical-intent'))", [organizationId]);
}
async function admissions(client: PoolClient, organizationId: string): Promise<readonly Row[]> {
  const result = await client.query<Row>(`SELECT a.business_request_id,a.initiated_principal_kind,a.initiated_principal_subject,a.result_json,a.payload_fingerprint admission_fingerprint,
      outcome.status outcome_status,outcome.payload_fingerprint outcome_fingerprint,outcome.result_json outcome_result,COALESCE(outcome.completed_at,a.created_at) recorded_at,withdrawal.result_json withdrawal_result
    FROM v2_operation_requests a LEFT JOIN v2_operation_requests outcome ON outcome.organization_id=a.organization_id
      AND outcome.operation=a.result_json->>'operation' AND outcome.business_request_id=a.business_request_id
    LEFT JOIN v2_operation_requests withdrawal ON withdrawal.organization_id=a.organization_id AND withdrawal.business_request_id=a.business_request_id
      AND withdrawal.operation=('fulfillment.physical-intent.withdraw.v1:'||(a.result_json->>'operation')) AND withdrawal.status='succeeded'
    WHERE a.organization_id=$1 AND a.operation=ANY($2::text[]) AND a.status='succeeded' ORDER BY a.created_at DESC,a.id DESC`, [organizationId, physicalOperations.map(admissionOperation)]);
  return result.rows;
}
async function legacyReceipts(client:PoolClient,organizationId:string,identity?:Readonly<{operation:PhysicalOperation;businessRequestId:string}>):Promise<readonly Row[]>{
  const result=await client.query<{business_request_id:string;operation:PhysicalOperation;payload_fingerprint:string;initiated_principal_kind:string;initiated_principal_subject:string;result_json:any;recorded_at:Date|string}>(`SELECT outcome.business_request_id,outcome.operation,outcome.payload_fingerprint,outcome.initiated_principal_kind,outcome.initiated_principal_subject,outcome.result_json,outcome.completed_at recorded_at
    FROM v2_operation_requests outcome WHERE outcome.organization_id=$1 AND outcome.operation=ANY($2::text[]) AND outcome.status='succeeded'
      AND NOT EXISTS(SELECT 1 FROM v2_operation_requests a WHERE a.organization_id=outcome.organization_id AND a.operation=($3::text||outcome.operation) AND a.business_request_id=outcome.business_request_id)
      AND ($4::text IS NULL OR outcome.operation=$4) AND ($5::text IS NULL OR outcome.business_request_id=$5)
    ORDER BY outcome.completed_at DESC,outcome.id DESC LIMIT 50`,[organizationId,[...physicalOperations],"fulfillment.physical-intent.admit.v1:",identity?.operation??null,identity?.businessRequestId??null]);
  const rows:Row[]=[];
  for(const request of result.rows){
    const saved=request.result_json;let scopes:Scope[]=[];
    if(request.operation==="fulfillment.pickup.complete.v1"||request.operation==="fulfillment.shipment.complete.v1"){
      const handoff=saved?.handoff;
      if(!handoff||handoff.organizationId!==organizationId||!Array.isArray(saved.allocations)||saved.allocations.some((item:any)=>item.organizationId!==organizationId||item.handoffId!==handoff.handoffId||item.orderId!==handoff.orderId))throw new V2ApplicationError("CONFLICT","Historical handoff receipt scope is inconsistent.");
      const evidence=await client.query<{order_document_id:string;replacement_obligation_id:string|null}>("SELECT order_document_id,replacement_obligation_id FROM v2_fulfillment_handoffs WHERE organization_id=$1 AND id=$2 AND order_document_id=$3",[organizationId,handoff.handoffId,handoff.orderId]);
      if(evidence.rows.length!==1||evidence.rows[0].replacement_obligation_id!==(handoff.replacementObligationId??null))throw new V2ApplicationError("CONFLICT","Historical handoff receipt identity is unavailable.");
      scopes=[{orderId:handoff.orderId,...(handoff.replacementObligationId?{replacementObligationId:handoff.replacementObligationId}:{})}];
    }else{
      const revision=saved?.currentPreparedRevision;
      if(saved?.organizationId!==organizationId||!saved.shipmentId||!revision||revision.organizationId!==organizationId||revision.shipmentId!==saved.shipmentId||revision.revisionId!==saved.preparedRevisionId||!Array.isArray(revision.allocations))throw new V2ApplicationError("CONFLICT","Historical shipment receipt scope is inconsistent.");
      const persisted=await client.query<{id:string;supersedes_revision_id:string|null}>("SELECT id,supersedes_revision_id FROM v2_fulfillment_shipment_prepared_revisions WHERE organization_id=$1 AND shipment_id=$2 AND id=$3",[organizationId,saved.shipmentId,revision.revisionId]);
      if(persisted.rows.length!==1||persisted.rows[0].supersedes_revision_id!==(revision.supersedesRevisionId??null))throw new V2ApplicationError("CONFLICT","Historical shipment receipt revision is unavailable.");
      const revisionIds=[revision.revisionId,...(request.operation==="fulfillment.shipment-container.correct.v1"&&revision.supersedesRevisionId?[revision.supersedesRevisionId]:[])];
      const evidence=await client.query<{revision_id:string;order_document_id:string;order_line_id:string;quantity:number;replacement_obligation_id:string|null}>("SELECT revision_id,order_document_id,order_line_id,quantity,replacement_obligation_id FROM v2_fulfillment_shipment_prepared_revision_lines WHERE organization_id=$1 AND shipment_id=$2 AND revision_id=ANY($3::text[]) ORDER BY revision_id,order_document_id,order_line_id,replacement_obligation_id",[organizationId,saved.shipmentId,revisionIds]);
      const exact=evidence.rows.filter(item=>item.revision_id===revision.revisionId).map(item=>({orderId:item.order_document_id,orderLineId:item.order_line_id,quantity:item.quantity,...(item.replacement_obligation_id?{replacementObligationId:item.replacement_obligation_id}:{})}));
      if(hash([...exact].sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b))))!==hash([...revision.allocations].sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)))))throw new V2ApplicationError("CONFLICT","Historical shipment receipt allocations are inconsistent.");
      scopes=evidence.rows.map(item=>({orderId:item.order_document_id,...(item.replacement_obligation_id?{replacementObligationId:item.replacement_obligation_id}:{})}));
    }
    if(scopes.length)rows.push({business_request_id:request.business_request_id,initiated_principal_kind:request.initiated_principal_kind,initiated_principal_subject:request.initiated_principal_subject,result_json:{businessRequestId:request.business_request_id,operation:request.operation,input:{},scopes},outcome_status:"succeeded",outcome_fingerprint:request.payload_fingerprint,outcome_result:saved,recorded_at:request.recorded_at});
  }
  return rows;
}
async function scopesFor(client: PoolClient, org: string, operation: PhysicalOperation, input: Record<string, unknown>): Promise<readonly Scope[]> {
  const allocations: Scope[] = [];
  if (operation === "fulfillment.pickup.complete.v1" || operation === "fulfillment.shipment.complete.v1") {
    if (typeof input.orderId !== "string" || !Array.isArray(input.allocations) || !input.allocations.length) throw new V2ApplicationError("VALIDATION_ERROR", "Pickup/Shipment intent requires an Order and allocations.");
    allocations.push({ orderId: input.orderId, ...(typeof input.replacementObligationId === "string" ? { replacementObligationId: input.replacementObligationId } : {}) });
  } else {
    if (Array.isArray(input.allocations)) for (const value of input.allocations) {
      const item = record(value);
      if (typeof item.orderId !== "string" || typeof item.orderLineId !== "string" || !Number.isSafeInteger(item.quantity) || Number(item.quantity) <= 0) throw new V2ApplicationError("VALIDATION_ERROR", "Prepared allocations require exact Order/line and positive quantity.");
      const line = await client.query("SELECT id FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2 AND id=$3", [org, item.orderId, item.orderLineId]);
      if (!line.rows.length) throw new V2ApplicationError("NOT_FOUND", "Physical intent Order line was not found.");
      allocations.push({ orderId: item.orderId, ...(typeof item.replacementObligationId === "string" ? { replacementObligationId: item.replacementObligationId } : {}) });
    }
    if (operation !== "fulfillment.shipment-container.prepare.v1") {
      if (typeof input.shipmentId !== "string") throw new V2ApplicationError("VALIDATION_ERROR", "Shipment identity is required.");
      const saved = await client.query<{ order_document_id: string; replacement_obligation_id: string | null }>(`SELECT line.order_document_id,line.replacement_obligation_id FROM v2_fulfillment_shipments s
        JOIN v2_fulfillment_shipment_prepared_revision_lines line ON line.organization_id=s.organization_id AND line.shipment_id=s.id AND line.revision_id=s.prepared_revision_id
        WHERE s.organization_id=$1 AND s.id=$2`, [org, input.shipmentId]);
      allocations.push(...saved.rows.map(row => ({ orderId: row.order_document_id, ...(row.replacement_obligation_id ? { replacementObligationId: row.replacement_obligation_id } : {}) })));
    }
  }
  if (!allocations.length) throw new V2ApplicationError("NOT_FOUND", "Physical intent scope was not found.");
  return [...new Map(allocations.map(item => [canonicalJson([item.orderId,item.replacementObligationId??null]), item])).values()];
}
async function authorize(client: PoolClient, c: OperationContext, operation: PhysicalOperation, scopes: readonly Scope[], read = false) {
  requireOperationPrincipalScope(c);
  if (c.principal.kind !== "staff") throw new V2ApplicationError("FORBIDDEN", "Physical operation recovery is staff-only.");
  const authority = new AuthorityPolicy();
  for (const scope of scopes) {
    const result = await client.query<{ customer_id: string | null }>("SELECT customer_id FROM v2_sales_documents WHERE organization_id=$1 AND id=$2 AND document_kind='order'", [c.organizationId, scope.orderId]);
    if (!result.rows[0]) throw new V2ApplicationError("NOT_FOUND", "Physical operation scope was not found.");
    const resource = { organizationId: c.organizationId, customerId: result.rows[0].customer_id ?? undefined };
    const capability = operation === "fulfillment.pickup.complete.v1" ? "fulfillment.pickup" : "fulfillment.ship";
    if (!authority.decide(c.principal, { capability: read ? "fulfillment.view" : capability, resource }).allowed || scope.replacementObligationId && !authority.decide(c.principal, { capability: "fulfillment.replace", resource }).allowed) throw new V2ApplicationError("FORBIDDEN", "Physical operation recovery authority is unavailable.");
    if (scope.replacementObligationId) {
      const replacement = await client.query("SELECT id FROM v2_order_replacement_obligations WHERE organization_id=$1 AND id=$2 AND order_document_id=$3", [c.organizationId, scope.replacementObligationId, scope.orderId]);
      if (!replacement.rows.length) throw new V2ApplicationError("NOT_FOUND", "Replacement recovery scope was not found.");
    }
  }
}
const projection = (row: Row, c: OperationContext): PhysicalRecoveryResult => {
  let fingerprint=row.outcome_fingerprint;
  if(!row.outcome_status&&row.admission_fingerprint){
    const intent={businessRequestId:row.business_request_id,operation:row.result_json.operation,input:row.result_json.input};
    if(row.result_json.businessRequestId===row.business_request_id&&row.admission_fingerprint===hash(intent))fingerprint=hash(intent.input);
  }
  const verified=typeof fingerprint==="string"&&/^sha256:[0-9a-f]{64}$/.test(fingerprint);
  return {organizationId:c.organizationId,businessRequestId:row.business_request_id,operation:row.result_json.operation,status:pending(row)?"pending":row.outcome_status==="succeeded"?"succeeded":row.withdrawal_result?"withdrawn":"failed",anotherActor:!sameActor(row,c),...(verified?{submittedPayloadFingerprint:fingerprint!}:{}),...(pending(row)&&sameActor(row,c)?{input:row.result_json.input}:{}),...(row.outcome_status==="succeeded"?{result:row.outcome_result}:{})};
};

/** Called inside the SAME owner transaction as the physical result/receipt. */
export async function claimPhysicalIntent(client: PoolClient, c: OperationContext, operation: PhysicalOperation, input: unknown) {
  await lock(client, c.organizationId);
  const rows = await admissions(client, c.organizationId), own = rows.find(row => row.business_request_id === c.businessRequest?.id&&row.result_json.operation===operation);
  if (!rows.length) return;
  if (own) {
    if (own.result_json.operation !== operation || hash(own.result_json.input) !== hash(input)) throw new V2ApplicationError("IDEMPOTENCY_CONFLICT", "The admitted physical intent does not match this exact command.");
    await authorize(client, c, operation, own.result_json.scopes);
    if(!pending(own))return;
  }
  const terminal=await client.query<{status:string;payload_fingerprint:string}>("SELECT status,payload_fingerprint FROM v2_operation_requests WHERE organization_id=$1 AND operation=$2 AND business_request_id=$3",[c.organizationId,operation,c.businessRequest?.id]);
  if(terminal.rows[0]&&['succeeded','permanent_failure'].includes(terminal.rows[0].status)){
    if(terminal.rows[0].payload_fingerprint!==hash(input))throw new V2ApplicationError("IDEMPOTENCY_CONFLICT","The historical domain request has a different exact command.");
    // The owning application's replay branch reauthorizes historical scope.
    return;
  }
  const scopes = own?.result_json.scopes ?? await scopesFor(client, c.organizationId, operation, record(input));
  if (rows.some(row => row !== own && pending(row) && row.result_json.scopes.some(prior => scopes.some(scope => scope.orderId === prior.orderId && scope.replacementObligationId === prior.replacementObligationId)))) throw new V2ApplicationError("CONFLICT", "An admitted physical operation has an unknown outcome for this exact output authority. Recover its owner result before another handoff.");
}

/** Immutable admission receipt + exact domain-result receipt, using existing M0 ports. */
export class PostgresPhysicalOperationRecovery implements PhysicalOperationRecoveryPort {
  constructor(private readonly pool: Pool) {}
  private async run<T>(work: (client: PoolClient) => Promise<T>): Promise<ApplicationResult<T>> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return success(result); }
    catch (cause) { await client.query("ROLLBACK"); return failure(cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Physical operation recovery is unavailable.")); }
    finally { client.release(); }
  }
  admit(c: OperationContext, intent: PhysicalIntent) {
    return this.run(async client => {
      requireOperationPrincipalScope(c);
      if (!physicalOperations.includes(intent.operation) || !intent.businessRequestId?.trim() || c.businessRequest?.id !== intent.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching physical business request identity is required.");
      if(c.principal.kind!=="staff"||!new AuthorityPolicy().decide(c.principal,{capability:intent.operation==="fulfillment.pickup.complete.v1"?"fulfillment.pickup":"fulfillment.ship",resource:{organizationId:c.organizationId}}).allowed)throw new V2ApplicationError("FORBIDDEN","Physical admission requires fresh owner authority.");
      await lock(client,c.organizationId);
      const input = record(intent.input);
      const saved=(await admissions(client,c.organizationId)).find(row=>row.business_request_id===intent.businessRequestId&&row.result_json.operation===intent.operation)??(await legacyReceipts(client,c.organizationId,{operation:intent.operation,businessRequestId:intent.businessRequestId}))[0];
      const scopes=saved?.result_json.scopes??await scopesFor(client,c.organizationId,intent.operation,input);
      if(canonicalJson(intent).length>100_000)throw new V2ApplicationError("VALIDATION_ERROR","Physical intent is too large.");
      await authorize(client, c, intent.operation, scopes);
      await claimPhysicalIntent(client, c, intent.operation, input);
      const previous=await client.query<{payload_fingerprint:string;status:string;initiated_principal_kind:string;initiated_principal_subject:string}>("SELECT payload_fingerprint,status,initiated_principal_kind,initiated_principal_subject FROM v2_operation_requests WHERE organization_id=$1 AND operation=$2 AND business_request_id=$3",[c.organizationId,intent.operation,intent.businessRequestId]);
      const existing=previous.rows[0];
      if(existing&&existing.payload_fingerprint!==hash(input))throw new V2ApplicationError("IDEMPOTENCY_CONFLICT","The domain request identity already belongs to a different physical intent.");
      const requests = new PostgresOperationRequestRepository(), request = await requests.reserve(client, { organizationId: c.organizationId, operation: admissionOperation(intent.operation), businessRequestId: intent.businessRequestId, payloadFingerprint: hash(intent), ...actor(c) });
      if (request.kind !== "replay") await requests.succeed(client, c.organizationId, request.request.id, { resourceType: "fulfillment_physical_intent", resourceId: intent.businessRequestId, resultJson: { ...intent, scopes } });
      const row = (await admissions(client, c.organizationId)).find(item => item.business_request_id === intent.businessRequestId&&item.result_json.operation===intent.operation);
      if (!row) throw new V2ApplicationError("NOT_FOUND", "The physical admission was not found.");
      return projection(row, c);
    });
  }
  discover(c: OperationContext) {
    return this.run(async client => {
      requireOperationPrincipalScope(c);
      if (c.principal.kind !== "staff" || !new AuthorityPolicy().decide(c.principal, { capability: "fulfillment.view", resource: { organizationId: c.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "Physical recovery reads require Fulfillment authority.");
      const results: PhysicalRecoveryResult[] = [];
      const rows=[...await admissions(client,c.organizationId),...await legacyReceipts(client,c.organizationId)].sort((a,b)=>new Date(b.recorded_at??0).getTime()-new Date(a.recorded_at??0).getTime());
      let terminalCount=0;
      for (const row of rows) {
        // Do not reveal a request, payload or result outside fresh read scope.
        try { await authorize(client, c, row.result_json.operation, row.result_json.scopes, true); }
        catch (error) { if (error instanceof V2ApplicationError && ["FORBIDDEN", "NOT_FOUND"].includes(error.code)) continue; throw error; }
        if(pending(row))results.push(projection(row,c));else if(terminalCount++<50)results.push(projection(row,c));
      }
      return results;
    });
  }
  receipt(c:OperationContext,operation:PhysicalOperation,businessRequestId:string){
    return this.run(async client=>{
      requireOperationPrincipalScope(c);
      if(c.principal.kind!=="staff"||!new AuthorityPolicy().decide(c.principal,{capability:"fulfillment.view",resource:{organizationId:c.organizationId}}).allowed)throw new V2ApplicationError("FORBIDDEN","Exact physical receipt reads require fresh Fulfillment authority.");
      if(!physicalOperations.includes(operation)||!businessRequestId.trim())throw new V2ApplicationError("VALIDATION_ERROR","An exact physical receipt identity is required.");
      const row=(await admissions(client,c.organizationId)).find(item=>item.business_request_id===businessRequestId&&item.result_json.operation===operation)??(await legacyReceipts(client,c.organizationId,{operation,businessRequestId}))[0];
      if(!row)throw new V2ApplicationError("NOT_FOUND","The physical receipt was not found; absence does not prove that a mutation failed.");
      await authorize(client,c,operation,row.result_json.scopes,true);
      return projection(row,c);
    });
  }
  withdraw(c: OperationContext, operation:PhysicalOperation, businessRequestId: string) {
    return this.run(async client => {
      requireOperationPrincipalScope(c); await lock(client, c.organizationId);
      if(c.principal.kind!=="staff"||!new AuthorityPolicy().decide(c.principal,{capability:operation==="fulfillment.pickup.complete.v1"?"fulfillment.pickup":"fulfillment.ship",resource:{organizationId:c.organizationId}}).allowed)throw new V2ApplicationError("FORBIDDEN","Withdrawal requires fresh physical-operation authority.");
      if(!physicalOperations.includes(operation)||c.businessRequest?.id!==businessRequestId)throw new V2ApplicationError("VALIDATION_ERROR","Withdrawal requires the exact tenant/operation/business-request identity.");
      const row = (await admissions(client, c.organizationId)).find(item => item.business_request_id === businessRequestId&&item.result_json.operation===operation);
      if (!row) throw new V2ApplicationError("NOT_FOUND", "The admitted physical intent was not found; absence is not evidence of failure.");
      await authorize(client, c, row.result_json.operation, row.result_json.scopes);
      if (pending(row)) {
        const requests = new PostgresOperationRequestRepository(), reserved = await requests.reserve(client, { organizationId: c.organizationId, operation: row.result_json.operation, businessRequestId, payloadFingerprint: hash(row.result_json.input), ...actor(c) });
        if (reserved.kind === "replay" && reserved.request.status === "succeeded") return projection({ ...row, outcome_status: "succeeded", outcome_fingerprint:reserved.request.payloadFingerprint,outcome_result: reserved.request.resultJson }, c);
        // Explicit owner withdrawal under the execution lock, NOT an inference
        // that an unknown request failed because a browser/read was refreshed.
        await requests.markPermanentFailure(client, c.organizationId, reserved.request.id);
        const withdrawal={organizationId:c.organizationId,operation,businessRequestId,status:"withdrawn",submittedPayloadFingerprint:reserved.request.payloadFingerprint};
        const receipt=await requests.reserve(client,{organizationId:c.organizationId,operation:withdrawalOperation(operation),businessRequestId,payloadFingerprint:hash(withdrawal),...actor(c)});
        if(receipt.kind!=="replay")await requests.succeed(client,c.organizationId,receipt.request.id,{resourceType:"fulfillment_physical_intent_withdrawal",resourceId:businessRequestId,resultJson:withdrawal});
        return projection({...row,outcome_status:"permanent_failure",outcome_fingerprint:reserved.request.payloadFingerprint,withdrawal_result:withdrawal},c);
      }
      return projection(row,c);
    });
  }
}
