import type { Pool } from "pg";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import { IssuedV2PrincipalProvider, type TrustedHostIdentitySource } from "../authentication/trustedHostPrincipalProvider.js";
import { PostgresPermissionAuthorityReader } from "../authorization/postgresPermissionAuthorityRead.js";
import type { QuickBooksIntegrationHttpDependencies } from "../../src/interfaces/http/quickBooksIntegrationRoutes.js";
import { QuickBooksIntegrationReadinessService } from "./quickBooksIntegrationReadiness.js";
import { PostgresQuickBooksSyncNow } from "./quickBooksBillingQueue.js";

export const composeAuthenticatedQuickBooksIntegrationRuntime=(input:Readonly<{pool:Pool;trustedHostIdentity:TrustedHostIdentitySource;publicWebOrigin?:string}>):QuickBooksIntegrationHttpDependencies=>({integrations:new QuickBooksIntegrationReadinessService(),quickBooksSync:new PostgresQuickBooksSyncNow(input.pool),principals:new IssuedV2PrincipalProvider(input.trustedHostIdentity,new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(input.pool))),publicWebOrigin:input.publicWebOrigin});
