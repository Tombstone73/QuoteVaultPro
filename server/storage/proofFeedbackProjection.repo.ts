import { and, desc, eq } from "drizzle-orm";

import { db } from "../db";
import {
  lineItemProofApprovals,
  lineItemProofVersions,
  users,
} from "@shared/schema";

export type LatestProofFeedbackRow = {
  decision: string;
  responseNotes: string | null;
  responderName: string | null;
  responderEmail: string | null;
  responderSource: string | null;
  responderRole: string | null;
  respondedAt: Date;
  versionId: string;
  versionNumber: number;
};

export class ProofFeedbackProjectionRepository {
  constructor(private readonly dbInstance = db) {}

  async getLatestByLineItemId(
    organizationId: string,
    lineItemId: string,
    executor: any = this.dbInstance,
  ): Promise<LatestProofFeedbackRow | null> {
    const [row] = await executor
      .select({
        decision: lineItemProofApprovals.decision,
        responseNotes: lineItemProofApprovals.responseNotes,
        responderName: lineItemProofApprovals.responderName,
        responderEmail: lineItemProofApprovals.responderEmail,
        responderSource: lineItemProofApprovals.responderSource,
        responderRole: users.role,
        respondedAt: lineItemProofApprovals.respondedAt,
        versionId: lineItemProofVersions.id,
        versionNumber: lineItemProofVersions.versionNumber,
      })
      .from(lineItemProofApprovals)
      .innerJoin(lineItemProofVersions, eq(lineItemProofApprovals.proofVersionId, lineItemProofVersions.id))
      .leftJoin(users, eq(lineItemProofApprovals.responderUserId, users.id))
      .where(
        and(
          eq(lineItemProofApprovals.organizationId, organizationId),
          eq(lineItemProofApprovals.lineItemId, lineItemId),
          eq(lineItemProofVersions.organizationId, organizationId),
          eq(lineItemProofVersions.lineItemId, lineItemId),
        ),
      )
      .orderBy(
        desc(lineItemProofApprovals.respondedAt),
        desc(lineItemProofApprovals.createdAt),
        desc(lineItemProofVersions.versionNumber),
      )
      .limit(1);

    return row ?? null;
  }
}

export const proofFeedbackProjectionRepository = new ProofFeedbackProjectionRepository();