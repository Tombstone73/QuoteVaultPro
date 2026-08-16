import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { PostgresPermissionAuthorityReader } from "../authorization/postgresPermissionAuthorityRead.js";
import { IssuedV2PrincipalProvider, type TrustedHostIdentitySource } from "../authentication/trustedHostPrincipalProvider.js";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import { PrepressApplicationService } from "../../src/modules/prepress/prepressApplication.js";
import type { PrepressHttpDependencies } from "../../src/interfaces/http/prepressRoutes.js";
import { PostgresPrepressTransactionRunner } from "./postgresPrepressTransaction.js";

export type AuthenticatedPrepressRuntimeDependencies=Readonly<{pool:Pool;trustedHostIdentity:TrustedHostIdentitySource;trustedHostMiddleware:RequestHandler;service?:PrepressApplicationService}>;
export type AuthenticatedPrepressRuntime=Readonly<{dependencies:PrepressHttpDependencies;trustedHostMiddleware:RequestHandler}>;
export const composeAuthenticatedPrepressRuntime=(input:AuthenticatedPrepressRuntimeDependencies):AuthenticatedPrepressRuntime=>({dependencies:{service:input.service??new PrepressApplicationService(new PostgresPrepressTransactionRunner(input.pool)),principals:new IssuedV2PrincipalProvider(input.trustedHostIdentity,new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(input.pool)))},trustedHostMiddleware:input.trustedHostMiddleware});
