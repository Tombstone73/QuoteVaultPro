import type { PoolClient } from "pg";
import type { PrincipalKind } from "../../src/authorization/principals.js";

export type PrincipalAttribution = {
  principalKind: PrincipalKind;
  principalSubject: string;
  staffActorUserId?: string | null;
};

export type OperationRequestInput = PrincipalAttribution & {
  organizationId: string;
  operation: string;
  businessRequestId: string;
  payloadFingerprint: string;
};

export type OperationRequestRecord = OperationRequestInput & {
  id: string;
  status: "in_progress" | "succeeded" | "retryable_failure" | "permanent_failure";
  resultResourceType: string | null;
  resultResourceId: string | null;
  resultJson: unknown | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type OperationRequestReservation =
  | { kind: "new"; request: OperationRequestRecord }
  | { kind: "resumed"; request: OperationRequestRecord }
  | { kind: "replay"; request: OperationRequestRecord };

export type AttributionInput = PrincipalAttribution & {
  organizationId: string;
  operationRequestId?: string | null;
  operation: string;
  resourceType: string;
  resourceId: string;
};

export type OutboxMessageInput = {
  organizationId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  idempotencyKey: string;
  payload: unknown;
};

export type OutboxMessageRecord = OutboxMessageInput & {
  id: string;
  status: "pending" | "processing" | "completed" | "dead_letter";
  attemptCount: number;
  availableAt: Date;
  claimedBy: string | null;
  leaseExpiresAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

export type TransactionalClient = Pick<PoolClient, "query">;
