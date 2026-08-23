import { createHash } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId, type PrincipalKind } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { evaluateResolvedFormula } from "./v2PricingAdapter.js";

export type FormulaVisibility = "product_scoped" | "library";
export type FormulaStatus = "active" | "inactive" | "archived";
export type FormulaInputType = "number" | "integer" | "boolean";
export type FormulaInputValue = number | boolean;
export type FormulaDeclaredInput = Readonly<{
  key: string;
  label: string;
  description?: string;
  type: FormulaInputType;
  required: boolean;
  defaultValue?: FormulaInputValue;
  minimum?: number;
  maximum?: number;
  /** Existing pricing Formula semantics use inches and square feet. */
  unit?: "in" | "sq_ft";
  authorable: boolean;
}>;
export type FormulaRevisionDefinition = Readonly<{
  expression: string;
  declaredInputs: readonly FormulaDeclaredInput[];
  validationEvidence?: Readonly<Record<string, unknown>>;
}>;
/**
 * A transient Formula-domain evaluation request.  This deliberately accepts a
 * definition rather than a ProductVersion: Formula Tester must be able to
 * validate an unsaved revision without reading or changing commercial data.
 */
export type FormulaEvaluationInput = Readonly<{
  definition: FormulaRevisionDefinition;
  width: number;
  height: number;
  quantity: number;
  /** Values for this revision's declared inputs only. */
  inputValues?: Readonly<Record<string, unknown>>;
  /** Optional tester rate for Formulae that use the standard p/base_price aliases. */
  basePrice?: number;
}>;
export type FormulaEvaluationResult = Readonly<{
  expression: string;
  result: number;
  width: number;
  height: number;
  quantity: number;
  inputValues: Readonly<Record<string, FormulaInputValue>>;
  /** Safe diagnostic scope supplied to the canonical Formula evaluator. */
  variables: Readonly<Record<string, number>>;
}>;
export type FormulaRevision = Readonly<FormulaRevisionDefinition & {
  formulaRevisionId: string;
  formulaId: string;
  organizationId: string;
  revisionNumber: number;
  createdAt: string;
  createdByUserId?: string;
}>;
export type FormulaIdentity = Readonly<{
  formulaId: string;
  organizationId: string;
  name: string;
  description?: string;
  visibility: FormulaVisibility;
  status: FormulaStatus;
  currentRevisionId: string;
  revision: FormulaRevision;
  usageCount?: number;
  createdAt: string;
  updatedAt: string;
}>;

const keyPattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
const label = (value: unknown, field: string, max = 255): string => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new V2ApplicationError("VALIDATION_ERROR", `${field} is required.`);
  return value.trim();
};
const optionalText = (value: unknown, field: string, max = 2_000): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  return label(value, field, max);
};
const isInputType = (value: unknown): value is FormulaInputType => value === "number" || value === "integer" || value === "boolean";
const validInputValue = (type: FormulaInputType, value: unknown): value is FormulaInputValue =>
  type === "boolean" ? typeof value === "boolean" : typeof value === "number" && Number.isFinite(value) && (type !== "integer" || Number.isInteger(value));
const formulaRuntimeProbe = ["q", "w", "h", "sqft", "total_sqft", "computed_sheets", "billed_sqft", "base_price", "p", "sheet_price", "unitPrice", "allow_rotation"] as const;
const probeValue = (input: FormulaDeclaredInput): number => {
  if (typeof input.defaultValue === "number") return input.defaultValue;
  if (input.minimum !== undefined) return input.minimum;
  if (input.maximum !== undefined && input.maximum < 1) return input.maximum;
  return 1;
};

