import type { ProductOptionRule } from "../../../shared/productOptionRules";

export type ApiError = Readonly<{ code: string; message: string }>;
export type SalesTaxJurisdiction = Readonly<{ jurisdictionId: string; name: string; countryCode: string; regionCode: string; postalCode?: string; rateBasisPoints: number; active: boolean; homeBusiness: boolean; destinationMethods?: readonly ("shipping"|"local_delivery")[]; updatedAt: string }>;
export type SalesTaxSettings = Readonly<{ homeBusiness?: SalesTaxJurisdiction; destinationJurisdictions: readonly SalesTaxJurisdiction[]; readiness: Readonly<{ status:"ready"|"needs_attention"; pickup: Readonly<{status:string; jurisdictionName?:string; rateBasisPoints?:number; reason?:string}>; shipping: Readonly<{status:string; jurisdictionName?:string; rateBasisPoints?:number; reason?:string}>; localDelivery: Readonly<{status:string; jurisdictionName?:string; rateBasisPoints?:number; reason?:string}> }>; revision:string }>;
export type EmailIntegrationReadiness = Readonly<{ provider: "gmail"; status: "not_configured" | "ready" | "reauth_required" | "error"; sendingAddress?: string; displayName?: string; lastValidatedAt?: string; actionRequired?: string; legacyAvailable?: boolean }>;
export type OrganizationAddress = Readonly<{ line1?: string; line2?: string; city?: string; region?: string; postalCode?: string; country?: string }>;
export type OrganizationSettings = Readonly<{ businessProfile: Readonly<{ displayName: string; legalName?: string; phone?: string; email?: string; website?: string; businessAddress: OrganizationAddress; pickupAddressSource: "business_address"; timeZone?: string; currency?: string }>; documentsBranding: Readonly<{ logo: Readonly<{ status: "configured" | "not_configured" }>; footerNote?: string; paymentInstructions?: string; checksPayableTo?: string; remittanceAddress?: OrganizationAddress }>; readiness: Readonly<{ status: "ready" | "needs_attention"; missing: readonly string[] }>; revision: string }>;
export type NumberingSettings = Readonly<{ revision: string; documents: readonly Readonly<{ kind: "quote" | "order"; prefix: string; nextNumber: string; nextDisplayNumber: string; status: "ready"; adoption: "native_v2" | "lazy_native_default" }>[]; sharedJobNumber: Readonly<{ owner: "order_number"; behavior: "order_display_number"; configurableSeparately: false }>; compatibility: Readonly<{ legacyQuoteOrder: "converged"; legacyInvoice: "native_job_derived"; legacyPurchaseOrder: "compatibility_managed"; importedHistoricalDocuments: "preserved" }>; readiness: Readonly<{ status: "ready" | "migration_required" | "needs_attention"; reasons: readonly string[] }> }>;
export type TeamCapabilityGroup = Readonly<{ key: string; label: string; capabilities: readonly string[] }>;
export type TeamPermissionSet = Readonly<{ permissionSetId: string; name: string; description?: string; active: boolean; revision: string; principalKind: "staff" | "portal"; systemManaged: boolean; sourceTemplateKey?: string; capabilities: readonly string[]; assignmentCount: number }>;
export type TeamAccessRead = Readonly<{ authorityRevision: string; staff: readonly Readonly<{ memberId: string; displayName: string; email: string; status: "active" | "disabled"; permissionSets: readonly string[]; administratorCapable: boolean; allowedActions?: readonly string[] }>[]; invitations: readonly Readonly<{ invitationId: string; email: string; requestedLegacyRole?: "admin" | "manager" | "member"; status: "accepted" | "expired" | "pending"; deliveryState: string; expiresAt: string; createdAt: string }>[]; permissionSets: readonly TeamPermissionSet[]; portalAccess: readonly Readonly<{ portalAccessId: string; customerId: string; contactId?: string; customerName: string; contactName: string; email: string; status: string; deliveryState: string; permissionSets: readonly string[] }>[]; portalCandidates: readonly Readonly<{ customerId: string; customerName: string; contactId: string; contactName: string; email?: string; eligibility: string; portalAccessId?: string; portalStatus?: string }>[]; readiness: Readonly<{ status: "ready" | "needs_attention"; reasons: readonly string[]; activeStaffCount: number; viableAdministratorCount: number; pendingInvitationCount: number }>; capabilityGroups: readonly TeamCapabilityGroup[] }>;
export type QuoteSendReadiness = Readonly<{ recipient: Readonly<{ status: "ready" | "contact_missing" | "email_missing" | "contact_unavailable"; email?: string }>; tax: Readonly<{ status: "ready" | "unresolved" }>; routability: Readonly<{ status: "ready" | "unroutable"; productNames?: readonly string[] }>; email: EmailIntegrationReadiness; canSend: boolean }>;
export type QuoteSellingInstruction = Readonly<
  | { kind: "calculated" }
  | { kind: "unit_override"; unitCents: number; reason: string }
  | { kind: "total_override"; totalCents: number; reason: string }
  | { kind: "discount"; discountBasisPoints: number; reason: string }
>;
export type QuoteSellingPriceDecision = Readonly<{
  kind:
    "calculated" | "unit_override" | "total_override" | "discount" | "locked";
  reason?: string;
  discountBasisPoints?: number;
}>;
export type SalesLine = Readonly<{
  lineId: string;
  position: number;
  productId: string;
  description: string;
  quantity: number;
  resolvedConfiguration: Readonly<Record<string, unknown>>;
  calculatedUnitAmount: { cents: number; currency: string };
  calculatedLineAmount: { cents: number; currency: string };
  sellingUnitAmount: { cents: number; currency: string };
  sellingLineAmount: { cents: number; currency: string };
  sellingPriceDecision: QuoteSellingPriceDecision;
  taxability?: { taxable: boolean; source: string };
}>;
export type QuoteLine = SalesLine;
export type OrderLine = SalesLine;
export type QuoteRead = Readonly<{
  quote: {
    quoteId: string;
    customerContact: {
      organizationId: string;
      customerId: string;
      contactId?: string;
    };
    purchaseOrderNumber?: string;
    requestedDueDate?: string;
    terms: { termsCode?: string; commercialNotes?: string };
    currency: string;
    expiresAt?: string;
    deliveryState: "not_sent" | "sent";
    acceptanceState: "not_accepted" | "accepted";
    lifecycleState?: "open" | "declined" | "voided";
    convertedOrderId?: string;
    requestedFulfillment?: { method: "pickup" | "shipping" | "local_delivery"; destination?: { addressLine1: string; city: string; region?: string; country?: string; postalCode?: string; recipient?: string; company?: string; phone?: string }; instructions?: string };
    sellingAdjustment?: { cents: number; reason: string };
    commercialCharge?: { kind: "shipping" | "delivery" | "handling" | "packing" | "crating" | "postage"; cents: number; description?: string };
    taxComposition?: { status: "resolved" | "unresolved"; taxCents?: number; finalTotalCents: number; taxableBaseCents?: number; taxableLineCents?: number; nonTaxableLineCents?: number; jurisdiction?: { name: string; rateBasisPoints: number }; reason?: string };
    lines: QuoteLine[];
  };
  number: { display: string; core: string };
  revision: string;
  checkpoints: readonly {
    checkpointId: string;
    kind: string;
    occurredAt: string;
  }[];
  totals: {
    currency: string;
    calculatedLineAmount: { cents: number; currency: string };
    sellingLineAmount: { cents: number; currency: string };
    tax?: QuoteRead["quote"]["taxComposition"];
  };
}>;
export type QuoteResult = Readonly<{ quote: QuoteRead; checkpointId?: string }>;
export type QuoteAcceptanceResult = Readonly<{
  quote: QuoteRead;
  quoteId: string;
  sourceCheckpointId: string;
  conversionCheckpointId: string;
  orderId: string;
  draftInvoiceId: string;
  orderNumber: string;
}>;
export type UiBootstrap = Readonly<{
  organizationId: string;
  csrfToken: string;
  /** Opaque session epoch, never a user/principal/capability claim. */
  sessionScope: string;
  capabilities: Readonly<{
    quoteView?: boolean;
    customerView?: boolean;
    customerEdit?: boolean;
    productView?: boolean;
    productEdit?: boolean;
    /** Formula-domain authoring is deliberately separate from Product editing. */
    pricingConfigure?: boolean;
    organizationConfigure?: boolean;
    numberingConfigure?: boolean;
    communicationsConfigure?: boolean;
    permissionsView?: boolean;
    permissionsManageSets?: boolean;
    permissionsAssignStaff?: boolean;
    permissionsAssignPortal?: boolean;
    quoteOverridePrice: boolean;
    quoteCreate?: boolean;
    quoteEdit?: boolean;
    quoteSend?: boolean;
    quoteConvert?: boolean;
    orderView?: boolean;
    orderCreate?: boolean;
    orderEdit?: boolean;
    orderCancel?: boolean;
    orderOverridePrice?: boolean;
    invoiceView?: boolean;
    invoiceIssue?: boolean;
    paymentView?: boolean;
    paymentRecord?: boolean;
    refundIssue?: boolean;
    artworkView?: boolean;
    artworkAssign?: boolean;
    proofView?: boolean;
    proofPrepare?: boolean;
    proofIssue?: boolean;
    proofRespond?: boolean;
    prepressView?: boolean;
    prepressWork?: boolean;
    prepressComplete?: boolean;
    productionView?: boolean;
    productionWork?: boolean;
    productionComplete?: boolean;
    inventoryView?: boolean;
    inventoryReceive?: boolean;
    fulfillmentView?: boolean;
    fulfillmentPickup?: boolean;
    fulfillmentShip?: boolean;
    routeView?: boolean;
    routeAdvance?: boolean;
  }>;
}>;
export type SalesListPage<T> = Readonly<{
  items: readonly T[];
  nextCursor?: string;
  summary?: Readonly<{
    itemCount: number;
    sellingTotalCents?: number;
    currencies: readonly string[];
  }>;
}>;
export type ProductLifecycle =
  "active" | "inactive" | "draft" | "active_with_draft";
export type ProductCatalogItem = Readonly<{
  productId: string;
  displayName: string;
  category?: string;
  lifecycle: ProductLifecycle;
  measurementMode: "dimensions_required" | "quantity_only";
  pricingSummary: string;
  productType?: Readonly<{
    displayName: string;
    routePolicy: "route_required" | "no_route" | "unconfigured";
  }>;
  primaryMaterialName?: string;
  activeVersion?: Readonly<{ label: string; publishedAt?: string }>;
  hasDraft: boolean;
}>;
export type ProductionRequirementPreview =
  | Readonly<{
      state: "configured";
      specificationFingerprint: string;
      units: readonly Readonly<{
        key: string;
        side?: "front" | "back";
        sourcePageIndex?: number;
        layerKey?: string;
        layerOrder?: number;
      }>[];
    }>
  | Readonly<{ state: "unconfigured"; reason: "product_specification_absent" }>;
