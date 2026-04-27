import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from "@jest/globals";
import express, { NextFunction, Response } from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

jest.mock("../services/productionRoutingService", () => {
  const { productionJobs } = require("../../shared/schema");
  return {
    routeLineItemToProduction: jest.fn(async ({ tx, organizationId, orderId, lineItemId, stationKey, stepKey }: any) => {
      const [created] = await tx
        .insert(productionJobs)
        .values({
          organizationId,
          orderId,
          lineItemId,
          stationKey,
          stepKey,
          status: "queued",
        })
        .returning({ id: productionJobs.id });

      return {
        outcome: "created",
        jobId: created.id,
        stationKey,
        stepKey,
      };
    }),
  };
});

import { db } from "../db";
import { tenantContext, getRequestOrganizationId } from "../tenantContext";
import { auditLogs, lineItemProofManualApprovalOverrides, orderAttachments, orderLineItems, productionJobs } from "../../shared/schema";
import { proofingQueueResponseSchema, proofingReadModelSchema, type ProofVersionHistoryEntry } from "../../shared/proofing";
import { createProofAccessToken, validateProofToken } from "../services/proofAccessTokenService";
import {
  autoSyncCanonicalProofForLineItem,
  createAndSendProofVersion,
  createLineItemProofVersion,
  listProofingQueue,
  markProofVersionSent,
  recordManualProofApprovalOverride,
  recordProofResponse,
  resolveLineItemProofingTruth,
} from "../services/proofingService";
import { completeLineItemDesign, transitionLineItemWorkflowState } from "../services/lineItemWorkflowService";

async function ensureProofingSchemaReady() {
  await db.execute(sql`alter table order_line_items add column if not exists requires_proof_approval boolean not null default false`);
  await db.execute(sql`alter table order_line_items add column if not exists approved_proof_version_id varchar`);
  await db.execute(sql`alter table order_line_items add column if not exists design_status varchar(50)`);

  await db.execute(sql`
    do $$
    begin
      create type line_item_proof_version_status as enum (
        'draft',
        'awaiting_response',
        'approved',
        'rejected',
        'revision_requested',
        'superseded'
      );
    exception
      when duplicate_object then null;
    end $$;
  `);

  await db.execute(sql`
    do $$
    begin
      create type line_item_proof_response_decision as enum (
        'approved',
        'rejected',
        'revision_requested'
      );
    exception
      when duplicate_object then null;
    end $$;
  `);

  await db.execute(sql`
    create table if not exists line_item_proof_versions (
      id varchar primary key default gen_random_uuid()::text,
      organization_id varchar not null references organizations(id) on delete cascade,
      order_id varchar not null references orders(id) on delete cascade,
      line_item_id varchar not null references order_line_items(id) on delete cascade,
      proof_file_id varchar not null references order_attachments(id) on delete restrict,
      version_number integer not null,
      status line_item_proof_version_status not null default 'draft',
      internal_notes text,
      customer_message text,
      sent_to_name varchar(255),
      sent_to_email varchar(255),
      sent_by_user_id varchar references users(id) on delete set null,
      sent_at timestamp with time zone,
      created_by_user_id varchar not null references users(id) on delete restrict,
      created_at timestamp with time zone not null default now(),
      updated_at timestamp with time zone not null default now()
    )
  `);

  await db.execute(sql`create index if not exists line_item_proof_versions_org_idx on line_item_proof_versions (organization_id)`);
  await db.execute(sql`create index if not exists line_item_proof_versions_order_idx on line_item_proof_versions (order_id)`);
  await db.execute(sql`create index if not exists line_item_proof_versions_line_item_idx on line_item_proof_versions (line_item_id)`);
  await db.execute(sql`create index if not exists line_item_proof_versions_status_idx on line_item_proof_versions (status)`);
  await db.execute(sql`create index if not exists line_item_proof_versions_proof_file_idx on line_item_proof_versions (proof_file_id)`);
  await db.execute(sql`create unique index if not exists line_item_proof_versions_line_item_version_uidx on line_item_proof_versions (line_item_id, version_number)`);
  await db.execute(sql`create unique index if not exists line_item_proof_versions_active_review_uidx on line_item_proof_versions (line_item_id) where status = 'awaiting_response'`);

  await db.execute(sql`
    create table if not exists line_item_proof_approvals (
      id varchar primary key default gen_random_uuid()::text,
      organization_id varchar not null references organizations(id) on delete cascade,
      order_id varchar not null references orders(id) on delete cascade,
      line_item_id varchar not null references order_line_items(id) on delete cascade,
      proof_version_id varchar not null references line_item_proof_versions(id) on delete cascade,
      decision line_item_proof_response_decision not null,
      response_notes text,
      responder_user_id varchar references users(id) on delete set null,
      responder_name varchar(255),
      responder_email varchar(255),
      responder_source varchar(50) not null default 'internal',
      responded_at timestamp with time zone not null default now(),
      created_at timestamp with time zone not null default now()
    )
  `);

  await db.execute(sql`create index if not exists line_item_proof_approvals_org_idx on line_item_proof_approvals (organization_id)`);
  await db.execute(sql`create index if not exists line_item_proof_approvals_order_idx on line_item_proof_approvals (order_id)`);
  await db.execute(sql`create index if not exists line_item_proof_approvals_line_item_idx on line_item_proof_approvals (line_item_id)`);
  await db.execute(sql`create index if not exists line_item_proof_approvals_decision_idx on line_item_proof_approvals (decision)`);
  await db.execute(sql`create unique index if not exists line_item_proof_approvals_version_uidx on line_item_proof_approvals (proof_version_id)`);

  await db.execute(sql`
    create table if not exists line_item_proof_manual_approval_overrides (
      id varchar primary key default gen_random_uuid()::text,
      organization_id varchar not null references organizations(id) on delete cascade,
      order_id varchar not null references orders(id) on delete cascade,
      line_item_id varchar not null references order_line_items(id) on delete cascade,
      proof_version_id varchar not null references line_item_proof_versions(id) on delete cascade,
      source varchar(50) not null default 'manual_override',
      override_reason text not null,
      internal_note text,
      actor_user_id varchar references users(id) on delete set null,
      actor_name varchar(255),
      actor_email varchar(255),
      overridden_at timestamp with time zone not null default now(),
      created_at timestamp with time zone not null default now()
    )
  `);

  await db.execute(sql`create index if not exists line_item_proof_manual_approval_overrides_org_idx on line_item_proof_manual_approval_overrides (organization_id)`);
  await db.execute(sql`create index if not exists line_item_proof_manual_approval_overrides_order_idx on line_item_proof_manual_approval_overrides (order_id)`);
  await db.execute(sql`create index if not exists line_item_proof_manual_approval_overrides_line_item_idx on line_item_proof_manual_approval_overrides (line_item_id)`);
  await db.execute(sql`create index if not exists line_item_proof_manual_approval_overrides_created_at_idx on line_item_proof_manual_approval_overrides (created_at)`);
  await db.execute(sql`create unique index if not exists line_item_proof_manual_approval_overrides_version_uidx on line_item_proof_manual_approval_overrides (proof_version_id)`);

  await db.execute(sql`
    create table if not exists proof_access_tokens (
      id varchar primary key default gen_random_uuid()::text,
      organization_id varchar not null references organizations(id) on delete cascade,
      line_item_id varchar not null references order_line_items(id) on delete cascade,
      proof_version_id varchar not null references line_item_proof_versions(id) on delete cascade,
      token varchar(128) not null,
      expires_at timestamp with time zone not null,
      revoked_at timestamp with time zone,
      created_at timestamp with time zone not null default now(),
      created_by varchar(255) not null
    )
  `);

  await db.execute(sql`create index if not exists proof_access_tokens_org_idx on proof_access_tokens (organization_id)`);
  await db.execute(sql`create index if not exists proof_access_tokens_line_item_idx on proof_access_tokens (line_item_id)`);
  await db.execute(sql`create index if not exists proof_access_tokens_proof_version_idx on proof_access_tokens (proof_version_id)`);
  await db.execute(sql`create index if not exists proof_access_tokens_expires_at_idx on proof_access_tokens (expires_at)`);
  await db.execute(sql`create unique index if not exists proof_access_tokens_token_uidx on proof_access_tokens (token)`);

  await db.execute(sql`
    do $$
    begin
      if not exists (
        select 1
        from pg_constraint
        where conname = 'order_line_items_approved_proof_version_id_fkey'
      ) then
        alter table order_line_items
        add constraint order_line_items_approved_proof_version_id_fkey
        foreign key (approved_proof_version_id)
        references line_item_proof_versions(id)
        on delete set null;
      end if;
    end $$;
  `);
}

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

