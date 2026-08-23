import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import type { FormulaHttpDependencies } from "../../src/interfaces/http/formulaRoutes.js";
import { FormulaDomainApplicationService } from "../../src/modules/pricing/formulaDomain.js";
import { IssuedV2PrincipalProvider, type TrustedHostIdentitySource } from "../authentication/trustedHostPrincipalProvider.js";
import { PostgresPermissionAuthorityReader } from "../authorization/postgresPermissionAuthorityRead.js";
import { PostgresFormulaDomainReads, PostgresFormulaDomainTransactionRunner } from "./postgresFormulaDomain.js";

export type AuthenticatedFormulaRuntimeDependencies=Readonly<{pool:Pool;trustedHostIdentity:TrustedHostIdentitySource;trustedHostMiddleware:RequestHandler}>;
export type AuthenticatedFormulaRuntime=Readonly<{dependencies:FormulaHttpDependencies;trustedHostMiddleware:RequestHandler}>;
/** Composition root for tenant-scoped Formula-domain reads and revision authoring. */
export const composeAuthenticatedFormulaRuntime=(input:AuthenticatedFormulaRuntimeDependencies):AuthenticatedFormulaRuntime=>({
  dependencies:{reads:new PostgresFormulaDomainReads(input.pool),service:new FormulaDomainApplicationService(new PostgresFormulaDomainTransactionRunner(input.pool)),principals:new IssuedV2PrincipalProvider(input.trustedHostIdentity,new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(input.pool)))},
  trustedHostMiddleware:input.trustedHostMiddleware,
});