/** Validates an immutable Formula definition at the Formula-domain boundary. */
export const validateFormulaDefinition = (value: FormulaRevisionDefinition): FormulaRevisionDefinition => {
  const expression = label(value.expression, "Formula expression", 10_000);
  if (!Array.isArray(value.declaredInputs)) throw new V2ApplicationError("VALIDATION_ERROR", "Formula input declarations are invalid.");
  const keys = new Set<string>();
  const declaredInputs = value.declaredInputs.map((raw) => {
    const key = label(raw.key, "Formula input key", 64);
    if (!keyPattern.test(key) || keys.has(key)) throw new V2ApplicationError("VALIDATION_ERROR", "Formula input keys must be unique identifiers.");
    keys.add(key);
    if (!isInputType(raw.type) || typeof raw.required !== "boolean" || typeof raw.authorable !== "boolean") throw new V2ApplicationError("VALIDATION_ERROR", "Formula input declarations are invalid.");
    if (raw.type === "boolean" && (raw.minimum !== undefined || raw.maximum !== undefined)) throw new V2ApplicationError("VALIDATION_ERROR", "Boolean Formula inputs cannot have numeric bounds.");
    if (raw.minimum !== undefined && (!Number.isFinite(raw.minimum) || raw.type === "boolean")) throw new V2ApplicationError("VALIDATION_ERROR", "Formula input minimum is invalid.");
    if (raw.maximum !== undefined && (!Number.isFinite(raw.maximum) || raw.type === "boolean" || (raw.minimum !== undefined && raw.maximum < raw.minimum))) throw new V2ApplicationError("VALIDATION_ERROR", "Formula input maximum is invalid.");
    if (raw.defaultValue !== undefined && !validInputValue(raw.type, raw.defaultValue)) throw new V2ApplicationError("VALIDATION_ERROR", "Formula input default value is invalid.");
    if (typeof raw.defaultValue === "number" && ((raw.minimum !== undefined && raw.defaultValue < raw.minimum) || (raw.maximum !== undefined && raw.defaultValue > raw.maximum))) throw new V2ApplicationError("VALIDATION_ERROR", "Formula input default value is outside its allowed range.");
    const unit = optionalText(raw.unit, "Formula input unit", 80);
    if (unit !== undefined && unit !== "in" && unit !== "sq_ft") throw new V2ApplicationError("VALIDATION_ERROR", "Formula input unit is invalid.");
    return { key, label: label(raw.label, "Formula input label"), ...(optionalText(raw.description, "Formula input description") ? { description: optionalText(raw.description, "Formula input description") } : {}), type: raw.type, required: raw.required, ...(raw.defaultValue !== undefined ? { defaultValue: raw.defaultValue } : {}), ...(raw.minimum !== undefined ? { minimum: raw.minimum } : {}), ...(raw.maximum !== undefined ? { maximum: raw.maximum } : {}), ...(unit ? { unit } : {}), authorable: raw.authorable } satisfies FormulaDeclaredInput;
  });
  // Reuse the one canonical V2 Formula evaluator for definition validation;
  // Formula creation must not introduce expressions the pricing spine cannot
  // calculate later.  This probe deliberately uses only synthetic values and
  // never reaches Product/ProductVersion data.
  try {
    evaluateResolvedFormula(expression, {
      ...Object.fromEntries(formulaRuntimeProbe.map((key) => [key, 1])),
      ...Object.fromEntries(declaredInputs.filter((input) => input.type !== "boolean").map((input) => [input.key, probeValue(input)])),
    });
  } catch (error) {
    throw new V2ApplicationError("VALIDATION_ERROR", error instanceof Error ? `Formula expression is invalid: ${error.message}` : "Formula expression is invalid.");
  }
  return {
    expression,
    declaredInputs,
    validationEvidence: {
      ...(value.validationEvidence ?? {}),
      evaluator: "v2_pricing_formula_v1",
      expressionFingerprint: `sha256:${createHash("sha256").update(expression).digest("hex")}`,
    },
  };
};

