import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { PostgresPermissionAuthorityReader } from "../authorization/postgresPermissionAuthorityRead.js";
import { IssuedV2PrincipalProvider, type TrustedHostIdentitySource } from "../authentication/trustedHostPrincipalProvider.js";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import { ArtworkApplicationService } from "../../src/modules/artwork/artworkApplication.js";
import type { ArtworkHttpDependencies } from "../../src/interfaces/http/artworkRoutes.js";
import { PostgresArtworkTransactionRunner } from "./postgresArtworkTransaction.js";
import { PostgresArtworkWorkspaceReads } from "./postgresArtworkWorkspaceReads.js";

export type AuthenticatedArtworkRuntimeDependencies = Readonly<{ pool: Pool; trustedHostIdentity: TrustedHostIdentitySource; trustedHostMiddleware: RequestHandler; service?: ArtworkApplicationService }>;
export type AuthenticatedArtworkRuntime = Readonly<{ dependencies: ArtworkHttpDependencies; trustedHostMiddleware: RequestHandler }>;

export const composeAuthenticatedArtworkRuntime = (input: AuthenticatedArtworkRuntimeDependencies): AuthenticatedArtworkRuntime => ({
  dependencies: { service: input.service ?? new ArtworkApplicationService(new PostgresArtworkTransactionRunner(input.pool)), workspace: new PostgresArtworkWorkspaceReads(input.pool), principals: new IssuedV2PrincipalProvider(input.trustedHostIdentity, new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(input.pool))) },
  trustedHostMiddleware: input.trustedHostMiddleware,
});
