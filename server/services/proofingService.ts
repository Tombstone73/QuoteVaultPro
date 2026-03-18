import { and, desc, eq, ne, sql } from "drizzle-orm";

import {
  lineItemProofApprovals,
  lineItemProofVersions,
  orderAttachments,
  orderLineItems,
  orders,
  productionEvents,
  productionJobs,
} from "@shared/schema";
import { transitionLineItemWorkflowState } from "./lineItemWorkflowService";

type ProofDecision = "approved" | "rejected" | "revision_requested";
type ProofVersionStatus = "draft" | "awaiting_response" | "approved" | "rejected" | "revision_requested" | "superseded";

export function deriveProofResponseWorkflowState(args: { decision: ProofDecision; requiresPrepress: boolean }) {
  if (args.decision === "approved") {
    return args.requiresPrepress ? "ready_for_prepress" : "ready_for_production";
  }

  return "needs_design";
}

type LoadedProofLineItem = {
  lineItemId: string;
  orderId: string;
  organizationId: string;
  workflowState: string;
  requiresPrepress: boolean;
  requiresProofApproval: boolean;
  approvedProofVersionId: string | null;
};

async function loadProofLineItem(tx: any, args: { organizationId: string; lineItemId: string }): Promise<LoadedProofLineItem> {
  const [row] = await tx
    .select({
      lineItemId: orderLineItems.id,
      orderId: orderLineItems.orderId,
      organizationId: orders.organizationId,
      workflowState: orderLineItems.workflowState,
      requiresPrepress: orderLineItems.requiresPrepress,
      requiresProofApproval: orderLineItems.requiresProofApproval,
      approvedProofVersionId: orderLineItems.approvedProofVersionId,
    })
    .from(orderLineItems)
    .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
    .where(and(eq(orderLineItems.id, args.lineItemId), eq(orders.organizationId, args.organizationId)))
    .limit(1);

  if (!row) {
    throw Object.assign(new Error("Line item not found"), { statusCode: 404 });
  }

  return {
    ...row,
    requiresPrepress: Boolean(row.requiresPrepress),
    requiresProofApproval: Boolean(row.requiresProofApproval),
  };
}

async function appendProofingEvent(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  eventType: string;
  actorUserId?: string | null;
  payload?: Record<string, unknown>;
}) {
  const [job] = await tx
    .select({ id: productionJobs.id })
    .from(productionJobs)
    .where(and(eq(productionJobs.organizationId, args.organizationId), eq(productionJobs.lineItemId, args.lineItemId)))
    .orderBy(desc(productionJobs.updatedAt), desc(productionJobs.createdAt))
    .limit(1);

  if (!job) {
    return;
  }

  await tx.insert(productionEvents).values({
    organizationId: args.organizationId,
    productionJobId: job.id,
    type: "note",
    payload: {
      eventType: args.eventType,
      actorUserId: args.actorUserId ?? null,
      ...(args.payload ?? {}),
    },
  });
}

async function loadProofVersion(tx: any, args: { organizationId: string; proofVersionId: string }) {
  const [row] = await tx
    .select({
      id: lineItemProofVersions.id,
      organizationId: lineItemProofVersions.organizationId,
      orderId: lineItemProofVersions.orderId,
      lineItemId: lineItemProofVersions.lineItemId,
      proofFileId: lineItemProofVersions.proofFileId,
      versionNumber: lineItemProofVersions.versionNumber,
      status: lineItemProofVersions.status,
      customerMessage: lineItemProofVersions.customerMessage,
      sentToName: lineItemProofVersions.sentToName,
      sentToEmail: lineItemProofVersions.sentToEmail,
      sentAt: lineItemProofVersions.sentAt,
      internalNotes: lineItemProofVersions.internalNotes,
    })
    .from(lineItemProofVersions)
    .where(and(eq(lineItemProofVersions.organizationId, args.organizationId), eq(lineItemProofVersions.id, args.proofVersionId)))
    .limit(1);

  if (!row) {
    throw Object.assign(new Error("Proof version not found"), { statusCode: 404 });
  }

  return row;
}