export type ProductVersionSummary = Readonly<{
  productVersionId: string;
  status: "active" | "draft" | "deprecated" | "archived";
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
export type ProductActiveDefinition = Readonly<{
  productVersionId: string;
  options: readonly Readonly<{
    label: string;
    inputType: string;
    required: boolean;
    defaultLabel?: string;
    choices: readonly Readonly<{
      label: string;
      value: string | number | boolean;
    }>[];
  }>[];
  pricing: Readonly<{
    mode: "unconfigured" | "simple" | "formula" | "matrix" | "matrix_formula";
    perPieceCents?: number;
    perSquareFootCents?: number;
    minimumChargeCents?: number;
    tierBasis?: "quantity" | "square_foot" | "computed_sheet_usage";
    tiers: readonly Readonly<{
      minimum: number;
      maximum: number | null;
      perPieceCents?: number;
      perSquareFootCents?: number;
      minimumChargeCents?: number;
    }>[];
    formula?: Readonly<{
      name?: string;
      expression: string;
      variables: Readonly<Record<string, number>>;
    }>;
    matrix?: Readonly<{
      pricingUnit: "per_piece" | "per_square_foot";
      dimensions: readonly string[];
      rows: readonly Readonly<{
        selections: readonly string[];
        baseRateCents: number;
        tierCount: number;
        computedSheetTiers: boolean;
      }>[];
    }>;
  }>;
  recipe: readonly Readonly<{
    componentId: string;
    materialName: string;
    materialSku?: string;
    quantity: string;
    unit: string;
    basis: string;
    condition?: string;
    replacesCompatibility: boolean;
  }>[];
  productionUnits: readonly Readonly<{
    key: string;
    side?: string;
    condition?: string;
  }>[];
  routing?: Readonly<{
    mode: "route_required" | "no_route" | "unconfigured";
    templateName?: string;
    revision?: string;
    fingerprint?: string;
    steps: readonly string[];
  }>;
}>;
export type ProductProductionUnitRule = Readonly<{
  key: string;
  side?: "front" | "back";
  sourcePageIndex?: number;
  layerKey?: string;
  layerOrder?: number;
  when?: Readonly<{ selectionKey: string; equals: string | number | boolean }>;
}>;
export type ProductProductionUnitSpecification = Readonly<{
  schemaVersion: 1;
  rules: readonly ProductProductionUnitRule[];
}>;
export type ProductDraftGeneral = Readonly<{
  displayName: string;
  category: string | null;
  description: string | null;
  storefrontVisible: boolean;
  measurementMode: "dimensions_required" | "quantity_only";
  workflowIntent: "standard_production" | "fulfillment_only" | "service_fee";
  requiresProofApproval: boolean;
  requiresProductionJob: boolean;
  productionUnitSpecification: ProductProductionUnitSpecification | null;
}>;
export type ProductDraftGeneralRead = Readonly<{
  productId: string;
  draftVersionId: string;
  draftUpdatedAt: string;
  lifecycle: "draft";
  general: ProductDraftGeneral;
}>;
export type ProductDraftOptionInputType =
  "boolean" | "select" | "multiselect" | "number" | "text" | "textarea";
export type ProductDraftOption = Readonly<{
  optionId: string;
  selectionKey: string;
  label: string;
  inputType: ProductDraftOptionInputType;
  required: boolean;
  defaultValue: string | number | boolean | null | readonly string[];
  choices: readonly Readonly<{ choiceValue: string; label: string; visibilityRules?: readonly unknown[] }>[];
  visibility?: Readonly<{ rules?: readonly unknown[] }>;
  canRemove: boolean;
  removalReason?: string;
}>;
export type ProductDraftOptionsRead = Readonly<{
  productId: string;
  draftVersionId: string;
  draftUpdatedAt: string;
  lifecycle: "draft";
  options: readonly ProductDraftOption[];
  optionRules: readonly ProductOptionRule[];
}>;
export type ProductDraftPricingTier = Readonly<{
  tierId: string;
  minimum: number;
  maximum: number | null;
  perPieceCents: number | null;
  perSqftCents: number | null;
  minimumChargeCents: number | null;
}>;
export type ProductDraftPricingTierSets = Readonly<{
  quantity: readonly ProductDraftPricingTier[];
  squareFoot: readonly ProductDraftPricingTier[];
  computedSheetUsage: readonly ProductDraftPricingTier[];
}>;
export type ProductDraftPricing = Readonly<{
  productId: string;
  draftVersionId: string;
  draftUpdatedAt: string;
  lifecycle: "draft";
  measurementMode: "dimensions_required" | "quantity_only";
  mode:
    | "simple_base"
    | "simple_with_tiers"
    | "matrix"
    | "formula"
    | "advanced"
    | "unconfigured";
  editable: boolean;
  unavailableReason?: string;
  base: Readonly<{
    perPieceCents: number | null;
    perSqftCents: number | null;
    minimumChargeCents: number | null;
  }>;
  flatFeeCents: number | null;
  tierBasis: "quantity" | "square_foot" | "computed_sheet_usage" | null;
  tiers: readonly ProductDraftPricingTier[];
  tierSets: ProductDraftPricingTierSets;
}>;
export type PricingExplanation = Readonly<{
  dimensions?: Readonly<{
    widthIn: string;
    heightIn: string;
    areaPerPieceSqft: string;
    totalAreaSqft: string;
  }>;
  computedSheetUsage?: Readonly<{
    sheetCount: number;
    billedSquareFeet?: number;
    allowRotation?: boolean;
    productAllowsRotation?: boolean;
    optionAllowsRotation?: boolean;
    effectiveRotation?: boolean;
    rotationControl?: Readonly<{
      optionId: string;
      selectionKey: string;
      selectedChoiceValues: readonly string[];
      allowWhenChoiceValues: readonly string[];
    }>;
  }>;
  tier?: Readonly<{
    basis: "quantity" | "square_foot" | "computed_sheet";
    value: string;
    selectedTierId: string;
    rateCents: number;
  }>;
  matrix?: Readonly<{ rowId: string; selectedValues: readonly string[] }>;
  formula?: Readonly<{
    source: "library" | "embedded";
    expression: string;
    baseRateCents?: number;
  }>;
  optionImpacts: readonly Readonly<{
    selectionKey: string;
    kind: string;
    cents: number;
  }>[];
  minimumChargeApplied: boolean;
}>;
export type ProductDraftPricingPreview = Readonly<{
  quantity: number;
  dimensions?: Readonly<{
    width: number;
    height: number;
    unit: "in";
    areaSquareFeet: number;
  }>;
  calculatedUnitAmount: Readonly<{ cents: number; currency: string }>;
  calculatedLineAmount: Readonly<{ cents: number; currency: string }>;
  minimumChargeApplied: boolean;
  tier?: Readonly<{
    basis: "quantity" | "square_foot" | "computed_sheet";
    value: string;
  }>;
  breakdown: readonly Readonly<{
    label: string;
    cents: number;
    currency: string;
  }>[];
  explanation: PricingExplanation;
  warnings: readonly string[];
  configuration: Readonly<{
    effectiveSelections: Readonly<Record<string, unknown>>;
    visibleOptionSelectionKeys: readonly string[];
    hiddenOptionSelectionKeys: readonly string[];
    disabledOptionSelectionKeys: readonly string[];
    requiredOptionSelectionKeys: readonly string[];
    clearedOptionSelectionKeys: readonly string[];
    defaultedOptionSelectionKeys: readonly string[];
  }>;
}>;
export type ProductDraftPricingMatrix = Readonly<{
  productId: string;
  draftVersionId: string;
  draftUpdatedAt: string;
  lifecycle: "draft";
  editable: boolean;
  unavailableReason?: string;
  active: boolean;
  matrixId: string;
  pricingUnit: "per_piece" | "per_square_foot";
  availableDimensions: readonly Readonly<{
    selectionKey: string;
    label: string;
    values: readonly Readonly<{
      value: string | number | boolean;
      label: string;
    }>[];
  }>[];
  dimensions: readonly Readonly<{
    selectionKey: string;
    label: string;
    values: readonly Readonly<{
      value: string | number | boolean;
      label: string;
    }>[];
  }>[];
  rows: readonly Readonly<{
    rowId: string;
    combination: Record<string, string | number | boolean>;
    baseRateCents: number | null;
    tierBasis: "quantity" | "computed_sheet_usage" | null;
    tiers: readonly ProductDraftPricingTier[];
  }>[];
  warnings: readonly string[];
}>;
export type ProductRotationControl = Readonly<{
  optionId: string;
  allowWhenChoiceValues: readonly string[];
}>;
export type ProductDraftFormulaPricing = Readonly<{
  productId: string;
  draftVersionId: string;
  draftUpdatedAt: string;
  lifecycle: "draft";
  source:
    | "none"
    | "formula_revision"
    | "embedded_editable"
    | "library_product_inputs_editable"
    | "library_reference_read_only"
    | "unsupported_legacy";
  editable: boolean;
  expressionEditable: boolean;
  variablesEditable: boolean;
  rotationEditable: boolean;
  inputs: readonly Readonly<{
    key: string;
    label: string;
    type?: "number" | "integer" | "boolean";
    required?: boolean;
    defaultValue?: number | boolean;
    maximum?: number;
    unit?: "in" | "sq_ft";
    minimum?: number;
    exclusiveMinimum?: boolean;
  }>[];
  unavailableReason?: string;
  formulaId?: string;
  formulaRevisionId?: string;
  formulaRevisionNumber?: number;
  formulaName?: string;
  expression: string;
  legacyExpression?: string;
  canAdoptLegacyFormula?: boolean;
  variables: Record<string, number>;
  /** Present for canonical FormulaRevision bindings; omitted by temporary
   * legacy Formula compatibility reads. */
  inputValues?: Record<string, number | boolean>;
  allowRotation: boolean;
  rotationControl?: ProductRotationControl;
  supportedRuntimeVariables: readonly string[];
  warnings: readonly string[];
}>;
export type ProductFormulaLibraryEntry = Readonly<{
  id: string;
  name: string;
  code?: string | null;
  expression: string;
  config?: unknown;
}>;
/** Formula-domain read model. New authoring must use V2 Formula revisions,
 * not the mutable legacy `/api/pricing-formulas` endpoint. */
export type FormulaDomainListEntry = Readonly<{
  formulaId: string;
  name: string;
  description?: string;
  visibility: "product_scoped" | "library";
  /** Stable owner for an unlisted Formula. Omitted for reusable Formulae. */
  scopeProductId?: string;
  /** Tenant-scoped Product presentation for a Product-scoped Formula. */
  scopeProductName?: string;
  status: "active" | "inactive" | "archived";
  currentRevisionId: string;
  revision: FormulaDomainRevision;
  usageCount?: number;
  createdAt?: string;
  updatedAt?: string;
  createdByUserId?: string;
  createdByDisplayName?: string;
  updatedByUserId?: string;
  updatedByDisplayName?: string;
}>;
export type FormulaDomainRevision = Readonly<{
  formulaRevisionId: string;
  formulaId: string;
  organizationId: string;
  revisionNumber: number;
  expression: string;
  declaredInputs: readonly FormulaDomainDeclaredInput[];
  validationEvidence: Readonly<Record<string, unknown>>;
  createdAt: string;
  createdByUserId?: string;
  createdByDisplayName?: string;
}>;
export type FormulaDomainDeclaredInput = Readonly<{
  key: string;
  label: string;
  description?: string;
  type: "number" | "integer" | "boolean";
  required: boolean;
  defaultValue?: number | boolean;
  minimum?: number;
  maximum?: number;
  unit?: "in" | "sq_ft";
  authorable: boolean;
}>;
export type FormulaDomainDefinition = Readonly<{
  expression: string;
  declaredInputs: readonly FormulaDomainDeclaredInput[];
}>;
/** Server-authoritative, no-persistence Formula Tester contract. */
export type FormulaDomainEvaluationInput = Readonly<{
  definition: FormulaDomainDefinition;
  width: number;
  height: number;
  quantity: number;
  inputValues?: Readonly<Record<string, number | boolean>>;
  basePrice?: number;
}>;
export type FormulaDomainEvaluationResult = Readonly<{
  expression: string;
  result: number;
  width: number;
  height: number;
  quantity: number;
  inputValues: Readonly<Record<string, number | boolean>>;
  variables: Readonly<Record<string, number>>;
}>;
export type ProductDraftOptionPricingImpact =
  | Readonly<{
      type:
        | "fixed"
        | "per_item"
        | "per_square_foot"
        | "per_linear_foot"
        | "per_inch"
        | "percent_of_base"
        | "percent_of_options_subtotal"
        | "percent_of_line_subtotal"
        | "multiplier";
      value: number;
    }>
  | Readonly<{ type: "formula"; formula: string }>;
export type ProductDraftOptionPricingOverride = Readonly<{
  mode: "set" | "add" | "multiply";
  target: "per_square_foot" | "per_piece" | "minimum_charge";
  value: number;
}>;
export type ProductDraftOptionPricing = Readonly<{
  productId: string;
  draftVersionId: string;
  draftUpdatedAt: string;
  lifecycle: "draft";
  options: readonly Readonly<{
    optionId: string;
    selectionKey: string;
    label: string;
    nodeImpact: ProductDraftOptionPricingImpact | null;
    nodeImpacts: readonly ProductDraftOptionPricingImpact[];
    choices: readonly Readonly<{
      choiceValue: string;
      label: string;
      impact: ProductDraftOptionPricingImpact | null;
      impacts: readonly ProductDraftOptionPricingImpact[];
      override: ProductDraftOptionPricingOverride | null;
      editable: boolean;
      readOnlyReason?: string;
    }>[];
  }>[];
}>;
export type ProductRecipeComponent = Readonly<{
  componentId?: string;
  materialId: string;
  materialName?: string;
  materialSku?: string | null;
  quantity: string;
  unit: "each" | "square_foot" | "linear_foot" | "sheet" | "roll";
  quantityKind: "per_line" | "per_piece" | "per_area";
  condition?: Readonly<{
    type: "selected";
    optionId: string;
    choiceValue: string;
  }>;
  replacesPbv2Compatibility?: boolean;
}>;
export type ProductRecipe = Readonly<{
  recipeId: string;
  productId: string;
  productVersionId: string;
  draftUpdatedAt: string;
  lifecycle: "draft" | "active" | "historical";
  components: readonly ProductRecipeComponent[];
}>;
export type ProductDraftRouting = Readonly<{
  productId: string;
  draftVersionId: string;
  draftUpdatedAt: string;
  lifecycle: "draft";
  routing:
    | Readonly<{
        kind: "route_required";
        routeTemplateId: string;
        routeTemplateName: string;
        steps: readonly Readonly<{
          position: number;
          kind: "proofing" | "prepress" | "production" | "fulfillment";
        }>[];
        sourceTemplateRevision?: string;
        sourceTemplateFingerprint?: string;
      }>
    | Readonly<{ kind: "no_route" | "unconfigured" }>;
}>;
export type PublishedProductVersion = Readonly<{
  productId: string;
  productName: string;
  productVersionId: string;
  productUpdatedAt: string;
  productVersionUpdatedAt: string;
  publishedAt?: string;
  alreadyPublished: boolean;
  operationReference: "products.publish_configuration.v1";
}>;
export type ProductMaterial = Readonly<{
  materialId: string;
  name: string;
  sku: string | null;
  unit: ProductRecipeComponent["unit"];
}>;
export type ProductWorkspaceDetail = Readonly<
  ProductCatalogItem & {
    productUpdatedAt: string;
    description?: string;
    workflowIntent: "standard_production" | "fulfillment_only" | "service_fee";
    requiresProductionJob: boolean;
    requiresProofApproval: boolean;
    configurableOptionCount: number;
    activeDefinition?: ProductActiveDefinition;
    versions: ProductVersionLifecycle;
  }
>;
export type ProductCatalogPage = Readonly<{
  items: readonly ProductCatalogItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}>;
export type ProductRoutingReadiness = "ROUTABLE_VERSION_ROUTE" | "ROUTABLE_COMPATIBILITY_ROUTE" | "UNROUTABLE_NO_PRODUCT_TYPE" | "UNROUTABLE_PRODUCT_TYPE_NO_DEFAULT_ROUTE" | "UNROUTABLE_INVALID_ROUTE" | "NON_PRODUCTION_ROUTING_NOT_REQUIRED";
export type ProductRoutingCompatibility = Readonly<{
  productId:string; productName:string; productUpdatedAt:string; readiness:ProductRoutingReadiness;
  productTypeId?:string; productTypeName?:string; versionRouteName?:string; compatibilityRouteName?:string;
  productTypes:readonly Readonly<{productTypeId:string;name:string;updatedAt:string;defaultRoute?:Readonly<{routeTemplateId:string;name:string}>}>[];
  routeTemplates:readonly Readonly<{routeTemplateId:string;name:string;steps:readonly string[]}>[];
}>;
export type ProductRoutingReadinessAudit = Readonly<{products:readonly Readonly<{productId:string;productName:string;readiness:ProductRoutingReadiness;versionRouteName?:string;compatibilityRouteName?:string}>[];worklist:readonly Readonly<{productId:string;productName:string;workflowIntent:"standard_production";productTypeName?:string;exactVersionRouteStatus:string;productTypeDefaultRouteStatus:string;reason:string;remediation:"compatibility"|"version_routing"}>[];routeTemplates:readonly Readonly<{routeTemplateId:string;name:string;steps:readonly string[]}>[];counts:Readonly<{activeProducts:number;activeStandardProduction:number;routableByVersion:number;routableByCompatibility:number;unroutable:number}>}>;
export type CreatedProductWithInitialDraft = Readonly<{
  productId: string;
  draftVersionId: string;
  draftUpdatedAt: string;
}>;
export type FulfillmentMethod = "pickup" | "shipment";
export type FulfillmentPhysicalIntegrityAnomaly = Readonly<{
  code: "FULFILLMENT_HISTORY_EXCEEDS_RECORDED_PRODUCTION";
  completedProductionQuantity: number;
  completedFulfillmentQuantity: number;
  excessFulfillmentQuantity: number;
}>;
export type FulfillmentAvailability = Readonly<{
  orderId: string;
  orderLineId: string;
  orderedQuantity: number;
  completedPickupQuantity: number;
  completedShipmentQuantity: number;
  completedFulfillmentQuantity: number;
  completedProductionQuantity: number;
  availableFulfillmentQuantity: number;
  remainingProductionQuantity: number;
  remainingFulfillmentQuantity: number;
  physicalIntegrityAnomaly?: FulfillmentPhysicalIntegrityAnomaly;
}>;
export type FulfillmentWorkspaceOrder = Readonly<{
  orderId: string;
  number: string;
  commercialState: "open" | "cancelled";
  requestedFulfillment?: { method: "pickup" | "shipping" | "local_delivery"; destination?: { recipient?: string; company?: string; addressLine1: string; addressLine2?: string; city: string; region?: string; postalCode?: string; country?: string; phone?: string }; instructions?: string };
  customerName: string;
  customerId?: string;
  contactId?: string;
  requestedDueDate?: string;
  lines: readonly Readonly<{ description: string } & FulfillmentAvailability>[];
  handoffs: readonly Readonly<{
    handoff: Readonly<{
      handoffId: string;
      method: FulfillmentMethod;
      completedAt: string;
      completedPrincipalSubject: string;
    }>;
    allocations: readonly Readonly<{ orderLineId: string; quantity: number }>[];
    /** Only immutable handoffs created after document snapshots were introduced can be previewed. */
    documentAvailable?: boolean;
  }>[];
}>;
export type FulfillmentTerminalResult = Readonly<{
  handoff: Readonly<{
    handoffId: string;
    method: FulfillmentMethod;
    completedAt: string;
  }>;
  allocations: readonly Readonly<{ orderLineId: string; quantity: number }>[];
  availability: readonly FulfillmentAvailability[];
}>;
export type QuoteListItem = Readonly<{
  source: "v2" | "legacy";
  recordId: string;
  quoteId: string;
  number: string;
  customerDisplayName: string;
  purchaseOrderNumber?: string;
  lineCount?: number;
  lifecycle: string;
  sellingTotalCents: number;
  currency: string;
  requestedDueDate?: string;
  updatedAt: string;
  convertedOrderId?: string;
  convertedOrderNumber?: string;
}>;
export type OrderListItem = Readonly<{
  source: "v2" | "legacy";
  recordId: string;
  orderId: string;
  number: string;
  customerDisplayName: string;
  purchaseOrderNumber?: string;
  lineCount?: number;
  lifecycle: string;
  sellingTotalCents: number;
  currency: string;
  requestedDueDate?: string;
  updatedAt: string;
  draftInvoice?: { invoiceId: string; lifecycle: "draft"; totalCents: number };
  routing: "routed" | "no_route";
  activeRecordClassification?:
    | "CLOSED_HISTORY"
    | "ACTIVE_BUT_CAN_REMAIN_LEGACY"
    | "ACTIVE_REQUIRES_CUTOVER_STRATEGY"
    | "AMBIGUOUS";
}>;
export type OrderRead = Readonly<{
  order: Readonly<{
    organizationId: string;
    orderId: string;
    customerContact: {
      organizationId: string;
      customerId: string;
      contactId?: string;
    };
    purchaseOrderNumber?: string;
    requestedDueDate?: string;
    terms: { termsCode?: string; commercialNotes?: string };
    currency: string;
    commercialState: "open" | "cancelled";
    requestedFulfillment?: { method: "pickup" | "shipping" | "local_delivery"; destination?: { recipient?: string; company?: string; addressLine1: string; addressLine2?: string; city: string; region?: string; postalCode?: string; country?: string; phone?: string }; instructions?: string };
    sellingAdjustment?: { cents: number; reason: string };
    sourceQuoteId?: string;
    billingInvoiceReference?: string;
    lines: readonly OrderLine[];
  }>;
  number: { display: string; core: string };
  revision: string;
  totals: {
    calculated: { cents: number; currency: string };
    selling: { cents: number; currency: string };
  };
  draftInvoice?: {
    invoiceId: string;
    lifecycle: "draft";
    synchronizationVersion: string;
    lineCount: number;
    total: { cents: number; currency: string };
  };
  routes: readonly Readonly<{
    routeInstanceId?: string;
    work: { orderLineId: string };
    state: string;
    currentStepId?: string;
    currentPrerequisite?: Readonly<{ satisfied: boolean; reason?: string }>;
    steps: readonly Readonly<{
      routeInstanceStepId: string;
      position: number;
      kind: string;
    }>[];
  }>[];
}>;
export type OrderResult = Readonly<{
  order: OrderRead;
  draftInvoiceId: string;
  lineCorrelations?: readonly Readonly<{
    clientLineKey: string;
    orderLineId: string;
  }>[];
}>;
export type InvoiceRead = Readonly<{
  source?: "v2" | "legacy";
  readOnly?: true;
  invoiceId: string;
  organizationId: string;
  sourceOrderId: string;
  sourceOrderNumber?: string;
  customerId?: string;
  customerPresentation?: {
    customerDisplayName?: string;
    contactDisplayName?: string;
    companyName?: string;
    email?: string;
    phone?: string;
    billingAddress?: {
      lines: readonly string[];
      city?: string;
      region?: string;
      postalCode?: string;
      countryCode?: string;
    };
  };
  lifecycle: "draft" | "issued" | "void";
  synchronizationVersion: string;
  purchaseOrderNumber?: string;
  termsCode?: string;
  issuedAt?: string;
  createdAt: string;
  updatedAt: string;
  currency: string;
  lines: readonly Readonly<{
    sourceOrderLineId: string;
    productId: string;
    description: string;
    quantity: number;
    sellingUnitAmount: { cents: number; currency: string };
    lineAmount: { cents: number; currency: string };
  }>[];
  subtotal: { cents: number; currency: string };
  salesAdjustment?: { amount: { cents: number; currency: string }; reason: string };
  taxTotal: { cents: number; currency: string };
  total: { cents: number; currency: string };
}>;
export type InvoiceListItem = Readonly<{
  invoiceId: string;
  sourceOrderId: string;
  sourceOrderNumber: string;
  customerId?: string;
  lifecycle: InvoiceRead["lifecycle"];
  customerPresentation?: InvoiceRead["customerPresentation"];
  currency: string;
  total: InvoiceRead["total"];
  issuedAt?: string;
  updatedAt: string;
}>;
export type FinancialHistoryEntry = Readonly<{
  kind: "payment" | "refund";
  id: string;
  paymentId?: string;
  amount: { cents: number; currency: string };
  method?: string;
  source: "manual" | "provider";
  occurredAt: string;
  recordedAt: string;
  balanceAfter: { cents: number; currency: string };
}>;
export type FinancialInvoiceRead = Readonly<{
  invoice: InvoiceRead;
  settlement: {
    gross: InvoiceRead["total"];
    paid: InvoiceRead["total"];
    refunded: InvoiceRead["total"];
    balance: InvoiceRead["total"];
  };
  history: readonly FinancialHistoryEntry[];
}>;
export type FinancialInvoiceListItem = Readonly<{
  source: "v2" | "legacy";
  recordId: string;
  invoiceId: string;
  sourceOrderId: string;
  sourceOrderNumber: string;
  customerId?: string;
  customerName?: string;
  lifecycle: InvoiceRead["lifecycle"];
  settlement?: "unpaid" | "partially_paid" | "paid";
  currency: string;
  gross: InvoiceRead["total"];
  paid: InvoiceRead["total"];
  refunded: InvoiceRead["total"];
  balance: InvoiceRead["total"];
  issuedAt?: string;
  updatedAt: string;
}>;
export type FinancialLedgerEntry = FinancialHistoryEntry &
  Readonly<{
    recordSource: "v2" | "legacy";
    recordId: string;
    invoiceId: string;
    sourceOrderId: string;
    sourceOrderNumber: string;
    customerId?: string;
    customerName?: string;
  }>;
export type ArtworkOrderProjection = Readonly<{
  assignment: Readonly<{
    id: string;
    artworkFileId: string;
    orderId: string;
    orderLineId: string;
    purpose: "customer_supplied" | "production" | "proof" | "reference";
    side?: "front" | "back";
    sourcePageIndex?: number;
    layerKey?: string;
    layerOrder?: number;
    createdAt: string;
  }>;
  file: Readonly<{
    id: string;
    originalFilename: string;
    displayFilename: string;
    contentType: string;
    byteSize: number;
    source: "customer_upload" | "prepress_derived" | "imported";
    pageCount?: number;
    detectedWidthMicrons?: number;
    detectedHeightMicrons?: number;
    derivedFromArtworkFileId?: string;
    createdAt: string;
  }>;
}>;
/**
 * A Quote-line usage of the canonical Artwork file.  This is deliberately a
 * business association, not a second file representation: the file remains
 * owned by Artwork and can later be referenced by the converted Order.
 */
export type QuoteArtworkProjection = Readonly<{
  association: Readonly<{
    id: string;
    quoteId: string;
    quoteLineId: string;
    artworkFileId: string;
    purpose: "customer_supplied" | "production" | "proof" | "reference";
    side?: "front" | "back";
    sourcePageIndex?: number;
    layerKey?: string;
    layerOrder?: number;
    createdAt: string;
  }>;
  file: ArtworkOrderProjection["file"];
}>;
export type QuoteArtworkMutationResult = Readonly<{
  artworkFile: ArtworkOrderProjection["file"];
  assignment: QuoteArtworkProjection["association"];
  quoteRevision: string;
}>;
export type ArtworkWorkspaceDetailAssignment = Readonly<{
  assignment: ArtworkOrderProjection["assignment"];
  orderNumber: string;
  customerId?: string;
  customerDisplayName: string;
  lineDescription: string;
}>;
export type ArtworkWorkspaceDetail = Readonly<{
  file: ArtworkOrderProjection["file"];
  assignments: readonly ArtworkWorkspaceDetailAssignment[];
}>;
export type ProofResponse = Readonly<{
  proofResponseId: string;
  proofVersionId: string;
  outcome: "approved" | "revision_requested";
  comment?: string;
  origin: "direct" | "staff_recorded_customer";
  respondedAt: string;
  responderPrincipalSubject: string;
}>;
export type ProofVersion = Readonly<{
  proofVersionId: string;
  proofWorkId: string;
  sequence: number;
  artwork: readonly Readonly<{
    position: number;
    artworkAssignmentId: string;
    artworkFileId: string;
  }>[];
  createdAt: string;
  issuedAt?: string;
  issuedPrincipalSubject?: string;
}>;
export type ProofWorkProjection = Readonly<{
  work: Readonly<{
    proofWorkId: string;
    orderId: string;
    orderLineId: string;
    createdAt: string;
  }>;
  versions: readonly Readonly<{
    version: ProofVersion;
    response?: ProofResponse;
  }>[];
}>;
export type ProofingMutationResult = Readonly<{
  work: ProofWorkProjection["work"];
  version?: ProofVersion;
  response?: ProofResponse;
}>;
export type ProofQueueItem = Readonly<{
  work: ProofWorkProjection["work"];
  orderNumber: string;
  customerDisplayName: string;
  lineDescription: string;
  latest?: Readonly<{
    sequence: number;
    issuedAt?: string;
    outcome?: "approved" | "revision_requested";
  }>;
}>;
export type PrepressUnit = Readonly<{
  prepressUnitId: string;
  organizationId: string;
  orderId: string;
  orderLineId: string;
  artworkAssignmentId: string;
  artworkFileId: string;
  side?: "front" | "back";
  sourcePageIndex?: number;
  layerKey?: string;
  layerOrder?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}>;
export type ProductionRequirementCoverage = Readonly<{
  requirement: Readonly<{
    key: string;
    side?: "front" | "back";
    sourcePageIndex?: number;
    layerKey?: string;
    layerOrder?: number;
  }>;
  artworkAssignmentIds: readonly string[];
  prepressUnits: readonly PrepressUnit[];
  productionArtworkCovered: boolean;
  prepressComplete: boolean;
}>;
export type OrderLinePrepressCoverage = Readonly<{
  state: "unconfigured" | "configured";
  requirements: readonly ProductionRequirementCoverage[];
  productionArtworkComplete: boolean;
  allRequiredPrepressUnitsComplete: boolean;
}>;
export type PrepressQueueItem = Readonly<{
  orderId: string;
  orderNumber: string;
  customerId?: string;
  customerDisplayName: string;
  orderLineId: string;
  lineDescription: string;
  quantity: number;
  requestedDueDate?: string;
  routingStepKind?: "proofing" | "prepress" | "production" | "fulfillment";
  coverage: OrderLinePrepressCoverage;
}>;
export type ProductionAttempt = Readonly<{
  productionAttemptId: string;
  productionWorkId: string;
  sequence: number;
  kind: "initial" | "reprint" | "correction";
  stationKey: "flatbed" | "roll";
  goodQuantity: number;
  wasteQuantity: number;
  startedAt: string;
  completedAt?: string;
}>;
export type ProductionWorkProjection = Readonly<{
  work: Readonly<{
    productionWorkId: string;
    orderId: string;
    orderLineId: string;
    requirement: ProductionRequirementCoverage["requirement"];
    artworkAssignmentId: string;
    artworkFileId: string;
    prepressUnitId?: string;
    orderedQuantity: number;
  }>;
  attempts: readonly ProductionAttempt[];
  completedGoodQuantity: number;
  unitQuantitySatisfied: boolean;
  operatorContext?: Readonly<{
    orderNumber?: string;
    product?: Readonly<{ productId: string; displayName: string }>;
    customer?: Readonly<{ customerId: string; displayName: string }>;
  }>;
}>;
export type ProductionMaterialProjection = Readonly<{
  usage: Readonly<{
    productionWorkId: string;
    facts: readonly Readonly<{
      consumptionId: string;
      materialId: string;
      materialName: string;
      materialSku: string | null;
      requirementId?: string;
      quantity: string;
      unit: ProductRecipeComponent["unit"];
      kind: "consumed" | "waste" | "correction";
      correctsConsumptionId?: string;
      createdAt: string;
    }>[];
    comparison: readonly Readonly<{
      materialId: string;
      materialName: string;
      materialSku: string | null;
      requirementId?: string;
      unit: ProductRecipeComponent["unit"];
      expectedQuantity: string;
      consumedQuantity: string;
      wasteQuantity: string;
      correctionQuantity: string;
      totalPhysicalUsageQuantity: string;
      varianceQuantity: string;
    }>[];
  }>;
  inventory: Readonly<{
    balances: readonly Readonly<{
      materialId: string;
      materialName: string;
      materialSku: string | null;
      unit: ProductRecipeComponent["unit"];
      onHandQuantity: string;
      reservedQuantity: string;
      availableQuantity: string;
    }>[];
    facts: readonly Readonly<{
      consumptionId: string;
      status: "applied" | "unapplied" | "blocked" | "retryable";
      lastFailureCode?: string;
      lastFailureMessage?: string;
      attemptCount: number;
    }>[];
  }>;
}>;
export type Selection = Readonly<{
  customerId?: string;
  contactId?: string;
  productId?: string;
  displayName: string;
  measurementMode?: "dimensions_required" | "quantity_only";
  requiresDimensions?: boolean;
}>;
export type ProductConfiguration = Readonly<{
  productId: string;
  displayName: string;
  measurementMode: "dimensions_required" | "quantity_only";
  requiresDimensions: boolean;
  supportedDimensionUnits: readonly ("in" | "ft" | "mm")[];
  effectiveSelections: Record<string, unknown>;
  productionRequirements?: ProductionRequirementPreview;
  fields: readonly Readonly<{
    selectionKey: string;
    label: string;
    inputType: string;
    required: boolean;
    defaultValue?: unknown;
    choices: readonly Readonly<{
      value: string | number | boolean;
      label: string;
    }>[];
  }>[];
}>;
export type SalesLinePricingPreview = Readonly<{
  calculatedUnitAmount: Readonly<{ cents: number; currency: string }>;
  calculatedLineAmount: Readonly<{ cents: number; currency: string }>;
  currency: string;
  explanation: PricingExplanation;
}>;
const csrfTokens = new Map<string, string>();
let sessionScope: string | undefined;
const csrfKey = (organizationId: string) =>
  `${sessionScope ?? "unscoped"}:${organizationId}`;
export const newBusinessRequestId = () => crypto.randomUUID();
const endpoint = (org: string, suffix = "") =>
  `/v2/organizations/${encodeURIComponent(org)}/quotes${suffix}`;
const orderEndpoint = (org: string, suffix = "") =>
  `/v2/organizations/${encodeURIComponent(org)}/orders${suffix}`;
const withSearch = (
  url: string,
  query: Readonly<{
    q?: string;
    lifecycle?: string;
    dueFrom?: string;
    dueTo?: string;
    sort?: "updated_desc" | "updated_asc";
    cursor?: string;
    limit?: number;
  }> = {},
) => {
  const value = new URLSearchParams();
  if (query.q) value.set("q", query.q);
  if (query.lifecycle) value.set("lifecycle", query.lifecycle);
  if (query.dueFrom) value.set("dueFrom", query.dueFrom);
  if (query.dueTo) value.set("dueTo", query.dueTo);
  if (query.sort) value.set("sort", query.sort);
  if (query.cursor) value.set("cursor", query.cursor);
  if (query.limit) value.set("limit", String(query.limit));
  const text = value.toString();
  return text ? `${url}?${text}` : url;
};
const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  // FormData owns its multipart boundary. Supplying JSON here would make a
  // legitimate binary upload unreadable by the HTTP boundary.
  const isMultipart =
    typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include",
    ...init,
    // init may carry only the CSRF header. JSON remains the default for the
    // normal V2 command path; multipart is explicitly left to the browser.
    headers: {
      ...(isMultipart ? {} : { "content-type": "application/json" }),
      ...(init?.headers ?? {}),
    },
  });
  // Every authenticated Quote/form response carries the trusted host's opaque
  // session epoch. Detect a replacement before its body can update the old
  // session's React Query namespace.
  const responseSessionScope = response.headers.get("x-v2-session-scope");
  if (responseSessionScope) adoptSessionScope(responseSessionScope);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok)
    throw (body.error ?? {
      code: "INTERNAL_ERROR",
      message: "The Quote service is unavailable.",
    }) as ApiError;
  return body.data as T;
};
export const clearV2ApiSessionState = (): void => {
  csrfTokens.clear();
  sessionScope = undefined;
};
export const taxSettingsApi = {
  get: (organizationId: string) => request<SalesTaxSettings>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/sales-tax`),
  saveHomeBusiness: (organizationId: string, businessRequestId: string, input: Readonly<{name:string;countryCode:string;regionCode:string;postalCode?:string;ratePercent:string;active:boolean;}>) => request<SalesTaxSettings>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/sales-tax/home-business`, { method:"PUT", headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId)) ?? ""}, body:JSON.stringify({...input,businessRequestId}) }),
  createDestination: (organizationId:string,businessRequestId:string,input:Readonly<{expectedRevision:string;name:string;countryCode:string;regionCode:string;postalCode?:string;ratePercent:string;active:boolean;destinationMethods:readonly ("shipping"|"local_delivery")[]}>) => request<SalesTaxSettings>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/sales-tax/destination-jurisdictions`,{method:"POST",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId)) ?? ""},body:JSON.stringify({...input,businessRequestId})}),
  updateDestination: (organizationId:string,jurisdictionId:string,businessRequestId:string,input:Readonly<{expectedRevision:string;name:string;countryCode:string;regionCode:string;postalCode?:string;ratePercent:string;active:boolean;destinationMethods:readonly ("shipping"|"local_delivery")[]}>) => request<SalesTaxSettings>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/sales-tax/destination-jurisdictions/${encodeURIComponent(jurisdictionId)}`,{method:"PUT",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId)) ?? ""},body:JSON.stringify({...input,businessRequestId})}),
};
const settingsEndpoint = (organizationId: string, suffix = "") => `/v2/organizations/${encodeURIComponent(organizationId)}/settings/organization${suffix}`;
export const organizationSettingsApi = {
  get: (organizationId: string) => request<OrganizationSettings>(settingsEndpoint(organizationId)),
  saveBusinessProfile: (organizationId: string, businessRequestId: string, input: Readonly<{ expectedRevision: string; displayName: string; legalName?: string; phone?: string; email?: string; website?: string; businessAddress: OrganizationAddress; timeZone?: string; currency?: string }>) => request<OrganizationSettings>(settingsEndpoint(organizationId, "/business-profile"), { method: "PUT", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify({ businessRequestId, ...input }) }),
  saveDocumentsBranding: (organizationId: string, businessRequestId: string, input: Readonly<{ expectedRevision: string; footerNote?: string; paymentInstructions?: string; checksPayableTo?: string; remittanceAddress?: OrganizationAddress }>) => request<OrganizationSettings>(settingsEndpoint(organizationId, "/documents-branding"), { method: "PUT", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify({ businessRequestId, ...input }) }),
  adoptLogo: (organizationId: string, businessRequestId: string, expectedRevision: string, file: File) => { const body = new FormData(); body.append("businessRequestId", businessRequestId); body.append("expectedRevision", expectedRevision); body.append("file", file); return request<OrganizationSettings>(settingsEndpoint(organizationId, "/documents-branding/logo"), { method: "POST", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body }); },
};
export const numberingSettingsApi = {
  get: (organizationId: string) => request<NumberingSettings>(`${settingsEndpoint(organizationId)}/numbering`),
  save: (organizationId: string, businessRequestId: string, input: Readonly<{ expectedRevision: string; quote: Readonly<{ prefix: string; nextNumber: string }>; order: Readonly<{ prefix: string; nextNumber: string }> }>) => request<NumberingSettings>(`${settingsEndpoint(organizationId)}/numbering`, { method: "PUT", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify({ businessRequestId, ...input }) }),
};
export const teamAccessApi = {
  get: (organizationId: string) => request<TeamAccessRead>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/team-access`),
  invite: (organizationId: string, input: Readonly<{ businessRequestId: string; expectedAuthorityRevision: string; email: string; legacyRole?: "admin" | "manager" | "member" }>) => request<Readonly<{ invitationId: string; status: "pending" }>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/team-access/staff/invitations`, { method: "POST", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify(input) }),
  setStaffStatus: (organizationId: string, userId: string, input: Readonly<{ businessRequestId: string; expectedAuthorityRevision: string; active: boolean }>) => request<Readonly<{ userId: string; status: "active" | "disabled" }>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/team-access/staff/${encodeURIComponent(userId)}/status`, { method: "PATCH", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify(input) }),
  replaceStaffPermissionSets: (organizationId: string, userId: string, input: Readonly<{ businessRequestId: string; expectedAuthorityRevision: string; permissionSetIds: readonly string[] }>) => request<Readonly<{ userId: string }>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/team-access/staff/${encodeURIComponent(userId)}/permission-sets`, { method: "PUT", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify(input) }),
  createPermissionSet: (organizationId: string, input: Readonly<{ businessRequestId: string; expectedAuthorityRevision: string; name: string; description?: string; principalKind: "staff" | "portal"; capabilities: readonly string[] }>) => request<Readonly<{ permissionSetId: string }>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/team-access/permission-sets`, { method: "POST", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify(input) }),
  updatePermissionSet: (organizationId: string, permissionSetId: string, input: Readonly<{ businessRequestId: string; expectedAuthorityRevision: string; name: string; description?: string; active: boolean; capabilities: readonly string[] }>) => request<Readonly<{ permissionSetId: string }>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/team-access/permission-sets/${encodeURIComponent(permissionSetId)}`, { method: "PUT", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify(input) }),
  replacePortalPermissionSets: (organizationId: string, portalAccessId: string, input: Readonly<{ businessRequestId: string; expectedAuthorityRevision: string; permissionSetIds: readonly string[] }>) => request<Readonly<{ portalAccessId: string }>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/team-access/portal-access/${encodeURIComponent(portalAccessId)}/permission-sets`, { method: "PUT", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify(input) }),
  bootstrapPortalAccess: (organizationId: string, input: Readonly<{ businessRequestId: string; expectedAuthorityRevision: string; customerId: string; contactId: string; permissionSetId: string }>) => request<Readonly<{ portalAccessId: string; status: "pending" | "active"; deliveryState: "not_sent" | "pending" | "succeeded" | "uncertain" }>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/team-access/portal-access/bootstrap`, { method: "POST", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify(input) }),
};
export const emailIntegrationApi = {
  get: (organizationId: string) => request<EmailIntegrationReadiness>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/email`),
  connect: (organizationId: string) => request<Readonly<{ authorizeUrl: string }>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/email/connect`, { method:"POST", headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId)) ?? ""}, body:"{}" }),
  adoptLegacy: (organizationId: string) => request<EmailIntegrationReadiness>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/email/adopt-legacy`, { method:"POST", headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId)) ?? ""}, body:"{}" }),
  disconnect: (organizationId: string) => request<EmailIntegrationReadiness>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/email/disconnect`, { method:"POST", headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId)) ?? ""}, body:"{}" }),
};
export type QuickBooksRefundDisbursementAccount = Readonly<{id:string;name:string;accountType:"Bank";accountSubtype:string|null}>;
export type QuickBooksConnectionReadiness = Readonly<{ state: "not_connected" | "connected_sandbox" | "connected_production" | "connected_unknown" | "authorization_required" | "reconnect_required" | "worker_not_ready" | "sync_ready" | "action_required"; environment: "sandbox" | "production" | "unknown"; connected: boolean; connectedCompanyName: string | null; actionRequired: string | null; refunds:Readonly<{state:"ready"|"configuration_required";account:QuickBooksRefundDisbursementAccount|null}> }>;
export type QuickBooksEligibleInvoice = Readonly<{invoiceId:string;displayNumber:string;customerName:string;totalCents:number;currency:string;issuedAt:string|null;syncStatus:"eligible"}>;
export type QuickBooksEligibleFinancialFact = Readonly<{subjectKind:"payment"|"refund";subjectId:string;displayNumber:string;customerName:string;amountCents:number;currency:string;occurredAt:string}>;
export type QuickBooksQueueActivity = Readonly<{jobId:string;subjectKind:"invoice"|"payment"|"refund";subjectId:string;displayNumber:string;customerName:string;amountCents:number|null;currency:string|null;state:"queued"|"processing"|"retry"|"succeeded"|"uncertain"|"blocked";attemptCount:number;lastError:string|null;updatedAt:string;completedAt:string|null;providerId:string|null;retryEligible:boolean;recoveryEligible:boolean}>;
export type QuickBooksOperationsRead = Readonly<{eligibleInvoiceCount:number;queueSummary:Readonly<{queued:number;processing:number;succeeded:number;actionRequired:number}>}>;
export type QuickBooksInvoiceImportPreview = Readonly<{rows:readonly Readonly<{qbInvoiceId:string;qbDocNumber:string;customerRefName:string;classification:"open_ar"|"historical";canImport:boolean;cannotImportReason?:string;warningReasons:readonly string[];exclusionReasons:readonly string[]}>[];scope:"open_ar"|"historical"|"all_unsynced";page:number;pageSize:number;sourceTotal:number|null;hasNextPage:boolean}>;
export type QuickBooksCustomerImportPreview = readonly Readonly<{qbCustomerId:string;qbDisplayName:string;mappedCompanyName:string;importStatus:string;contactNeedsReview:boolean;failureReason:string|null;matchedExistingCustomerId:string|null}>[];
export const quickBooksIntegrationApi = {
  get: (organizationId: string) => request<QuickBooksConnectionReadiness>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting`),
  refundDisbursementAccounts:(organizationId:string)=>request<readonly QuickBooksRefundDisbursementAccount[]>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting/refund-disbursement-accounts`),
  setRefundDisbursementAccount:(organizationId:string,accountId:string)=>request<Readonly<{account:QuickBooksRefundDisbursementAccount}>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting/refund-disbursement-account`,{method:"PUT",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId)) ?? ""},body:JSON.stringify({accountId})}),
  connect: (organizationId: string) => request<Readonly<{ authorizeUrl: string }>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting/connect`, { method:"POST", headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId)) ?? ""}, body:"{}" }),
  disconnect: (organizationId: string) => request<QuickBooksConnectionReadiness>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting/disconnect`, { method:"POST", headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId)) ?? ""}, body:"{}" }),
  operations: (organizationId:string) => request<QuickBooksOperationsRead>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting/operations`),
  policy:(organizationId:string)=>request<Readonly<{autoSync:boolean}>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting/policy`),
  setPolicy:(organizationId:string,autoSync:boolean)=>request<Readonly<{autoSync:boolean}>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting/policy`,{method:"PUT",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId)) ?? ""},body:JSON.stringify({autoSync})}),
  unsyncedInvoices:(organizationId:string,page:number,pageSize:number,search:string)=>request<Readonly<{items:readonly QuickBooksEligibleInvoice[];total:number;page:number;pageSize:number;hasNextPage:boolean}>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting/unsynced-invoices?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}`),
  unsyncedFinancialFacts:(organizationId:string,page:number,pageSize:number,search:string)=>request<Readonly<{items:readonly QuickBooksEligibleFinancialFact[];total:number;page:number;pageSize:number;hasNextPage:boolean}>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting/unsynced-financial-facts?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}`),
  queue:(organizationId:string,page:number,pageSize:number,search:string,actionRequired:boolean)=>request<Readonly<{items:readonly QuickBooksQueueActivity[];total:number;page:number;pageSize:number;hasNextPage:boolean}>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting/queue?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}&actionRequired=${actionRequired}`),
  syncSelected: (organizationId:string,invoiceIds:readonly string[]) => request<Readonly<{invoiceIds:readonly string[];state:"queued"}>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting/sync-selected`,{method:"POST",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId)) ?? ""},body:JSON.stringify({invoiceIds})}),
  syncFinancial:(organizationId:string,subjects:readonly Readonly<{subjectKind:"payment"|"refund";subjectId:string}>[]) => request<Readonly<{subjects:readonly Readonly<{subjectKind:"payment"|"refund";subjectId:string}>[];state:"queued"}>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting/sync-financial`,{method:"POST",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId)) ?? ""},body:JSON.stringify({subjects})}),
  retry: (organizationId:string,kind:"invoice"|"payment"|"refund",subjectId:string) => request<Readonly<{state:"queued";attemptCount:number}>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting/queue/${encodeURIComponent(kind)}/${encodeURIComponent(subjectId)}/retry`,{method:"POST",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId)) ?? ""},body:"{}"}),
  reconcile: (organizationId:string,kind:"invoice"|"payment"|"refund",subjectId:string) => request<Readonly<{state:"queued";attemptCount:number}>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting/queue/${encodeURIComponent(kind)}/${encodeURIComponent(subjectId)}/reconcile`,{method:"POST",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId)) ?? ""},body:"{}"}),
  customerImportPreview:(organizationId:string)=>request<QuickBooksCustomerImportPreview>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting/import-preview/customers`),
  invoiceImportPreview:(organizationId:string,scope:"open_ar"|"historical"|"all_unsynced",page:number)=>request<QuickBooksInvoiceImportPreview>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting/import-preview/invoices?scope=${scope}&page=${page}&pageSize=25`),
  importInvoices:(organizationId:string,invoices:readonly Readonly<{qbId:string;classification:"open_ar"|"historical"|"skip"}>[])=>request<Readonly<{created:number;updated:number;skipped:number;excluded:number;failed:number;errors:readonly string[]}>>(`/v2/organizations/${encodeURIComponent(organizationId)}/settings/accounting/import/invoices`,{method:"POST",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId)) ?? ""},body:JSON.stringify({invoices})}),
};
const adoptSessionScope = (nextScope: string): void => {
  if (sessionScope && sessionScope !== nextScope) {
    csrfTokens.clear();
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("v2:session-context-changed"));
  }
  sessionScope = nextScope;
};
export const quoteApi = {
  bootstrap: async (organizationId: string) => {
    const value = await request<UiBootstrap>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/ui-bootstrap`,
    );
    adoptSessionScope(value.sessionScope);
    csrfTokens.set(csrfKey(organizationId), value.csrfToken);
    return value;
  },
  sendReadiness: (organizationId: string, quoteId: string) => request<QuoteSendReadiness>(endpoint(organizationId, `/${encodeURIComponent(quoteId)}/send-readiness`)),
  customers: (organizationId: string) =>
    request<readonly Selection[]>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/quotes/form/customers`,
    ),
  contacts: (organizationId: string, customerId: string) =>
    request<readonly Selection[]>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/quotes/form/customers/${encodeURIComponent(customerId)}/contacts`,
    ),
  products: (organizationId: string) =>
    request<readonly Selection[]>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/quotes/form/products`,
    ),
  configuration: (organizationId: string, productId: string) =>
    request<ProductConfiguration>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/quotes/form/products/${encodeURIComponent(productId)}/configuration`,
    ),
  resolveConfiguration: (
    organizationId: string,
    productId: string,
    selections: Record<string, unknown>,
  ) =>
    request<ProductConfiguration>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/quotes/form/products/${encodeURIComponent(productId)}/configuration/resolve`,
      {
        method: "POST",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ selections }),
      },
    ),
  previewLinePricing: (
    organizationId: string,
    productId: string,
    input: Readonly<{
      quantity: number;
      selections: Record<string, unknown>;
      dimensions?: Readonly<{
        width: string;
        height: string;
        unit: "in" | "ft" | "mm";
      }>;
    }>,
  ) =>
    request<SalesLinePricingPreview>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/quotes/form/products/${encodeURIComponent(productId)}/pricing-preview`,
      {
        method: "POST",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify(input),
      },
    ),
  get: (organizationId: string, quoteId: string) =>
    request<QuoteRead>(
      endpoint(organizationId, `/${encodeURIComponent(quoteId)}`),
    ),
  artwork: (organizationId: string, quoteId: string) =>
    request<readonly QuoteArtworkProjection[]>(
      endpoint(organizationId, `/${encodeURIComponent(quoteId)}/artwork`),
    ),
  uploadArtwork: (
    organizationId: string,
    quoteId: string,
    businessRequestId: string,
    input: Readonly<{
      quoteLineId: string;
      expectedRevision: string;
      side?: "front" | "back";
      file: File;
    }>,
  ) => {
    const body = new FormData();
    body.append("businessRequestId", businessRequestId);
    body.append("quoteLineId", input.quoteLineId);
    body.append("expectedRevision", input.expectedRevision);
    body.append("purpose", "customer_supplied");
    if (input.side) body.append("side", input.side);
    body.append("file", input.file);
    return request<QuoteArtworkMutationResult>(
      endpoint(organizationId, `/${encodeURIComponent(quoteId)}/artwork/uploads`),
      {
        method: "POST",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body,
      },
    );
  },
  removeArtwork: (
    organizationId: string,
    quoteId: string,
    quoteArtworkAssociationId: string,
    businessRequestId: string,
    expectedRevision: string,
  ) =>
    request<Readonly<{ quoteRevision: string }>>(
      endpoint(
        organizationId,
        `/${encodeURIComponent(quoteId)}/artwork/${encodeURIComponent(quoteArtworkAssociationId)}`,
      ),
      {
        method: "DELETE",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ businessRequestId, expectedRevision }),
      },
    ),
  legacy: (organizationId: string, recordId: string) =>
    request<LegacyCommercialDetail>(
      endpoint(organizationId, `/legacy/${encodeURIComponent(recordId)}`),
    ),
  list: (
    organizationId: string,
    query?: Readonly<{
      q?: string;
      lifecycle?: string;
      dueFrom?: string;
      dueTo?: string;
      sort?: "updated_desc" | "updated_asc";
      cursor?: string;
      limit?: number;
    }>,
  ) =>
    request<SalesListPage<QuoteListItem>>(
      withSearch(endpoint(organizationId), query),
    ),
  create: (
    organizationId: string,
    businessRequestId: string,
    input: Record<string, unknown>,
  ) =>
    request<QuoteResult>(endpoint(organizationId), {
      method: "POST",
      headers: {
        "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
      },
      body: JSON.stringify({ ...input, businessRequestId }),
    }),
  patch: (
    organizationId: string,
    quoteId: string,
    businessRequestId: string,
    input: Record<string, unknown>,
  ) =>
    request<QuoteResult>(
      endpoint(organizationId, `/${encodeURIComponent(quoteId)}`),
      {
        method: "PATCH",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({
          ...input,
          businessRequestId,
          expectedRevision: input.expectedRevision,
        }),
      },
    ),
  duplicate: (
    organizationId: string,
    quoteId: string,
    businessRequestId: string,
  ) =>
    request<QuoteResult>(
      endpoint(organizationId, `/${encodeURIComponent(quoteId)}/duplicate`),
      {
        method: "POST",
        headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" },
        body: JSON.stringify({ businessRequestId }),
      },
    ),
  action: (
    organizationId: string,
    quoteId: string,
    action: "send" | "decline" | "void",
    businessRequestId: string,
    expectedRevision: string,
    reason?: string,
  ) =>
    request<QuoteResult>(
      endpoint(organizationId, `/${encodeURIComponent(quoteId)}/${action}`),
      {
        method: "POST",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ businessRequestId, expectedRevision, ...(reason ? { reason } : {}) }),
      },
    ),
  accept: (
    organizationId: string,
    quoteId: string,
    businessRequestId: string,
    expectedRevision: string,
  ) =>
    request<QuoteAcceptanceResult>(
      endpoint(organizationId, `/${encodeURIComponent(quoteId)}/accept`),
      {
        method: "POST",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ businessRequestId, expectedRevision }),
      },
    ),
  convert: (
    organizationId: string,
    quoteId: string,
    businessRequestId: string,
    sourceCheckpointId: string,
    expectedRevision: string,
  ) =>
    request<
      Readonly<{
        quoteId: string;
        sourceCheckpointId: string;
        conversionCheckpointId: string;
        orderId: string;
        draftInvoiceId: string;
        orderNumber: string;
      }>
    >(endpoint(organizationId, `/${encodeURIComponent(quoteId)}/convert`), {
      method: "POST",
      headers: {
        "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
      },
      body: JSON.stringify({
        businessRequestId,
        sourceCheckpointId,
        expectedRevision,
      }),
    }),
};

