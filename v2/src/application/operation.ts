import type { Principal } from "../authorization/principals.js";
import type { ApplicationResult } from "../errors/applicationError.js";
import { V2ApplicationError } from "../errors/applicationError.js";

export type BusinessRequest = Readonly<{
  /** Operation-specific durable identity, independent of actor identity. */
  id: string;
  /** Canonical fingerprint of the operation input. */
  payloadFingerprint: string;
}>;

export type OperationContext = Readonly<{
  principal: Principal;
  organizationId: string;
  operationId: string;
  businessRequest?: BusinessRequest;
}>;

/**
 * Every concrete operation must call this before repository access. It keeps a
 * command's explicit organization scope from being retargeted away from its
 * authenticated principal.
 */
export const requireOperationPrincipalScope = (context: OperationContext): void => {
  if (context.principal.organizationId !== context.organizationId) {
    throw new V2ApplicationError("WRONG_TENANT", "The requested organization is outside the principal scope.");
  }
};

export type OperationReference = Readonly<{
  resourceType: string;
  resourceId: string;
  reconciliationId?: string;
}>;

export type OperationSuccess<T> = Readonly<{
  value: T;
  reference: OperationReference;
  replayed: boolean;
}>;

/** Domain operations define concrete command/result types; no god command exists. */
export interface ApplicationOperation<TCommand, TResult> {
  execute(
    context: OperationContext,
    command: TCommand,
  ): Promise<ApplicationResult<OperationSuccess<TResult>>>;
}
