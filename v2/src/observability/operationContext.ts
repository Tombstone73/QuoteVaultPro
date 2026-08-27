import type { Principal, PrincipalKind } from "../authorization/principals.js";
import { principalSubject, staffActorId } from "../authorization/principals.js";

export type V2LogContext = Readonly<{
  operationId?: string;
  businessRequestId?: string;
  organizationId?: string;
  principalKind?: PrincipalKind;
  principalSubject?: string;
  staffActorId?: string;
  resourceType?: string;
  resourceId?: string;
  reconciliationId?: string;
  errorCode?: string;
  httpStatus?: number;
}>;

export const principalLogContext = (principal: Principal): V2LogContext => ({
  organizationId: principal.organizationId,
  principalKind: principal.kind,
  principalSubject: principalSubject(principal),
  staffActorId: staffActorId(principal),
});