type RawOrderLine = Readonly<{
  lineId: string;
  productId: string;
  description: string;
  quantity: number;
  resolvedConfiguration: Record<string, unknown>;
  pricingResult: { calculatedUnitAmount: { cents: number; currency: string } };
  calculatedLineAmount: { cents: number; currency: string };
  sellingPriceDecision: QuoteSellingPriceDecision & {
    resultingUnitAmount: { cents: number; currency: string };
    resultingLineAmount: { cents: number; currency: string };
  };
  sellingLineAmount: { cents: number; currency: string };
}>;
type RawOrderRead = Omit<OrderRead, "order"> & {
  order: Omit<OrderRead["order"], "lines"> & { lines: readonly RawOrderLine[] };
};
const orderForUi = (value: RawOrderRead): OrderRead => ({
  ...value,
  order: {
    ...value.order,
    lines: value.order.lines.map((line, index) => ({
      lineId: line.lineId,
      position: index + 1,
      productId: line.productId,
      description: line.description,
      quantity: line.quantity,
      resolvedConfiguration: line.resolvedConfiguration,
      calculatedUnitAmount: line.pricingResult.calculatedUnitAmount,
      calculatedLineAmount: line.calculatedLineAmount,
      sellingUnitAmount: line.sellingPriceDecision.resultingUnitAmount,
      sellingLineAmount: line.sellingLineAmount,
      sellingPriceDecision: line.sellingPriceDecision,
    })),
  },
});
export const orderApi = {
  create: async (
    organizationId: string,
    businessRequestId: string,
    input: Record<string, unknown>,
  ): Promise<OrderResult> => {
    const raw = await request<{ order: RawOrderRead; draftInvoiceId: string }>(
      orderEndpoint(organizationId),
      {
        method: "POST",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ ...input, businessRequestId }),
      },
    );
    return { ...raw, order: orderForUi(raw.order) };
  },
  list: (
    organizationId: string,
    query?: Readonly<{
      q?: string;
      lifecycle?: string;
      cursor?: string;
      limit?: number;
    }>,
  ) =>
    request<SalesListPage<OrderListItem>>(
      withSearch(orderEndpoint(organizationId), query),
    ),
  get: async (organizationId: string, orderId: string) =>
    orderForUi(
      await request<RawOrderRead>(
        orderEndpoint(organizationId, `/${encodeURIComponent(orderId)}`),
      ),
    ),
  history: (organizationId: string, orderId: string) => request<readonly { eventType: string; occurredAt: string; summary: string }[]>(orderEndpoint(organizationId, `/${encodeURIComponent(orderId)}/history`)),
  legacy: (organizationId: string, recordId: string) =>
    request<LegacyCommercialDetail>(
      orderEndpoint(organizationId, `/legacy/${encodeURIComponent(recordId)}`),
    ),
  patch: async (
    organizationId: string,
    orderId: string,
    businessRequestId: string,
    input: Record<string, unknown>,
  ): Promise<OrderResult> => {
    const raw = await request<{ order: RawOrderRead; draftInvoiceId: string }>(
      orderEndpoint(organizationId, `/${encodeURIComponent(orderId)}`),
      {
        method: "PATCH",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ ...input, businessRequestId }),
      },
    );
    return { ...raw, order: orderForUi(raw.order) };
  },
  duplicate: async (organizationId: string, orderId: string, businessRequestId: string): Promise<OrderResult> => {
    const raw = await request<{ order: RawOrderRead; draftInvoiceId: string }>(
      orderEndpoint(organizationId, `/${encodeURIComponent(orderId)}/duplicate`),
      {
        method: "POST",
        headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" },
        body: JSON.stringify({ businessRequestId }),
      },
    );
    return { ...raw, order: orderForUi(raw.order) };
  },
  cancel: async (organizationId: string, orderId: string, businessRequestId: string, expectedStateToken: string, reason: string): Promise<OrderResult> => {
    const raw = await request<{ order: RawOrderRead; draftInvoiceId: string }>(orderEndpoint(organizationId, `/${encodeURIComponent(orderId)}/cancel`), { method: "POST", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify({ businessRequestId, expectedStateToken, reason }) });
    return { ...raw, order: orderForUi(raw.order) };
  },
};
export type LegacyCommercialDetail = Readonly<{
  source: "legacy";
  recordId: string;
  number: string;
  customerDisplayName: string;
  lifecycle: string;
  sellingTotalCents: number;
  currency: string;
  requestedDueDate?: string;
  updatedAt: string;
  readOnly: true;
  activeRecordClassification?:
    | "CLOSED_HISTORY"
    | "ACTIVE_BUT_CAN_REMAIN_LEGACY"
    | "ACTIVE_REQUIRES_CUTOVER_STRATEGY"
    | "AMBIGUOUS";
}>;
export const invoiceApi = {
  forOrder: (organizationId: string, orderId: string) => request<InvoiceRead | null>(`/v2/organizations/${encodeURIComponent(organizationId)}/invoices/orders/${encodeURIComponent(orderId)}`),
  list: (
    organizationId: string,
    query?: Readonly<{ q?: string; lifecycle?: InvoiceRead["lifecycle"] }>,
  ) =>
    request<SalesListPage<InvoiceListItem>>(
      withSearch(
        `/v2/organizations/${encodeURIComponent(organizationId)}/invoices`,
        query,
      ),
    ),
  get: (organizationId: string, invoiceId: string) =>
    request<InvoiceRead>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/invoices/${encodeURIComponent(invoiceId)}`,
    ),
  issue: (
    organizationId: string,
    invoiceId: string,
    businessRequestId: string,
  ) =>
    request<Readonly<{ invoice: InvoiceRead }>>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/invoices/${encodeURIComponent(invoiceId)}/issue`,
      {
        method: "POST",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ businessRequestId }),
      },
    ),
};
const financeEndpoint = (org: string, suffix = "") =>
  `/v2/organizations/${encodeURIComponent(org)}/finance${suffix}`;