function assertInternalUser(req: any, res: Response) {
  const role = String(req.user?.role ?? "").toLowerCase();
  if (role === "customer") {
    res.status(403).json({ error: "Access denied" });
    return false;
  }
  return true;
}

function createTestApp() {
  const app = express();
  app.use(express.json());

  app.use((req: any, _res: Response, next: NextFunction) => {
    const userId = req.headers["x-test-user-id"];
    const role = req.headers["x-test-user-role"] || "employee";
    const orgId = req.headers["x-test-org-id"];

    if (orgId) {
      req.headers["x-organization-id"] = orgId;
    }

    if (userId) {
      req.user = { id: userId, role };
      req.isAuthenticated = () => true;
    } else {
      req.isAuthenticated = () => false;
    }

    next();
  });

  const isAuthenticated = (req: any, res: Response, next: NextFunction) => {
    if (req.isAuthenticated && req.isAuthenticated()) return next();
    return res.status(401).json({ error: "Unauthorized" });
  };

  const isAdmin = (req: any, res: Response, next: NextFunction) => {
    const role = String(req.user?.role ?? "").toLowerCase();
    if (role === "admin" || role === "owner") return next();
    return res.status(403).json({ error: "Admin access required" });
  };

  app.get("/api/proofing/queue", isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const queue = await listProofingQueue(db, {
        organizationId,
        slice: typeof req.query?.slice === "string" ? req.query.slice : "all",
      });

      return res.json({ success: true, data: queue });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ error: error?.message || "Failed to fetch proofing queue" });
    }
  });

  app.get("/api/proofing/line-item/:lineItemId", isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const truth = await resolveLineItemProofingTruth(db, {
        organizationId,
        lineItemId: String(req.params.lineItemId),
      });

      return res.json({ success: true, data: truth });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ error: error?.message || "Failed to resolve proofing truth" });
    }
  });

  app.post("/api/proofing/line-item/:lineItemId/versions", isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const parsed = z.object({
        proofFileId: z.string().min(1),
        internalNotes: z.string().optional().nullable(),
      }).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const lineItemId = String(req.params.lineItemId);
      const created = await db.transaction(async (tx) => {
        const proofVersion = await createLineItemProofVersion(tx, {
          organizationId,
          lineItemId,
          proofFileId: parsed.data.proofFileId,
          createdByUserId: userId,
          internalNotes: parsed.data.internalNotes ?? null,
        });

        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          actionType: "CREATE",
          entityType: "line_item_proof_version",
          entityId: proofVersion.id,
          entityName: `Proof v${proofVersion.versionNumber}`,
          description: `Created proof version ${proofVersion.versionNumber} for line item ${lineItemId}`,
          newValues: {
            lineItemId,
            proofFileId: proofVersion.proofFileId,
            versionNumber: proofVersion.versionNumber,
            status: proofVersion.status,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        const proofing = await resolveLineItemProofingTruth(tx, {
          organizationId,
          lineItemId,
        });

        return { proofVersion, proofing };
      });

      return res.json({ success: true, data: created });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ error: error?.message || "Failed to create proof version" });
    }
  });

  app.post("/api/proofing/versions/:proofVersionId/send", isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const parsed = z.object({
        sentToName: z.string().optional().nullable(),
        sentToEmail: z.string().optional().nullable(),
        customerMessage: z.string().optional().nullable(),
      }).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const result = await db.transaction(async (tx) => {
        const sendResult = await markProofVersionSent(tx, {
          organizationId,
          proofVersionId: String(req.params.proofVersionId),
          actorUserId: userId,
          sentToName: parsed.data.sentToName ?? null,
          sentToEmail: parsed.data.sentToEmail ?? null,
          customerMessage: parsed.data.customerMessage ?? null,
        });

        const proofing = await resolveLineItemProofingTruth(tx, {
          organizationId,
          lineItemId: sendResult.proofVersion.lineItemId,
        });

        return {
          ...sendResult,
          proofing,
        };
      });

      return res.json({ success: true, data: result });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ error: error?.message || "Failed to send proof version for review" });
    }
  });

  app.post("/api/proofing/line-item/:lineItemId/send-proof", isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const parsed = z.discriminatedUnion("mode", [
        z.object({
          mode: z.literal("uploaded"),
          proofFileId: z.string().min(1),
          internalNotes: z.string().optional().nullable(),
          sentToName: z.string().optional().nullable(),
          sentToEmail: z.string().optional().nullable(),
          customerMessage: z.string().optional().nullable(),
        }),
        z.object({
          mode: z.literal("generated"),
          internalNotes: z.string().optional().nullable(),
          sentToName: z.string().optional().nullable(),
          sentToEmail: z.string().optional().nullable(),
          customerMessage: z.string().optional().nullable(),
        }),
      ]).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const lineItemId = String(req.params.lineItemId);
      const result = await db.transaction(async (tx) => {
        const created = await createAndSendProofVersion(tx, {
          organizationId,
          lineItemId,
          actorUserId: userId,
          mode: parsed.data.mode,
          proofFileId: "proofFileId" in parsed.data ? parsed.data.proofFileId : null,
          internalNotes: parsed.data.internalNotes ?? null,
          sentToName: parsed.data.sentToName ?? null,
          sentToEmail: parsed.data.sentToEmail ?? null,
          customerMessage: parsed.data.customerMessage ?? null,
        });

        const proofing = await resolveLineItemProofingTruth(tx, {
          organizationId,
          lineItemId,
        });

        return {
          ...created,
          proofing,
        };
      });

      return res.json({ success: true, data: result });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ error: error?.message || "Failed to create and send proof" });
    }
  });

  app.post("/api/proofing/versions/:proofVersionId/respond", isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const parsed = z.object({
        decision: z.enum(["approved", "rejected", "revision_requested"]),
        responseNotes: z.string().optional().nullable(),
        responderName: z.string().optional().nullable(),
        responderEmail: z.string().optional().nullable(),
        responderSource: z.string().optional().nullable(),
      }).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const result = await db.transaction(async (tx) => {
        const responseResult = await recordProofResponse(tx, {
          organizationId,
          proofVersionId: String(req.params.proofVersionId),
          actorUserId: userId,
          responderName: parsed.data.responderName ?? null,
          responderEmail: parsed.data.responderEmail ?? null,
          responderSource: parsed.data.responderSource ?? null,
          decision: parsed.data.decision,
          responseNotes: parsed.data.responseNotes ?? null,
        });

        const proofing = await resolveLineItemProofingTruth(tx, {
          organizationId,
          lineItemId: responseResult.approval.lineItemId,
        });

        return {
          ...responseResult,
          proofing,
        };
      });

      return res.json({ success: true, data: result });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ error: error?.message || "Failed to record proof response" });
    }
  });

  app.post("/api/proofing/line-item/:lineItemId/manual-approval-override", isAuthenticated, tenantContext, isAdmin, async (req: any, res: Response) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const parsed = z.object({
        proofVersionId: z.string().min(1).optional().nullable(),
        overrideReason: z.string().trim().min(1, "Override reason is required"),
        internalNote: z.string().optional().nullable(),
      }).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const lineItemId = String(req.params.lineItemId);
      const result = await db.transaction(async (tx) => {
        const overrideResult = await recordManualProofApprovalOverride(tx, {
          organizationId,
          lineItemId,
          proofVersionId: parsed.data.proofVersionId ?? null,
          actorUserId: userId,
          actorName: req.user?.name ?? null,
          actorEmail: req.user?.email ?? null,
          overrideReason: parsed.data.overrideReason,
          internalNote: parsed.data.internalNote ?? null,
        });

        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          actionType: "CREATE",
          entityType: "line_item_proof_manual_approval_override",
          entityId: overrideResult.manualApprovalOverride.id,
          entityName: `Manual proof override ${overrideResult.manualApprovalOverride.id}`,
          description: `Manual approval override recorded for proof version ${overrideResult.manualApprovalOverride.proofVersionId}`,
          newValues: {
            source: "manual_override",
            lineItemId,
            proofVersionId: overrideResult.manualApprovalOverride.proofVersionId,
            overrideReason: overrideResult.manualApprovalOverride.overrideReason,
            internalNote: overrideResult.manualApprovalOverride.internalNote,
            workflowState: overrideResult.workflowTransition.toState,
          },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        const proofing = await resolveLineItemProofingTruth(tx, {
          organizationId,
          lineItemId,
        });

        return {
          ...overrideResult,
          proofing,
        };
      });

      return res.json({ success: true, data: result });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ error: error?.message || "Failed to record manual approval override" });
    }
  });

  app.get("/api/portal/proof/:token", async (req: any, res: Response) => {
    try {
      const validation = await validateProofToken(db, String(req.params.token));

      return res.json({
        success: true,
        data: {
          proofVersion: {
            id: validation.proofVersion.id,
            versionNumber: validation.proofVersion.versionNumber,
            createdAt: new Date(validation.proofVersion.createdAt).toISOString(),
          },
          attachments: [
            {
              id: validation.proofVersion.proofFileId,
              downloadUrl: `https://example.com/objects/${validation.proofVersion.proofFileId}`,
            },
          ],
          status: validation.currentApprovalState.status,
        },
      });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ error: error?.message || "Failed to resolve portal proof" });
    }
  });

  app.post("/api/portal/proof/:token/action", async (req: any, res: Response) => {
    try {
      const parsed = z.object({
        action: z.enum(["approve", "reject", "revision_request"]),
        comment: z.string().optional().nullable(),
      }).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const result = await db.transaction(async (tx) => {
        const validation = await validateProofToken(tx, String(req.params.token));

        if (validation.currentApprovalState.isOverridden) {
          throw Object.assign(new Error("This proof has already been resolved by manual approval override"), { statusCode: 409 });
        }

        if (validation.currentApprovalState.status !== "pending") {
          throw Object.assign(new Error("This proof has already been resolved"), { statusCode: 409 });
        }

        const decision = parsed.data.action === "approve"
          ? "approved"
          : parsed.data.action === "reject"
            ? "rejected"
            : "revision_requested";

        const responseResult = await recordProofResponse(tx, {
          organizationId: validation.lineItem.organizationId,
          proofVersionId: validation.proofVersion.id,
          actorUserId: null,
          responderName: validation.proofVersion.sentToName ?? null,
          responderEmail: validation.proofVersion.sentToEmail ?? null,
          responderSource: "customer",
          decision,
          responseNotes: parsed.data.comment ?? null,
        });

        await tx.insert(auditLogs).values({
          organizationId: validation.lineItem.organizationId,
          userId: null,
          userName: validation.proofVersion.sentToEmail || validation.proofVersion.sentToName || "External customer",
          actionType: "CREATE",
          entityType: "line_item_proof_approval",
          entityId: responseResult.approval.id,
          entityName: `Proof response ${responseResult.approval.id}`,
          description: `Customer recorded ${responseResult.approval.decision} response for proof version ${responseResult.approval.proofVersionId}`,
          newValues: {
            source: "customer",
            lineItemId: responseResult.approval.lineItemId,
            proofVersionId: responseResult.approval.proofVersionId,
            decision: responseResult.approval.decision,
          },
        } as any);

        const updated = await validateProofToken(tx, String(req.params.token));

        return {
          approval: responseResult.approval,
          status: updated.currentApprovalState.status,
        };
      });

      return res.json({ success: true, data: result });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ error: error?.message || "Failed to record customer proof action" });
    }
  });

  app.post("/api/design/line-item/:lineItemId/complete", isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const result = await db.transaction((tx) =>
        completeLineItemDesign(tx, {
          organizationId,
          lineItemId: String(req.params.lineItemId),
          actorUserId: userId,
          note: typeof req.body?.note === "string" ? req.body.note : null,
          metadata: { source: "test_design_complete" },
        }),
      );

      return res.json({ success: true, data: result });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ error: error?.message || "Failed to complete design" });
    }
  });

  app.post("/api/line-items/:lineItemId/workflow-transition", isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const parsed = z.object({
        toState: z.enum([
          "new",
          "needs_design",
          "in_design",
          "awaiting_proof_approval",
          "ready_for_prepress",
          "in_prepress",
          "ready_for_production",
          "in_production",
          "completed",
          "on_hold",
          "canceled",
        ]),
      }).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const result = await db.transaction((tx) =>
        transitionLineItemWorkflowState(tx, {
          organizationId,
          lineItemId: String(req.params.lineItemId),
          toState: parsed.data.toState,
          actorUserId: userId,
        }),
      );

      return res.json({ success: true, data: result });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ error: error?.message || "Failed to transition workflow" });
    }
  });

  return app;
}

