import type { Pool } from "pg";
import { PermissionSetPrincipalIssuer } from "../../src/authorization/permissionSets.js";
import type { TrustedHostIdentitySource } from "../authentication/trustedHostPrincipalProvider.js";
import { IssuedV2PrincipalProvider } from "../authentication/trustedHostPrincipalProvider.js";
import { PostgresPermissionAuthorityReader } from "../authorization/postgresPermissionAuthorityRead.js";
import { PostgresEmailIntegrationService } from "./postgresEmailIntegration.js";
import type { EmailIntegrationHttpDependencies } from "../../src/interfaces/http/emailIntegrationRoutes.js";

export const composeAuthenticatedEmailIntegrationRuntime=(input:Readonly<{pool:Pool;trustedHostIdentity:TrustedHostIdentitySource;publicWebOrigin?:string}>):EmailIntegrationHttpDependencies=>({integrations:new PostgresEmailIntegrationService(input.pool),principals:new IssuedV2PrincipalProvider(input.trustedHostIdentity,new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(input.pool))),identities:input.trustedHostIdentity,publicWebOrigin:input.publicWebOrigin});
