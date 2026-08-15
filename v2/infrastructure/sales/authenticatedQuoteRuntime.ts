import type { Pool } from "pg";
import type { RequestHandler } from "express";
import { PostgresPermissionAuthorityReader } from "../authorization/postgresPermissionAuthorityRead.js";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import type { QuoteHttpDependencies } from "../../src/interfaces/http/quoteRoutes.js";
import { QuoteApplicationService } from "../../src/modules/sales/quoteApplication.js";
import {
  IssuedV2PrincipalProvider,
  type TrustedHostIdentitySource,
} from "../authentication/trustedHostPrincipalProvider.js";
import { PostgresQuoteTransactionRunner } from "./postgresQuoteTransaction.js";
import { PostgresQuoteFormReads } from "./postgresQuoteFormReads.js";

export type AuthenticatedQuoteRuntimeDependencies = Readonly<{
  pool: Pool;
  trustedHostIdentity: TrustedHostIdentitySource;
  trustedHostMiddleware: RequestHandler;
}>;

export type AuthenticatedQuoteRuntime = Readonly<{
  dependencies: QuoteHttpDependencies;
  trustedHostMiddleware: RequestHandler;
}>;

/** Composition root for an authenticated human Quote request; Sales receives no raw session data. */
export const composeAuthenticatedQuoteRuntime = (
  input: AuthenticatedQuoteRuntimeDependencies,
): AuthenticatedQuoteRuntime => {
  const principalIssuer = new PermissionSetPrincipalIssuer(
    new PostgresPermissionAuthorityReader(input.pool),
  );
  return {
    dependencies: {
      service: new QuoteApplicationService(
        new PostgresQuoteTransactionRunner(input.pool),
      ),
      principals: new IssuedV2PrincipalProvider(
        input.trustedHostIdentity,
        principalIssuer,
      ),
      formReads: new PostgresQuoteFormReads(input.pool),
    },
    trustedHostMiddleware: input.trustedHostMiddleware,
  };
};
