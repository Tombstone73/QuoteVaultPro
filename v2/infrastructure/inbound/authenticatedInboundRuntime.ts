import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { PostgresPermissionAuthorityReader } from "../authorization/postgresPermissionAuthorityRead.js";
import { IssuedV2PrincipalProvider, type TrustedHostIdentitySource } from "../authentication/trustedHostPrincipalProvider.js";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import type { InboundHttpDependencies } from "../../src/interfaces/http/inboundRoutes.js";
import { InboundIntakeApplicationService } from "../../src/modules/inbound/inboundIntakeApplication.js";
import { OrderApplicationService } from "../../src/modules/sales/orderApplication.js";
import { PostgresInboundIntakeStore } from "./postgresInboundIntakeStore.js";

export type AuthenticatedInboundRuntimeDependencies = Readonly<{
  pool: Pool;
  trustedHostIdentity: TrustedHostIdentitySource;
  trustedHostMiddleware: RequestHandler;
  /** The same canonical Sales writer mounted by the V2 Order route. */
  orders: OrderApplicationService;
}>;
export type AuthenticatedInboundRuntime = Readonly<{
  dependencies: InboundHttpDependencies;
  trustedHostMiddleware: RequestHandler;
}>;

/** Inbound owns source evidence/review only; conversion calls the injected Sales application service. */
export const composeAuthenticatedInboundRuntime = (
  input: AuthenticatedInboundRuntimeDependencies,
): AuthenticatedInboundRuntime => {
  const principals = new IssuedV2PrincipalProvider(
    input.trustedHostIdentity,
    new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(input.pool)),
  );
  const service = new InboundIntakeApplicationService(
    new PostgresInboundIntakeStore(input.pool),
    { createOrder: (context, command) => input.orders.create(context, command) },
  );
  return { dependencies: { service, principals }, trustedHostMiddleware: input.trustedHostMiddleware };
};