export type CustomerWorkspaceRead = Readonly<{
  customerId: string;
  displayName: string;
  revision: string;
  editable: Readonly<{ companyName: string; displayName?: string; email?: string; phone?: string; billingAddress?: Readonly<{ street1?: string; street2?: string; city?: string; state?: string; postalCode?: string; country?: string }>; shippingAddress?: Readonly<{ street1?: string; street2?: string; city?: string; state?: string; postalCode?: string; country?: string }> }>;
  presentation: Readonly<{
    customerDisplayName?: string;
    contactDisplayName?: string;
    companyName?: string;
    email?: string;
    phone?: string;
    billingAddress?: Readonly<{
      lines: readonly string[];
      city?: string;
      region?: string;
      postalCode?: string;
      countryCode?: string;
    }>;
    shippingAddress?: Readonly<{
      lines: readonly string[];
      city?: string;
      region?: string;
      postalCode?: string;
      countryCode?: string;
    }>;
  }>;
  contacts: readonly Readonly<{
    contactId: string;
    displayName: string;
    email?: string;
    phone?: string;
    primary: boolean;
    title?: string;
    status: "active" | "archived";
    revision: string;
    portalAccessStatus?: string;
  }>[];
  contactReadiness: Readonly<{ status: "ready" | "needs_attention"; reasons: readonly string[] }>;
}>;
export type CustomerCatalogItem = Readonly<{
  customerId: string;
  displayName: string;
  companyName: string;
  email?: string;
  phone?: string;
  primaryContact?: Readonly<{
    contactId: string;
    displayName: string;
    email?: string;
    phone?: string;
    primary: boolean;
  }>;
}>;
export const customerApi = {
  list: (organizationId: string, query = "") =>
    request<{ items: readonly CustomerCatalogItem[] }>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/customers${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    ),
  get: (organizationId: string, customerId: string) =>
    request<CustomerWorkspaceRead>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/customers/${encodeURIComponent(customerId)}`,
    ),
  create: (organizationId: string, input: Readonly<{ companyName: string; displayName?: string; email?: string; phone?: string }>) =>
    request<CustomerWorkspaceRead>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/customers`,
      {
        method: "POST",
        headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" },
        body: JSON.stringify(input),
      },
    ),
  update: (organizationId: string, customerId: string, input: Readonly<{ businessRequestId: string; expectedRevision: string; companyName: string; displayName?: string; email?: string; phone?: string; billingAddress?: CustomerWorkspaceRead["editable"]["billingAddress"]; shippingAddress?: CustomerWorkspaceRead["editable"]["shippingAddress"] }>) => request<CustomerWorkspaceRead>(`/v2/organizations/${encodeURIComponent(organizationId)}/customers/${encodeURIComponent(customerId)}`, { method: "PATCH", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify(input) }),
  setPrimaryContact: (organizationId: string, customerId: string, input: Readonly<{ businessRequestId: string; expectedCustomerRevision: string; contactId: string }>) => request<CustomerWorkspaceRead>(`/v2/organizations/${encodeURIComponent(organizationId)}/customers/${encodeURIComponent(customerId)}/primary-contact`, { method: "PUT", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify(input) }),
};
export type ContactCatalogItem = Readonly<{
  contactId: string;
  displayName: string;
  email?: string;
  phone?: string;
  customerId: string;
  customerName: string;
  primary: boolean;
  title?: string;
  status: "active" | "archived";
  revision: string;
  portalAccessStatus?: string;
}>;
export type ContactWorkspaceRead = ContactCatalogItem &
  Readonly<{
    firstName: string;
    lastName: string;
    customerPresentation: CustomerWorkspaceRead["presentation"];
    relatedContacts: readonly ContactCatalogItem[];
    customerRevision: string;
  }>;
