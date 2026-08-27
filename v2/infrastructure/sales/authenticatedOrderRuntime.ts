import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { PostgresPermissionAuthorityReader } from "../authorization/postgresPermissionAuthorityRead.js";
import {
  IssuedV2PrincipalProvider,
  type TrustedHostIdentitySource,
} from "../authentication/trustedHostPrincipalProvider.js";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import type {
  OrderHttpDependencies,
  OrderHttpService,
} from "../../src/interfaces/http/orderRoutes.js";
import { PostgresSalesWorkspaceReads } from "./postgresSalesWorkspaceReads.js";
import { PostgresCustomerDocumentService } from "./postgresCustomerDocuments.js";

export type AuthenticatedOrderRuntimeDependencies = Readonly<{
  pool: Pool;
  trustedHostIdentity: TrustedHostIdentitySource;
  trustedHostMiddleware: RequestHandler;
  /** Supplied by the M1.9 Sales composition root; this module never writes Orders. */
  service: OrderHttpService;
}>;

export type AuthenticatedOrderRuntime = Readonly<{
  dependencies: OrderHttpDependencies;
  trustedHostMiddleware: RequestHandler;
}>;

/**
 * Composition root for authenticated Order transport. The only request fact
 * crossing into V2 is verified identity; final permission-set authority is
 * freshly resolved server-side for every request.
 */
export const composeAuthenticatedOrderRuntime = (
  input: AuthenticatedOrderRuntimeDependencies,
): AuthenticatedOrderRuntime => {
  const issuer = new PermissionSetPrincipalIssuer(
    new PostgresPermissionAuthorityReader(input.pool),
  );
  return {
    dependencies: {
      service: input.service,
      principals: new IssuedV2PrincipalProvider(input.trustedHostIdentity, issuer),
      workspace: new PostgresSalesWorkspaceReads(input.pool),
      documents: new PostgresCustomerDocumentService(input.pool),
    },
    trustedHostMiddleware: input.trustedHostMiddleware,
  };
};