describe("proofing route integration", () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const orgId = `org_proof_${suffix}`;
  const userId = `user_proof_${suffix}`;
  const customerId = `cust_proof_${suffix}`;
  const productId = `prod_proof_${suffix}`;
  const orderId = `order_proof_${suffix}`;
  const app = createTestApp();

  beforeAll(async () => {
    await ensureProofingSchemaReady();

    await db.execute(sql`
      insert into organizations (id, name, slug)
      values (${orgId}, ${`Proof Org ${suffix}`}, ${`proof-org-${suffix}`})
      on conflict (id) do nothing
    `);

    await db.execute(sql`
      insert into stations (organization_id, key, name, sort, active)
      values
        (${orgId}, ${"design"}, ${"Design"}, ${10}, ${true}),
        (${orgId}, ${"prepress"}, ${"Prepress"}, ${20}, ${true})
      on conflict (organization_id, key) do update
      set name = excluded.name,
          sort = excluded.sort,
          active = excluded.active
    `);

    await db.execute(sql`
      insert into production_station_steps (organization_id, station_key, key, label, sort_order, active, triggers)
      values
        (${orgId}, ${"design"}, ${"design"}, ${"Design"}, ${10}, ${true}, '[]'::jsonb),
        (${orgId}, ${"prepress"}, ${"prepress"}, ${"Prepress"}, ${20}, ${true}, '[]'::jsonb)
      on conflict (organization_id, station_key, key) do update
      set label = excluded.label,
          sort_order = excluded.sort_order,
          active = excluded.active,
          triggers = excluded.triggers
    `);

    await db.execute(sql`
      insert into users (id, email, role, is_admin, is_platform_admin)
      values (${userId}, ${`proof-${suffix}@example.com`}, ${"employee"}, ${false}, ${false})
      on conflict (id) do nothing
    `);

    await db.execute(sql`
      insert into user_organizations (user_id, organization_id, role, is_default)
      values (${userId}, ${orgId}, ${"admin"}, ${true})
      on conflict (user_id, organization_id) do nothing
    `);

    await db.execute(sql`
      insert into customers (id, organization_id, company_name, status)
      values (${customerId}, ${orgId}, ${"Proof Customer"}, ${"active"})
      on conflict (id) do nothing
    `);

    await db.execute(sql`
      insert into products (id, organization_id, name, description, requires_production_job)
      values (${productId}, ${orgId}, ${"Proof Product"}, ${"desc"}, ${true})
      on conflict (id) do nothing
    `);

    await db.execute(sql`
      insert into orders (
        id,
        organization_id,
        order_number,
        customer_id,
        created_by_user_id,
        subtotal,
        tax,
        total,
        discount,
        status,
        state,
        priority,
        fulfillment_status,
        billing_status,
        billing_ready_override
      )
      values (
        ${orderId}, ${orgId}, ${`SO-PROOF-${suffix}`}, ${customerId}, ${userId}, ${0}, ${0}, ${0}, ${0}, ${"new"}, ${"open"}, ${"normal"}, ${"pending"}, ${"not_ready"}, ${false}
      )
      on conflict (id) do nothing
    `);
  });

  afterEach(async () => {
    await db.execute(sql`delete from audit_logs where organization_id = ${orgId} and entity_type in ('line_item_proof_version', 'line_item_proof_approval', 'line_item_proof_manual_approval_override')`);
    await db.execute(sql`delete from production_events where organization_id = ${orgId}`);
    await db.execute(sql`delete from production_jobs where organization_id = ${orgId}`);
    await db.execute(sql`delete from storage_jobs where organization_id = ${orgId}`);
    await db.execute(sql`delete from proof_access_tokens where organization_id = ${orgId}`);
    await db.execute(sql`delete from line_item_proof_manual_approval_overrides where organization_id = ${orgId}`);
    await db.execute(sql`delete from line_item_proof_approvals where organization_id = ${orgId}`);
    await db.execute(sql`delete from line_item_proof_versions where organization_id = ${orgId}`);
    await db.execute(sql`delete from order_attachments where order_id = ${orderId}`);
    await db.execute(sql`delete from order_line_items where order_id = ${orderId}`);
    await db.execute(sql`delete from file_derivatives where file_record_id in (select id from file_records where organization_id = ${orgId})`);
    await db.execute(sql`delete from storage_placements where file_record_id in (select id from file_records where organization_id = ${orgId})`);
    await db.execute(sql`delete from file_records where organization_id = ${orgId}`);
  });

  afterAll(async () => {
    await db.execute(sql`delete from orders where id = ${orderId}`);
    await db.execute(sql`delete from storage_jobs where organization_id = ${orgId}`);
    await db.execute(sql`delete from file_derivatives where file_record_id in (select id from file_records where organization_id = ${orgId})`);
    await db.execute(sql`delete from storage_placements where file_record_id in (select id from file_records where organization_id = ${orgId})`);
    await db.execute(sql`delete from file_records where organization_id = ${orgId}`);
    await db.execute(sql`delete from organization_storage_profiles where organization_id = ${orgId}`);
    await db.execute(sql`delete from storage_provider_configs where organization_id = ${orgId}`);
    await db.execute(sql`delete from production_station_steps where organization_id = ${orgId}`);
    await db.execute(sql`delete from stations where organization_id = ${orgId}`);
    await db.execute(sql`delete from products where id = ${productId}`);
    await db.execute(sql`delete from customers where id = ${customerId}`);
    await db.execute(sql`delete from user_organizations where user_id = ${userId}`);
    await db.execute(sql`delete from users where id = ${userId}`);
    await db.execute(sql`delete from organizations where id = ${orgId}`);
  });

  async function createLineItemFixture(
    name: string,
    options?: {
      workflowState?: string;
      designStatus?: string | null;
      requiresDesign?: boolean;
      requiresProofApproval?: boolean;
      requiresPrepress?: boolean;
      attachProofFiles?: boolean;
      addArtwork?: boolean;
    },
  ) {
    const lineItemId = `line_${name}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const proofFileA = `proof_a_${name}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const proofFileB = `proof_b_${name}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const artworkFileId = `artwork_${name}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    const workflowState = options?.workflowState ?? "ready_for_prepress";
    const designStatus = options?.designStatus ?? null;
    const requiresDesign = options?.requiresDesign ?? false;
    const requiresProofApproval = options?.requiresProofApproval ?? false;
    const requiresPrepress = options?.requiresPrepress ?? true;
    const attachProofFiles = options?.attachProofFiles ?? true;
    const addArtwork = options?.addArtwork ?? false;

    await db.execute(sql`
      insert into order_line_items (
        id,
        order_id,
        product_id,
        description,
        quantity,
        unit_price,
        total_price,
        sort_order,
        requires_design,
        requires_proof_approval,
        requires_prepress,
        design_status,
        workflow_state,
        status
      )
      values (
        ${lineItemId}, ${orderId}, ${productId}, ${`Line ${name}`}, ${1}, ${10}, ${10}, ${0}, ${requiresDesign}, ${requiresProofApproval}, ${requiresPrepress}, ${designStatus}, ${workflowState}, ${"new"}
      )
    `);

    if (attachProofFiles) {
      await db.execute(sql`
        insert into order_attachments (
          id,
          order_id,
          order_line_item_id,
          uploaded_by_user_id,
          uploaded_by_name,
          file_name,
          file_url,
          role
        )
        values
          (${proofFileA}, ${orderId}, ${lineItemId}, ${userId}, ${"Proof User"}, ${`${name}-proof-a.pdf`}, ${`https://example.com/${proofFileA}.pdf`}, ${"proof"}),
          (${proofFileB}, ${orderId}, ${lineItemId}, ${userId}, ${"Proof User"}, ${`${name}-proof-b.pdf`}, ${`https://example.com/${proofFileB}.pdf`}, ${"proof"})
      `);
    }

    if (addArtwork) {
      await db.execute(sql`
        insert into order_attachments (
          id,
          order_id,
          order_line_item_id,
          uploaded_by_user_id,
          uploaded_by_name,
          file_name,
          file_url,
          role,
          is_primary
        )
        values (
          ${artworkFileId}, ${orderId}, ${lineItemId}, ${userId}, ${"Proof User"}, ${`${name}-artwork.pdf`}, ${`https://example.com/${artworkFileId}.pdf`}, ${"artwork"}, ${true}
        )
      `);
    }

    return { lineItemId, proofFileA, proofFileB, artworkFileId };
  }

  async function createAndSendProof(lineItemId: string, proofFileId: string) {
    const createRes = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/versions`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ proofFileId })
      .expect(200);

    const proofVersionId = createRes.body?.data?.proofVersion?.id as string;

    const sendRes = await request(app)
      .post(`/api/proofing/versions/${proofVersionId}/send`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ sentToEmail: "customer@example.com" })
      .expect(200);

    return {
      proofVersionId,
      createRes,
      sendRes,
    };
  }

  async function createPortalToken(lineItemId: string, proofVersionId: string) {
    const result = await db.transaction((tx) =>
      createProofAccessToken(tx, {
        organizationId: orgId,
        lineItemId,
        proofVersionId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        createdBy: userId,
      }),
    );

    return result.rawToken;
  }

  test("creates a proof version and exposes the canonical read model", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("create");

    const res = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/versions`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ proofFileId: proofFileA, internalNotes: "draft ready" })
      .expect(200);

    expect(res.body?.data?.proofVersion?.status).toBe("draft");
    const proofing = proofingReadModelSchema.parse(res.body?.data?.proofing);
    expect(proofing.currentActionableProofVersion?.status).toBe("draft");
    expect(proofing.currentActionableProofVersion?.proofFileId).toBe(proofFileA);
    expect(proofing.blockedPendingProofApproval).toBe(false);
  });

  test("sends a proof for review and blocks the line item pending approval", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("send");
    const { sendRes } = await createAndSendProof(lineItemId, proofFileA);

    expect(sendRes.body?.data?.proofVersion?.status).toBe("awaiting_response");
    const proofing = proofingReadModelSchema.parse(sendRes.body?.data?.proofing);
    expect(proofing.workflowState).toBe("awaiting_proof_approval");
    expect(proofing.requiresProofApproval).toBe(true);
    expect(proofing.blockedPendingProofApproval).toBe(true);
    expect(proofing.currentActionableProofVersion?.status).toBe("awaiting_response");
  });

  test("uploads or selects a manual proof file and sends it through the canonical flow", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("manual_send");

    const res = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/send-proof`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ mode: "uploaded", proofFileId: proofFileA, internalNotes: "manual fallback" })
      .expect(200);

    expect(res.body?.data?.proofVersion?.status).toBe("awaiting_response");
    const proofing = proofingReadModelSchema.parse(res.body?.data?.proofing);
    expect(proofing.currentActionableProofVersion?.proofFileId).toBe(proofFileA);
    expect(proofing.currentDisplayedProofArtifact?.artifactKind).toBe("uploaded");
    expect(proofing.currentProofInputSnapshot?.lineItemId).toBe(lineItemId);
  });

  test("generates a basic proof from persisted artwork and sends it through the canonical flow", async () => {
    const { lineItemId, artworkFileId } = await createLineItemFixture("generated_send", {
      attachProofFiles: false,
      addArtwork: true,
      requiresProofApproval: true,
      requiresPrepress: true,
      workflowState: "awaiting_proof_approval",
    });

    const res = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/send-proof`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ mode: "generated", internalNotes: "generated path" })
      .expect(200);

    expect(res.body?.data?.proofVersion?.status).toBe("awaiting_response");
    expect(res.body?.data?.proofVersion?.proofFileId).not.toBe(artworkFileId);
    const proofing = proofingReadModelSchema.parse(res.body?.data?.proofing);
    expect(proofing.currentDisplayedProofArtifact?.artifactKind).toBe("generated");
    expect(proofing.currentProofInputSnapshot?.sourceArtwork?.sourceId).toBe(artworkFileId);

    const [generatedAttachment] = await db
      .select({ mimeType: orderAttachments.mimeType, role: orderAttachments.role })
      .from(orderAttachments)
      .where(eq(orderAttachments.id, String(res.body?.data?.proofVersion?.proofFileId)))
      .limit(1);

    expect(generatedAttachment).toMatchObject({ mimeType: "application/pdf", role: "proof" });
  });

  test("fails clearly when generated proof is requested without a saved artwork source", async () => {
    const { lineItemId } = await createLineItemFixture("generated_missing_art", {
      attachProofFiles: false,
      addArtwork: false,
      requiresProofApproval: true,
      requiresPrepress: true,
      workflowState: "awaiting_proof_approval",
    });

    const res = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/send-proof`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ mode: "generated" })
      .expect(409);

    expect(res.body?.error).toBe("A saved artwork source is required before generating a proof");

    const truth = await resolveLineItemProofingTruth(db, {
      organizationId: orgId,
      lineItemId,
    });

    expect(truth.currentActionableProofVersionId).toBeNull();
  });

  test("auto-syncs a canonical proof from persisted artwork and exposes it in the proofing queue", async () => {
    const { lineItemId, artworkFileId } = await createLineItemFixture("auto_sync", {
      workflowState: "ready_for_prepress",
      requiresProofApproval: true,
      requiresPrepress: true,
      attachProofFiles: false,
      addArtwork: true,
    });

    const result = await db.transaction((tx) =>
      autoSyncCanonicalProofForLineItem(tx, {
        organizationId: orgId,
        lineItemId,
        actorUserId: userId,
        reason: "artwork_saved",
      }),
    );

    expect(result.status).toBe("created");

    const truth = await resolveLineItemProofingTruth(db, {
      organizationId: orgId,
      lineItemId,
    });

    expect(truth.workflowState).toBe("awaiting_proof_approval");
    expect(truth.currentActionableProofVersion?.status).toBe("awaiting_response");
    expect(truth.currentActionableProofVersion?.proofFileId).not.toBe(artworkFileId);

    const queue = await listProofingQueue(db, {
      organizationId: orgId,
      slice: "awaiting_approval",
    });

    expect(queue.rows.some((row) => row.lineItemId === lineItemId)).toBe(true);
  });

  test("approves a proof, advances workflow, and rejects repeated approvals safely", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("approve");
    const { proofVersionId } = await createAndSendProof(lineItemId, proofFileA);

    const approveRes = await request(app)
      .post(`/api/proofing/versions/${proofVersionId}/respond`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ decision: "approved", responseNotes: "looks good" })
      .expect(200);

    expect(approveRes.body?.data?.approval?.decision).toBe("approved");
    expect(approveRes.body?.data?.workflowTransition?.toState).toBe("ready_for_prepress");
    const proofing = proofingReadModelSchema.parse(approveRes.body?.data?.proofing);
    expect(proofing.approvedProofVersionId).toBe(proofVersionId);
    expect(proofing.approvedNormally).toBe(true);
    expect(proofing.approvedByOverride).toBe(false);
    expect(proofing.blockedPendingProofApproval).toBe(false);

    const [job] = await db
      .select({ stationKey: productionJobs.stationKey, stepKey: productionJobs.stepKey, status: productionJobs.status })
      .from(productionJobs)
      .where(eq(productionJobs.lineItemId, lineItemId))
      .limit(1);

    expect(job).toMatchObject({ stationKey: "prepress", stepKey: "prepress", status: "queued" });

    const repeatRes = await request(app)
      .post(`/api/proofing/versions/${proofVersionId}/respond`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ decision: "approved" })
      .expect(409);

    expect(repeatRes.body?.error).toBe("Only proof versions awaiting response can be decided");
  });

  test("rejects a proof and returns the line item to design", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("reject");
    const { proofVersionId } = await createAndSendProof(lineItemId, proofFileA);

    const rejectRes = await request(app)
      .post(`/api/proofing/versions/${proofVersionId}/respond`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ decision: "rejected", responseNotes: "wrong phone number" })
      .expect(200);

    expect(rejectRes.body?.data?.workflowTransition?.toState).toBe("needs_design");
    const proofing = proofingReadModelSchema.parse(rejectRes.body?.data?.proofing);
    expect(proofing.approvedProofVersionId).toBeNull();
    expect(proofing.proofDecisionHistory[0]?.decision).toBe("rejected");
  });

  test("refreshes proof context when artwork changes after approval", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("refresh_after_art", {
      workflowState: "ready_for_prepress",
      requiresProofApproval: true,
      requiresPrepress: true,
      attachProofFiles: true,
      addArtwork: false,
    });

    const { proofVersionId } = await createAndSendProof(lineItemId, proofFileA);

    await request(app)
      .post(`/api/proofing/versions/${proofVersionId}/respond`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ decision: "approved", responseNotes: "approved before art change" })
      .expect(200);

    const replacementArtworkId = `artwork_refresh_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    await db.execute(sql`
      insert into order_attachments (
        id,
        order_id,
        order_line_item_id,
        uploaded_by_user_id,
        uploaded_by_name,
        file_name,
        file_url,
        role,
        is_primary
      )
      values (
        ${replacementArtworkId}, ${orderId}, ${lineItemId}, ${userId}, ${"Proof User"}, ${"replacement-artwork.pdf"}, ${`https://example.com/${replacementArtworkId}.pdf`}, ${"artwork"}, ${true}
      )
    `);

    const result = await db.transaction((tx) =>
      autoSyncCanonicalProofForLineItem(tx, {
        organizationId: orgId,
        lineItemId,
        actorUserId: userId,
        reason: "artwork_saved",
      }),
    );

    expect(result.status).toBe("refreshed");

    const truth = await resolveLineItemProofingTruth(db, {
      organizationId: orgId,
      lineItemId,
    });

    expect(truth.approvedProofVersionId).toBeNull();
    expect(truth.workflowState).toBe("awaiting_proof_approval");
    expect(truth.currentActionableProofVersion?.status).toBe("awaiting_response");

    const versions = await db
      .select({ id: orderAttachments.id, role: orderAttachments.role })
      .from(orderAttachments)
      .where(eq(orderAttachments.orderLineItemId, lineItemId));

    expect(versions.some((row) => row.role === "proof")).toBe(true);
  });

  test("blocks incomplete design from bypassing directly into prepress", async () => {
    const { lineItemId } = await createLineItemFixture("design_block", {
      workflowState: "in_design",
      designStatus: "in_design",
      requiresDesign: true,
      requiresPrepress: true,
    });

    const res = await request(app)
      .post(`/api/line-items/${lineItemId}/workflow-transition`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ toState: "ready_for_prepress" })
      .expect(409);

    expect(res.body?.error).toBe("Design must be completed before transitioning to ready_for_prepress");
  });

  test("completes design into awaiting proof approval when proofing is required", async () => {
    const { lineItemId } = await createLineItemFixture("design_to_proof", {
      workflowState: "in_design",
      designStatus: "in_design",
      requiresDesign: true,
      requiresProofApproval: true,
      requiresPrepress: true,
    });

    const res = await request(app)
      .post(`/api/design/line-item/${lineItemId}/complete`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ note: "ready for customer proof" })
      .expect(200);

    expect(res.body?.data?.fromState).toBe("in_design");
    expect(res.body?.data?.toState).toBe("awaiting_proof_approval");

    const [lineItem] = await db
      .select({ workflowState: orderLineItems.workflowState, designStatus: orderLineItems.designStatus })
      .from(orderLineItems)
      .where(eq(orderLineItems.id, lineItemId))
      .limit(1);

    expect(lineItem?.workflowState).toBe("awaiting_proof_approval");
    expect(lineItem?.designStatus).toBe("design_complete");
  });

  test("completes design into prepress when no proof is required", async () => {
    const { lineItemId } = await createLineItemFixture("design_to_prepress", {
      workflowState: "in_design",
      designStatus: "in_design",
      requiresDesign: true,
      requiresProofApproval: false,
      requiresPrepress: true,
    });

    const res = await request(app)
      .post(`/api/design/line-item/${lineItemId}/complete`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ note: "ready for prepress" })
      .expect(200);

    expect(res.body?.data?.fromState).toBe("in_design");
    expect(res.body?.data?.toState).toBe("ready_for_prepress");

    const [lineItem] = await db
      .select({ workflowState: orderLineItems.workflowState, designStatus: orderLineItems.designStatus })
      .from(orderLineItems)
      .where(eq(orderLineItems.id, lineItemId))
      .limit(1);

    expect(lineItem?.workflowState).toBe("ready_for_prepress");
    expect(lineItem?.designStatus).toBe("design_complete");
  });

  test("returns proofing queue slices from canonical proofing truth", async () => {
    const { lineItemId: awaitingSendLineItemId, proofFileA: awaitingSendProofFile } = await createLineItemFixture("queue_draft");
    await request(app)
      .post(`/api/proofing/line-item/${awaitingSendLineItemId}/versions`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ proofFileId: awaitingSendProofFile })
      .expect(200);

    const { lineItemId: awaitingApprovalLineItemId, proofFileA: awaitingApprovalProofFile } = await createLineItemFixture("queue_awaiting");
    await createAndSendProof(awaitingApprovalLineItemId, awaitingApprovalProofFile);

    const { lineItemId: revisionLineItemId, proofFileA: revisionProofFile } = await createLineItemFixture("queue_revision");
    const { proofVersionId: revisionProofVersionId } = await createAndSendProof(revisionLineItemId, revisionProofFile);
    await request(app)
      .post(`/api/proofing/versions/${revisionProofVersionId}/respond`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ decision: "revision_requested", responseNotes: "Please revise" })
      .expect(200);

    const { lineItemId: approvedLineItemId, proofFileA: approvedProofFile } = await createLineItemFixture("queue_approved");
    const { proofVersionId: approvedProofVersionId } = await createAndSendProof(approvedLineItemId, approvedProofFile);
    await request(app)
      .post(`/api/proofing/versions/${approvedProofVersionId}/respond`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ decision: "approved", responseNotes: "approved" })
      .expect(200);

    const allQueueRes = await request(app)
      .get("/api/proofing/queue")
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .expect(200);

    const allQueue = proofingQueueResponseSchema.parse(allQueueRes.body?.data);
    expect(allQueue.counts.all).toBe(4);
    expect(allQueue.counts.awaitingSend).toBe(1);
    expect(allQueue.counts.awaitingApproval).toBe(1);
    expect(allQueue.counts.revisionRequested).toBe(1);
    expect(allQueue.counts.approved).toBe(1);

    const awaitingApprovalRow = allQueue.rows.find((row) => row.lineItemId === awaitingApprovalLineItemId);
    expect(awaitingApprovalRow?.currentQueueStatus).toBe("awaiting_approval");
    expect(awaitingApprovalRow?.blockedPendingProofApproval).toBe(true);
    expect(awaitingApprovalRow?.currentDisplayedProofVersionLabel).toBe("Proof v1");

    const approvedOnlyRes = await request(app)
      .get("/api/proofing/queue")
      .query({ slice: "approved" })
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .expect(200);

    const approvedQueue = proofingQueueResponseSchema.parse(approvedOnlyRes.body?.data);
    expect(approvedQueue.rows).toHaveLength(1);
    expect(approvedQueue.rows[0]?.lineItemId).toBe(approvedLineItemId);
    expect(approvedQueue.rows[0]?.approvedNormally).toBe(true);
  });

  test("records manual approval override as a first-class approval source with durable history", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("override_success");
    const { proofVersionId } = await createAndSendProof(lineItemId, proofFileA);

    const overrideRes = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/manual-approval-override`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ proofVersionId, overrideReason: "Customer approved by phone", internalNote: "CSR confirmed at 4:30 PM" })
      .expect(200);

    expect(overrideRes.body?.data?.workflowTransition?.toState).toBe("ready_for_prepress");
    const proofing = proofingReadModelSchema.parse(overrideRes.body?.data?.proofing);
    expect(proofing.approvedProofVersionId).toBe(proofVersionId);
    expect(proofing.approvedProofSource).toBe("manual_override");
    expect(proofing.approvedByOverride).toBe(true);
    expect(proofing.approvedNormally).toBe(false);
    expect(proofing.manualApprovalOverrideHistory).toHaveLength(1);
    expect(proofing.manualApprovalOverrideHistory[0]?.overrideReason).toBe("Customer approved by phone");

    const [overrideRow] = await db
      .select({
        proofVersionId: lineItemProofManualApprovalOverrides.proofVersionId,
        overrideReason: lineItemProofManualApprovalOverrides.overrideReason,
        source: lineItemProofManualApprovalOverrides.source,
      })
      .from(lineItemProofManualApprovalOverrides)
      .where(sql`${lineItemProofManualApprovalOverrides.organizationId} = ${orgId} and ${lineItemProofManualApprovalOverrides.lineItemId} = ${lineItemId}`)
      .limit(1);

    expect(overrideRow?.proofVersionId).toBe(proofVersionId);
    expect(overrideRow?.overrideReason).toBe("Customer approved by phone");
    expect(overrideRow?.source).toBe("manual_override");

    const [auditRow] = await db
      .select({ entityType: auditLogs.entityType, entityId: auditLogs.entityId })
      .from(auditLogs)
      .where(sql`${auditLogs.organizationId} = ${orgId} and ${auditLogs.entityType} = 'line_item_proof_manual_approval_override'`)
      .limit(1);

    expect(auditRow?.entityType).toBe("line_item_proof_manual_approval_override");
  });

  test("rejects manual approval override when reason is missing", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("override_missing_reason");
    const { proofVersionId } = await createAndSendProof(lineItemId, proofFileA);

    const res = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/manual-approval-override`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ proofVersionId, overrideReason: "   " })
      .expect(400);

    expect(String(res.body?.error || "")).toMatch(/override reason is required/i);
  });

  test("rejects stale or invalid manual approval override attempts", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("override_invalid");

    const createDraftRes = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/versions`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ proofFileId: proofFileA })
      .expect(200);

    const draftProofVersionId = createDraftRes.body?.data?.proofVersion?.id as string;

    const invalidDraftOverrideRes = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/manual-approval-override`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ proofVersionId: draftProofVersionId, overrideReason: "Force approval" })
      .expect(409);

    expect(invalidDraftOverrideRes.body?.error).toBe("Line item is not eligible for manual approval override");

    const { proofVersionId } = await createAndSendProof(lineItemId, proofFileA);
    await request(app)
      .post(`/api/proofing/versions/${proofVersionId}/respond`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ decision: "approved" })
      .expect(200);

    const staleOverrideRes = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/manual-approval-override`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ proofVersionId, overrideReason: "Late override" })
      .expect(409);

    expect(String(staleOverrideRes.body?.error || "")).toMatch(/already has an approved proof|not eligible/i);
  });

  test("records revision requests and returns the line item to design", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("revision");
    const { proofVersionId } = await createAndSendProof(lineItemId, proofFileA);

    const revisionRes = await request(app)
      .post(`/api/proofing/versions/${proofVersionId}/respond`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ decision: "revision_requested", responseNotes: "update crop marks" })
      .expect(200);

    expect(revisionRes.body?.data?.workflowTransition?.toState).toBe("needs_design");
    const proofing = proofingReadModelSchema.parse(revisionRes.body?.data?.proofing);
    expect(proofing.proofDecisionHistory[0]?.decision).toBe("revision_requested");
    expect(proofing.currentActionableProofVersion).toBeNull();
  });

  test("blocks workflow progression when proof approval is required but still missing", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("guard");
    await createAndSendProof(lineItemId, proofFileA);

    const res = await request(app)
      .post(`/api/line-items/${lineItemId}/workflow-transition`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ toState: "ready_for_prepress" })
      .expect(409);

    expect(res.body?.error).toBe("Approved proof is required before transitioning to ready_for_prepress");
  });

  test("rejects stale actions against a superseded proof version", async () => {
    const { lineItemId, proofFileA, proofFileB } = await createLineItemFixture("stale");

    const firstCreate = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/versions`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ proofFileId: proofFileA })
      .expect(200);

    const staleProofVersionId = firstCreate.body?.data?.proofVersion?.id as string;

    const secondCreate = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/versions`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ proofFileId: proofFileB })
      .expect(200);

    const readRes = await request(app)
      .get(`/api/proofing/line-item/${lineItemId}`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .expect(200);

    const proofing = proofingReadModelSchema.parse(readRes.body?.data);
    const superseded = proofing.proofVersionHistory.find((entry: ProofVersionHistoryEntry) => entry.id === staleProofVersionId);
    expect(superseded?.status).toBe("superseded");
    expect(proofing.currentActionableProofVersion?.id).toBe(secondCreate.body?.data?.proofVersion?.id);

    const sendStaleRes = await request(app)
      .post(`/api/proofing/versions/${staleProofVersionId}/send`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ sentToEmail: "customer@example.com" })
      .expect(409);

    expect(sendStaleRes.body?.error).toBe("Only draft proof versions can be sent for review");
  });

  test("validates customer proof tokens and returns a customer-safe proof payload", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("portal_view");
    const { proofVersionId } = await createAndSendProof(lineItemId, proofFileA);
    const token = await createPortalToken(lineItemId, proofVersionId);

    const res = await request(app)
      .get(`/api/portal/proof/${token}`)
      .expect(200);

    expect(res.body?.data?.proofVersion?.id).toBe(proofVersionId);
    expect(res.body?.data?.status).toBe("pending");
    expect(res.body?.data?.attachments?.[0]?.downloadUrl).toContain(proofFileA);
  });

  test("records a customer approval through the token layer and preserves canonical proofing truth", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("portal_approve");
    const { proofVersionId } = await createAndSendProof(lineItemId, proofFileA);
    const token = await createPortalToken(lineItemId, proofVersionId);

    const approveRes = await request(app)
      .post(`/api/portal/proof/${token}/action`)
      .send({ action: "approve", comment: "Approved by customer" })
      .expect(200);

    expect(approveRes.body?.data?.approval?.decision).toBe("approved");
    expect(approveRes.body?.data?.status).toBe("approved");

    const truthRes = await request(app)
      .get(`/api/proofing/line-item/${lineItemId}`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .expect(200);

    const truth = proofingReadModelSchema.parse(truthRes.body?.data);
    expect(truth.approvedProofVersionId).toBe(proofVersionId);
    expect(truth.proofDecisionHistory[0]?.responderSource).toBe("customer");
  });

  test("blocks customer token actions after manual approval override resolves the proof", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("portal_override");
    const { proofVersionId } = await createAndSendProof(lineItemId, proofFileA);
    const token = await createPortalToken(lineItemId, proofVersionId);

    await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/manual-approval-override`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ proofVersionId, overrideReason: "Press approval required" })
      .expect(200);

    const actionRes = await request(app)
      .post(`/api/portal/proof/${token}/action`)
      .send({ action: "revision_request", comment: "Too late" })
      .expect(409);

    expect(String(actionRes.body?.error || "")).toMatch(/manual approval override/i);
  });
});
