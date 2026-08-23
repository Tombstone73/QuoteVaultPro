import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { FormulaDomainTransaction, FormulaDomainTransactionRunner, FormulaIdentity, FormulaRevision, HistoricalFormulaRevisionBinding, HistoricalFormulaLifecycle, FormulaInputValue } from "../../src/modules/pricing/formulaDomain.js";
import { validateFormulaDefinition, validateFormulaRevisionInputValues, type FormulaDeclaredInput, type FormulaStatus, type FormulaVisibility } from "../../src/modules/pricing/formulaDomain.js";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";

type IdentityRow = { id:string; organization_id:string; name:string; description:string|null; visibility:FormulaVisibility; status:FormulaStatus; current_revision_id:string; created_at:Date; updated_at:Date; usage_count:string };
type RevisionRow = { id:string; organization_id:string; formula_id:string; revision_number:number; expression:string; declared_inputs:unknown; validation_evidence:unknown; created_at:Date; created_by_user_id:string|null };
type CurrentFormulaRow = IdentityRow & { formula_revision_id:string; formula_revision_organization_id:string; formula_revision_formula_id:string; formula_revision_number:number; formula_revision_expression:string; formula_revision_declared_inputs:unknown; formula_revision_validation_evidence:unknown; formula_revision_created_at:Date; formula_revision_created_by_user_id:string|null };
type HistoricalProductVersionRow = { id:string; product_id:string; status:string };
type HistoricalBindingRow = { organization_id:string; product_id:string; product_version_id:string; formula_id:string; formula_revision_id:string; input_values:unknown; created_at:Date; created_by_user_id:string|null };
const normalize = (value:string) => value.trim().toLocaleLowerCase("en-US");
const record = (value:unknown): Record<string,unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string,unknown> : {};
const canonicalInputValues = (values: Readonly<Record<string, FormulaInputValue>>): Readonly<Record<string, FormulaInputValue>> => Object.freeze(Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right))));
const equalInputValues = (left: Readonly<Record<string, FormulaInputValue>>, right: Readonly<Record<string, FormulaInputValue>>): boolean => JSON.stringify(canonicalInputValues(left)) === JSON.stringify(canonicalInputValues(right));
const revision = (row:RevisionRow): FormulaRevision => ({ formulaRevisionId:row.id,formulaId:row.formula_id,organizationId:row.organization_id,revisionNumber:row.revision_number,expression:row.expression,declaredInputs:validateFormulaDefinition({expression:row.expression,declaredInputs:Array.isArray(row.declared_inputs)?row.declared_inputs as FormulaDeclaredInput[]:[],validationEvidence:record(row.validation_evidence)}).declaredInputs,validationEvidence:record(row.validation_evidence),createdAt:row.created_at.toISOString(),...(row.created_by_user_id?{createdByUserId:row.created_by_user_id}:{}) });
const currentRevision = (row:CurrentFormulaRow): RevisionRow => ({ id:row.formula_revision_id,organization_id:row.formula_revision_organization_id,formula_id:row.formula_revision_formula_id,revision_number:row.formula_revision_number,expression:row.formula_revision_expression,declared_inputs:row.formula_revision_declared_inputs,validation_evidence:row.formula_revision_validation_evidence,created_at:row.formula_revision_created_at,created_by_user_id:row.formula_revision_created_by_user_id });
const historicalBinding = (row: HistoricalBindingRow, lifecycle: HistoricalFormulaLifecycle): HistoricalFormulaRevisionBinding => Object.freeze({ organizationId: row.organization_id, productId: row.product_id, productVersionId: row.product_version_id, lifecycle, formulaId: row.formula_id, formulaRevisionId: row.formula_revision_id, inputValues: canonicalInputValues(record(row.input_values) as Record<string, FormulaInputValue>), createdAt: row.created_at.toISOString(), ...(row.created_by_user_id ? { createdByUserId: row.created_by_user_id } : {}) });
const identity = (header:IdentityRow, current:RevisionRow): FormulaIdentity => ({ formulaId:header.id,organizationId:header.organization_id,name:header.name,...(header.description?{description:header.description}:{}),visibility:header.visibility,status:header.status,currentRevisionId:header.current_revision_id,revision:revision(current),usageCount:Number(header.usage_count),createdAt:header.created_at.toISOString(),updatedAt:header.updated_at.toISOString() });
const select = `SELECT f.id,f.organization_id,f.name,f.description,f.visibility,f.status,f.current_revision_id,f.created_at,f.updated_at,
  (SELECT count(*)::text FROM v2_product_version_formula_revision_bindings b WHERE b.organization_id=f.organization_id AND b.formula_id=f.id) usage_count
  FROM v2_formula_identities f`;