export async function createLineItemProofVersion(tx: any, args: {
  organizationId: string;
  lineItemId: string;
  proofFileId: string;
  createdByUserId: string;
  internalNotes?: string | null;
}) {
  const lineItem = await loadProofLineItem(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });

  const [attachment] = await tx
    .select({
      id: orderAttachments.id,
      orderId: orderAttachments.orderId,
      orderLineItemId: orderAttachments.orderLineItemId,
      role: orderAttachments.role,
    })
    .from(orderAttachments)
    .innerJoin(orders, eq(orderAttachments.orderId, orders.id))
    .where(and(eq(orderAttachments.id, args.proofFileId), eq(orders.organizationId, args.organizationId)))
    .limit(1);

  if (!attachment) {
    throw Object.assign(new Error("Proof file not found"), { statusCode: 404 });
  }

  if (attachment.orderId !== lineItem.orderId || attachment.orderLineItemId !== lineItem.lineItemId) {
    throw Object.assign(new Error("Proof file does not belong to the target line item"), { statusCode: 409 });
  }

  if (String(attachment.role || "") !== "proof") {
    throw Object.assign(new Error("Order attachment must have role=proof before creating a proof version"), { statusCode: 409 });
  }

  const [blockingVersion] = await tx
    .select({ id: lineItemProofVersions.id })
    .from(lineItemProofVersions)
    .where(
      and(
        eq(lineItemProofVersions.organizationId, args.organizationId),
        eq(lineItemProofVersions.lineItemId, lineItem.lineItemId),
        eq(lineItemProofVersions.status, "awaiting_response"),
      ),
    )
    .limit(1);

  if (blockingVersion) {
    throw Object.assign(new Error("Cannot create a new proof version while another proof is awaiting response"), { statusCode: 409 });
  }

  const [versionNumberRow] = await tx
    .select({ nextVersionNumber: sql<number>`coalesce(max(${lineItemProofVersions.versionNumber}), 0)::int + 1` })
    .from(lineItemProofVersions)
    .where(and(eq(lineItemProofVersions.organizationId, args.organizationId), eq(lineItemProofVersions.lineItemId, lineItem.lineItemId)));

  const [created] = await tx
    .insert(lineItemProofVersions)
    .values({
      organizationId: args.organizationId,
      orderId: lineItem.orderId,
      lineItemId: lineItem.lineItemId,
      proofFileId: args.proofFileId,
      versionNumber: versionNumberRow?.nextVersionNumber ?? 1,
      status: "draft",
      internalNotes: args.internalNotes ?? null,
      createdByUserId: args.createdByUserId,
      updatedAt: new Date(),
    })
    .returning();

  await appendProofingEvent(tx, {
    organizationId: args.organizationId,
    lineItemId: lineItem.lineItemId,
    eventType: "proof_version_created",
    actorUserId: args.createdByUserId,
    payload: {
      proofVersionId: created.id,
      proofFileId: created.proofFileId,
      versionNumber: created.versionNumber,
    },
  });

  return created;
}

