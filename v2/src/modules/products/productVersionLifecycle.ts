import { createHash } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { validateProductionUnitSpecification, type ProductionUnitSpecification } from "../shared/productionRequirements.js";
import type { OperatorPricingExplanation } from "../pricing/operatorPricingExplanation.js";
import type { ProductFormulaInput } from "./productFormulaInputs.js";

export type ProductVersionStatus = "active" | "draft" | "deprecated" | "archived";
export type ProductVersionSummary = Readonly<{
  productVersionId: string;
  status: ProductVersionStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  editable: boolean;
}>;
export type ProductVersionLifecycle = Readonly<{
  active?: ProductVersionSummary;
  draft?: ProductVersionSummary;
  history: readonly ProductVersionSummary[];
  historyLimit: number;
  historyHasMore: boolean;
  canCreateDraft: boolean;
}>;

export type CreateProductDraftInput = Readonly<{
  productId: string;
  businessRequestId: string;
  expectedActiveVersionUpdatedAt: string;
}>;
/** Creates a Product identity only together with its first editable Draft. */
export type CreateProductWithInitialDraftInput = Readonly<{ displayName: string; businessRequestId: string }>;
export type CreatedProductWithInitialDraft = Readonly<{ productId: string; draftVersionId: string; draftUpdatedAt: string }>;
export type ProductMeasurementMode = "dimensions_required" | "quantity_only";
export type ProductWorkflowIntent = "standard_production" | "fulfillment_only" | "service_fee";
export type ProductDraftGeneral = Readonly<{
  displayName: string;
  category: string | null;
  description: string | null;
  storefrontVisible: boolean;
  measurementMode: ProductMeasurementMode;
  workflowIntent: ProductWorkflowIntent;
  requiresProofApproval: boolean;
  requiresProductionJob: boolean;
  productionUnitSpecification: ProductionUnitSpecification | null;
}>;
export type ProductDraftGeneralRead = Readonly<{
  productId: string;
  draftVersionId: string;
  draftUpdatedAt: string;
  lifecycle: "draft";
  general: ProductDraftGeneral;
}>;
export type UpdateProductDraftGeneralInput = Readonly<{
  productId: string;
  draftVersionId: string;
  expectedDraftUpdatedAt: string;
  businessRequestId: string;
  general: ProductDraftGeneral;
}>;
export type ProductDraftOptionInputType = "boolean" | "select" | "multiselect" | "number" | "text" | "textarea";
export type ProductDraftOptionDefault = string | number | boolean | null | readonly string[];
export type ProductDraftOptionChoice = Readonly<{ choiceValue: string; label: string }>;
export type ProductDraftOption = Readonly<{
  optionId: string;
  label: string;
  inputType: ProductDraftOptionInputType;
  required: boolean;
  defaultValue: ProductDraftOptionDefault;
  choices: readonly ProductDraftOptionChoice[];
  canRemove: boolean;
  removalReason?: string;
}>;
export type ProductDraftOptionsRead = Readonly<{
  productId: string;
  draftVersionId: string;
  draftUpdatedAt: string;
  lifecycle: "draft";
  options: readonly ProductDraftOption[];
}>;
export type UpdateProductDraftOptionsInput = Readonly<{
  productId: string;
  draftVersionId: string;
  expectedDraftUpdatedAt: string;
  businessRequestId: string;
  options: readonly ProductDraftOption[];
}>;
export type ProductDraftPricingMode = "simple_base" | "simple_with_tiers" | "matrix" | "formula" | "advanced" | "unconfigured";
export type ProductDraftPricingTier = Readonly<{ tierId: string; minimum: number; maximum: number | null; perPieceCents: number | null; perSqftCents: number | null; minimumChargeCents: number | null }>;
export type ProductDraftPricing = Readonly<{ productId: string; draftVersionId: string; draftUpdatedAt: string; lifecycle: "draft"; measurementMode: ProductMeasurementMode; mode: ProductDraftPricingMode; editable: boolean; unavailableReason?: string; base: Readonly<{ perPieceCents: number | null; perSqftCents: number | null; minimumChargeCents: number | null }>; tierBasis: "quantity" | "square_foot" | "computed_sheet_usage" | null; tiers: readonly ProductDraftPricingTier[] }>;
/** Operator-facing projection of a Draft-only parity calculation. */
export type ProductDraftPricingPreview = Readonly<{ quantity: number; dimensions?: Readonly<{ width: number; height: number; unit: "in"; areaSquareFeet: number }>; calculatedUnitAmount: Readonly<{ cents: number; currency: string }>; calculatedLineAmount: Readonly<{ cents: number; currency: string }>; minimumChargeApplied: boolean; tier?: Readonly<{ basis: "quantity" | "square_foot" | "computed_sheet"; value: string }>; breakdown: readonly Readonly<{ label: string; cents: number; currency: string }>[]; explanation: OperatorPricingExplanation; warnings: readonly string[] }>;
export type ProductDraftPricingMatrixDimension = Readonly<{ selectionKey: string; label: string; values: readonly Readonly<{ value: string | number | boolean; label: string }>[] }>;
export type ProductDraftPricingMatrixRow = Readonly<{ rowId: string; combination: Readonly<Record<string, string | number | boolean>>; baseRateCents: number; tierBasis: "quantity" | "computed_sheet_usage" | null; tiers: readonly ProductDraftPricingTier[] }>;
export type ProductDraftPricingMatrix = Readonly<{ productId: string; draftVersionId: string; draftUpdatedAt: string; lifecycle: "draft"; editable: boolean; unavailableReason?: string; matrixId: string; pricingUnit: "per_piece" | "per_square_foot"; dimensions: readonly ProductDraftPricingMatrixDimension[]; rows: readonly ProductDraftPricingMatrixRow[]; warnings: readonly string[] }>;
export type UpdateProductDraftPricingMatrixInput = Readonly<{ productId: string; draftVersionId: string; expectedDraftUpdatedAt: string; businessRequestId: string; matrixId: string; pricingUnit: "per_piece" | "per_square_foot"; dimensions: readonly string[]; rows: readonly ProductDraftPricingMatrixRow[] }>;
export type ProductDraftFormulaPricing = Readonly<{ productId:string; draftVersionId:string; draftUpdatedAt:string; lifecycle:"draft"; source:"embedded_editable"|"library_product_inputs_editable"|"library_reference_read_only"|"unsupported_legacy"; editable:boolean; expressionEditable:boolean; variablesEditable:boolean; inputs:readonly ProductFormulaInput[]; unavailableReason?:string; formulaId?:string; formulaName?:string; expression:string; variables:Readonly<Record<string,number>>; supportedRuntimeVariables:readonly string[]; warnings:readonly string[] }>;
export type UpdateProductDraftFormulaPricingInput = Readonly<{ productId:string; draftVersionId:string; expectedDraftUpdatedAt:string; businessRequestId:string; expression:string; variables:Readonly<Record<string,number>> }>;
export type ProductDraftOptionPricingImpact=Readonly<{type:"fixed"|"per_item"|"per_square_foot"|"percent_of_base"|"multiplier";value:number}>;
export type ProductDraftOptionPricing=Readonly<{productId:string;draftVersionId:string;draftUpdatedAt:string;lifecycle:"draft";options:readonly Readonly<{optionId:string;selectionKey:string;label:string;nodeImpact:ProductDraftOptionPricingImpact|null;choices:readonly Readonly<{choiceValue:string;label:string;impact:ProductDraftOptionPricingImpact|null;editable:boolean;readOnlyReason?:string}>[]}>[]}>;
export type UpdateProductDraftOptionPricingInput=Readonly<{productId:string;draftVersionId:string;expectedDraftUpdatedAt:string;businessRequestId:string;optionId:string;choiceValue?:string;impact:ProductDraftOptionPricingImpact|null}>;
export type UpdateProductDraftPricingInput = Readonly<{ productId: string; draftVersionId: string; expectedDraftUpdatedAt: string; businessRequestId: string; base: ProductDraftPricing["base"]; tierBasis: ProductDraftPricing["tierBasis"]; tiers: readonly ProductDraftPricingTier[] }>;
type DraftCreateReservation = Readonly<{
  kind: "new" | "resumed" | "replay";
  request: Readonly<{ id: string; resultJson: unknown | null }>;
}>;
export interface ProductVersionTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string; principalKind: "staff" | "delegated_ai" | "portal" | "service"; principalSubject: string; staffActorUserId?: string }>): Promise<DraftCreateReservation>;
  createDraftFromActive(input: Readonly<{ organizationId: string; productId: string; expectedActiveVersionUpdatedAt: string; staffActorUserId?: string }>): Promise<Readonly<{ draftId: string; lifecycle: ProductVersionLifecycle }>>;
  createProductWithInitialDraft?(input: Readonly<{ organizationId: string; displayName: string; staffActorUserId?: string }>): Promise<CreatedProductWithInitialDraft>;
  succeed(organizationId: string, requestId: string, draftId: string, result: unknown): Promise<void>;
  attribute(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; principalKind: "staff" | "delegated_ai" | "portal" | "service"; principalSubject: string; staffActorUserId?: string }>): Promise<void>;
  audit(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; principalKind: "staff" | "delegated_ai" | "portal" | "service"; principalSubject: string; staffActorUserId?: string }>): Promise<void>;
  updateDraftGeneral?(input: Readonly<{ organizationId: string; productId: string; draftVersionId: string; expectedDraftUpdatedAt: string; general: ProductDraftGeneral; staffActorUserId?: string }>): Promise<ProductDraftGeneralRead>;
  auditDraftGeneral?(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; principalKind: "staff" | "delegated_ai" | "portal" | "service"; principalSubject: string; staffActorUserId?: string; changedFields: readonly string[] }>): Promise<void>;
  updateDraftOptions?(input: Readonly<{ organizationId: string; productId: string; draftVersionId: string; expectedDraftUpdatedAt: string; options: readonly ProductDraftOption[]; staffActorUserId?: string }>): Promise<ProductDraftOptionsRead>;
  auditDraftOptions?(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; principalKind: "staff" | "delegated_ai" | "portal" | "service"; principalSubject: string; changedFields: readonly string[] }>): Promise<void>;
  updateDraftPricing?(input: Readonly<{ organizationId: string; productId: string; draftVersionId: string; expectedDraftUpdatedAt: string; base: ProductDraftPricing["base"]; tierBasis: ProductDraftPricing["tierBasis"]; tiers: readonly ProductDraftPricingTier[]; staffActorUserId?: string }>): Promise<ProductDraftPricing>;
  auditDraftPricing?(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; principalKind: "staff" | "delegated_ai" | "portal" | "service"; principalSubject: string; changedFields: readonly string[] }>): Promise<void>;
  updateDraftPricingMatrix?(input: Readonly<{ organizationId: string; productId: string; draftVersionId: string; expectedDraftUpdatedAt: string; matrix: UpdateProductDraftPricingMatrixInput; staffActorUserId?: string }>): Promise<ProductDraftPricingMatrix>;
  auditDraftPricingMatrix?(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; principalKind: "staff" | "delegated_ai" | "portal" | "service"; principalSubject: string; changedFields: readonly string[] }>): Promise<void>;
  updateDraftFormulaPricing?(input:Readonly<{organizationId:string;productId:string;draftVersionId:string;expectedDraftUpdatedAt:string;formula:UpdateProductDraftFormulaPricingInput;staffActorUserId?:string}>):Promise<ProductDraftFormulaPricing>;
  auditDraftFormulaPricing?(input:Readonly<{organizationId:string;requestId:string;operation:string;resourceId:string;principalKind:"staff"|"delegated_ai"|"portal"|"service";principalSubject:string;changedFields:readonly string[]}>):Promise<void>;
  updateDraftOptionPricing?(input:Readonly<{organizationId:string;productId:string;draftVersionId:string;expectedDraftUpdatedAt:string;optionPricing:UpdateProductDraftOptionPricingInput;staffActorUserId?:string}>):Promise<ProductDraftOptionPricing>;
  auditDraftOptionPricing?(input:Readonly<{organizationId:string;requestId:string;operation:string;resourceId:string;principalKind:"staff"|"delegated_ai"|"portal"|"service";principalSubject:string;changedFields:readonly string[]}>):Promise<void>;
}
export interface ProductVersionTransactionRunner { transaction<T>(action: (tx: ProductVersionTransaction) => Promise<T>): Promise<T>; }

