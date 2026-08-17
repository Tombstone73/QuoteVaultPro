import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import type { RoutingHttpDependencies } from "../../src/interfaces/http/routingRoutes.js";
import { PostgresPermissionAuthorityReader } from "../authorization/postgresPermissionAuthorityRead.js";
import { IssuedV2PrincipalProvider, type TrustedHostIdentitySource } from "../authentication/trustedHostPrincipalProvider.js";
import { PostgresRoutingWorkspaceReads } from "./postgresRoutingWorkspaceReads.js";

export type AuthenticatedRoutingRuntimeDependencies = Readonly<{ pool: Pool; trustedHostIdentity: TrustedHostIdentitySource; trustedHostMiddleware: RequestHandler }>;
export type AuthenticatedRoutingRuntime = Readonly<{ dependencies: RoutingHttpDependencies; trustedHostMiddleware: RequestHandler }>;
export const composeAuthenticatedRoutingRuntime = (input: AuthenticatedRoutingRuntimeDependencies): AuthenticatedRoutingRuntime => ({
  dependencies: { workspace: new PostgresRoutingWorkspaceReads(input.pool), principals: new IssuedV2PrincipalProvider(input.trustedHostIdentity, new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(input.pool))) },
  trustedHostMiddleware: input.trustedHostMiddleware,
});