const selectCurrent = `SELECT f.id,f.organization_id,f.name,f.description,f.visibility,f.status,f.current_revision_id,f.created_at,f.updated_at,
  r.id formula_revision_id,r.organization_id formula_revision_organization_id,r.formula_id formula_revision_formula_id,r.revision_number formula_revision_number,r.expression formula_revision_expression,r.declared_inputs formula_revision_declared_inputs,r.validation_evidence formula_revision_validation_evidence,r.created_at formula_revision_created_at,r.created_by_user_id formula_revision_created_by_user_id,
  (SELECT count(*)::text FROM v2_product_version_formula_revision_bindings b WHERE b.organization_id=f.organization_id AND b.formula_id=f.id) usage_count
  FROM v2_formula_identities f`;
const current = `SELECT r.id,r.organization_id,r.formula_id,r.revision_number,r.expression,r.declared_inputs,r.validation_evidence,r.created_at,r.created_by_user_id FROM formula_revisions r`;

export class PostgresFormulaDomainReads {
  constructor(private readonly pool:Pool) {}
  async list(organizationId:string, input:Readonly<{ includeInactive?:boolean; query?:string }>={}):Promise<readonly FormulaIdentity[]> {
    const query=(input.query??"").trim();
    const result=await this.pool.query<CurrentFormulaRow>(`${selectCurrent} JOIN formula_revisions r ON r.id=f.current_revision_id AND r.organization_id=f.organization_id WHERE f.organization_id=$1 ${input.includeInactive?"":"AND f.status='active'"} ${query?"AND f.name ILIKE $2":""} ORDER BY f.name,f.id`,query?[organizationId,`%${query}%`]:[organizationId]);
    return result.rows.map(row=>identity(row,currentRevision(row)));
  }
  async get(organizationId:string,formulaId:string):Promise<FormulaIdentity|null>{const result=await this.pool.query<CurrentFormulaRow>(`${selectCurrent} JOIN formula_revisions r ON r.id=f.current_revision_id AND r.organization_id=f.organization_id WHERE f.organization_id=$1 AND f.id=$2`,[organizationId,formulaId]);return result.rows[0]?identity(result.rows[0]!,currentRevision(result.rows[0]!)):null;}
  async revisions(organizationId:string,formulaId:string):Promise<readonly FormulaRevision[]>{const result=await this.pool.query<RevisionRow>(`${current} WHERE r.organization_id=$1 AND r.formula_id=$2 ORDER BY r.revision_number DESC`,[organizationId,formulaId]);return result.rows.map(revision);}
  async usage(organizationId:string,formulaId:string):Promise<readonly Readonly<{productId:string;productVersionId:string;formulaRevisionId:string;revisionNumber:number;productName:string;versionStatus:string}>[]>{
    const result=await this.pool.query<{product_id:string;product_version_id:string;formula_revision_id:string;revision_number:number;product_name:string;version_status:string}>("SELECT b.product_id,b.product_version_id,b.formula_revision_id,r.revision_number,p.name product_name,v.status version_status FROM v2_product_version_formula_revision_bindings b JOIN formula_revisions r ON r.id=b.formula_revision_id AND r.organization_id=b.organization_id JOIN products p ON p.id=b.product_id AND p.organization_id=b.organization_id JOIN pbv2_tree_versions v ON v.id=b.product_version_id AND v.organization_id=b.organization_id AND v.product_id=b.product_id WHERE b.organization_id=$1 AND b.formula_id=$2 ORDER BY p.name,v.updated_at DESC",[organizationId,formulaId]);
    return result.rows.map(row=>({productId:row.product_id,productVersionId:row.product_version_id,formulaRevisionId:row.formula_revision_id,revisionNumber:row.revision_number,productName:row.product_name,versionStatus:row.version_status}));
  }
}

