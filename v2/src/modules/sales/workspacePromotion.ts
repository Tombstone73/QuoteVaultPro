import type { OperationContext } from "../../application/operation.js";
import { V2ApplicationError, type ApplicationResult } from "../../errors/applicationError.js";
import type { JsonValue } from "../shared/commercialValues.js";
import type { SalesWorkspaceHeader, SalesWorkspacePromotionReceipt, SalesWorkspaceTarget } from "./workspaceContracts.js";

export type PromoteSalesWorkspaceInput = Readonly<{
  workspaceId: string;
  target: SalesWorkspaceTarget;
  requestId: string;
  expectedRevision: number;
}>;

/** Immutable creation evidence, not a projection of later canonical edits.
 * Document number cores are decimal strings, so receipts are JSON-safe. */
export type WorkspacePromotionReceipt = SalesWorkspacePromotionReceipt & Readonly<{
  result: Readonly<Record<string, JsonValue>>;
  artworkPromoted: boolean;
}>;

export type WorkspacePromotionResult = Readonly<{
  receipt: WorkspacePromotionReceipt;
  replayed: boolean;
  /** Preserved workspace metadata, not evidence of canonical display bindings. */
  promotedWorkspaceHeader: SalesWorkspaceHeader;
}>;

export interface WorkspacePromotion {
  promote(context: OperationContext, input: PromoteSalesWorkspaceInput): Promise<ApplicationResult<WorkspacePromotionResult>>;
}

export type WorkspacePromotionConflict =
  | "workspace_state"
  | "workspace_expired"
  | "workspace_revision"
  | "promotion_request"
  | "preview_required"
  | "preview_stale";

export class WorkspacePromotionConflictError extends V2ApplicationError {
  constructor(reason: WorkspacePromotionConflict, message: string) {
    super("CONFLICT", message, { reason });
  }
}