const operation = "product.version.createDraft.v1";
const createProductOperation = "product.createWithDraft.v1";
const updateGeneralOperation = "product.draft.general.update.v1";
const updateOptionsOperation = "product.draft.options.update.v1";
const updatePricingOperation = "product.draft.pricing.update.v1";
const updatePricingMatrixOperation = "product.draft.pricingMatrix.update.v1";
const updateFormulaPricingOperation = "product.draft.pricingFormula.update.v1";
const updateOptionPricingOperation="product.draft.optionPricing.update.v1";
const actor = (context: OperationContext) => ({ principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
const fingerprint = (input: CreateProductDraftInput) => createHash("sha256").update(JSON.stringify({ productId: input.productId, expectedActiveVersionUpdatedAt: input.expectedActiveVersionUpdatedAt })).digest("hex");
const generalFingerprint = (input: UpdateProductDraftGeneralInput) => createHash("sha256").update(JSON.stringify({ productId: input.productId, draftVersionId: input.draftVersionId, expectedDraftUpdatedAt: input.expectedDraftUpdatedAt, general: input.general })).digest("hex");
const optionsFingerprint = (input: UpdateProductDraftOptionsInput) => createHash("sha256").update(JSON.stringify({ productId: input.productId, draftVersionId: input.draftVersionId, expectedDraftUpdatedAt: input.expectedDraftUpdatedAt, options: input.options })).digest("hex");
const pricingFingerprint = (input: UpdateProductDraftPricingInput) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const matrixFingerprint = (input: UpdateProductDraftPricingMatrixInput) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const formulaFingerprint = (input: UpdateProductDraftFormulaPricingInput) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const optionPricingFingerprint=(input:UpdateProductDraftOptionPricingInput)=>createHash("sha256").update(JSON.stringify(input)).digest("hex");
const validPricing = (input: UpdateProductDraftPricingInput) => { const cents=(value:number|null)=>{if(value!==null&&(!Number.isSafeInteger(value)||value<0||value>100000000))throw new V2ApplicationError("VALIDATION_ERROR","Pricing values must be non-negative whole cents.");};cents(input.base.perPieceCents);cents(input.base.perSqftCents);cents(input.base.minimumChargeCents);if(input.base.perPieceCents!==null&&input.base.perSqftCents!==null)throw new V2ApplicationError("VALIDATION_ERROR","Choose either per-piece or per-square-foot pricing.");if(input.tierBasis!==null&&input.tierBasis!=="quantity"&&input.tierBasis!=="square_foot")throw new V2ApplicationError("VALIDATION_ERROR","This tier basis is not editable.");let prior=0;for(const tier of input.tiers){if(!Number.isSafeInteger(tier.minimum)||tier.minimum<1||tier.minimum<=prior||(tier.maximum!==null&&(!Number.isSafeInteger(tier.maximum)||tier.maximum<tier.minimum)))throw new V2ApplicationError("VALIDATION_ERROR","Tier thresholds are invalid.");prior=tier.minimum;cents(tier.perPieceCents);cents(tier.perSqftCents);cents(tier.minimumChargeCents);if(tier.perPieceCents!==null&&tier.perSqftCents!==null)throw new V2ApplicationError("VALIDATION_ERROR","A tier cannot combine per-piece and per-square-foot rates.");}return input;};
const validGeneral = (general: ProductDraftGeneral): ProductDraftGeneral => {
  const text = (value: unknown, label: string, max: number, nullable = false): string | null => {
    if (nullable && (value === null || value === undefined || value === "")) return null;
    if (typeof value !== "string") throw new V2ApplicationError("VALIDATION_ERROR", `${label} is invalid.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > max) throw new V2ApplicationError("VALIDATION_ERROR", `${label} is invalid.`);
    return normalized;
  };
  const displayName = text(general.displayName, "Product name", 160)!;
  const category = text(general.category, "Category", 100, true);
  const description = text(general.description, "Description", 2000, true);
  if (typeof general.storefrontVisible !== "boolean" || typeof general.requiresProofApproval !== "boolean" || typeof general.requiresProductionJob !== "boolean")
    throw new V2ApplicationError("VALIDATION_ERROR", "Product settings are invalid.");
  if (general.measurementMode !== "dimensions_required" && general.measurementMode !== "quantity_only") throw new V2ApplicationError("VALIDATION_ERROR", "Measurement mode is invalid.");
  if (general.workflowIntent !== "standard_production" && general.workflowIntent !== "fulfillment_only" && general.workflowIntent !== "service_fee") throw new V2ApplicationError("VALIDATION_ERROR", "Workflow is invalid.");
  if (general.workflowIntent !== "standard_production" && (general.requiresProofApproval || general.requiresProductionJob)) throw new V2ApplicationError("VALIDATION_ERROR", "This workflow cannot require proofing or production.");
  const productionUnitSpecification=general.productionUnitSpecification==null?null:validateProductionUnitSpecification(general.productionUnitSpecification);
  return { displayName, category, description, storefrontVisible: general.storefrontVisible, measurementMode: general.measurementMode, workflowIntent: general.workflowIntent, requiresProofApproval: general.requiresProofApproval, requiresProductionJob: general.requiresProductionJob, productionUnitSpecification };
};
const optionTypes: readonly ProductDraftOptionInputType[] = ["boolean", "select", "multiselect", "number", "text", "textarea"];
const choiceBased = (type: ProductDraftOptionInputType) => type === "select" || type === "multiselect";
const validOptions = (options: readonly ProductDraftOption[]): readonly ProductDraftOption[] => {
  if (!Array.isArray(options) || options.length > 100) throw new V2ApplicationError("VALIDATION_ERROR", "Product options are invalid.");
  const ids = new Set<string>();
  return options.map((option, index) => {
    if (!option || typeof option !== "object" || typeof option.optionId !== "string" || !option.optionId.trim() || ids.has(option.optionId)) throw new V2ApplicationError("VALIDATION_ERROR", "Product options are invalid.");
    ids.add(option.optionId);
    const label = typeof option.label === "string" ? option.label.trim() : "";
    if (!label || label.length > 160 || !optionTypes.includes(option.inputType) || typeof option.required !== "boolean" || !Array.isArray(option.choices) || option.choices.length > 100) throw new V2ApplicationError("VALIDATION_ERROR", "Product options are invalid.");
    const choices = option.choices.map((choice: ProductDraftOptionChoice) => {
      if (!choice || typeof choice.choiceValue !== "string" || typeof choice.label !== "string" || choice.label.trim().length === 0 || choice.label.trim().length > 160) throw new V2ApplicationError("VALIDATION_ERROR", "A choice is invalid.");
      return { choiceValue: choice.choiceValue.trim(), label: choice.label.trim() };
    });
    if (new Set(choices.map((choice: ProductDraftOptionChoice) => choice.choiceValue).filter(Boolean)).size !== choices.filter((choice: ProductDraftOptionChoice) => choice.choiceValue).length) throw new V2ApplicationError("VALIDATION_ERROR", "Choice values must be unique.");
    if (!choiceBased(option.inputType) && choices.length) throw new V2ApplicationError("VALIDATION_ERROR", "This option type does not use choices.");
    if (choiceBased(option.inputType)) {
      if (!choices.length) throw new V2ApplicationError("VALIDATION_ERROR", "A choice-based option needs at least one choice.");
      if (option.inputType === "select" && option.defaultValue !== null && (typeof option.defaultValue !== "string" || !choices.some((choice: ProductDraftOptionChoice) => choice.choiceValue === option.defaultValue))) throw new V2ApplicationError("VALIDATION_ERROR", "Choose a valid default choice.");
      if (option.inputType === "multiselect" && option.defaultValue !== null && (!Array.isArray(option.defaultValue) || option.defaultValue.some((value: unknown) => typeof value !== "string" || !choices.some((choice: ProductDraftOptionChoice) => choice.choiceValue === value)))) throw new V2ApplicationError("VALIDATION_ERROR", "Choose valid default choices.");
    } else if (option.inputType === "boolean" && option.defaultValue !== null && typeof option.defaultValue !== "boolean") throw new V2ApplicationError("VALIDATION_ERROR", "A Boolean option needs a Boolean default.");
    else if (option.inputType === "number" && option.defaultValue !== null && (typeof option.defaultValue !== "number" || !Number.isFinite(option.defaultValue))) throw new V2ApplicationError("VALIDATION_ERROR", "A Number option needs a numeric default.");
    else if ((option.inputType === "text" || option.inputType === "textarea") && option.defaultValue !== null && typeof option.defaultValue !== "string") throw new V2ApplicationError("VALIDATION_ERROR", "A text option needs a text default.");
    return { ...option, label, choices, defaultValue: option.defaultValue };
  });
};

/** Product configuration drafts are a PBV2 lifecycle concern. This service never changes an ACTIVE tree or Product pointer. */
export class ProductVersionLifecycleApplicationService {
  constructor(private readonly runner: ProductVersionTransactionRunner, private readonly authority = new AuthorityPolicy()) {}

  async createDraft(context: OperationContext, input: CreateProductDraftInput): Promise<ApplicationResult<ProductVersionLifecycle>> {
    try {
      requireOperationPrincipalScope(context);
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId)
        throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      if (!input.productId || !input.businessRequestId || Number.isNaN(Date.parse(input.expectedActiveVersionUpdatedAt)))
        throw new V2ApplicationError("VALIDATION_ERROR", "A Product, business request, and current Active version state are required.");
      if (!this.authority.decide(context.principal, { capability: "product.edit", resource: { organizationId: context.organizationId } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to create a Product Draft.");
      const value = await this.runner.transaction(async (tx) => {
        const request = await tx.reserve({ organizationId: context.organizationId, operation, businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), ...actor(context) });
        if (request.kind === "replay") return request.request.resultJson as ProductVersionLifecycle;
        const created = await tx.createDraftFromActive({ organizationId: context.organizationId, productId: input.productId, expectedActiveVersionUpdatedAt: input.expectedActiveVersionUpdatedAt, staffActorUserId: staffActorId(context.principal) });
        await tx.attribute({ organizationId: context.organizationId, requestId: request.request.id, operation, resourceId: created.draftId, ...actor(context) });
        await tx.audit({ organizationId: context.organizationId, requestId: request.request.id, operation, resourceId: created.draftId, ...actor(context) });
        await tx.succeed(context.organizationId, request.request.id, created.draftId, created.lifecycle);
        return created.lifecycle;
      });
      return success(value);
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", error instanceof Error ? error.message : "Product Draft could not be created."));
    }
  }

  async createProductWithInitialDraft(context: OperationContext, input: CreateProductWithInitialDraftInput): Promise<ApplicationResult<CreatedProductWithInitialDraft>> {
    try {
      requireOperationPrincipalScope(context);
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      const displayName = input.displayName.trim();
      if (!displayName || displayName.length > 160) throw new V2ApplicationError("VALIDATION_ERROR", "Product name is invalid.");
      if (!this.authority.decide(context.principal, { capability: "product.edit", resource: { organizationId: context.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to create a Product.");
      const value = await this.runner.transaction(async (tx) => {
        if (!tx.createProductWithInitialDraft) throw new V2ApplicationError("CONFLICT", "Product creation is unavailable.");
        const request = await tx.reserve({ organizationId: context.organizationId, operation: createProductOperation, businessRequestId: input.businessRequestId, payloadFingerprint: createHash("sha256").update(JSON.stringify({ displayName })).digest("hex"), ...actor(context) });
        if (request.kind === "replay") return request.request.resultJson as CreatedProductWithInitialDraft;
        const created = await tx.createProductWithInitialDraft({ organizationId: context.organizationId, displayName, staffActorUserId: staffActorId(context.principal) });
        await tx.attribute({ organizationId: context.organizationId, requestId: request.request.id, operation: createProductOperation, resourceId: created.productId, ...actor(context) });
        await tx.audit({ organizationId: context.organizationId, requestId: request.request.id, operation: createProductOperation, resourceId: created.productId, ...actor(context) });
        await tx.succeed(context.organizationId, request.request.id, created.productId, created);
        return created;
      });
      return success(value);
    } catch (error) { return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", error instanceof Error ? error.message : "Product could not be created.")); }
  }

  async updateDraftGeneral(context: OperationContext, input: UpdateProductDraftGeneralInput): Promise<ApplicationResult<ProductDraftGeneralRead>> {
    try {
      requireOperationPrincipalScope(context);
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      if (!input.productId || !input.draftVersionId || !input.businessRequestId || Number.isNaN(Date.parse(input.expectedDraftUpdatedAt))) throw new V2ApplicationError("VALIDATION_ERROR", "A Draft and its current revision are required.");
      if (!this.authority.decide(context.principal, { capability: "product.edit", resource: { organizationId: context.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to edit this Product Draft.");
      const general = validGeneral(input.general);
      const value = await this.runner.transaction(async (tx) => {
        if (!tx.updateDraftGeneral || !tx.auditDraftGeneral) throw new V2ApplicationError("CONFLICT", "Product Draft editing is unavailable.");
        const request = await tx.reserve({ organizationId: context.organizationId, operation: updateGeneralOperation, businessRequestId: input.businessRequestId, payloadFingerprint: generalFingerprint({ ...input, general }), ...actor(context) });
        if (request.kind === "replay") return request.request.resultJson as ProductDraftGeneralRead;
        const updated = await tx.updateDraftGeneral({ organizationId: context.organizationId, productId: input.productId, draftVersionId: input.draftVersionId, expectedDraftUpdatedAt: input.expectedDraftUpdatedAt, general, staffActorUserId: staffActorId(context.principal) });
        const changedFields = Object.keys(general);
        await tx.attribute({ organizationId: context.organizationId, requestId: request.request.id, operation: updateGeneralOperation, resourceId: updated.draftVersionId, ...actor(context) });
        await tx.auditDraftGeneral({ organizationId: context.organizationId, requestId: request.request.id, operation: updateGeneralOperation, resourceId: updated.draftVersionId, changedFields, ...actor(context) });
        await this.succeedGeneral(tx, context.organizationId, request.request.id, updated.draftVersionId, updated);
        return updated;
      });
      return success(value);
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", error instanceof Error ? error.message : "Product Draft could not be saved."));
    }
  }

  async updateDraftOptions(context: OperationContext, input: UpdateProductDraftOptionsInput): Promise<ApplicationResult<ProductDraftOptionsRead>> {
    try {
      requireOperationPrincipalScope(context);
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      if (!input.productId || !input.draftVersionId || !input.businessRequestId || Number.isNaN(Date.parse(input.expectedDraftUpdatedAt))) throw new V2ApplicationError("VALIDATION_ERROR", "A Draft and its current revision are required.");
      if (!this.authority.decide(context.principal, { capability: "product.edit", resource: { organizationId: context.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to edit this Product Draft.");
      const options = validOptions(input.options);
      const value = await this.runner.transaction(async (tx) => {
        if (!tx.updateDraftOptions || !tx.auditDraftOptions) throw new V2ApplicationError("CONFLICT", "Product Draft option editing is unavailable.");
        const request = await tx.reserve({ organizationId: context.organizationId, operation: updateOptionsOperation, businessRequestId: input.businessRequestId, payloadFingerprint: optionsFingerprint({ ...input, options }), ...actor(context) });
        if (request.kind === "replay") return request.request.resultJson as ProductDraftOptionsRead;
        const updated = await tx.updateDraftOptions({ organizationId: context.organizationId, productId: input.productId, draftVersionId: input.draftVersionId, expectedDraftUpdatedAt: input.expectedDraftUpdatedAt, options, staffActorUserId: staffActorId(context.principal) });
        await tx.attribute({ organizationId: context.organizationId, requestId: request.request.id, operation: updateOptionsOperation, resourceId: updated.draftVersionId, ...actor(context) });
        await tx.auditDraftOptions({ organizationId: context.organizationId, requestId: request.request.id, operation: updateOptionsOperation, resourceId: updated.draftVersionId, changedFields: ["options"], ...actor(context) });
        await tx.succeed(context.organizationId, request.request.id, updated.draftVersionId, updated);
        return updated;
      });
      return success(value);
    } catch (error) { return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", error instanceof Error ? error.message : "Product Draft options could not be saved.")); }
  }

  async updateDraftPricing(context: OperationContext, input: UpdateProductDraftPricingInput): Promise<ApplicationResult<ProductDraftPricing>> { try { requireOperationPrincipalScope(context);if(!context.businessRequest||context.businessRequest.id!==input.businessRequestId)throw new V2ApplicationError("VALIDATION_ERROR","A matching business request identity is required.");if(!this.authority.decide(context.principal,{capability:"product.edit",resource:{organizationId:context.organizationId}}).allowed)throw new V2ApplicationError("FORBIDDEN","The principal does not have authority to edit this Product Draft.");validPricing(input);const value=await this.runner.transaction(async tx=>{if(!tx.updateDraftPricing||!tx.auditDraftPricing)throw new V2ApplicationError("CONFLICT","Product Draft pricing editing is unavailable.");const request=await tx.reserve({organizationId:context.organizationId,operation:updatePricingOperation,businessRequestId:input.businessRequestId,payloadFingerprint:pricingFingerprint(input),...actor(context)});if(request.kind==="replay")return request.request.resultJson as ProductDraftPricing;const updated=await tx.updateDraftPricing({...input,organizationId:context.organizationId,staffActorUserId:staffActorId(context.principal)});await tx.attribute({organizationId:context.organizationId,requestId:request.request.id,operation:updatePricingOperation,resourceId:updated.draftVersionId,...actor(context)});await tx.auditDraftPricing({organizationId:context.organizationId,requestId:request.request.id,operation:updatePricingOperation,resourceId:updated.draftVersionId,changedFields:["base","tiers"],...actor(context)});await tx.succeed(context.organizationId,request.request.id,updated.draftVersionId,updated);return updated;});return success(value);}catch(error){return failure(error instanceof V2ApplicationError?error:new V2ApplicationError("CONFLICT",error instanceof Error?error.message:"Product Draft pricing could not be saved."));} }
  async updateDraftPricingMatrix(context: OperationContext, input: UpdateProductDraftPricingMatrixInput): Promise<ApplicationResult<ProductDraftPricingMatrix>> { try { requireOperationPrincipalScope(context);if(!context.businessRequest||context.businessRequest.id!==input.businessRequestId)throw new V2ApplicationError("VALIDATION_ERROR","A matching business request identity is required.");if(!this.authority.decide(context.principal,{capability:"product.edit",resource:{organizationId:context.organizationId}}).allowed)throw new V2ApplicationError("FORBIDDEN","The principal does not have authority to edit this Product Draft.");const value=await this.runner.transaction(async tx=>{if(!tx.updateDraftPricingMatrix||!tx.auditDraftPricingMatrix)throw new V2ApplicationError("CONFLICT","Product Draft matrix editing is unavailable.");const request=await tx.reserve({organizationId:context.organizationId,operation:updatePricingMatrixOperation,businessRequestId:input.businessRequestId,payloadFingerprint:matrixFingerprint(input),...actor(context)});if(request.kind==="replay")return request.request.resultJson as ProductDraftPricingMatrix;const updated=await tx.updateDraftPricingMatrix({organizationId:context.organizationId,productId:input.productId,draftVersionId:input.draftVersionId,expectedDraftUpdatedAt:input.expectedDraftUpdatedAt,matrix:input,staffActorUserId:staffActorId(context.principal)});await tx.attribute({organizationId:context.organizationId,requestId:request.request.id,operation:updatePricingMatrixOperation,resourceId:updated.draftVersionId,...actor(context)});await tx.auditDraftPricingMatrix({organizationId:context.organizationId,requestId:request.request.id,operation:updatePricingMatrixOperation,resourceId:updated.draftVersionId,changedFields:["dimensions","rows","rates"],...actor(context)});await tx.succeed(context.organizationId,request.request.id,updated.draftVersionId,updated);return updated;});return success(value);}catch(error){return failure(error instanceof V2ApplicationError?error:new V2ApplicationError("CONFLICT",error instanceof Error?error.message:"Product Draft matrix could not be saved."));} }
  async updateDraftFormulaPricing(context:OperationContext,input:UpdateProductDraftFormulaPricingInput):Promise<ApplicationResult<ProductDraftFormulaPricing>>{try{requireOperationPrincipalScope(context);if(!context.businessRequest||context.businessRequest.id!==input.businessRequestId)throw new V2ApplicationError("VALIDATION_ERROR","A matching business request identity is required.");if(!this.authority.decide(context.principal,{capability:"product.edit",resource:{organizationId:context.organizationId}}).allowed)throw new V2ApplicationError("FORBIDDEN","The principal does not have authority to edit this Product Draft.");const value=await this.runner.transaction(async tx=>{if(!tx.updateDraftFormulaPricing||!tx.auditDraftFormulaPricing)throw new V2ApplicationError("CONFLICT","Product Draft Formula editing is unavailable.");const request=await tx.reserve({organizationId:context.organizationId,operation:updateFormulaPricingOperation,businessRequestId:input.businessRequestId,payloadFingerprint:formulaFingerprint(input),...actor(context)});if(request.kind==="replay")return request.request.resultJson as ProductDraftFormulaPricing;const updated=await tx.updateDraftFormulaPricing({organizationId:context.organizationId,productId:input.productId,draftVersionId:input.draftVersionId,expectedDraftUpdatedAt:input.expectedDraftUpdatedAt,formula:input,staffActorUserId:staffActorId(context.principal)});await tx.attribute({organizationId:context.organizationId,requestId:request.request.id,operation:updateFormulaPricingOperation,resourceId:updated.draftVersionId,...actor(context)});await tx.auditDraftFormulaPricing({organizationId:context.organizationId,requestId:request.request.id,operation:updateFormulaPricingOperation,resourceId:updated.draftVersionId,changedFields:updated.expressionEditable?["expression","variables"]:["variables"],...actor(context)});await tx.succeed(context.organizationId,request.request.id,updated.draftVersionId,updated);return updated;});return success(value);}catch(error){return failure(error instanceof V2ApplicationError?error:new V2ApplicationError("CONFLICT",error instanceof Error?error.message:"Product Draft Formula could not be saved."));}}
  async updateDraftOptionPricing(context:OperationContext,input:UpdateProductDraftOptionPricingInput):Promise<ApplicationResult<ProductDraftOptionPricing>>{try{requireOperationPrincipalScope(context);if(!context.businessRequest||context.businessRequest.id!==input.businessRequestId)throw new V2ApplicationError("VALIDATION_ERROR","A matching business request identity is required.");if(!this.authority.decide(context.principal,{capability:"product.edit",resource:{organizationId:context.organizationId}}).allowed)throw new V2ApplicationError("FORBIDDEN","The principal does not have authority to edit this Product Draft.");if(!input.optionId||input.impact&&(!Number.isFinite(input.impact.value)||input.impact.value<0))throw new V2ApplicationError("VALIDATION_ERROR","Option pricing is invalid.");const value=await this.runner.transaction(async tx=>{if(!tx.updateDraftOptionPricing||!tx.auditDraftOptionPricing)throw new V2ApplicationError("CONFLICT","Product Draft option pricing editing is unavailable.");const request=await tx.reserve({organizationId:context.organizationId,operation:updateOptionPricingOperation,businessRequestId:input.businessRequestId,payloadFingerprint:optionPricingFingerprint(input),...actor(context)});if(request.kind==="replay")return request.request.resultJson as ProductDraftOptionPricing;const updated=await tx.updateDraftOptionPricing({organizationId:context.organizationId,productId:input.productId,draftVersionId:input.draftVersionId,expectedDraftUpdatedAt:input.expectedDraftUpdatedAt,optionPricing:input,staffActorUserId:staffActorId(context.principal)});await tx.attribute({organizationId:context.organizationId,requestId:request.request.id,operation:updateOptionPricingOperation,resourceId:updated.draftVersionId,...actor(context)});await tx.auditDraftOptionPricing({organizationId:context.organizationId,requestId:request.request.id,operation:updateOptionPricingOperation,resourceId:updated.draftVersionId,changedFields:[input.choiceValue===undefined?"option_pricing":"choice_pricing"],...actor(context)});await tx.succeed(context.organizationId,request.request.id,updated.draftVersionId,updated);return updated;});return success(value);}catch(error){return failure(error instanceof V2ApplicationError?error:new V2ApplicationError("CONFLICT",error instanceof Error?error.message:"Product Draft option pricing could not be saved."));}}
  private async succeedGeneral(tx: ProductVersionTransaction, organizationId: string, requestId: string, draftVersionId: string, result: ProductDraftGeneralRead) {
    await tx.succeed(organizationId, requestId, draftVersionId, result);
  }
}