export const contactApi = {
  list: (organizationId: string, query = "") =>
    request<{
      items: readonly ContactCatalogItem[];
      total: number;
      accounts: number;
    }>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/contacts${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    ),
  get: (organizationId: string, contactId: string) =>
    request<ContactWorkspaceRead>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/contacts/${encodeURIComponent(contactId)}`,
    ),
  create: (organizationId: string, input: Readonly<{ businessRequestId: string; expectedCustomerRevision: string; customerId: string; firstName: string; lastName: string; email?: string; phone?: string; title?: string }>) =>
    request<ContactWorkspaceRead>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/contacts`,
      {
        method: "POST",
        headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" },
        body: JSON.stringify(input),
      },
    ),
  update: (organizationId: string, contactId: string, input: Readonly<{ customerId: string; businessRequestId: string; expectedCustomerRevision: string; expectedContactRevision: string; firstName: string; lastName: string; email?: string; phone?: string; title?: string; active: boolean }>) => request<ContactWorkspaceRead>(`/v2/organizations/${encodeURIComponent(organizationId)}/contacts/${encodeURIComponent(contactId)}`, { method: "PATCH", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify(input) }),
};
export const productApi = {
  /** Shared Formula Library is read-only from Product Builder. */
  listFormulaLibrary: () =>
    request<readonly ProductFormulaLibraryEntry[]>("/api/pricing-formulas"),
  list: (organizationId: string, query = "", page = 1) =>
    request<ProductCatalogPage>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products?q=${encodeURIComponent(query)}&page=${page}&pageSize=50`,
    ),
  get: (organizationId: string, productId: string) =>
    request<ProductWorkspaceDetail>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}`,
    ),
  routingReadiness: (organizationId:string) => request<ProductRoutingReadinessAudit>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/routing-readiness`),
  routingCompatibility: (organizationId:string,productId:string) => request<ProductRoutingCompatibility>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/routing-compatibility`),
  assignRoutingCompatibility: (organizationId:string,productId:string,input:Readonly<{businessRequestId:string;productTypeId:string|null;expectedProductUpdatedAt:string}>) => request<ProductRoutingCompatibility>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/routing-compatibility`,{method:"PATCH",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId))??""},body:JSON.stringify(input)}),
  setProductTypeDefaultRoute: (organizationId:string,productTypeId:string,input:Readonly<{businessRequestId:string;routeTemplateId:string;expectedProductTypeUpdatedAt:string}>) => request<unknown>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/product-types/${encodeURIComponent(productTypeId)}/default-route`,{method:"PATCH",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId))??""},body:JSON.stringify(input)}),
  createProduct: (
    organizationId: string,
    businessRequestId: string,
    displayName: string,
  ) =>
    request<CreatedProductWithInitialDraft>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products`,
      {
        method: "POST",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ businessRequestId, displayName }),
      },
    ),
  createDraft: (
    organizationId: string,
    productId: string,
    businessRequestId: string,
    expectedActiveVersionUpdatedAt: string,
  ) =>
    request<ProductVersionLifecycle>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/drafts`,
      {
        method: "POST",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({
          businessRequestId,
          expectedActiveVersionUpdatedAt,
        }),
      },
    ),
  publishDraft: (
    organizationId: string,
    productId: string,
    businessRequestId: string,
    input: Readonly<{
      draftVersionId: string;
      expectedProductUpdatedAt: string;
      expectedDraftUpdatedAt: string;
      confirmWarnings?: boolean;
      activateProduct?: boolean;
    }>,
  ) =>
    request<PublishedProductVersion>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/publish`,
      {
        method: "POST",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ businessRequestId, ...input }),
      },
    ),
  draftGeneral: (organizationId: string, productId: string) =>
    request<ProductDraftGeneralRead>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/general`,
    ),
  saveDraftGeneral: (
    organizationId: string,
    productId: string,
    businessRequestId: string,
    input: Readonly<{
      draftVersionId: string;
      expectedDraftUpdatedAt: string;
      general: ProductDraftGeneral;
    }>,
  ) =>
    request<ProductDraftGeneralRead>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/general`,
      {
        method: "PATCH",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ businessRequestId, ...input }),
      },
    ),
  draftOptions: (organizationId: string, productId: string) =>
    request<ProductDraftOptionsRead>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/options`,
    ),
  saveDraftOptions: (
    organizationId: string,
    productId: string,
    businessRequestId: string,
    input: Readonly<{
      draftVersionId: string;
      expectedDraftUpdatedAt: string;
      options: readonly ProductDraftOption[];
      optionRules?: readonly ProductOptionRule[];
    }>,
  ) =>
    request<ProductDraftOptionsRead>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/options`,
      {
        method: "PATCH",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ businessRequestId, ...input }),
      },
    ),
  draftPricing: (organizationId: string, productId: string) =>
    request<ProductDraftPricing>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/pricing`,
    ),
  saveDraftPricing: (
    organizationId: string,
    productId: string,
    businessRequestId: string,
    input: Readonly<{
      draftVersionId: string;
      expectedDraftUpdatedAt: string;
      base: ProductDraftPricing["base"];
      flatFeeCents: number | null;
      tierBasis: ProductDraftPricing["tierBasis"];
      tiers: readonly ProductDraftPricingTier[];
      tierSets?: ProductDraftPricingTierSets;
    }>,
  ) =>
    request<ProductDraftPricing>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/pricing`,
      {
        method: "PATCH",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ businessRequestId, ...input }),
      },
    ),
  previewDraftPricing: (
    organizationId: string,
    productId: string,
    input: Readonly<{
      quantity: number;
      width?: number;
      height?: number;
      selections?: Record<string, unknown>;
    }>,
  ) =>
    request<ProductDraftPricingPreview>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/pricing/preview`,
      {
        method: "POST",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify(input),
      },
    ),
  draftPricingMatrix: (organizationId: string, productId: string) =>
    request<ProductDraftPricingMatrix>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/pricing/matrix`,
    ),
  saveDraftPricingMatrix: (
    organizationId: string,
    productId: string,
    businessRequestId: string,
    input: Readonly<{
      draftVersionId: string;
      expectedDraftUpdatedAt: string;
      active: boolean;
      matrixId: string;
      pricingUnit: "per_piece" | "per_square_foot";
      dimensions: readonly string[];
      rows: ProductDraftPricingMatrix["rows"];
    }>,
  ) =>
    request<ProductDraftPricingMatrix>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/pricing/matrix`,
      {
        method: "PATCH",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ businessRequestId, ...input }),
      },
    ),
  draftFormula: (organizationId: string, productId: string) =>
    request<ProductDraftFormulaPricing>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/pricing/formula`,
    ),
  saveDraftFormula: (
    organizationId: string,
    productId: string,
    businessRequestId: string,
    input: Readonly<{
      draftVersionId: string;
      expectedDraftUpdatedAt: string;
      source: "formula_revision" | "embedded" | "library";
      formulaId?: string;
      formulaRevisionId?: string;
      expression?: string;
      variables?: Record<string, number>;
      inputValues?: Record<string, number | boolean>;
      allowRotation: boolean;
      rotationControl?: ProductRotationControl;
    }>,
  ) =>
    request<ProductDraftFormulaPricing>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/pricing/formula`,
      {
        method: "PATCH",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ businessRequestId, ...input }),
      },
    ),
  adoptLegacyDraftFormula: (
    organizationId: string,
    productId: string,
    businessRequestId: string,
    input: Readonly<{ draftVersionId: string; expectedDraftUpdatedAt: string }>,
  ) =>
    request<ProductDraftFormulaPricing>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/pricing/formula/adopt-legacy`,
      {
        method: "POST",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ businessRequestId, ...input }),
      },
    ),
  draftOptionPricing: (organizationId: string, productId: string) =>
    request<ProductDraftOptionPricing>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/option-pricing`,
    ),
  saveDraftOptionPricing: (
    organizationId: string,
    productId: string,
    businessRequestId: string,
    input: Readonly<{
      draftVersionId: string;
      expectedDraftUpdatedAt: string;
      optionId: string;
      choiceValue?: string;
      /** Compatibility single-impact write. */ impact?: ProductDraftOptionPricingImpact | null;
      /** Ordered canonical impact write. */ impacts?: readonly ProductDraftOptionPricingImpact[];
      override?: ProductDraftOptionPricingOverride | null;
    }>,
  ) =>
    request<ProductDraftOptionPricing>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/option-pricing`,
      {
        method: "PATCH",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ businessRequestId, ...input }),
      },
    ),
  draftRecipe: (organizationId: string, productId: string) =>
    request<ProductRecipe>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/recipe`,
    ),
  activeRecipe: (organizationId: string, productId: string) =>
    request<ProductRecipe>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/active/recipe`,
    ),
  materials: (organizationId: string, productId: string, query = "") =>
    request<{ items: readonly ProductMaterial[] }>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/materials?q=${encodeURIComponent(query)}`,
    ),
  saveDraftRecipe: (
    organizationId: string,
    productId: string,
    businessRequestId: string,
    input: Readonly<{
      draftVersionId: string;
      expectedDraftUpdatedAt: string;
      components: readonly ProductRecipeComponent[];
    }>,
  ) =>
    request<ProductRecipe>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/recipe`,
      {
        method: "PATCH",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ businessRequestId, ...input }),
      },
    ),
  draftRouting: (organizationId: string, productId: string) =>
    request<ProductDraftRouting>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/routing`,
    ),
  saveDraftRouting: (
    organizationId: string,
    productId: string,
    businessRequestId: string,
    input: Readonly<{
      draftVersionId: string;
      expectedDraftUpdatedAt: string;
      routing: ProductDraftRouting["routing"];
    }>,
  ) =>
    request<ProductDraftRouting>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/routing`,
      {
        method: "PATCH",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ businessRequestId, ...input }),
      },
    ),
};
export const formulaApi = {
  list: (organizationId: string, input: string | Readonly<{ query?: string; includeInactive?: boolean; productId?: string; includeProductScoped?: boolean }> = "") => {
    const options = typeof input === "string" ? { query: input } : input;
    const params = new URLSearchParams();
    if (options.query) params.set("q", options.query);
    if (options.includeInactive) params.set("includeInactive", "true");
    if (options.productId) params.set("productId", options.productId);
    if (options.includeProductScoped) params.set("includeProductScoped", "true");
    const suffix = params.size ? `?${params.toString()}` : "";
    return request<readonly FormulaDomainListEntry[]>(`/v2/organizations/${encodeURIComponent(organizationId)}/formulas${suffix}`);
  },
  get: (organizationId: string, formulaId: string) =>
    request<FormulaDomainListEntry>(`/v2/organizations/${encodeURIComponent(organizationId)}/formulas/${encodeURIComponent(formulaId)}`),
  revisions: (organizationId: string, formulaId: string) =>
    request<readonly FormulaDomainRevision[]>(`/v2/organizations/${encodeURIComponent(organizationId)}/formulas/${encodeURIComponent(formulaId)}/revisions`),
  usage: (organizationId: string, formulaId: string) =>
    request<readonly Readonly<{ productId: string; productVersionId: string; formulaRevisionId: string; revisionNumber: number; productName: string; versionStatus: string }>[]>(`/v2/organizations/${encodeURIComponent(organizationId)}/formulas/${encodeURIComponent(formulaId)}/usage`),
  evaluate: (organizationId: string, input: FormulaDomainEvaluationInput) =>
    request<FormulaDomainEvaluationResult>(`/v2/organizations/${encodeURIComponent(organizationId)}/formulas/test`, { method: "POST", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify(input) }),
  create: (organizationId: string, businessRequestId: string, input: Readonly<{ name: string; description?: string; visibility: "product_scoped" | "library"; scopeProductId?: string; definition: FormulaDomainDefinition }>) =>
    request<FormulaDomainListEntry>(`/v2/organizations/${encodeURIComponent(organizationId)}/formulas`, { method: "POST", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify({ businessRequestId, ...input }) }),
  revise: (organizationId: string, formulaId: string, businessRequestId: string, input: Readonly<{ expectedCurrentRevisionId: string; definition: FormulaDomainDefinition }>) =>
    request<FormulaDomainListEntry>(`/v2/organizations/${encodeURIComponent(organizationId)}/formulas/${encodeURIComponent(formulaId)}/revisions`, { method: "POST", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify({ businessRequestId, ...input }) }),
  updateMetadata: (organizationId: string, formulaId: string, businessRequestId: string, input: Readonly<{ expectedCurrentRevisionId: string; name: string; description: string | null }>) =>
    request<FormulaDomainListEntry>(`/v2/organizations/${encodeURIComponent(organizationId)}/formulas/${encodeURIComponent(formulaId)}/metadata`, { method: "POST", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify({ businessRequestId, ...input }) }),
  /** Product scope is established only at Formula creation. This promotes the
   * same identity to the tenant library; it never creates a second Formula. */
  setVisibility: (organizationId: string, formulaId: string, businessRequestId: string, input: Readonly<{ expectedCurrentRevisionId: string; visibility: "library" }>) =>
    request<FormulaDomainListEntry>(`/v2/organizations/${encodeURIComponent(organizationId)}/formulas/${encodeURIComponent(formulaId)}/visibility`, { method: "POST", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify({ businessRequestId, ...input }) }),
  setStatus: (organizationId: string, formulaId: string, businessRequestId: string, input: Readonly<{ expectedCurrentRevisionId: string; status: "active" | "inactive" | "archived" }>) =>
    request<FormulaDomainListEntry>(`/v2/organizations/${encodeURIComponent(organizationId)}/formulas/${encodeURIComponent(formulaId)}/status`, { method: "POST", headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "" }, body: JSON.stringify({ businessRequestId, ...input }) }),
};
export const financeApi = {
  overview: (organizationId: string) =>
    request<{ items: readonly FinancialInvoiceListItem[] }>(
      financeEndpoint(organizationId, "/overview"),
    ),
  ledger: (organizationId: string) =>
    request<{ items: readonly FinancialLedgerEntry[] }>(
      financeEndpoint(organizationId, "/ledger"),
    ),
  invoice: (organizationId: string, invoiceId: string) =>
    request<FinancialInvoiceRead>(
      financeEndpoint(
        organizationId,
        `/invoices/${encodeURIComponent(invoiceId)}`,
      ),
    ),
  legacyInvoice: (organizationId: string, invoiceId: string) =>
    request<FinancialInvoiceRead>(
      financeEndpoint(
        organizationId,
        `/invoices/legacy/${encodeURIComponent(invoiceId)}`,
      ),
    ),
  recordPayment: (
    organizationId: string,
    invoiceId: string,
    businessRequestId: string,
    input: Readonly<{
      amountCents: number;
      currency: string;
      method: "cash" | "check" | "external";
      occurredAt: string;
    }>,
  ) =>
    request<unknown>(
      financeEndpoint(
        organizationId,
        `/invoices/${encodeURIComponent(invoiceId)}/payments`,
      ),
      {
        method: "POST",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ ...input, businessRequestId }),
      },
    ),
  recordRefund: (
    organizationId: string,
    invoiceId: string,
    businessRequestId: string,
    input: Readonly<{
      paymentId: string;
      amountCents: number;
      currency: string;
      occurredAt: string;
    }>,
  ) =>
    request<unknown>(
      financeEndpoint(
        organizationId,
        `/invoices/${encodeURIComponent(invoiceId)}/refunds`,
      ),
      {
        method: "POST",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ ...input, businessRequestId }),
      },
    ),
};
export const artworkApi = {
  workspace: (organizationId: string, query = "") =>
    request<{
      items: readonly (ArtworkOrderProjection &
        Readonly<{
          orderNumber: string;
          customerId?: string;
          customerDisplayName: string;
          lineDescription: string;
        }>)[];
    }>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/artwork/workspace${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    ),
  detail: (organizationId: string, artworkFileId: string) =>
    request<ArtworkWorkspaceDetail>(`/v2/organizations/${encodeURIComponent(organizationId)}/artwork/workspace/files/${encodeURIComponent(artworkFileId)}`),
  forOrder: (organizationId: string, orderId: string) =>
    request<readonly ArtworkOrderProjection[]>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/artwork/orders/${encodeURIComponent(orderId)}`,
    ),
  assign: (
    organizationId: string,
    artworkFileId: string,
    businessRequestId: string,
    usage: Record<string, unknown>,
  ) =>
    request<
      Readonly<{
        artworkFile: ArtworkOrderProjection["file"];
        assignment: ArtworkOrderProjection["assignment"];
      }>
    >(
      `/v2/organizations/${encodeURIComponent(organizationId)}/artwork/files/${encodeURIComponent(artworkFileId)}/assign`,
      {
        method: "POST",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body: JSON.stringify({ businessRequestId, usage }),
      },
    ),
  upload: (
    organizationId: string,
    businessRequestId: string,
    input: Readonly<{
      orderId: string;
      orderLineId: string;
      purpose: "customer_supplied" | "production" | "proof" | "reference";
      side?: "front" | "back";
      file: File;
    }>,
  ) => {
    const body = new FormData();
    body.append("businessRequestId", businessRequestId);
    body.append("orderId", input.orderId);
    body.append("orderLineId", input.orderLineId);
    body.append("purpose", input.purpose);
    if (input.side) body.append("side", input.side);
    body.append("file", input.file);
    return request<
      Readonly<{
        artworkFile: ArtworkOrderProjection["file"];
        assignment: ArtworkOrderProjection["assignment"];
      }>
    >(
      `/v2/organizations/${encodeURIComponent(organizationId)}/artwork/uploads`,
      {
        method: "POST",
        headers: {
          "x-v2-csrf-token": csrfTokens.get(csrfKey(organizationId)) ?? "",
        },
        body,
      },
    );
  },
};
const proofEndpoint = (org: string, suffix = "") =>
  `/v2/organizations/${encodeURIComponent(org)}/proofing${suffix}`;
