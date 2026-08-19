import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { PostgresPermissionAuthorityReader } from "../authorization/postgresPermissionAuthorityRead.js";
import { IssuedV2PrincipalProvider, type TrustedHostIdentitySource } from "../authentication/trustedHostPrincipalProvider.js";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import type { InventoryHttpDependencies } from "../../src/interfaces/http/inventoryRoutes.js";
import { InventoryLedgerApplicationService } from "../../src/modules/inventory/inventoryLedger.js";
import { PostgresInventoryLedgerTransactionRunner } from "./postgresInventoryLedgerTransaction.js";

export type AuthenticatedInventoryRuntimeDependencies = Readonly<{ pool: Pool; trustedHostIdentity: TrustedHostIdentitySource; trustedHostMiddleware: RequestHandler; inventory?: InventoryLedgerApplicationService }>;
export type AuthenticatedInventoryRuntime = Readonly<{ dependencies: InventoryHttpDependencies; trustedHostMiddleware: RequestHandler }>;
export const composeAuthenticatedInventoryRuntime = (input: AuthenticatedInventoryRuntimeDependencies): AuthenticatedInventoryRuntime => ({
  dependencies: { inventory: input.inventory ?? new InventoryLedgerApplicationService(new PostgresInventoryLedgerTransactionRunner(input.pool)), principals: new IssuedV2PrincipalProvider(input.trustedHostIdentity, new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(input.pool))) },
  trustedHostMiddleware: input.trustedHostMiddleware,
});