/** Applies a revision's typed input contract to a ProductVersion-owned value map. */
export const validateFormulaInputValues = (declaredInputs: readonly FormulaDeclaredInput[], values: Readonly<Record<string, unknown>>): Readonly<Record<string, FormulaInputValue>> => {
  const declarations = new Map(declaredInputs.map((input) => [input.key, input]));
  for (const key of Object.keys(values)) if (!declarations.has(key)) throw new V2ApplicationError("VALIDATION_ERROR", `Formula input '${key}' is not declared by this Formula revision.`);
  const result: Record<string, FormulaInputValue> = {};
  for (const input of declaredInputs) {
    const value = values[input.key] ?? input.defaultValue;
    if (value === undefined) { if (input.required) throw new V2ApplicationError("VALIDATION_ERROR", `Formula input '${input.label}' is required.`); continue; }
    if (!validInputValue(input.type, value)) throw new V2ApplicationError("VALIDATION_ERROR", `Formula input '${input.label}' has an invalid value.`);
    if (typeof value === "number" && ((input.minimum !== undefined && value < input.minimum) || (input.maximum !== undefined && value > input.maximum))) throw new V2ApplicationError("VALIDATION_ERROR", `Formula input '${input.label}' is outside its allowed range.`);
    result[input.key] = value;
  }
  return result;
};
/** Stable ProductVersion-binding validation entry point. */
export const validateFormulaRevisionInputValues = validateFormulaInputValues;

const positiveFinite = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new V2ApplicationError("VALIDATION_ERROR", `${label} must be a positive finite number.`);
  }
  return value;
};

/**
 * Evaluates a Formula through the same restricted V2 evaluator used by the
 * canonical pricing spine.  It has no transaction, persistence, or
 * ProductVersion dependency, so Formula Tester cannot accidentally mutate a
 * Formula or product while typing.
 */
export const evaluateFormulaDefinition = (input: FormulaEvaluationInput): FormulaEvaluationResult => {
  const definition = validateFormulaDefinition(input.definition);
  const width = positiveFinite(input.width, "Width");
  const height = positiveFinite(input.height, "Height");
  const quantity = positiveFinite(input.quantity, "Quantity");
  const requestedBasePrice = input.basePrice === undefined ? undefined : (() => {
    if (typeof input.basePrice !== "number" || !Number.isFinite(input.basePrice) || input.basePrice < 0) {
      throw new V2ApplicationError("VALIDATION_ERROR", "Base price must be a non-negative finite number.");
    }
    return input.basePrice;
  })();
  const inputValues = validateFormulaInputValues(definition.declaredInputs, input.inputValues ?? {});
  const declaredScope = Object.fromEntries(Object.entries(inputValues).map(([key, value]) => [key, typeof value === "boolean" ? (value ? 1 : 0) : value]));
  const declaredRate = [declaredScope.p, declaredScope.base_price, declaredScope.basePrice]
    .find((value): value is number => typeof value === "number" && Number.isFinite(value));
  const basePrice = requestedBasePrice ?? declaredRate ?? 1;
  const sqft = width * height / 144;
  // Runtime geometry remains authoritative even if an invalid old definition
  // attempted to declare one of these aliases.  Domain definitions are
  // otherwise allowed to declare p/base_price for legacy-compatible use.
  const variables = {
    ...declaredScope,
    w: width,
    h: height,
    q: quantity,
    width,
    height,
    quantity,
    sqft,
    total_sqft: sqft * quantity,
    totalSqft: sqft * quantity,
    base_price: basePrice,
    basePrice,
    p: basePrice,
  };
  try {
    const result = evaluateResolvedFormula(definition.expression, variables);
    if (!Number.isFinite(result)) throw new Error("Formula returned a non-finite result.");
    return { expression: definition.expression, result, width, height, quantity, inputValues, variables };
  } catch (error) {
    throw new V2ApplicationError("VALIDATION_ERROR", error instanceof Error ? `Formula could not be evaluated: ${error.message}` : "Formula could not be evaluated.");
  }
};

export type CreateFormulaInput = Readonly<{ businessRequestId: string; name: string; description?: string; visibility: FormulaVisibility; definition: FormulaRevisionDefinition }>;
export type ReviseFormulaInput = Readonly<{ businessRequestId: string; formulaId: string; expectedCurrentRevisionId: string; definition: FormulaRevisionDefinition }>;
export type UpdateFormulaMetadataInput = Readonly<{ businessRequestId: string; formulaId: string; expectedCurrentRevisionId: string; name: string; description?: string }>;
export type SetFormulaVisibilityInput = Readonly<{ businessRequestId: string; formulaId: string; expectedCurrentRevisionId: string; visibility: FormulaVisibility }>;
export type SetFormulaStatusInput = Readonly<{ businessRequestId: string; formulaId: string; expectedCurrentRevisionId: string; status: FormulaStatus }>;
/**
 * A ProductVersion that is already commercial history can be bound once to
 * the immutable FormulaRevision it was proven to use.  This is deliberately
 * separate from Draft authoring: it cannot edit the ProductVersion tree or
 * retarget an existing binding.
 */