const proofMutation = <T>(
  org: string,
  suffix: string,
  businessRequestId: string,
  input: Record<string, unknown>,
) =>
  request<T>(proofEndpoint(org, suffix), {
    method: "POST",
    headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(org)) ?? "" },
    body: JSON.stringify({ ...input, businessRequestId }),
  });
export const proofingApi = {
  orderWorks: (org: string, orderId: string) => request<readonly ProofWorkProjection[]>(proofEndpoint(org, `/orders/${encodeURIComponent(orderId)}/works`)),
  list: (org: string) =>
    request<readonly ProofQueueItem[]>(proofEndpoint(org, "/works?limit=50")),
  get: (org: string, proofWorkId: string) =>
    request<ProofWorkProjection>(
      proofEndpoint(org, `/works/${encodeURIComponent(proofWorkId)}`),
    ),
  start: (
    org: string,
    businessRequestId: string,
    orderId: string,
    orderLineId: string,
  ) =>
    proofMutation<ProofingMutationResult>(org, "/works", businessRequestId, {
      orderId,
      orderLineId,
    }),
  createVersion: (
    org: string,
    proofWorkId: string,
    businessRequestId: string,
    artworkAssignmentIds: readonly string[],
  ) =>
    proofMutation<ProofingMutationResult>(
      org,
      `/works/${encodeURIComponent(proofWorkId)}/versions`,
      businessRequestId,
      { artworkAssignmentIds },
    ),
  issue: (org: string, proofVersionId: string, businessRequestId: string) =>
    proofMutation<ProofingMutationResult>(
      org,
      `/versions/${encodeURIComponent(proofVersionId)}/issue`,
      businessRequestId,
      {},
    ),
  respond: (
    org: string,
    proofVersionId: string,
    businessRequestId: string,
    outcome: "approved" | "revision_requested",
    comment?: string,
    recordedCustomerId?: string,
  ) =>
    proofMutation<ProofingMutationResult>(
      org,
      `/versions/${encodeURIComponent(proofVersionId)}/respond`,
      businessRequestId,
      {
        outcome,
        ...(comment?.trim() ? { comment: comment.trim() } : {}),
        ...(recordedCustomerId ? { recordedCustomerId } : {}),
      },
    ),
};
const prepressEndpoint = (org: string, suffix = "") =>
  `/v2/organizations/${encodeURIComponent(org)}/prepress${suffix}`;
