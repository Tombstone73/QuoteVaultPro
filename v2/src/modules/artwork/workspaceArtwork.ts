import type { OperationContext } from "../../application/operation.js";
import type { ApplicationResult } from "../../errors/applicationError.js";
import type { SalesWorkspaceLineMapEntry } from "../sales/workspaceContracts.js";

export type WorkspaceArtworkState = "pending" | "uploaded" | "promoted" | "cleanup_pending" | "deleted" | "retained";

/** Public projection deliberately excludes private storage keys and upload leases. */
export type WorkspaceArtworkClaim = Readonly<{
  id: string;
  workspaceId: string;
  workspaceLineId: string | null;
  filename: string;
  contentType: "application/pdf";
  byteSize: number;
  checksumSha256: string;
  state: WorkspaceArtworkState;
  artworkFileId: string | null;
  assignmentId: string | null;
}>;

export type WorkspaceArtworkMutation = Readonly<{
  workspaceId: string;
  expectedRevision: number;
  requestId: string;
}>;

export type WorkspaceArtworkUploadInput = WorkspaceArtworkMutation & Readonly<{
  workspaceLineId?: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}>;

export type WorkspaceArtworkResult = Readonly<{ claim: WorkspaceArtworkClaim; workspaceRevision: number }>;

export type WorkspaceArtworkPromotionInput = Readonly<{
  organizationId: string;
  workspaceId: string;
  actor: OperationContext;
  documentKind: "quote" | "order";
  documentId: string;
  lineMap: readonly SalesWorkspaceLineMapEntry[];
}>;
export type WorkspaceArtworkPromotionResult = Readonly<{ promotedCount: number; claims: readonly WorkspaceArtworkClaim[] }>;

export interface WorkspaceArtworkUploads {
  upload(context: OperationContext, input: WorkspaceArtworkUploadInput): Promise<ApplicationResult<WorkspaceArtworkResult>>;
}

export interface WorkspaceArtworkLifecycle {
  list(context: OperationContext, workspaceId: string): Promise<readonly WorkspaceArtworkClaim[]>;
  assign(context: OperationContext, input: WorkspaceArtworkMutation & Readonly<{ claimId: string; workspaceLineId: string }>): Promise<WorkspaceArtworkResult>;
  remove(context: OperationContext, input: WorkspaceArtworkMutation & Readonly<{ claimId: string }>): Promise<WorkspaceArtworkResult>;
}

/** Cleanup is an explicit maintenance operation, never an application startup sweep. */
export type WorkspaceArtworkCleanupSummary = Readonly<{
  inspected: number;
  /** Successful removal calls; an unresolved upload can still require a recheck. */
  deleted: number;
  retained: number;
  failed: number;
  busy: number;
  /** Includes released claims with unsettled/ambiguous writes, even if currently absent. */
  remaining: number;
}>;

export interface WorkspaceArtworkMaintenance {
  cleanup(input: Readonly<{ organizationId: string; limit: number }>): Promise<WorkspaceArtworkCleanupSummary>;
}

/** The legacy reconciler must defer these intents to the workspace lifecycle. */
export interface WorkspaceArtworkStorageLiveness {
  ownsStorageIntent(input: Readonly<{ organizationId: string; intentId: string; storageProvider: string; objectKey: string }>): Promise<boolean>;
}