export type HistoricalFormulaLifecycle = "ACTIVE" | "DEPRECATED";
export type HistoricalFormulaFreezeInput = Readonly<{
  businessRequestId: string;
  productVersionId: string;
  formulaRevisionId: string;
  inputValues: Readonly<Record<string, FormulaInputValue>>;
  /** Optional optimistic assertion for a reconciliation plan. */
  expectedLifecycle?: HistoricalFormulaLifecycle;
}>;
export type HistoricalFormulaRevisionBinding = Readonly<{
  organizationId: string;
  productId: string;
  productVersionId: string;
  lifecycle: HistoricalFormulaLifecycle;
  formulaId: string;
  formulaRevisionId: string;
  inputValues: Readonly<Record<string, FormulaInputValue>>;
  createdAt: string;
  createdByUserId?: string;
}>;
type Actor = Readonly<{ principalKind: PrincipalKind; principalSubject: string; staffActorUserId?: string }>;
export interface FormulaDomainTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string }> & Actor): Promise<Readonly<{ kind: "new" | "resumed" | "replay"; request: Readonly<{ id: string; resultJson: unknown | null }> }>>;
  create(input: Readonly<{ organizationId: string; name: string; description?: string; visibility: FormulaVisibility; definition: FormulaRevisionDefinition; staffActorUserId?: string }>): Promise<FormulaIdentity>;
  revise(input: Readonly<{ organizationId: string; formulaId: string; expectedCurrentRevisionId: string; definition: FormulaRevisionDefinition; staffActorUserId?: string }>): Promise<FormulaIdentity>;
  updateMetadata(input: Readonly<{ organizationId: string; formulaId: string; expectedCurrentRevisionId: string; name: string; description?: string; staffActorUserId?: string }>): Promise<FormulaIdentity>;
  setVisibility(input: Readonly<{ organizationId: string; formulaId: string; expectedCurrentRevisionId: string; visibility: FormulaVisibility; staffActorUserId?: string }>): Promise<FormulaIdentity>;
  setStatus(input: Readonly<{ organizationId: string; formulaId: string; expectedCurrentRevisionId: string; status: FormulaStatus; staffActorUserId?: string }>): Promise<FormulaIdentity>;
  freezeHistoricalBinding(input: Readonly<{ organizationId: string; productVersionId: string; formulaRevisionId: string; inputValues: Readonly<Record<string, FormulaInputValue>>; expectedLifecycle?: HistoricalFormulaLifecycle; staffActorUserId?: string }>): Promise<HistoricalFormulaRevisionBinding>;
  attribute(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; resourceType?: "formula" | "product_version" }> & Actor): Promise<void>;
  audit(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; resourceType?: "formula" | "product_version"; event: string; changes?: readonly Readonly<Record<string, unknown>>[] }> & Actor): Promise<void>;
  succeed(organizationId: string, requestId: string, resourceId: string, result: FormulaIdentity): Promise<void>;
  succeedHistoricalFreeze(organizationId: string, requestId: string, resourceId: string, result: HistoricalFormulaRevisionBinding): Promise<void>;
}
export interface FormulaDomainTransactionRunner { transaction<T>(work: (tx: FormulaDomainTransaction) => Promise<T>): Promise<T>; }

