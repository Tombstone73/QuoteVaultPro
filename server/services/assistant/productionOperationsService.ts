import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  assistantProductionIntakeSessions,
  orderLineItems,
  orders,
  productionJobs,
  type AssistantProductionIntakeSessionRow,
} from "@shared/schema";
import { db } from "../../db";
import { appendEvent } from "../../productionHelpers";
import { isProductionEligibleBundleLineItem } from "../productionScheduling";
import { loadProductionLineItemStatusRulesForOrganization } from "../../routes/production.shared";
import { canonicalProductionOperations } from "../canonicalProductionOperations";

export const productionOperationCommandNames = [
  "production.intake_line_items",
  "production.send_to_prepress",
  "production.update_job_status",
  "production.add_job_note",
] as const;
export type ProductionOperationCommandName =
  (typeof productionOperationCommandNames)[number];
type Intake = {
  command: ProductionOperationCommandName;
  lineItemIds?: string[];
  jobId?: string;
  note?: string;
  status?: "in_progress";
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class ProductionOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Canonical production boundary used by assistant adapters. It calls existing
 * scheduler/workflow/event services and never lets chat input select a station,
 * step, routing destination, or arbitrary status. */
export class ProductionOperationsService {
  async respond(input: {
    organizationId: string;
    userId: string;
    conversationId: string;
    message: string;
  }) {
    const message = input.message.trim();
    const ids = (value: string) =>
      value
        .split(/[\s,]+/)
        .map((id) => id.trim())
        .filter(Boolean);
    let intake: Intake | null = null;
    const intakeMatch = message.match(
      /\b(?:intake|schedule)\b[\s\S]*?\bline\s*items?\s+([\w,-]+)/i,
    );
    const prepressMatch = message.match(
      /\bsend\s+(?:line\s*item\s+)?([\w-]+)\s+to\s+prepress\s+(?:because|note)\s*[:\-]?\s*(.+)$/i,
    );
    const startMatch = message.match(
      /\bstart\s+(?:production\s+)?job\s+([\w-]+)/i,
    );
    const noteMatch = message.match(
      /\b(?:add\s+)?note\s+(?:to\s+)?(?:production\s+)?job\s+([\w-]+)\s*[:\-]\s*(.+)$/i,
    );
    if (intakeMatch)
      intake = {
        command: "production.intake_line_items",
        lineItemIds: ids(intakeMatch[1]),
      };
    else if (prepressMatch)
      intake = {
        command: "production.send_to_prepress",
        lineItemIds: [prepressMatch[1]],
        note: prepressMatch[2].trim(),
      };
    else if (startMatch)
      intake = {
        command: "production.update_job_status",
        jobId: startMatch[1],
        status: "in_progress",
      };
    else if (noteMatch)
      intake = {
        command: "production.add_job_note",
        jobId: noteMatch[1],
        note: noteMatch[2].trim(),
      };
    if (!intake) return { handled: false, response: "", cards: [] };
    try {
      const proposal = await this.createProposal({ ...input, intake });
      return {
        handled: true,
        response:
          "I prepared a production operation preview. Review it and use the dedicated GO control; free-text GO cannot execute it.",
        cards: [
          {
            kind: "production_operation_proposal",
            title: "Production operation proposal",
            summary: proposal.summary,
            sourceLinks: proposal.sourceLinks,
            details: proposal,
          },
          {
            kind: "action_proposal",
            title: "Confirm production operation",
            summary:
              "Only the server-created confirmation control can execute this operation.",
            sourceLinks: [],
            plan: {
              action: intake.command,
              productionIntakeSessionId: proposal.productionIntakeSessionId,
              proposalFingerprint: proposal.proposalFingerprint,
            },
          },
        ],
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to prepare production operation.";
      return {
        handled: true,
        response: message,
        cards: [
          {
            kind: "missing_information",
            title: "Production operation unavailable",
            summary: message,
            sourceLinks: [],
          },
        ],
      };
    }
  }
  private async createProposal(input: {
    organizationId: string;
    userId: string;
    conversationId: string;
    intake: Intake;
  }) {
    const [session] = await db
      .insert(assistantProductionIntakeSessions)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        conversationId: input.conversationId,
        commandName: input.intake.command,
        intakeJson: input.intake,
      })
      .returning();
    if (!session)
      throw new ProductionOperationError(
        "SESSION_CREATE_FAILED",
        "Unable to persist production proposal.",
      );
    const proposal = await this.buildProposal(input.organizationId, session);
    await db
      .update(assistantProductionIntakeSessions)
      .set({
        proposalFingerprint: proposal.proposalFingerprint,
        updatedAt: new Date(),
      })
      .where(eq(assistantProductionIntakeSessions.id, session.id));
    return proposal;
  }
  private async load(org: string, id: string) {
    const [session] = await db
      .select()
      .from(assistantProductionIntakeSessions)
      .where(
        and(
          eq(assistantProductionIntakeSessions.id, id),
          eq(assistantProductionIntakeSessions.organizationId, org),
        ),
      )
      .limit(1);
    if (!session)
      throw new ProductionOperationError(
        "SESSION_NOT_FOUND",
        "Production proposal not found.",
      );
    return session;
  }
  async buildProposal(
    organizationId: string,
    session: AssistantProductionIntakeSessionRow,
  ) {
    const intake = session.intakeJson as Intake;
    const links: { label: string; href: string }[] = [];
    let fingerprintSource: unknown;
    let summary = "";
    if (
      intake.command === "production.intake_line_items" ||
      intake.command === "production.send_to_prepress"
    ) {
      const lineItemIds = Array.from(new Set(intake.lineItemIds ?? []));
      if (!lineItemIds.length || lineItemIds.length > 25)
        throw new ProductionOperationError(
          "LINE_ITEMS_INVALID",
          "Select between one and 25 line items.",
        );
      const rows = await db
        .select({
          id: orderLineItems.id,
          orderId: orderLineItems.orderId,
          status: orderLineItems.status,
          workflowState: orderLineItems.workflowState,
          productionBypassed: orderLineItems.productionBypassed,
          lineItemRole: orderLineItems.lineItemRole,
          updatedAt: orderLineItems.updatedAt,
        })
        .from(orderLineItems)
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .where(
          and(
            eq(orders.organizationId, organizationId),
            inArray(orderLineItems.id, lineItemIds),
          ),
        );
      if (rows.length !== lineItemIds.length)
        throw new ProductionOperationError(
          "LINE_ITEM_NOT_FOUND",
          "One or more selected line items are unavailable.",
        );
      if (
        intake.command === "production.intake_line_items" &&
        rows.some(
          (row) =>
            row.productionBypassed ||
            row.lineItemRole === "parent" ||
            ["cancelled", "canceled", "done"].includes(
              String(row.status).toLowerCase(),
            ),
        )
      )
        throw new ProductionOperationError(
          "LINE_ITEM_INELIGIBLE",
          "All selected line items must be production-eligible and non-terminal.",
        );
      if (
        intake.command === "production.send_to_prepress" &&
        (!intake.note || intake.note.length > 1000 || rows.length !== 1)
      )
        throw new ProductionOperationError(
          "PREPRESS_NOTE_REQUIRED",
          "Send-to-prepress requires one line item and an internal note.",
        );
      links.push(
        ...Array.from(new Set(rows.map((row) => row.orderId))).map(
          (orderId) => ({ label: "Open order", href: `/orders/${orderId}` }),
        ),
      );
      fingerprintSource = rows;
      summary =
        intake.command === "production.intake_line_items"
          ? `Route ${rows.length} selected line item(s) through canonical production intake.`
          : "Return the selected line item to Prepress with the supplied internal edit-request note.";
    } else {
      if (!intake.jobId)
        throw new ProductionOperationError(
          "JOB_REQUIRED",
          "A production job is required.",
        );
      const [job] = await db
        .select({
          id: productionJobs.id,
          orderId: productionJobs.orderId,
          lineItemId: productionJobs.lineItemId,
          status: productionJobs.status,
          stationKey: productionJobs.stationKey,
          stepKey: productionJobs.stepKey,
          updatedAt: productionJobs.updatedAt,
        })
        .from(productionJobs)
        .where(
          and(
            eq(productionJobs.organizationId, organizationId),
            eq(productionJobs.id, intake.jobId),
          ),
        )
        .limit(1);
      if (!job)
        throw new ProductionOperationError(
          "JOB_NOT_FOUND",
          "Production job not found.",
        );
      if (
        intake.command === "production.update_job_status" &&
        job.status !== "queued"
      )
        throw new ProductionOperationError(
          "STATUS_TRANSITION_INVALID",
          "Assistant status updates only start queued jobs.",
        );
      if (
        intake.command === "production.add_job_note" &&
        (!intake.note || intake.note.length > 1000)
      )
        throw new ProductionOperationError(
          "NOTE_REQUIRED",
          "An internal production note is required.",
        );
      links.push(
        { label: "Open production job", href: `/production?jobId=${job.id}` },
        { label: "Open order", href: `/orders/${job.orderId}` },
      );
      fingerprintSource = job;
      summary =
        intake.command === "production.update_job_status"
          ? `Start queued production job ${job.id}.`
          : `Add an internal, append-only note to production job ${job.id}.`;
    }
    const proposalFingerprint = hash({
      sessionId: session.id,
      intake,
      fingerprintSource,
    });
    return {
      productionIntakeSessionId: session.id,
      commandName: intake.command,
      proposalFingerprint,
      summary,
      sourceLinks: links,
      unchanged: ["fulfillment", "invoices", "payments", "customer records"],
    };
  }
  async revalidateProposal(input: {
    organizationId: string;
    productionIntakeSessionId: string;
    expectedProposalFingerprint: string;
  }) {
    const session = await this.load(
      input.organizationId,
      input.productionIntakeSessionId,
    );
    if (session.status !== "preview_ready")
      return {
        valid: false as const,
        code: "PRODUCTION_PROPOSAL_NOT_READY",
        summary: "Production proposal is not ready.",
      };
    const proposal = await this.buildProposal(input.organizationId, session);
    return session.proposalFingerprint === input.expectedProposalFingerprint &&
      proposal.proposalFingerprint === input.expectedProposalFingerprint
      ? { valid: true as const, proposal }
      : {
          valid: false as const,
          code: "PRODUCTION_PROPOSAL_STALE",
          summary: "Production records changed; review a fresh preview.",
        };
  }
  async executeConfirmed(input: {
    organizationId: string;
    actorUserId: string;
    productionIntakeSessionId: string;
    proposalFingerprint: string;
  }) {
    const session = await this.load(
      input.organizationId,
      input.productionIntakeSessionId,
    );
    if (session.userId !== input.actorUserId)
      throw new ProductionOperationError(
        "SESSION_FORBIDDEN",
        "Only the user who created the proposal can confirm it.",
      );
    const intake = session.intakeJson as Intake;
    if (session.status === "created") return { sourceLinks: [] };
    const validation = await this.revalidateProposal({
      organizationId: input.organizationId,
      productionIntakeSessionId: session.id,
      expectedProposalFingerprint: input.proposalFingerprint,
    });
    if (!validation.valid)
      throw new ProductionOperationError(validation.code, validation.summary);
    if (intake.command === "production.intake_line_items") {
      const lineItemIds = intake.lineItemIds!;
      const rows = await db
        .select({ orderId: orderLineItems.orderId })
        .from(orderLineItems)
        .where(inArray(orderLineItems.id, lineItemIds));
      const orderIds = Array.from(new Set(rows.map((row) => row.orderId)));
      if (orderIds.length !== 1)
        throw new ProductionOperationError(
          "MULTI_ORDER_INTAKE_FORBIDDEN",
          "Selected line items must belong to one order.",
        );
      const result = await canonicalProductionOperations.intakeLineItems({
        organizationId: input.organizationId,
        orderId: orderIds[0],
        lineItemIds,
        actorUserId: input.actorUserId,
        loadRoutingRules: loadProductionLineItemStatusRulesForOrganization,
        appendEvent,
      });
      if (result.data.failed.length || result.data.skippedNonProductionCount)
        throw new ProductionOperationError(
          "INTAKE_INCOMPLETE",
          "One or more line items could not be routed safely.",
        );
      await db
        .update(assistantProductionIntakeSessions)
        .set({ status: "created", updatedAt: new Date() })
        .where(eq(assistantProductionIntakeSessions.id, session.id));
      return {
        sourceLinks: validation.proposal.sourceLinks,
        summary: result.message,
      };
    }
    if (intake.command === "production.send_to_prepress") {
      const lineItemId = intake.lineItemIds![0];
      await canonicalProductionOperations.returnLineItemToPrepress({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        lineItemId,
        reason: intake.note!,
      });
    } else if (intake.command === "production.update_job_status")
      await canonicalProductionOperations.startJob({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        jobId: intake.jobId!,
      });
    else
      await canonicalProductionOperations.addJobNote({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        jobId: intake.jobId!,
        note: intake.note!,
        source: "assistant",
      });
    await db
      .update(assistantProductionIntakeSessions)
      .set({ status: "created", updatedAt: new Date() })
      .where(eq(assistantProductionIntakeSessions.id, session.id));
    return {
      sourceLinks: validation.proposal.sourceLinks,
      summary: validation.proposal.summary,
    };
  }
}
export const productionOperationsService = new ProductionOperationsService();
