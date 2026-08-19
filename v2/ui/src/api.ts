export type ApiError = Readonly<{ code: string; message: string }>;
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
    terms: { commercialNotes?: string };
    currency: string;
    deliveryState: "not_sent" | "sent";
    acceptanceState: "not_accepted" | "accepted";
    convertedOrderId?: string;
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
  };
}>;
export type QuoteResult = Readonly<{ quote: QuoteRead; checkpointId?: string }>;
export type UiBootstrap = Readonly<{
  organizationId: string;
  csrfToken: string;
  /** Opaque session epoch, never a user/principal/capability claim. */
  sessionScope: string;
  capabilities: Readonly<{
    quoteView?: boolean;
    customerView?: boolean;
    productView?: boolean;
    productEdit?: boolean;
    quoteOverridePrice: boolean;
    quoteCreate?: boolean;
    quoteEdit?: boolean;
    quoteSend?: boolean;
    quoteConvert?: boolean;
    orderView?: boolean;
    orderEdit?: boolean;
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
    fulfillmentView?: boolean;
    fulfillmentPickup?: boolean;
    fulfillmentShip?: boolean;
    routeView?: boolean;
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
export type ProductLifecycle = "active" | "inactive" | "draft" | "active_with_draft";
export type ProductCatalogItem = Readonly<{ productId:string; displayName:string; category?:string; lifecycle:ProductLifecycle; measurementMode:"dimensions_required"|"quantity_only"; pricingSummary:string; productType?:Readonly<{displayName:string;routePolicy:"route_required"|"no_route"|"unconfigured"}>; primaryMaterialName?:string; activeVersion?:Readonly<{label:string;publishedAt?:string}>; hasDraft:boolean }>;
export type ProductVersionSummary = Readonly<{productVersionId:string;status:"active"|"draft"|"deprecated"|"archived";createdAt:string;updatedAt:string;publishedAt?:string;editable:boolean}>;
export type ProductVersionLifecycle = Readonly<{active?:ProductVersionSummary;draft?:ProductVersionSummary;history:readonly ProductVersionSummary[];historyLimit:number;historyHasMore:boolean;canCreateDraft:boolean}>;
export type ProductDraftGeneral = Readonly<{displayName:string;category:string|null;description:string|null;storefrontVisible:boolean;measurementMode:"dimensions_required"|"quantity_only";workflowIntent:"standard_production"|"fulfillment_only"|"service_fee";requiresProofApproval:boolean;requiresProductionJob:boolean}>;
export type ProductDraftGeneralRead = Readonly<{productId:string;draftVersionId:string;draftUpdatedAt:string;lifecycle:"draft";general:ProductDraftGeneral}>;
export type ProductDraftOptionInputType="boolean"|"select"|"multiselect"|"number"|"text"|"textarea";
export type ProductDraftOption=Readonly<{optionId:string;label:string;inputType:ProductDraftOptionInputType;required:boolean;defaultValue:string|number|boolean|null|readonly string[];choices:readonly Readonly<{choiceValue:string;label:string}>[];canRemove:boolean;removalReason?:string}>;
export type ProductDraftOptionsRead=Readonly<{productId:string;draftVersionId:string;draftUpdatedAt:string;lifecycle:"draft";options:readonly ProductDraftOption[]}>;
export type ProductDraftPricingTier=Readonly<{tierId:string;minimum:number;maximum:number|null;perPieceCents:number|null;perSqftCents:number|null;minimumChargeCents:number|null}>;
export type ProductDraftPricing=Readonly<{productId:string;draftVersionId:string;draftUpdatedAt:string;lifecycle:"draft";measurementMode:"dimensions_required"|"quantity_only";mode:"simple_base"|"simple_with_tiers"|"matrix"|"formula"|"advanced"|"unconfigured";editable:boolean;unavailableReason?:string;base:Readonly<{perPieceCents:number|null;perSqftCents:number|null;minimumChargeCents:number|null}>;tierBasis:"quantity"|"square_foot"|"computed_sheet_usage"|null;tiers:readonly ProductDraftPricingTier[]}>;
export type ProductDraftPricingPreview=Readonly<{quantity:number;dimensions?:Readonly<{width:number;height:number;unit:"in";areaSquareFeet:number}>;calculatedUnitAmount:Readonly<{cents:number;currency:string}>;calculatedLineAmount:Readonly<{cents:number;currency:string}>;minimumChargeApplied:boolean;tier?:Readonly<{basis:"quantity"|"square_foot"|"computed_sheet";value:string}>;breakdown:readonly Readonly<{label:string;cents:number;currency:string}>[];warnings:readonly string[]}>;
export type ProductDraftPricingMatrix=Readonly<{productId:string;draftVersionId:string;draftUpdatedAt:string;lifecycle:"draft";editable:boolean;unavailableReason?:string;matrixId:string;pricingUnit:"per_piece"|"per_square_foot";dimensions:readonly Readonly<{selectionKey:string;label:string;values:readonly Readonly<{value:string|number|boolean;label:string}>[]}>[];rows:readonly Readonly<{rowId:string;combination:Record<string,string|number|boolean>;baseRateCents:number;tierBasis:"quantity"|"computed_sheet_usage"|null;tiers:readonly ProductDraftPricingTier[]}>[];warnings:readonly string[]}>;
export type ProductDraftFormulaPricing=Readonly<{productId:string;draftVersionId:string;draftUpdatedAt:string;lifecycle:"draft";source:"embedded_editable"|"library_reference_read_only"|"matrix_plus_formula_read_only"|"unsupported_legacy";editable:boolean;unavailableReason?:string;formulaId?:string;formulaName?:string;expression:string;variables:Record<string,number>;supportedRuntimeVariables:readonly string[];warnings:readonly string[]}>;
export type ProductDraftOptionPricingImpact=Readonly<{type:"fixed"|"per_item"|"per_square_foot"|"percent_of_base"|"multiplier";value:number}>;
export type ProductDraftOptionPricing=Readonly<{productId:string;draftVersionId:string;draftUpdatedAt:string;lifecycle:"draft";options:readonly Readonly<{optionId:string;selectionKey:string;label:string;nodeImpact:ProductDraftOptionPricingImpact|null;choices:readonly Readonly<{choiceValue:string;label:string;impact:ProductDraftOptionPricingImpact|null;editable:boolean;readOnlyReason?:string}>[]}>[]}>;
export type ProductRecipeComponent=Readonly<{componentId?:string;materialId:string;materialName?:string;materialSku?:string|null;quantity:string;unit:"each"|"square_foot"|"linear_foot"|"sheet"|"roll";quantityKind:"per_line"|"per_piece"|"per_area";condition?:Readonly<{type:"selected";optionId:string;choiceValue:string}>;replacesPbv2Compatibility?:boolean}>;
export type ProductRecipe=Readonly<{recipeId:string;productId:string;productVersionId:string;draftUpdatedAt:string;lifecycle:"draft"|"active"|"historical";components:readonly ProductRecipeComponent[]}>;
export type ProductDraftRouting=Readonly<{productId:string;draftVersionId:string;draftUpdatedAt:string;lifecycle:"draft";routing:Readonly<{kind:"route_required";routeTemplateId:string;routeTemplateName:string;steps:readonly Readonly<{position:number;kind:"proofing"|"prepress"|"production"|"fulfillment"}>[];sourceTemplateRevision?:string;sourceTemplateFingerprint?:string}>|Readonly<{kind:"no_route"|"unconfigured"}>}>;
export type PublishedProductVersion=Readonly<{productId:string;productName:string;productVersionId:string;productUpdatedAt:string;productVersionUpdatedAt:string;publishedAt?:string;alreadyPublished:boolean;operationReference:"products.publish_configuration.v1"}>;
export type ProductMaterial=Readonly<{materialId:string;name:string;sku:string|null;unit:ProductRecipeComponent["unit"]}>;
export type ProductWorkspaceDetail = Readonly<ProductCatalogItem & { productUpdatedAt:string; description?:string; workflowIntent:"standard_production"|"fulfillment_only"|"service_fee"; requiresProductionJob:boolean; requiresProofApproval:boolean; configurableOptionCount:number;versions:ProductVersionLifecycle }>;
export type ProductCatalogPage = Readonly<{items:readonly ProductCatalogItem[];page:number;pageSize:number;total:number;hasMore:boolean}>;
export type FulfillmentMethod = "pickup" | "shipment";
export type FulfillmentAvailability = Readonly<{
  orderId: string;
  orderLineId: string;
  orderedQuantity: number;
  completedPickupQuantity: number;
  completedShipmentQuantity: number;
  completedFulfillmentQuantity: number;
  remainingFulfillmentQuantity: number;
}>;
export type FulfillmentWorkspaceOrder = Readonly<{
  orderId: string;
  number: string;
  commercialState: "open" | "cancelled";
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
  activeRecordClassification?: "CLOSED_HISTORY" | "ACTIVE_BUT_CAN_REMAIN_LEGACY" | "ACTIVE_REQUIRES_CUTOVER_STRATEGY" | "AMBIGUOUS";
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
    terms: { commercialNotes?: string };
    currency: string;
    commercialState: "open" | "cancelled";
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
}>;
export type ProductionMaterialProjection=Readonly<{usage:Readonly<{productionWorkId:string;facts:readonly Readonly<{consumptionId:string;materialId:string;materialName:string;materialSku:string|null;requirementId?:string;quantity:string;unit:ProductRecipeComponent["unit"];kind:"consumed"|"waste"|"correction";correctsConsumptionId?:string;createdAt:string}>[];comparison:readonly Readonly<{materialId:string;materialName:string;materialSku:string|null;requirementId?:string;unit:ProductRecipeComponent["unit"];expectedQuantity:string;consumedQuantity:string;wasteQuantity:string;correctionQuantity:string;totalPhysicalUsageQuantity:string;varianceQuantity:string}>[]}>;inventory:Readonly<{balances:readonly Readonly<{materialId:string;materialName:string;materialSku:string|null;unit:ProductRecipeComponent["unit"];onHandQuantity:string;reservedQuantity:string;availableQuantity:string}>[];facts:readonly Readonly<{consumptionId:string;status:"applied"|"unapplied"|"blocked"|"retryable";lastFailureCode?:string;lastFailureMessage?:string;attemptCount:number}>[]}>}>;
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
    cursor?: string;
    limit?: number;
  }> = {},
) => {
  const value = new URLSearchParams();
  if (query.q) value.set("q", query.q);
  if (query.lifecycle) value.set("lifecycle", query.lifecycle);
  if (query.cursor) value.set("cursor", query.cursor);
  if (query.limit) value.set("limit", String(query.limit));
  const text = value.toString();
  return text ? `${url}?${text}` : url;
};
const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include",
    ...init,
    // init may carry only the CSRF header. Apply merged headers after init so
    // a mutation is still parsed as JSON by the V2 HTTP boundary.
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
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
  get: (organizationId: string, quoteId: string) =>
    request<QuoteRead>(
      endpoint(organizationId, `/${encodeURIComponent(quoteId)}`),
    ),
  legacy: (organizationId: string, recordId: string) => request<LegacyCommercialDetail>(endpoint(organizationId, `/legacy/${encodeURIComponent(recordId)}`)),
  list: (
    organizationId: string,
    query?: Readonly<{
      q?: string;
      lifecycle?: string;
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
  action: (
    organizationId: string,
    quoteId: string,
    action: "send" | "accept",
    businessRequestId: string,
    expectedRevision: string,
  ) =>
    request<QuoteResult>(
      endpoint(organizationId, `/${encodeURIComponent(quoteId)}/${action}`),
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
  legacy: (organizationId: string, recordId: string) => request<LegacyCommercialDetail>(orderEndpoint(organizationId, `/legacy/${encodeURIComponent(recordId)}`)),
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
  activeRecordClassification?: "CLOSED_HISTORY" | "ACTIVE_BUT_CAN_REMAIN_LEGACY" | "ACTIVE_REQUIRES_CUTOVER_STRATEGY" | "AMBIGUOUS";
}>;
export const invoiceApi = {
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
  presentation: Readonly<{
    customerDisplayName?: string;
    contactDisplayName?: string;
    companyName?: string;
    email?: string;
    phone?: string;
    billingAddress?: Readonly<{ lines: readonly string[]; city?: string; region?: string; postalCode?: string; countryCode?: string }>;
    shippingAddress?: Readonly<{ lines: readonly string[]; city?: string; region?: string; postalCode?: string; countryCode?: string }>;
  }>;
  contacts: readonly Readonly<{ contactId: string; displayName: string; email?: string; phone?: string }>[];
}>;
export type CustomerCatalogItem = Readonly<{
  customerId: string; displayName: string; companyName: string; email?: string; phone?: string;
  primaryContact?: Readonly<{ contactId: string; displayName: string; email?: string; phone?: string }>;
}>;
export const customerApi = {
  list: (organizationId: string, query = "") => request<{ items: readonly CustomerCatalogItem[] }>(
    `/v2/organizations/${encodeURIComponent(organizationId)}/customers${query ? `?q=${encodeURIComponent(query)}` : ""}`,
  ),
  get: (organizationId: string, customerId: string) =>
    request<CustomerWorkspaceRead>(
      `/v2/organizations/${encodeURIComponent(organizationId)}/customers/${encodeURIComponent(customerId)}`,
    ),
};
export type ContactCatalogItem = Readonly<{
  contactId: string;
  displayName: string;
  email?: string;
  phone?: string;
  customerId: string;
  customerName: string;
  primary: boolean;
}>;
export type ContactWorkspaceRead = ContactCatalogItem & Readonly<{
  customerPresentation: CustomerWorkspaceRead["presentation"];
  relatedContacts: readonly ContactCatalogItem[];
}>;
export const contactApi = {
  list: (organizationId: string, query = "") => request<{ items: readonly ContactCatalogItem[]; total: number; accounts: number }>(
    `/v2/organizations/${encodeURIComponent(organizationId)}/contacts${query ? `?q=${encodeURIComponent(query)}` : ""}`,
  ),
  get: (organizationId: string, contactId: string) => request<ContactWorkspaceRead>(
    `/v2/organizations/${encodeURIComponent(organizationId)}/contacts/${encodeURIComponent(contactId)}`,
  ),
};
export const productApi = {
  list: (organizationId: string, query = "", page = 1) => request<ProductCatalogPage>(
    `/v2/organizations/${encodeURIComponent(organizationId)}/products?q=${encodeURIComponent(query)}&page=${page}&pageSize=50`,
  ),
  get: (organizationId: string, productId: string) => request<ProductWorkspaceDetail>(
    `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}`,
  ),
  createDraft: (organizationId:string,productId:string,businessRequestId:string,expectedActiveVersionUpdatedAt:string) => request<ProductVersionLifecycle>(
    `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/drafts`,
    {method:"POST",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId))??""},body:JSON.stringify({businessRequestId,expectedActiveVersionUpdatedAt})},
  ),
  publishDraft:(organizationId:string,productId:string,businessRequestId:string,input:Readonly<{draftVersionId:string;expectedProductUpdatedAt:string;expectedDraftUpdatedAt:string;confirmWarnings?:boolean;activateProduct?:boolean}>)=>request<PublishedProductVersion>(
    `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/publish`,
    {method:"POST",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId))??""},body:JSON.stringify({businessRequestId,...input})},
  ),
  draftGeneral: (organizationId:string,productId:string) => request<ProductDraftGeneralRead>(
    `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/general`,
  ),
  saveDraftGeneral: (organizationId:string,productId:string,businessRequestId:string,input:Readonly<{draftVersionId:string;expectedDraftUpdatedAt:string;general:ProductDraftGeneral}>) => request<ProductDraftGeneralRead>(
    `/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/general`,
    {method:"PATCH",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId))??""},body:JSON.stringify({businessRequestId,...input})},
  ),
  draftOptions:(organizationId:string,productId:string)=>request<ProductDraftOptionsRead>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/options`),
  saveDraftOptions:(organizationId:string,productId:string,businessRequestId:string,input:Readonly<{draftVersionId:string;expectedDraftUpdatedAt:string;options:readonly ProductDraftOption[]}>)=>request<ProductDraftOptionsRead>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/options`,{method:"PATCH",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId))??""},body:JSON.stringify({businessRequestId,...input})}),
  draftPricing:(organizationId:string,productId:string)=>request<ProductDraftPricing>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/pricing`),
  saveDraftPricing:(organizationId:string,productId:string,businessRequestId:string,input:Readonly<{draftVersionId:string;expectedDraftUpdatedAt:string;base:ProductDraftPricing["base"];tierBasis:ProductDraftPricing["tierBasis"];tiers:readonly ProductDraftPricingTier[]}>)=>request<ProductDraftPricing>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/pricing`,{method:"PATCH",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId))??""},body:JSON.stringify({businessRequestId,...input})}),
  previewDraftPricing:(organizationId:string,productId:string,input:Readonly<{quantity:number;width?:number;height?:number;selections?:Record<string,unknown>}>)=>request<ProductDraftPricingPreview>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/pricing/preview`,{method:"POST",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId))??""},body:JSON.stringify(input)}),
  draftPricingMatrix:(organizationId:string,productId:string)=>request<ProductDraftPricingMatrix>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/pricing/matrix`),
  saveDraftPricingMatrix:(organizationId:string,productId:string,businessRequestId:string,input:Readonly<{draftVersionId:string;expectedDraftUpdatedAt:string;matrixId:string;pricingUnit:"per_piece"|"per_square_foot";dimensions:readonly string[];rows:ProductDraftPricingMatrix["rows"]}>)=>request<ProductDraftPricingMatrix>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/pricing/matrix`,{method:"PATCH",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId))??""},body:JSON.stringify({businessRequestId,...input})}),
  draftFormula:(organizationId:string,productId:string)=>request<ProductDraftFormulaPricing>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/pricing/formula`),
  saveDraftFormula:(organizationId:string,productId:string,businessRequestId:string,input:Readonly<{draftVersionId:string;expectedDraftUpdatedAt:string;expression:string;variables:Record<string,number>}>)=>request<ProductDraftFormulaPricing>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/pricing/formula`,{method:"PATCH",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId))??""},body:JSON.stringify({businessRequestId,...input})}),
  draftOptionPricing:(organizationId:string,productId:string)=>request<ProductDraftOptionPricing>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/option-pricing`),
  saveDraftOptionPricing:(organizationId:string,productId:string,businessRequestId:string,input:Readonly<{draftVersionId:string;expectedDraftUpdatedAt:string;optionId:string;choiceValue?:string;impact:ProductDraftOptionPricingImpact|null}>)=>request<ProductDraftOptionPricing>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/option-pricing`,{method:"PATCH",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId))??""},body:JSON.stringify({businessRequestId,...input})}),
  draftRecipe:(organizationId:string,productId:string)=>request<ProductRecipe>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/recipe`),
  activeRecipe:(organizationId:string,productId:string)=>request<ProductRecipe>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/active/recipe`),
  materials:(organizationId:string,productId:string,query="")=>request<{items:readonly ProductMaterial[]}>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/materials?q=${encodeURIComponent(query)}`),
  saveDraftRecipe:(organizationId:string,productId:string,businessRequestId:string,input:Readonly<{draftVersionId:string;expectedDraftUpdatedAt:string;components:readonly ProductRecipeComponent[]}>)=>request<ProductRecipe>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/recipe`,{method:"PATCH",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId))??""},body:JSON.stringify({businessRequestId,...input})}),
  draftRouting:(organizationId:string,productId:string)=>request<ProductDraftRouting>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/routing`),
  saveDraftRouting:(organizationId:string,productId:string,businessRequestId:string,input:Readonly<{draftVersionId:string;expectedDraftUpdatedAt:string;routing:ProductDraftRouting["routing"]}>)=>request<ProductDraftRouting>(`/v2/organizations/${encodeURIComponent(organizationId)}/products/${encodeURIComponent(productId)}/draft/routing`,{method:"PATCH",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(organizationId))??""},body:JSON.stringify({businessRequestId,...input})}),
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
      financeEndpoint(organizationId, `/invoices/legacy/${encodeURIComponent(invoiceId)}`),
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
  workspace: (organizationId: string, query = "") => request<{ items: readonly (ArtworkOrderProjection & Readonly<{ orderNumber: string; customerDisplayName: string; lineDescription: string }>)[] }>(
    `/v2/organizations/${encodeURIComponent(organizationId)}/artwork/workspace${query ? `?q=${encodeURIComponent(query)}` : ""}`,
  ),
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
    proofMutation<unknown>(org, "/works", businessRequestId, {
      orderId,
      orderLineId,
    }),
  createVersion: (
    org: string,
    proofWorkId: string,
    businessRequestId: string,
    artworkAssignmentIds: readonly string[],
  ) =>
    proofMutation<unknown>(
      org,
      `/works/${encodeURIComponent(proofWorkId)}/versions`,
      businessRequestId,
      { artworkAssignmentIds },
    ),
  issue: (org: string, proofVersionId: string, businessRequestId: string) =>
    proofMutation<unknown>(
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
  ) =>
    proofMutation<unknown>(
      org,
      `/versions/${encodeURIComponent(proofVersionId)}/respond`,
      businessRequestId,
      { outcome, ...(comment?.trim() ? { comment: comment.trim() } : {}) },
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
  materials:(org:string,workId:string)=>request<ProductionMaterialProjection>(productionEndpoint(org,`/works/${encodeURIComponent(workId)}/materials`)),
  recordMaterial:(org:string,workId:string,attemptId:string,businessRequestId:string,input:Readonly<{materialId:string;requirementId?:string;quantity:string;unit:ProductRecipeComponent["unit"];kind:"consumed"|"waste"|"correction";correctsConsumptionId?:string}>)=>productionMutation<unknown>(org,`/works/${encodeURIComponent(workId)}/attempts/${encodeURIComponent(attemptId)}/materials`,businessRequestId,input as Record<string,unknown>),
  reserveMaterials:(org:string,workId:string,businessRequestId:string)=>productionMutation<unknown>(org,`/works/${encodeURIComponent(workId)}/reservations`,businessRequestId,{}),
  releaseUnusedMaterials:(org:string,workId:string,businessRequestId:string)=>productionMutation<unknown>(org,`/works/${encodeURIComponent(workId)}/release-unused`,businessRequestId,{}),
  reconcileMaterial:(org:string,workId:string,consumptionId:string,businessRequestId:string)=>productionMutation<unknown>(org,`/works/${encodeURIComponent(workId)}/reconciliation/${encodeURIComponent(consumptionId)}`,businessRequestId,{}),
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
  templates: readonly Readonly<{ routeTemplateId: string; name: string; active: boolean; revision: string; definitionFingerprint: string; steps: readonly Readonly<{ position: number; kind: string }>[] }> [];
  instances: readonly Readonly<{ routeInstanceId: string; state: string; currentStepId?: string; sourceTemplate: Readonly<{ routeTemplateId: string; revision: string; definitionFingerprint: string }>; orderId: string; orderNumber: string; orderLineId: string; lineDescription: string; steps: readonly Readonly<{ routeInstanceStepId: string; position: number; kind: string }>[] }> [];
}>;
export const routingApi = {
  workspace: (org: string) => request<RoutingWorkspaceRead>(`/v2/organizations/${encodeURIComponent(org)}/routing/workspace`),
  createTemplate:(org:string,businessRequestId:string,input:Readonly<{name:string;steps:readonly Readonly<{position:number;kind:"proofing"|"prepress"|"production"|"fulfillment"}>[]}>)=>request<RoutingWorkspaceRead["templates"][number]>(`/v2/organizations/${encodeURIComponent(org)}/routing/templates`,{method:"POST",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(org))??""},body:JSON.stringify({businessRequestId,...input})}),
  updateTemplate:(org:string,routeTemplateId:string,businessRequestId:string,input:Readonly<{expectedRevision:string;name:string;active:boolean;steps:readonly Readonly<{position:number;kind:"proofing"|"prepress"|"production"|"fulfillment"}>[]}>)=>request<RoutingWorkspaceRead["templates"][number]>(`/v2/organizations/${encodeURIComponent(org)}/routing/templates/${encodeURIComponent(routeTemplateId)}/update`,{method:"POST",headers:{"x-v2-csrf-token":csrfTokens.get(csrfKey(org))??""},body:JSON.stringify({businessRequestId,...input})}),
};
export const money = (value: { cents: number; currency: string }) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: value.currency,
  }).format(value.cents / 100);
