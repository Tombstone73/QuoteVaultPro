import type { PoolClient } from "pg";
import type { OperationContext } from "../../src/application/operation.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import {
  authorizeSalesWorkspace, assertSalesWorkspaceMutable, bumpSalesWorkspaceRevision,
  validateSalesWorkspaceId,
} from "../../src/modules/sales/workspaceApplication.js";
import type { SalesWorkspace, SalesWorkspaceLineMapEntry } from "../../src/modules/sales/workspaceContracts.js";
import { PostgresSalesWorkspaceTransaction } from "./postgresSalesWorkspace.js";

/** Bounded Sales-owned access for Artwork; never expose a Sales repository or
 * permit Artwork to update commercial headers/lines directly. Caller owns tx. */
export async function lockSalesWorkspaceForArtwork(
  client: PoolClient, context: OperationContext, workspaceId: string,
  expectedRevision?: number, allowPromoting = false,
): Promise<SalesWorkspace> {
  const workspace = await readSalesWorkspaceForArtwork(client, context, workspaceId, true);
  if (allowPromoting && workspace.state === "promoted") return workspace;
  if (allowPromoting && workspace.state === "promoting") {
    if (Date.parse(workspace.expiresAt) <= Date.now() || (expectedRevision !== undefined && workspace.revision !== expectedRevision)) {
      throw new V2ApplicationError("CONFLICT", "Sales workspace expired or changed.");
    }
  } else {
    assertSalesWorkspaceMutable(workspace, expectedRevision ?? workspace.revision);
  }
  return workspace;
}

/** Read-only lifecycle inspection also permits cleanup/replay of terminal
 * workspaces; it never grants mutation authority or revives a discarded draft. */
export async function readSalesWorkspaceForArtwork(
  client: PoolClient, context: OperationContext, workspaceId: string, lock = false,
): Promise<SalesWorkspace> {
  const actor = authorizeSalesWorkspace(context);
  validateSalesWorkspaceId(workspaceId);
  const workspace = await new PostgresSalesWorkspaceTransaction(client).get(
    context.organizationId, actor.userId, workspaceId, lock,
  );
  if (!workspace) throw new V2ApplicationError("NOT_FOUND", "Sales workspace not found.");
  authorizeSalesWorkspace(context, workspace);
  return workspace;
}

export async function advanceSalesWorkspaceArtworkRevision(
  client: PoolClient, context: OperationContext, workspaceId: string, expectedRevision: number,
): Promise<SalesWorkspace> {
  const actor = authorizeSalesWorkspace(context);
  validateSalesWorkspaceId(workspaceId);
  const tx = new PostgresSalesWorkspaceTransaction(client);
  const workspace = await tx.get(context.organizationId, actor.userId, workspaceId, true);
  if (!workspace) throw new V2ApplicationError("NOT_FOUND", "Sales workspace not found.");
  authorizeSalesWorkspace(context, workspace);
  assertSalesWorkspaceMutable(workspace, expectedRevision);
  const next = bumpSalesWorkspaceRevision(workspace);
  await tx.update(next, expectedRevision);
  return next;
}

export async function readSalesWorkspacePromotionLineMap(
  client: PoolClient, context: OperationContext, workspaceId: string,
): Promise<readonly SalesWorkspaceLineMapEntry[]> {
  const workspace = await lockSalesWorkspaceForArtwork(client, context, workspaceId, undefined, true);
  if (workspace.state !== "promoting" && workspace.state !== "promoted") throw new V2ApplicationError("CONFLICT", "Workspace has no promotion mapping.");
  return new PostgresSalesWorkspaceTransaction(client).getPromotionLineMap(context.organizationId, workspaceId);
}