class Transaction implements FormulaDomainTransaction {
  private readonly requests=new PostgresOperationRequestRepository();
  constructor(private readonly client:PoolClient) {}
  reserve(input:Parameters<FormulaDomainTransaction["reserve"]>[0]) { return this.requests.reserve(this.client,input); }
  private async read(organizationId:string,formulaId:string):Promise<FormulaIdentity>{const found=await this.client.query<CurrentFormulaRow>(`${selectCurrent} JOIN formula_revisions r ON r.id=f.current_revision_id AND r.organization_id=f.organization_id WHERE f.organization_id=$1 AND f.id=$2`,[organizationId,formulaId]);if(!found.rows[0])throw new V2ApplicationError("NOT_FOUND","The tenant-scoped Formula was not found.");return identity(found.rows[0]!,currentRevision(found.rows[0]!));}
  async create(input:Parameters<FormulaDomainTransaction["create"]>[0]):Promise<FormulaIdentity>{
    const formulaId=randomUUID(),revisionId=randomUUID(),definition=validateFormulaDefinition(input.definition);
    try { await this.client.query("INSERT INTO v2_formula_identities(id,organization_id,name,normalized_name,description,visibility,status,created_by_user_id,updated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,'active',$7,$7)",[formulaId,input.organizationId,input.name,normalize(input.name),input.description??null,input.visibility,input.staffActorUserId??null]); } catch(error:any) { if(error?.code==="23505") throw new V2ApplicationError("CONFLICT","A Formula with that name already exists."); throw error; }
    await this.client.query("INSERT INTO formula_revisions(id,organization_id,formula_id,revision_number,expression,declared_inputs,validation_evidence,created_by_user_id) VALUES($1,$2,$3,1,$4,$5::jsonb,$6::jsonb,$7)",[revisionId,input.organizationId,formulaId,definition.expression,JSON.stringify(definition.declaredInputs),JSON.stringify(definition.validationEvidence??{}),input.staffActorUserId??null]);
    await this.client.query("UPDATE v2_formula_identities SET current_revision_id=$1 WHERE organization_id=$2 AND id=$3",[revisionId,input.organizationId,formulaId]);
    return this.read(input.organizationId,formulaId);
  }
  async revise(input:Parameters<FormulaDomainTransaction["revise"]>[0]):Promise<FormulaIdentity>{
    const header=(await this.client.query<IdentityRow>(`${select} WHERE f.organization_id=$1 AND f.id=$2 FOR UPDATE`,[input.organizationId,input.formulaId])).rows[0];if(!header)throw new V2ApplicationError("NOT_FOUND","The tenant-scoped Formula was not found.");if(header.current_revision_id!==input.expectedCurrentRevisionId)throw new V2ApplicationError("STALE_STATE","The Formula changed elsewhere. Refresh and try again.");if(header.status==="archived")throw new V2ApplicationError("CONFLICT","Archived Formulas cannot be revised.");
    const definition=validateFormulaDefinition(input.definition), revisionId=randomUUID();
    // The Formula identity row above is already locked FOR UPDATE and is the
    // serialization point for appending a revision. PostgreSQL forbids a row
    // lock on an aggregate query, so the sequence read must remain lock-free.
    const next=(await this.client.query<{revision_number:number}>("SELECT COALESCE(max(revision_number),0)+1 revision_number FROM formula_revisions WHERE organization_id=$1 AND formula_id=$2",[input.organizationId,input.formulaId])).rows[0]!.revision_number;
    await this.client.query("INSERT INTO formula_revisions(id,organization_id,formula_id,revision_number,expression,declared_inputs,validation_evidence,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)",[revisionId,input.organizationId,input.formulaId,next,definition.expression,JSON.stringify(definition.declaredInputs),JSON.stringify(definition.validationEvidence??{}),input.staffActorUserId??null]);
    await this.client.query("UPDATE v2_formula_identities SET current_revision_id=$1,updated_at=now(),updated_by_user_id=$2 WHERE organization_id=$3 AND id=$4",[revisionId,input.staffActorUserId??null,input.organizationId,input.formulaId]);
    return this.read(input.organizationId,input.formulaId);
  }
  async updateMetadata(input:Parameters<FormulaDomainTransaction["updateMetadata"]>[0]):Promise<FormulaIdentity>{
    try {
      const updated=await this.client.query("UPDATE v2_formula_identities SET name=$1,normalized_name=$2,description=$3,updated_at=now(),updated_by_user_id=$4 WHERE organization_id=$5 AND id=$6 AND current_revision_id=$7 RETURNING id",[input.name,normalize(input.name),input.description??null,input.staffActorUserId??null,input.organizationId,input.formulaId,input.expectedCurrentRevisionId]);
      if(!updated.rows[0]){const exists=await this.client.query("SELECT 1 FROM v2_formula_identities WHERE organization_id=$1 AND id=$2",[input.organizationId,input.formulaId]);throw new V2ApplicationError(exists.rows[0]?"STALE_STATE":"NOT_FOUND",exists.rows[0]?"The Formula changed elsewhere. Refresh and try again.":"The tenant-scoped Formula was not found.");}
    } catch(error:any) { if(error?.code==="23505") throw new V2ApplicationError("CONFLICT","A Formula with that name already exists."); throw error; }
    return this.read(input.organizationId,input.formulaId);
  }
  async setVisibility(input:Parameters<FormulaDomainTransaction["setVisibility"]>[0]):Promise<FormulaIdentity>{return this.updateVisibilityOrStatus(input.organizationId,input.formulaId,input.expectedCurrentRevisionId,"visibility",input.visibility,input.staffActorUserId);}
  async setStatus(input:Parameters<FormulaDomainTransaction["setStatus"]>[0]):Promise<FormulaIdentity>{return this.updateVisibilityOrStatus(input.organizationId,input.formulaId,input.expectedCurrentRevisionId,"status",input.status,input.staffActorUserId);}
  /**
   * The ProductVersion row is the serialization point for the first historic
   * binding.  A published binding cannot be updated by the database trigger,
   * so this method only ever inserts it or proves an exact replay.
   */
  async freezeHistoricalBinding(input: Parameters<FormulaDomainTransaction["freezeHistoricalBinding"]>[0]): Promise<HistoricalFormulaRevisionBinding> {
    const version = (await this.client.query<HistoricalProductVersionRow>(
      "SELECT id,product_id,status FROM pbv2_tree_versions WHERE organization_id=$1 AND id=$2 FOR UPDATE",
      [input.organizationId, input.productVersionId],
    )).rows[0];
    if (!version) throw new V2ApplicationError("NOT_FOUND", "The tenant-scoped ProductVersion was not found.");
    if (version.status !== "ACTIVE" && version.status !== "DEPRECATED") throw new V2ApplicationError("CONFLICT", "Only ACTIVE or DEPRECATED ProductVersions may receive a historical Formula freeze.");
    const lifecycle = version.status as HistoricalFormulaLifecycle;
    if (input.expectedLifecycle !== undefined && input.expectedLifecycle !== lifecycle) throw new V2ApplicationError("STALE_STATE", "The ProductVersion lifecycle changed elsewhere. Refresh and try again.");

    const existing = (await this.client.query<HistoricalBindingRow>(
      "SELECT organization_id,product_id,product_version_id,formula_id,formula_revision_id,input_values,created_at,created_by_user_id FROM v2_product_version_formula_revision_bindings WHERE organization_id=$1 AND product_version_id=$2 FOR UPDATE",
      [input.organizationId, input.productVersionId],
    )).rows[0];
    const selected = (await this.client.query<RevisionRow>(
      `SELECT r.id,r.organization_id,r.formula_id,r.revision_number,r.expression,r.declared_inputs,r.validation_evidence,r.created_at,r.created_by_user_id
       FROM formula_revisions r
       JOIN v2_formula_identities f ON f.id=r.formula_id AND f.organization_id=r.organization_id
       WHERE r.organization_id=$1 AND r.id=$2
       FOR KEY SHARE OF r, f`,
      [input.organizationId, input.formulaRevisionId],
    )).rows[0];
    if (!selected) throw new V2ApplicationError("NOT_FOUND", "The tenant-scoped Formula revision was not found.");
    const definition = validateFormulaDefinition({ expression: selected.expression, declaredInputs: Array.isArray(selected.declared_inputs) ? selected.declared_inputs as FormulaDeclaredInput[] : [], validationEvidence: record(selected.validation_evidence) });
    const inputValues = canonicalInputValues(validateFormulaRevisionInputValues(definition.declaredInputs, input.inputValues));

    if (existing) {
      if (existing.product_id !== version.product_id || existing.formula_revision_id !== selected.id || existing.formula_id !== selected.formula_id) throw new V2ApplicationError("CONFLICT", "The historical ProductVersion is already frozen to a different Formula revision.");
      const existingInputs = canonicalInputValues(validateFormulaRevisionInputValues(definition.declaredInputs, record(existing.input_values)));
      if (!equalInputValues(existingInputs, inputValues)) throw new V2ApplicationError("CONFLICT", "The historical ProductVersion is already frozen with different Formula input values.");
      return Object.freeze({ ...historicalBinding(existing, lifecycle), inputValues: existingInputs });
    }

    const inserted = await this.client.query<HistoricalBindingRow>(
      `INSERT INTO v2_product_version_formula_revision_bindings(organization_id,product_id,product_version_id,formula_id,formula_revision_id,input_values,created_by_user_id)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)
       ON CONFLICT (organization_id,product_version_id) DO NOTHING
       RETURNING organization_id,product_id,product_version_id,formula_id,formula_revision_id,input_values,created_at,created_by_user_id`,
      [input.organizationId, version.product_id, version.id, selected.formula_id, selected.id, JSON.stringify(inputValues), input.staffActorUserId ?? null],
    );
    if (inserted.rows[0]) return historicalBinding(inserted.rows[0], lifecycle);

    // Defensive retry for a direct/database-level concurrent writer.  Normal
    // callers are serialized by the locked ProductVersion above.
    const raced = (await this.client.query<HistoricalBindingRow>(
      "SELECT organization_id,product_id,product_version_id,formula_id,formula_revision_id,input_values,created_at,created_by_user_id FROM v2_product_version_formula_revision_bindings WHERE organization_id=$1 AND product_version_id=$2 FOR UPDATE",
      [input.organizationId, input.productVersionId],
    )).rows[0];
    if (!raced || raced.product_id !== version.product_id || raced.formula_id !== selected.formula_id || raced.formula_revision_id !== selected.id) throw new V2ApplicationError("CONFLICT", "The historical ProductVersion Formula binding changed concurrently.");
    const racedInputs = canonicalInputValues(validateFormulaRevisionInputValues(definition.declaredInputs, record(raced.input_values)));
    if (!equalInputValues(racedInputs, inputValues)) throw new V2ApplicationError("CONFLICT", "The historical ProductVersion Formula input values changed concurrently.");
    return Object.freeze({ ...historicalBinding(raced, lifecycle), inputValues: racedInputs });
  }
  private async updateVisibilityOrStatus(organizationId:string,formulaId:string,expected:string,column:"visibility"|"status",value:string,userId?:string):Promise<FormulaIdentity>{const updated=await this.client.query("UPDATE v2_formula_identities SET "+column+"=$1,updated_at=now(),updated_by_user_id=$2 WHERE organization_id=$3 AND id=$4 AND current_revision_id=$5 RETURNING id",[value,userId??null,organizationId,formulaId,expected]);if(!updated.rows[0]){const exists=await this.client.query("SELECT 1 FROM v2_formula_identities WHERE organization_id=$1 AND id=$2",[organizationId,formulaId]);throw new V2ApplicationError(exists.rows[0]?"STALE_STATE":"NOT_FOUND",exists.rows[0]?"The Formula changed elsewhere. Refresh and try again.":"The tenant-scoped Formula was not found.");}return this.read(organizationId,formulaId);}
  attribute(input:Parameters<FormulaDomainTransaction["attribute"]>[0]) {return this.requests.recordAttribution(this.client,{organizationId:input.organizationId,operationRequestId:input.requestId,operation:input.operation,resourceType:input.resourceType??"formula",resourceId:input.resourceId,principalKind:input.principalKind,principalSubject:input.principalSubject,staffActorUserId:input.staffActorUserId});}
  async audit(input:Parameters<FormulaDomainTransaction["audit"]>[0]){await this.client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)",[input.organizationId,input.requestId,input.operation,input.event,input.resourceType??"formula",input.resourceId,input.principalKind,input.principalSubject,input.staffActorUserId??null,JSON.stringify(input.changes??[])]);}
  async succeed(organizationId:string,requestId:string,resourceId:string,result:FormulaIdentity){await this.requests.succeed(this.client,organizationId,requestId,{resourceType:"formula",resourceId,resultJson:result});}
  async succeedHistoricalFreeze(organizationId:string,requestId:string,resourceId:string,result:HistoricalFormulaRevisionBinding){await this.requests.succeed(this.client,organizationId,requestId,{resourceType:"product_version",resourceId,resultJson:result});}
}
export class PostgresFormulaDomainTransactionRunner implements FormulaDomainTransactionRunner { constructor(private readonly pool:Pool) {} async transaction<T>(work:(tx:FormulaDomainTransaction)=>Promise<T>):Promise<T>{const client=await this.pool.connect();try{await client.query("BEGIN");const value=await work(new Transaction(client));await client.query("COMMIT");return value;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}} }