const actor = (context: OperationContext): Actor => ({ principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
const fingerprint = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const historicalFreezeFingerprint = (input: HistoricalFormulaFreezeInput): string => fingerprint({
  ...input,
  productVersionId: input.productVersionId.trim(),
  formulaRevisionId: input.formulaRevisionId.trim(),
  inputValues: Object.fromEntries(Object.entries(input.inputValues).sort(([left], [right]) => left.localeCompare(right))),
});
const statusOk = (value: unknown): value is FormulaStatus => value === "active" || value === "inactive" || value === "archived";
const visibilityOk = (value: unknown): value is FormulaVisibility => value === "product_scoped" || value === "library";
const historicalLifecycleOk = (value: unknown): value is HistoricalFormulaLifecycle => value === "ACTIVE" || value === "DEPRECATED";

/** Canonical Formula authoring. Every definition edit appends an immutable revision. */
export class FormulaDomainApplicationService {
  constructor(private readonly runner: FormulaDomainTransactionRunner, private readonly authority = new AuthorityPolicy()) {}
  async create(context: OperationContext, input: CreateFormulaInput): Promise<ApplicationResult<FormulaIdentity>> { return this.run(context, input.businessRequestId, "pricing.formula.create.v1", input, (tx, a) => tx.create({ organizationId: context.organizationId, name: label(input.name, "Formula name"), ...(optionalText(input.description, "Formula description") ? { description: optionalText(input.description, "Formula description") } : {}), visibility: visibilityOk(input.visibility) ? input.visibility : (() => { throw new V2ApplicationError("VALIDATION_ERROR", "Formula visibility is invalid."); })(), definition: validateFormulaDefinition(input.definition), staffActorUserId: a.staffActorUserId }), "formula_created"); }
  async revise(context: OperationContext, input: ReviseFormulaInput): Promise<ApplicationResult<FormulaIdentity>> { return this.run(context, input.businessRequestId, "pricing.formula.revise.v1", input, (tx, a) => { if (!input.formulaId.trim() || !input.expectedCurrentRevisionId.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "A current Formula revision is required."); return tx.revise({ organizationId:context.organizationId,formulaId:input.formulaId,expectedCurrentRevisionId:input.expectedCurrentRevisionId,definition:validateFormulaDefinition(input.definition),staffActorUserId:a.staffActorUserId }); }, "formula_revised"); }
  async updateMetadata(context: OperationContext, input: UpdateFormulaMetadataInput): Promise<ApplicationResult<FormulaIdentity>> { return this.run(context, input.businessRequestId, "pricing.formula.metadata.v1", input, (tx, a) => { if (!input.formulaId.trim() || !input.expectedCurrentRevisionId.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "A current Formula revision is required."); return tx.updateMetadata({ organizationId: context.organizationId, formulaId: input.formulaId, expectedCurrentRevisionId: input.expectedCurrentRevisionId, name: label(input.name, "Formula name"), ...(optionalText(input.description, "Formula description") ? { description: optionalText(input.description, "Formula description") } : {}), staffActorUserId: a.staffActorUserId }); }, "formula_metadata_changed"); }
  async setVisibility(context: OperationContext, input: SetFormulaVisibilityInput): Promise<ApplicationResult<FormulaIdentity>> { return this.run(context,input.businessRequestId,"pricing.formula.visibility.v1",input,(tx,a)=>{if(!input.formulaId.trim()||!input.expectedCurrentRevisionId.trim()||!visibilityOk(input.visibility))throw new V2ApplicationError("VALIDATION_ERROR","A current Formula and valid visibility are required.");return tx.setVisibility({...input,organizationId:context.organizationId,staffActorUserId:a.staffActorUserId});},"formula_visibility_changed"); }
  async setStatus(context: OperationContext, input: SetFormulaStatusInput): Promise<ApplicationResult<FormulaIdentity>> { return this.run(context,input.businessRequestId,"pricing.formula.status.v1",input,(tx,a)=>{if(!input.formulaId.trim()||!input.expectedCurrentRevisionId.trim()||!statusOk(input.status))throw new V2ApplicationError("VALIDATION_ERROR","A current Formula and valid status are required.");return tx.setStatus({...input,organizationId:context.organizationId,staffActorUserId:a.staffActorUserId});},"formula_status_changed"); }
  /**
   * Appends the first immutable FormulaRevision binding to a historical
   * ProductVersion.  It is intentionally an internal reconciliation command,
   * not a Product Builder mutation path.
   */
  async freezeHistoricalProductVersion(context: OperationContext, input: HistoricalFormulaFreezeInput): Promise<ApplicationResult<HistoricalFormulaRevisionBinding>> {
    try {
      requireOperationPrincipalScope(context);
      if (!input.businessRequestId?.trim() || context.businessRequest?.id !== input.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      if (!input.productVersionId?.trim() || !input.formulaRevisionId?.trim() || !input.inputValues || typeof input.inputValues !== "object" || Array.isArray(input.inputValues)) throw new V2ApplicationError("VALIDATION_ERROR", "A ProductVersion, Formula revision, and Formula input values are required.");
      if (input.expectedLifecycle !== undefined && !historicalLifecycleOk(input.expectedLifecycle)) throw new V2ApplicationError("VALIDATION_ERROR", "Historical Formula freeze lifecycle is invalid.");
      if (!this.authority.decide(context.principal, { capability: "pricing.configure", resource: { organizationId: context.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "You do not have permission to freeze historical Formula revisions.");
      const a = actor(context), operation = "pricing.formula.historical_freeze.v1";
      const result = await this.runner.transaction(async tx => {
        const request = await tx.reserve({ organizationId: context.organizationId, operation, businessRequestId: input.businessRequestId, payloadFingerprint: historicalFreezeFingerprint(input), ...a });
        if (request.kind === "replay") return request.request.resultJson as HistoricalFormulaRevisionBinding;
        const saved = await tx.freezeHistoricalBinding({ organizationId: context.organizationId, productVersionId: input.productVersionId.trim(), formulaRevisionId: input.formulaRevisionId.trim(), inputValues: input.inputValues, ...(input.expectedLifecycle ? { expectedLifecycle: input.expectedLifecycle } : {}), staffActorUserId: a.staffActorUserId });
        await tx.attribute({ organizationId: context.organizationId, requestId: request.request.id, operation, resourceType: "product_version", resourceId: saved.productVersionId, ...a });
        await tx.audit({ organizationId: context.organizationId, requestId: request.request.id, operation, resourceType: "product_version", resourceId: saved.productVersionId, event: "historical_formula_revision_frozen", changes: [{ field: "formulaRevisionId", value: saved.formulaRevisionId }, { field: "formulaId", value: saved.formulaId }, { field: "inputValues", value: saved.inputValues }], ...a });
        await tx.succeedHistoricalFreeze(context.organizationId, request.request.id, saved.productVersionId, saved);
        return saved;
      });
      return success(result);
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", "Historical Formula revision could not be frozen."));
    }
  }
  private async run(context:OperationContext,requestId:string,operation:string,input:unknown,work:(tx:FormulaDomainTransaction,a:Actor)=>Promise<FormulaIdentity>,event:string):Promise<ApplicationResult<FormulaIdentity>> { try { requireOperationPrincipalScope(context); if(!requestId?.trim()||context.businessRequest?.id!==requestId) throw new V2ApplicationError("VALIDATION_ERROR","A matching business request identity is required."); if(!this.authority.decide(context.principal,{capability:"pricing.configure",resource:{organizationId:context.organizationId}}).allowed) throw new V2ApplicationError("FORBIDDEN","You do not have permission to configure Formulas."); const a=actor(context); const result=await this.runner.transaction(async tx=>{const request=await tx.reserve({organizationId:context.organizationId,operation,businessRequestId:requestId,payloadFingerprint:fingerprint(input),...a});if(request.kind==="replay")return request.request.resultJson as FormulaIdentity;const saved=await work(tx,a);await tx.attribute({organizationId:context.organizationId,requestId:request.request.id,operation,resourceId:saved.formulaId,...a});await tx.audit({organizationId:context.organizationId,requestId:request.request.id,operation,resourceId:saved.formulaId,event,...a});await tx.succeed(context.organizationId,request.request.id,saved.formulaId,saved);return saved;});return success(result);}catch(error){return failure(error instanceof V2ApplicationError?error:new V2ApplicationError("CONFLICT","Formula could not be saved."));} }
}