const prepressMutation = <T>(
  org: string,
  suffix: string,
  businessRequestId: string,
  input: Record<string, unknown>,
) =>
  request<T>(prepressEndpoint(org, suffix), {
    method: "POST",
    headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(org)) ?? "" },
    body: JSON.stringify({ ...input, businessRequestId }),
  });
export const prepressApi = {
  list: (org: string) =>
    request<readonly PrepressQueueItem[]>(
      prepressEndpoint(org, "/queue?limit=50"),
    ),
  get: (org: string, prepressUnitId: string) =>
    request<PrepressUnit>(
      prepressEndpoint(org, `/units/${encodeURIComponent(prepressUnitId)}`),
    ),
  coverage: (org: string, lineId: string) =>
    request<OrderLinePrepressCoverage>(
      prepressEndpoint(org, `/lines/${encodeURIComponent(lineId)}/coverage`),
    ),
  open: (org: string, businessRequestId: string, artworkAssignmentId: string) =>
    prepressMutation<{ unit: PrepressUnit }>(org, "/units", businessRequestId, {
      artworkAssignmentId,
    }),
  start: (org: string, prepressUnitId: string, businessRequestId: string) =>
    prepressMutation<{ unit: PrepressUnit }>(
      org,
      `/units/${encodeURIComponent(prepressUnitId)}/start`,
      businessRequestId,
      {},
    ),
  complete: (org: string, prepressUnitId: string, businessRequestId: string) =>
    prepressMutation<{ unit: PrepressUnit }>(
      org,
      `/units/${encodeURIComponent(prepressUnitId)}/complete`,
      businessRequestId,
      {},
    ),
};
const productionEndpoint = (org: string, suffix = "") =>
  `/v2/organizations/${encodeURIComponent(org)}/production${suffix}`;
