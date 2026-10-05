import type { Pool, PoolClient } from "pg";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { productionIntentFingerprint, type ProductionOutputIntent, type ProductionOutputOperation, type ProductionOutputReceipt, type ProductionRecoveryActor, type ProductionRecoveryPort } from "../../src/modules/production/productionRecovery.js";
import type { ProductionRun } from "../../src/modules/production/productionRunApplication.js";
import type { ProductionMutationResult } from "../../src/modules/production/productionApplication.js";

type ReceiptRow = { result_json: ProductionOutputReceipt; status: string; creator_kind:string;creator_subject:string;bound_work:string|null;bound_attempt:string|null;bound_allocation:string|null; effect_result: unknown; effect_status: string | null; effect_fingerprint: string | null; effect_type:string|null;effect_id:string|null;rejection:ProductionOutputReceipt["rejection"]|null;rejection_id:string|null;rejection_fingerprint:string|null;rejection_type:string|null;rejection_resource:string|null; created_at: Date };
const intentOperation = (operation: ProductionOutputOperation) => `${operation}.intent`;
// Production-only serialization matches the proposed DB statement gate.
export async function lockProductionRunMembership(client:PoolClient){await client.query("SELECT pg_advisory_xact_lock(1886547812,1209)");}

/** The intent lock serializes execution with definitive rejection recording. */
export async function requirePreparedProductionOutput(client:PoolClient,input:Readonly<{organizationId:string;operation:string;businessRequestId:string;payloadFingerprint:string;principalKind:string;principalSubject:string;staffActorUserId?:string}>){
  const rows=await client.query<{payload_fingerprint:string;initiated_principal_kind:string;initiated_principal_subject:string;staff_actor_user_id:string|null;status:string}>("SELECT payload_fingerprint,initiated_principal_kind,initiated_principal_subject,staff_actor_user_id,status FROM v2_operation_requests WHERE organization_id=$1 AND operation=$2 AND business_request_id=$3 FOR UPDATE",[input.organizationId,`${input.operation}.intent`,input.businessRequestId]);
  const row=rows.rows[0];
  if(!row||row.status!=="succeeded")throw new V2ApplicationError("NOT_FOUND","The original Production output intent was not found.");
  if(row.payload_fingerprint!==input.payloadFingerprint)throw new V2ApplicationError("IDEMPOTENCY_CONFLICT","Production output intent does not match the original request.");
  const rejected=await client.query("SELECT id FROM v2_operation_requests WHERE organization_id=$1 AND operation=$2 AND business_request_id=$3 AND status='succeeded'",[input.organizationId,`${input.operation}.rejected`,input.businessRequestId]);
  if(rejected.rows.length)throw new V2ApplicationError("CONFLICT","The original output intent was definitively rejected; it cannot be executed again.");
}
export class PostgresProductionRecovery implements ProductionRecoveryPort {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly pool: Pool) {}
  private async transaction<T>(action: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await action(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  private static async read(client: PoolClient, actor: ProductionRecoveryActor, operation: ProductionOutputOperation, businessRequestId?: string,knownInput?:ProductionOutputIntent) {
    const rows = await client.query<ReceiptRow>(`SELECT intent.result_json,intent.status,intent.created_at,intent.initiated_principal_kind creator_kind,intent.initiated_principal_subject creator_subject,w.id bound_work,a.id bound_attempt,ra.id bound_allocation,effect.result_json effect_result,effect.status effect_status,effect.payload_fingerprint effect_fingerprint,effect.result_resource_type effect_type,effect.result_resource_id effect_id,rejected.result_json rejection,rejected.id rejection_id,rejected.payload_fingerprint rejection_fingerprint,rejected.result_resource_type rejection_type,rejected.result_resource_id rejection_resource
      FROM v2_operation_requests intent
      LEFT JOIN v2_production_works w ON w.organization_id=intent.organization_id AND w.id=intent.result_json->>'productionWorkId'
      LEFT JOIN v2_production_attempts a ON a.organization_id=w.organization_id AND a.production_work_id=w.id AND a.id=intent.result_json->>'productionAttemptId'
      LEFT JOIN v2_production_run_allocations ra ON ra.organization_id=w.organization_id AND ra.production_work_id=w.id AND ra.production_attempt_id=a.id AND ra.id=intent.result_json->>'productionRunAllocationId' AND ra.production_run_id=intent.result_json->>'productionRunId'
      LEFT JOIN v2_operation_requests effect ON effect.organization_id=intent.organization_id AND effect.operation=$2 AND effect.business_request_id=intent.business_request_id
      LEFT JOIN v2_operation_requests rejected ON rejected.organization_id=intent.organization_id AND rejected.operation=$2||'.rejected' AND rejected.business_request_id=intent.business_request_id AND rejected.status='succeeded'
      WHERE intent.organization_id=$1 AND intent.operation=$3
        AND ($4::varchar IS NULL OR intent.business_request_id=$4)
      ORDER BY (effect.status IS DISTINCT FROM 'succeeded' AND rejected.id IS NULL) DESC,intent.created_at DESC,intent.id DESC LIMIT 100`, [actor.organizationId, operation, intentOperation(operation), businessRequestId ?? null]);
    return rows.rows.map(row => {
      if (row.status !== "succeeded" || !row.result_json?.intent || row.result_json.operation !== operation) throw new V2ApplicationError("STALE_STATE", "Production recovery evidence is unavailable.");
      if(!row.bound_work||!row.bound_attempt||operation==="production.run.output.v1"&&!row.bound_allocation)throw new V2ApplicationError("CONFLICT","Production output intent owner resource binding is invalid.");
      if(row.effect_status && row.effect_fingerprint !== productionIntentFingerprint(row.result_json.intent)) throw new V2ApplicationError("IDEMPOTENCY_CONFLICT", "Production output recovery evidence does not match the original intent.");
      if(row.rejection_id&&row.effect_status!=="succeeded"){
        if(row.rejection_fingerprint!==productionIntentFingerprint(row.result_json.intent)||row.rejection_type!=="production_output_rejection"||row.rejection_resource!==row.result_json.businessRequestId)throw new V2ApplicationError("CONFLICT","Production no-effect receipt does not bind the original output intent.");
        if(!row.rejection||!["VALIDATION_ERROR","CONFLICT","NOT_FOUND"].includes(row.rejection.code)||typeof row.rejection.message!=="string"||!row.rejection.message.trim())throw new V2ApplicationError("STALE_STATE","Production no-effect receipt is unavailable; an unknown outcome must remain blocked.");
      }
      if(row.effect_status==="succeeded"&&(row.effect_type!==(operation==="production.run.output.v1"?"production_run":"production_attempt")||row.effect_id!==(row.result_json.productionRunId??row.result_json.productionAttemptId)))throw new V2ApplicationError("CONFLICT","Production output result resource binding is invalid.");
      if(row.effect_status==="succeeded"){
        if(!row.effect_result||typeof row.effect_result!=="object")throw new V2ApplicationError("STALE_STATE","The committed Production output result is unavailable; it must not be treated as non-commit.");
        if(operation==="production.run.output.v1"){
          const result=row.effect_result as ProductionRun;
          const allocation=Array.isArray(result.allocations)?result.allocations.find(item=>item.productionRunAllocationId===row.result_json.productionRunAllocationId):undefined;
          if(result.organizationId!==actor.organizationId||result.productionRunId!==row.result_json.productionRunId||!allocation||allocation.productionWorkId!==row.result_json.productionWorkId||allocation.productionAttemptId!==row.result_json.productionAttemptId)throw new V2ApplicationError("CONFLICT","Production output result resource binding is invalid.");
        }else{
          const result=row.effect_result as ProductionMutationResult;
          if(result.work?.organizationId!==actor.organizationId||result.work?.productionWorkId!==row.result_json.productionWorkId||result.attempt?.productionAttemptId!==row.result_json.productionAttemptId||result.attempt?.productionWorkId!==row.result_json.productionWorkId)throw new V2ApplicationError("CONFLICT","Production output result resource binding is invalid.");
        }
      }
      const creator=row.creator_kind===actor.principalKind&&row.creator_subject===actor.principalSubject;
      const supplied=knownInput&&productionIntentFingerprint(knownInput)===productionIntentFingerprint(row.result_json.intent)?knownInput:undefined;
      const {rejection:_priorRejection,intent:_privateIntent,...metadata}=row.result_json;
      return { ...metadata,intent:creator?row.result_json.intent:supplied??null,...(!creator&&!supplied?{intentRedacted:true as const}:{}), submittedAt: row.created_at.toISOString(), status: row.effect_status === "succeeded" && row.effect_result !== null ? "succeeded" as const : row.rejection?"rejected" as const:"pending" as const, result: row.effect_status === "succeeded" ? row.effect_result : null,...(row.rejection&&(creator||supplied)?{rejection:row.rejection}:{}) };
    });
  }
  discover(actor: ProductionRecoveryActor, operation: ProductionOutputOperation, businessRequestId?: string) {
    return this.transaction(async client=>{
      const receipts=await PostgresProductionRecovery.read(client,actor,operation,businessRequestId);
      const legacy=await client.query<{business_request_id:string;result_resource_type:string;result_resource_id:string;result_json:{organizationId?:string;productionRunId?:string;work?:{organizationId?:string;productionWorkId?:string};attempt?:{productionAttemptId?:string;productionWorkId?:string}};created_at:Date}>(`SELECT effect.business_request_id,effect.result_resource_type,effect.result_resource_id,effect.result_json,effect.created_at FROM v2_operation_requests effect
        WHERE effect.organization_id=$1 AND effect.operation=$2 AND effect.status='succeeded' AND effect.result_json IS NOT NULL
          AND ($3::varchar IS NULL OR effect.business_request_id=$3)
          AND NOT EXISTS(SELECT 1 FROM v2_operation_requests intent WHERE intent.organization_id=effect.organization_id AND intent.operation=$2||'.intent' AND intent.business_request_id=effect.business_request_id)
        ORDER BY effect.created_at DESC,effect.id DESC LIMIT 100`,[actor.organizationId,operation,businessRequestId??null]);
      const historical:ProductionOutputReceipt[]=legacy.rows.map(row=>{
        const result=row.result_json;
        const run=operation==="production.run.output.v1";
        if(run?(row.result_resource_type!=="production_run"||result.organizationId!==actor.organizationId||result.productionRunId!==row.result_resource_id):(row.result_resource_type!=="production_attempt"||result.work?.organizationId!==actor.organizationId||result.attempt?.productionAttemptId!==row.result_resource_id||result.attempt?.productionWorkId!==result.work?.productionWorkId))throw new V2ApplicationError("CONFLICT","Historical Production result resource binding is invalid.");
        return {operation,businessRequestId:row.business_request_id,...(run?{productionRunId:row.result_resource_id}:{productionWorkId:result.work!.productionWorkId,productionAttemptId:row.result_resource_id}),intent:null,historicalIntentUnavailable:true,submittedAt:row.created_at.toISOString(),status:"succeeded",result};
      });
      return [...receipts,...historical].sort((a,b)=>Number(b.status==="pending")-Number(a.status==="pending")||b.submittedAt.localeCompare(a.submittedAt)||b.businessRequestId.localeCompare(a.businessRequestId)).slice(0,100);
    });
  }
  prepare(actor: ProductionRecoveryActor, operation: ProductionOutputOperation, input: ProductionOutputIntent) {
    return this.transaction(client=>PostgresProductionRecovery.prepareInTransaction(client,actor,operation,input));
  }
  static async prepareInTransaction(client:PoolClient,actor:ProductionRecoveryActor,operation:ProductionOutputOperation,input:ProductionOutputIntent){
      const requests=new PostgresOperationRequestRepository();
      const resource = operation === "production.attempt.output.v1"
        ? await client.query<{ work_id: string; attempt_id: string }>("SELECT production_work_id work_id,id attempt_id FROM v2_production_attempts WHERE organization_id=$1 AND id=$2", [actor.organizationId, input.productionAttemptId])
        : await client.query<{ work_id: string; attempt_id: string }>("SELECT production_work_id work_id,production_attempt_id attempt_id FROM v2_production_run_allocations WHERE organization_id=$1 AND production_run_id=$2 AND id=$3", [actor.organizationId, input.productionRunId, input.productionRunAllocationId]);
      const bound = resource.rows[0];
      if (!bound?.attempt_id) throw new V2ApplicationError("NOT_FOUND", "Production output resource was not found.");
      const reservation = await requests.reserve(client, { ...actor, operation: intentOperation(operation), businessRequestId: input.businessRequestId, payloadFingerprint: productionIntentFingerprint(input) });
      if(reservation.kind==="replay"){
        const [receipt]=await PostgresProductionRecovery.read(client,actor,operation,input.businessRequestId,input);
        if(!receipt||receipt.productionWorkId!==bound.work_id||receipt.productionAttemptId!==bound.attempt_id)throw new V2ApplicationError("CONFLICT","Production recovery resource binding changed.");
        if(receipt.status!=="pending")return receipt;
      }
      // After the intent lock, match execution's Run -> Work lock order.
      if (input.productionRunId) {await lockProductionRunMembership(client);await client.query("SELECT id FROM v2_production_runs WHERE organization_id=$1 AND id=$2 FOR UPDATE", [actor.organizationId, input.productionRunId]);}
      await client.query("SELECT id FROM v2_production_works WHERE organization_id=$1 AND id=$2 FOR UPDATE", [actor.organizationId, bound.work_id]);
      const pending = await client.query(`SELECT intent.id FROM v2_operation_requests intent
        WHERE intent.organization_id=$1 AND intent.operation IN ('production.attempt.output.v1.intent','production.run.output.v1.intent')
          AND intent.result_resource_type='production_work' AND intent.result_resource_id=$2
          AND NOT (intent.operation=$3 AND intent.business_request_id=$4)
          AND NOT EXISTS(SELECT 1 FROM v2_operation_requests effect WHERE effect.organization_id=intent.organization_id AND effect.operation=replace(intent.operation,'.intent','') AND effect.business_request_id=intent.business_request_id AND effect.status='succeeded')
          AND NOT EXISTS(SELECT 1 FROM v2_operation_requests rejected WHERE rejected.organization_id=intent.organization_id AND rejected.operation=replace(intent.operation,'.intent','.rejected') AND rejected.business_request_id=intent.business_request_id AND rejected.status='succeeded') LIMIT 1`, [actor.organizationId, bound.work_id, intentOperation(operation), input.businessRequestId]);
      if (pending.rows.length) throw new V2ApplicationError("CONFLICT", "Production work has an unresolved output intent. Recover the original request before reporting new physical output.");
      if (reservation.kind !== "replay") {
        const receipt: ProductionOutputReceipt = { operation, businessRequestId: input.businessRequestId, productionWorkId: bound.work_id, productionAttemptId: bound.attempt_id, ...(input.productionRunId ? { productionRunId: input.productionRunId, productionRunAllocationId: input.productionRunAllocationId } : {}), intent: input, submittedAt: reservation.request.createdAt.toISOString(), status: "pending", result: null };
        await requests.succeed(client, actor.organizationId, reservation.request.id, { resourceType: "production_work", resourceId: bound.work_id, resultJson: receipt });
      }
      const [receipt] = await PostgresProductionRecovery.read(client, actor, operation, input.businessRequestId,input);
      if (!receipt || receipt.productionWorkId !== bound.work_id || receipt.productionAttemptId !== bound.attempt_id) throw new V2ApplicationError("CONFLICT", "Production recovery resource binding changed.");
      return receipt;
  }
  reject(actor:ProductionRecoveryActor,operation:ProductionOutputOperation,input:ProductionOutputIntent,rejection:Readonly<{code:string;message:string}>){
    return this.transaction(async client=>{
      await requirePreparedProductionOutput(client,{...actor,operation,businessRequestId:input.businessRequestId,payloadFingerprint:productionIntentFingerprint(input)});
      const committed=await client.query("SELECT id FROM v2_operation_requests WHERE organization_id=$1 AND operation=$2 AND business_request_id=$3 AND status='succeeded'",[actor.organizationId,operation,input.businessRequestId]);
      if(committed.rows.length)return;
      const request=await this.requests.reserve(client,{...actor,operation:`${operation}.rejected`,businessRequestId:input.businessRequestId,payloadFingerprint:productionIntentFingerprint(input)});
      if(request.kind!=="replay")await this.requests.succeed(client,actor.organizationId,request.request.id,{resourceType:"production_output_rejection",resourceId:input.businessRequestId,resultJson:rejection});
    });
  }
}
