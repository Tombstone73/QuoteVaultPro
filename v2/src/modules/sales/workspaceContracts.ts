import type { OperationContext } from "../../application/operation.js";
import type { CustomerContactReference } from "../customers/contracts.js";
import type { PricingResult, ResolvedProductConfiguration } from "../pricing/contracts.js";
import type { OperatorPricingExplanation } from "../pricing/operatorPricingExplanation.js";
import type { CommercialTerms, RequestedFulfillment, SellingPriceDecision } from "./contracts.js";
import type { QuoteLineInput, QuoteSellingInstruction } from "./quoteApplication.js";

export type SalesWorkspaceKind = "new_sales" | "quote_edit" | "order_edit";
export type SalesWorkspaceState = "draft" | "promoting" | "promoted" | "discarded" | "expired";
export type SalesWorkspaceTarget = "quote" | "order";
export type SalesWorkspaceHeader = Readonly<{
  customerContact?: CustomerContactReference;
  purchaseOrderNumber?: string;
  jobLabel?: string;
  requestedDueDate?: string;
  requestedFulfillment?: RequestedFulfillment;
  terms?: CommercialTerms;
  notes?: string;
}>;
export type SalesWorkspaceLineInput = Omit<QuoteLineInput, "selling"> & Readonly<{
  selling?: Extract<QuoteSellingInstruction, { kind: "calculated" | "unit_override" | "total_override" }>;
}>;
/** Produced by Products/Pricing and Sales, never accepted as client input. */
export type SalesWorkspaceLinePreview = Readonly<{
  target: SalesWorkspaceTarget;
  inputFingerprint: string;
  customerContact?: CustomerContactReference;
  resolvedConfiguration: ResolvedProductConfiguration;
  pricingResult: PricingResult;
  sellingPriceDecision: SellingPriceDecision;
  explanation?: OperatorPricingExplanation;
  calculatedAt: string;
}>;
export type WorkspaceLine = Readonly<{
  id: string;
  workspaceId: string;
  position: number;
  sourceLineId?: string;
  input: SalesWorkspaceLineInput;
  previews?: Readonly<{ quote?: SalesWorkspaceLinePreview; order?: SalesWorkspaceLinePreview }>;
  revision: number;
}>;
export type SalesWorkspaceLineMapEntry = Readonly<{
  workspaceLineId: string;
  canonicalLineId: string;
  position: number;
}>;
export type SalesWorkspacePromotionReceipt = Readonly<{
  workspaceId: string;
  organizationId: string;
  requestId: string;
  fingerprint: string;
  inputRevision: number;
  target: SalesWorkspaceTarget;
  documentId: string;
  documentRevision: string;
  displayNumber?: string;
  header: SalesWorkspaceHeader;
  lineMap: readonly SalesWorkspaceLineMapEntry[];
  promotedAt: string;
  /** Server-authored canonical creation result, never accepted as client input. */
  result?: Readonly<Record<string, unknown>>;
  artworkPromoted?: boolean;
}>;
export type SalesWorkspace = Readonly<{
  id: string;
  organizationId: string;
  creatorUserId: string;
  kind: SalesWorkspaceKind;
  state: SalesWorkspaceState;
  sourceDocumentKind?: SalesWorkspaceTarget;
  sourceDocumentId?: string;
  baseRevision?: string;
  revision: number;
  header: SalesWorkspaceHeader;
  lines: readonly WorkspaceLine[];
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  promotion?: SalesWorkspacePromotionReceipt;
}>;
export type SalesWorkspaceMutation = Readonly<{ requestId: string; expectedRevision: number }>;
export type CreateSalesWorkspaceInput = Readonly<{
  requestId: string;
  kind?: SalesWorkspaceKind;
  header?: SalesWorkspaceHeader;
  sourceDocumentKind?: SalesWorkspaceTarget;
  sourceDocumentId?: string;
  baseRevision?: string;
}>;
/** Replaces the draft header; omitted optional fields are cleared. */
export type SaveSalesWorkspaceInput = SalesWorkspaceMutation & Readonly<{ header: SalesWorkspaceHeader }>;
export type SalesWorkspaceRequestReceipt = Readonly<{
  operation: string;
  fingerprint: string;
  result: SalesWorkspace;
}>;

/** Caller holds the workspace lock before any line/header/receipt write.
 * Implementations join the caller's transaction and never begin/commit it. */
export interface SalesWorkspaceTransaction {
  lockCreationRequest(organizationId: string, requestId: string): Promise<void>;
  findCreation(organizationId: string, requestId: string): Promise<Readonly<{ workspaceId: string; creatorUserId: string; fingerprint: string }> | null>;
  create(workspace: SalesWorkspace, requestId: string, fingerprint: string): Promise<void>;
  get(organizationId: string, creatorUserId: string, workspaceId: string, lock?: boolean): Promise<SalesWorkspace | null>;
  list(organizationId: string, creatorUserId: string, now: string, limit: number): Promise<readonly SalesWorkspace[]>;
  update(workspace: SalesWorkspace, expectedRevision: number): Promise<void>;
  putLine(organizationId: string, line: WorkspaceLine): Promise<void>;
  deleteLine(organizationId: string, workspaceId: string, lineId: string): Promise<void>;
  reorderLines(organizationId: string, workspaceId: string, lineIds: readonly string[]): Promise<void>;
  invalidatePreviews(organizationId: string, workspaceId: string): Promise<void>;
  getRequest(organizationId: string, workspaceId: string, requestId: string): Promise<SalesWorkspaceRequestReceipt | null>;
  recordRequest(organizationId: string, workspaceId: string, requestId: string, receipt: SalesWorkspaceRequestReceipt): Promise<void>;
  getPromotion(organizationId: string, workspaceId: string): Promise<SalesWorkspacePromotionReceipt | null>;
  lockPromotionRequest(organizationId: string, requestId: string): Promise<void>;
  findPromotionRequest(organizationId: string, requestId: string): Promise<SalesWorkspacePromotionReceipt | null>;
  /** Transaction-local state transition; leaves header and revision unchanged. */
  beginPromotion(organizationId: string, workspaceId: string, expectedRevision: number,
    requestId: string, target: SalesWorkspaceTarget, fingerprint: string): Promise<void>;
  recordPromotionLineMap(organizationId: string, workspaceId: string, target: SalesWorkspaceTarget,
    documentId: string, lineMap: readonly SalesWorkspaceLineMapEntry[]): Promise<void>;
  getPromotionLineMap(organizationId: string, workspaceId: string): Promise<readonly SalesWorkspaceLineMapEntry[]>;
  recordPromotion(receipt: SalesWorkspacePromotionReceipt): Promise<void>;
  expireDrafts(organizationId: string, creatorUserId: string, now: string, limit: number): Promise<readonly string[]>;
}
export interface SalesWorkspaceStore {
  run<T>(work: (transaction: SalesWorkspaceTransaction) => Promise<T>): Promise<T>;
  withWorkspace<T>(context: OperationContext, workspaceId: string, expectedRevision: number,
    work: (transaction: SalesWorkspaceTransaction, workspace: SalesWorkspace) => Promise<T>): Promise<T>;
}