export async function markProofVersionSent(tx: any, args: {
  organizationId: string;
  proofVersionId: string;
  actorUserId: string;
  sentToName?: string | null;
  sentToEmail?: string | null;
  customerMessage?: string | null;
}) {
  const proofVersion = await loadProofVersion(tx, {
    organizationId: args.organizationId,
    proofVersionId: args.proofVersionId,
  });

  if (proofVersion.status !== "draft") {
    throw Object.assign(new Error("Only draft proof versions can be sent for review"), { statusCode: 409 });
  }

  const [blockingVersion] = await tx
    .select({ id: lineItemProofVersions.id })
    .from(lineItemProofVersions)
    .where(
      and(
        eq(lineItemProofVersions.organizationId, args.organizationId),
        eq(lineItemProofVersions.lineItemId, proofVersion.lineItemId),
        eq(lineItemProofVersions.status, "awaiting_response"),
        ne(lineItemProofVersions.id, proofVersion.id),
      ),
    )
    .limit(1);

  if (blockingVersion) {
    throw Object.assign(new Error("Another proof version is already awaiting response"), { statusCode: 409 });
  }

  await tx
    .update(orderLineItems)
    .set({
      requiresProofApproval: true,
      approvedProofVersionId: null,
      updatedAt: new Date(),
    })
    .where(eq(orderLineItems.id, proofVersion.lineItemId));

  const [updatedVersion] = await tx
    .update(lineItemProofVersions)
    .set({
      status: "awaiting_response",
      sentToName: args.sentToName ?? null,
      sentToEmail: args.sentToEmail ?? null,
      customerMessage: args.customerMessage ?? null,
      sentByUserId: args.actorUserId,
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(lineItemProofVersions.id, proofVersion.id))
    .returning();

  const workflowTransition = await transitionLineItemWorkflowState(tx, {
    organizationId: args.organizationId,
    lineItemId: proofVersion.lineItemId,
    toState: "awaiting_proof_approval",
    actorUserId: args.actorUserId,
    metadata: {
      source: "proofing_send_for_review",
      proofVersionId: proofVersion.id,
      versionNumber: proofVersion.versionNumber,
    },
  });

  await appendProofingEvent(tx, {
    organizationId: args.organizationId,
    lineItemId: proofVersion.lineItemId,
    eventType: "proof_sent_for_review",
    actorUserId: args.actorUserId,
    payload: {
      proofVersionId: proofVersion.id,
      versionNumber: proofVersion.versionNumber,
      workflowToState: workflowTransition.toState,
      sentToEmail: args.sentToEmail ?? null,
    },
  });

  return { proofVersion: updatedVersion, workflowTransition };
}

export async function recordProofResponse(tx: any, args: {
  organizationId: string;
  proofVersionId: string;
  actorUserId?: string | null;
  responderName?: string | null;
  responderEmail?: string | null;
  responderSource?: string | null;
  decision: ProofDecision;
  responseNotes?: string | null;
}) {
  const proofVersion = await loadProofVersion(tx, {
    organizationId: args.organizationId,
    proofVersionId: args.proofVersionId,
  });

  if (proofVersion.status !== "awaiting_response") {
    throw Object.assign(new Error("Only proof versions awaiting response can be decided"), { statusCode: 409 });
  }

  const lineItem = await loadProofLineItem(tx, {
    organizationId: args.organizationId,
    lineItemId: proofVersion.lineItemId,
  });

  const [existingResponse] = await tx
    .select({ id: lineItemProofApprovals.id })
    .from(lineItemProofApprovals)
    .where(eq(lineItemProofApprovals.proofVersionId, proofVersion.id))
    .limit(1);

  if (existingResponse) {
    throw Object.assign(new Error("A response has already been recorded for this proof version"), { statusCode: 409 });
  }

  const [approval] = await tx
    .insert(lineItemProofApprovals)
    .values({
      organizationId: args.organizationId,
      orderId: lineItem.orderId,
      lineItemId: lineItem.lineItemId,
      proofVersionId: proofVersion.id,
      decision: args.decision,
      responseNotes: args.responseNotes ?? null,
      responderUserId: args.actorUserId ?? null,
      responderName: args.responderName ?? null,
      responderEmail: args.responderEmail ?? null,
      responderSource: args.responderSource ?? (args.actorUserId ? "internal" : "external"),
    })
    .returning();

  const nextProofStatus: ProofVersionStatus = args.decision;
  const nextWorkflowState = deriveProofResponseWorkflowState({
    decision: args.decision,
    requiresPrepress: lineItem.requiresPrepress,
  });

  await tx
    .update(lineItemProofVersions)
    .set({
      status: nextProofStatus,
      updatedAt: new Date(),
    })
    .where(eq(lineItemProofVersions.id, proofVersion.id));

  await tx
    .update(orderLineItems)
    .set({
      approvedProofVersionId: args.decision === "approved" ? proofVersion.id : null,
      updatedAt: new Date(),
    })
    .where(eq(orderLineItems.id, lineItem.lineItemId));

  const workflowTransition = await transitionLineItemWorkflowState(tx, {
    organizationId: args.organizationId,
    lineItemId: lineItem.lineItemId,
    toState: nextWorkflowState,
    actorUserId: args.actorUserId ?? null,
    metadata: {
      source: "proofing_record_response",
      proofVersionId: proofVersion.id,
      approvalId: approval.id,
      decision: args.decision,
    },
  });

  await appendProofingEvent(tx, {
    organizationId: args.organizationId,
    lineItemId: lineItem.lineItemId,
    eventType: "proof_response_recorded",
    actorUserId: args.actorUserId ?? null,
    payload: {
      proofVersionId: proofVersion.id,
      approvalId: approval.id,
      decision: args.decision,
      workflowToState: workflowTransition.toState,
    },
  });

  return {
    approval,
    workflowTransition,
  };
}

export async function resolveLineItemProofingTruth(tx: any, args: {
  organizationId: string;
  lineItemId: string;
}) {
  const lineItem = await loadProofLineItem(tx, {
    organizationId: args.organizationId,
    lineItemId: args.lineItemId,
  });

  const versions = await tx
    .select({
      id: lineItemProofVersions.id,
      proofFileId: lineItemProofVersions.proofFileId,
      versionNumber: lineItemProofVersions.versionNumber,
      status: lineItemProofVersions.status,
      sentAt: lineItemProofVersions.sentAt,
      createdAt: lineItemProofVersions.createdAt,
      sentToName: lineItemProofVersions.sentToName,
      sentToEmail: lineItemProofVersions.sentToEmail,
    })
    .from(lineItemProofVersions)
    .where(and(eq(lineItemProofVersions.organizationId, args.organizationId), eq(lineItemProofVersions.lineItemId, args.lineItemId)))
    .orderBy(desc(lineItemProofVersions.versionNumber), desc(lineItemProofVersions.createdAt));

  const approvals = await tx
    .select({
      id: lineItemProofApprovals.id,
      proofVersionId: lineItemProofApprovals.proofVersionId,
      decision: lineItemProofApprovals.decision,
      responseNotes: lineItemProofApprovals.responseNotes,
      responderName: lineItemProofApprovals.responderName,
      responderEmail: lineItemProofApprovals.responderEmail,
      responderSource: lineItemProofApprovals.responderSource,
      respondedAt: lineItemProofApprovals.respondedAt,
    })
    .from(lineItemProofApprovals)
    .where(and(eq(lineItemProofApprovals.organizationId, args.organizationId), eq(lineItemProofApprovals.lineItemId, args.lineItemId)))
    .orderBy(desc(lineItemProofApprovals.respondedAt), desc(lineItemProofApprovals.createdAt));

  const currentAwaitingVersion = versions.find((version: (typeof versions)[number]) => version.status === "awaiting_response") ?? null;
  const approvedVersion = lineItem.approvedProofVersionId
    ? versions.find((version: (typeof versions)[number]) => version.id === lineItem.approvedProofVersionId) ?? null
    : null;
  const latestDecision = approvals[0] ?? null;

  return {
    lineItemId: lineItem.lineItemId,
    orderId: lineItem.orderId,
    workflowState: lineItem.workflowState,
    requiresProofApproval: lineItem.requiresProofApproval,
    approvedProofVersionId: lineItem.approvedProofVersionId,
    currentAwaitingVersion,
    approvedVersion,
    latestDecision,
    versions,
    approvals,
  };
}