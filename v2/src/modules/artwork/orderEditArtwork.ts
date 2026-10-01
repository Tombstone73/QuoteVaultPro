import type { OperationContext } from "../../application/operation.js";
import type { SalesWorkspaceLineMapEntry } from "../sales/workspaceContracts.js";
import type { WorkspaceArtworkPromotionResult } from "./workspaceArtwork.js";

export type OrderEditArtworkAction = "KEEP" | "REMOVE";
export type OrderEditArtworkSourceLine = Readonly<{ workspaceLineId: string; canonicalLineId: string }>;
export type OrderEditArtworkSourceInput = Readonly<{
  context: OperationContext;
  workspaceId: string;
  orderId: string;
}>;
export type CaptureOrderEditArtworkInput = OrderEditArtworkSourceInput & Readonly<{
  /** Complete Sales-owned source mapping, never client-authored evidence. */
  lineMap: readonly OrderEditArtworkSourceLine[];
}>;
export type ApplyOrderEditArtworkInput = OrderEditArtworkSourceInput & Readonly<{
  lineMap: readonly SalesWorkspaceLineMapEntry[];
}>;
export type OrderEditArtworkReference = Readonly<{
  workspaceLineId: string;
  sourceCanonicalLineId: string;
  sourceAssignmentId: string;
  artworkFileId: string;
  status: "current" | "removed" | "superseded" | "removed_and_superseded";
  action: OrderEditArtworkAction;
  filename: string;
  contentType: string;
  byteSize: number;
  purpose: "customer_supplied" | "production" | "proof" | "reference";
  sourceQuoteAcceptedArtworkSnapshotId: string | null;
}>;
export type OrderEditArtworkIntentResult = Readonly<{
  sourceAssignmentId: string;
  action: OrderEditArtworkAction;
  workspaceRevision: number;
}>;
export type OrderEditArtworkValidation = Readonly<{
  hasChanges: boolean;
  /** Assignment history always retains its canonical Sales-line FK. */
  sourceLineIdsWithHistory: readonly string[];
}>;
export type OrderEditArtworkApplyResult = WorkspaceArtworkPromotionResult & Readonly<{ removedCount: number }>;

/** These reference operations never upload/adopt a kept canonical file. New
 * PDFs continue to use the existing WorkspaceArtworkUploads contract. */
export interface OrderEditArtwork {
  readOrderEditArtwork(context: OperationContext, workspaceId: string): Promise<readonly OrderEditArtworkReference[]>;
  stageOrderEditArtworkIntent(context: OperationContext, workspaceId: string, sourceAssignmentId: string,
    action: OrderEditArtworkAction, expectedWorkspaceRevision: number, requestId: string): Promise<OrderEditArtworkIntentResult>;
}