const productionMutation = <T>(
  org: string,
  suffix: string,
  businessRequestId: string,
  input: Record<string, unknown>,
) =>
  request<T>(productionEndpoint(org, suffix), {
    method: "POST",
    headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(org)) ?? "" },
    body: JSON.stringify({ ...input, businessRequestId }),
  });
export const productionApi = {
  orderWorks: (org: string, orderId: string) => request<readonly ProductionWorkProjection[]>(productionEndpoint(org, `/orders/${encodeURIComponent(orderId)}/works`)),
  queue: (org: string, station: "flatbed" | "roll") =>
    request<readonly ProductionWorkProjection[]>(
      productionEndpoint(org, `/stations/${station}/queue?limit=50`),
    ),
  get: (org: string, id: string) =>
    request<ProductionWorkProjection>(
      productionEndpoint(org, `/works/${encodeURIComponent(id)}`),
    ),
  open: (org: string, businessRequestId: string, artworkAssignmentId: string) =>
    productionMutation<{ work: ProductionWorkProjection["work"] }>(
      org,
      "/works",
      businessRequestId,
      { artworkAssignmentId },
    ),
  start: (
    org: string,
    workId: string,
    businessRequestId: string,
    stationKey: "flatbed" | "roll",
    kind: "initial" | "reprint" | "correction",
  ) =>
    productionMutation<unknown>(
      org,
      `/works/${encodeURIComponent(workId)}/attempts`,
      businessRequestId,
      { stationKey, kind },
    ),
  output: (
    org: string,
    attemptId: string,
    businessRequestId: string,
    goodQuantityDelta: number,
  ) =>
    productionMutation<unknown>(
      org,
      `/attempts/${encodeURIComponent(attemptId)}/output`,
      businessRequestId,
      { goodQuantityDelta },
    ),
  complete: (org: string, attemptId: string, businessRequestId: string) =>
    productionMutation<unknown>(
      org,
      `/attempts/${encodeURIComponent(attemptId)}/complete`,
      businessRequestId,
      {},
    ),
  materials: (org: string, workId: string) =>
    request<ProductionMaterialProjection>(
      productionEndpoint(org, `/works/${encodeURIComponent(workId)}/materials`),
    ),
  recordMaterial: (
    org: string,
    workId: string,
    attemptId: string,
    businessRequestId: string,
    input: Readonly<{
      materialId: string;
      requirementId?: string;
      quantity: string;
      unit: ProductRecipeComponent["unit"];
      kind: "consumed" | "waste" | "correction";
      correctsConsumptionId?: string;
    }>,
  ) =>
    productionMutation<unknown>(
      org,
      `/works/${encodeURIComponent(workId)}/attempts/${encodeURIComponent(attemptId)}/materials`,
      businessRequestId,
      input as Record<string, unknown>,
    ),
  reserveMaterials: (org: string, workId: string, businessRequestId: string) =>
    productionMutation<unknown>(
      org,
      `/works/${encodeURIComponent(workId)}/reservations`,
      businessRequestId,
      {},
    ),
  releaseUnusedMaterials: (
    org: string,
    workId: string,
    businessRequestId: string,
  ) =>
    productionMutation<unknown>(
      org,
      `/works/${encodeURIComponent(workId)}/release-unused`,
      businessRequestId,
      {},
    ),
  reconcileMaterial: (
    org: string,
    workId: string,
    consumptionId: string,
    businessRequestId: string,
  ) =>
    productionMutation<unknown>(
      org,
      `/works/${encodeURIComponent(workId)}/reconciliation/${encodeURIComponent(consumptionId)}`,
      businessRequestId,
      {},
    ),
};
export type InventoryMaterialBalance = Readonly<{
  materialId: string;
  materialName: string;
  materialSku: string | null;
  unit: ProductRecipeComponent["unit"];
  onHandQuantity: string;
  reservedQuantity: string;
  availableQuantity: string;
}>;
export type InventoryReceipt = Readonly<{
  movementId: string;
  materialId: string;
  quantity: string;
  unit: ProductRecipeComponent["unit"];
  kind: "receipt";
  onHandDelta: string;
  reservedDelta: string;
  reason: string;
  createdAt: string;
}>;
const inventoryEndpoint = (org: string, suffix = "") =>
  `/v2/organizations/${encodeURIComponent(org)}/inventory${suffix}`;
export const inventoryApi = {
  materials: (org: string) =>
    request<readonly InventoryMaterialBalance[]>(
      inventoryEndpoint(org, "/materials"),
    ),
  receive: (
    org: string,
    materialId: string,
    businessRequestId: string,
    input: Readonly<{ quantity: string; reason: string }>,
  ) =>
    request<InventoryReceipt>(
      inventoryEndpoint(
        org,
        `/materials/${encodeURIComponent(materialId)}/receipts`,
      ),
      {
        method: "POST",
        headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(org)) ?? "" },
        body: JSON.stringify({ businessRequestId, ...input }),
      },
    ),
};
const fulfillmentEndpoint = (org: string, suffix = "") =>
  `/v2/organizations/${encodeURIComponent(org)}/fulfillment${suffix}`;
const fulfillmentMutation = (
  org: string,
  orderId: string,
  method: FulfillmentMethod,
  businessRequestId: string,
  allocations: readonly { orderLineId: string; quantity: number }[],
) =>
  request<FulfillmentTerminalResult>(
    fulfillmentEndpoint(
      org,
      `/orders/${encodeURIComponent(orderId)}/${method === "pickup" ? "pickups" : "shipments"}`,
    ),
    {
      method: "POST",
      headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(org)) ?? "" },
      body: JSON.stringify({ businessRequestId, allocations }),
    },
  );
export const fulfillmentApi = {
  list: (
    org: string,
    query?: Readonly<{ q?: string; cursor?: string; limit?: number }>,
  ) =>
    request<SalesListPage<FulfillmentWorkspaceOrder>>(
      withSearch(fulfillmentEndpoint(org), query),
    ),
  get: (org: string, orderId: string) =>
    request<FulfillmentWorkspaceOrder>(
      fulfillmentEndpoint(org, `/orders/${encodeURIComponent(orderId)}`),
    ),
  complete: (
    org: string,
    orderId: string,
    method: FulfillmentMethod,
    businessRequestId: string,
    allocations: readonly { orderLineId: string; quantity: number }[],
  ) =>
    fulfillmentMutation(org, orderId, method, businessRequestId, allocations),
};
export type RoutingWorkspaceRead = Readonly<{
  templates: readonly Readonly<{
    routeTemplateId: string;
    name: string;
    active: boolean;
    revision: string;
    definitionFingerprint: string;
    steps: readonly Readonly<{ position: number; kind: string }>[];
  }>[];
  instances: readonly Readonly<{
    routeInstanceId: string;
    state: string;
    revision: string;
    currentStepId?: string;
    currentPrerequisite?: Readonly<{ satisfied: boolean; reason?: string }>;
    sourceTemplate: Readonly<{
      routeTemplateId: string;
      revision: string;
      definitionFingerprint: string;
    }>;
    orderId: string;
    orderNumber: string;
    orderLineId: string;
    lineDescription: string;
    steps: readonly Readonly<{
      routeInstanceStepId: string;
      position: number;
      kind: string;
    }>[];
  }>[];
}>;
export const routingApi = {
  workspace: (org: string) =>
    request<RoutingWorkspaceRead>(
      `/v2/organizations/${encodeURIComponent(org)}/routing/workspace`,
    ),
  completeCurrent: (
    org: string,
    routeInstanceId: string,
    businessRequestId: string,
    expectedRevision: string,
  ) =>
    request<
      Readonly<{ routeInstance: RoutingWorkspaceRead["instances"][number] }>
    >(
      `/v2/organizations/${encodeURIComponent(org)}/routing/instances/${encodeURIComponent(routeInstanceId)}/complete-current`,
      {
        method: "POST",
        headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(org)) ?? "" },
        body: JSON.stringify({ businessRequestId, expectedRevision }),
      },
    ),
  createTemplate: (
    org: string,
    businessRequestId: string,
    input: Readonly<{
      name: string;
      steps: readonly Readonly<{
        position: number;
        kind: "proofing" | "prepress" | "production" | "fulfillment";
      }>[];
    }>,
  ) =>
    request<RoutingWorkspaceRead["templates"][number]>(
      `/v2/organizations/${encodeURIComponent(org)}/routing/templates`,
      {
        method: "POST",
        headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(org)) ?? "" },
        body: JSON.stringify({ businessRequestId, ...input }),
      },
    ),
  updateTemplate: (
    org: string,
    routeTemplateId: string,
    businessRequestId: string,
    input: Readonly<{
      expectedRevision: string;
      name: string;
      active: boolean;
      steps: readonly Readonly<{
        position: number;
        kind: "proofing" | "prepress" | "production" | "fulfillment";
      }>[];
    }>,
  ) =>
    request<RoutingWorkspaceRead["templates"][number]>(
      `/v2/organizations/${encodeURIComponent(org)}/routing/templates/${encodeURIComponent(routeTemplateId)}/update`,
      {
        method: "POST",
        headers: { "x-v2-csrf-token": csrfTokens.get(csrfKey(org)) ?? "" },
        body: JSON.stringify({ businessRequestId, ...input }),
      },
    ),
};
export const money = (value: { cents: number; currency: string }) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: value.currency,
  }).format(value.cents / 100);
