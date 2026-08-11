import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from "@jest/globals";
import express, { NextFunction, Response } from "express";
import * as fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";
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
import { resolveLocalStoragePath } from "../services/localStoragePath";
import { tenantContext, getRequestOrganizationId } from "../tenantContext";
import { auditLogs, lineItemFiles, lineItemProofManualApprovalOverrides, lineItemProofVersions, orderAttachments, orderLineItems, productionJobs, proofVersionLineItems } from "../../shared/schema";
import { proofingQueueResponseSchema, proofingReadModelSchema, type ProofVersionHistoryEntry } from "../../shared/proofing";
import { createProofAccessToken, validateProofToken } from "../services/proofAccessTokenService";
import {
  buildProofArtifactSummary,
  autoSyncCanonicalProofForLineItem,
  cancelProofVersion,
  createAndSendProofVersion,
  createGeneratedCombinedProofVersion,
  createGeneratedDraftProofVersion,
  createLineItemProofVersion,
  createLineItemProofVersionFromExistingAttachment,
  generateLineItemArtworkPreviewDerivative,
  getProofArtworkPreparation,
  getEligibleProofArtworkSourceForDisplay,
  INCOMPLETE_PROOF_MESSAGE,
  listEligibleProofArtworkSources,
  listProofingQueue,
  markProofVersionSent,
  recordManualProofApprovalOverride,
  recordManualProofApprovalOverrides,
  recordProofResponse,
  resolveLineItemProofingTruth,
} from "../services/proofingService";
import { completeLineItemDesign, transitionLineItemWorkflowState } from "../services/lineItemWorkflowService";
import { resolveLineItemProofReleaseGate } from "../services/proofGateService";

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
        'cancelled',
        'superseded'
      );
    exception
      when duplicate_object then null;
    end $$;
  `);

  await db.execute(sql`alter type line_item_proof_version_status add value if not exists 'cancelled'`);

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
    create table if not exists proof_version_line_items (
      id varchar primary key default gen_random_uuid()::text,
      organization_id varchar not null references organizations(id) on delete cascade,
      order_id varchar not null references orders(id) on delete cascade,
      proof_version_id varchar not null references line_item_proof_versions(id) on delete cascade,
      line_item_id varchar not null references order_line_items(id) on delete cascade,
      sort_order integer not null default 0,
      line_item_label_snapshot text,
      display_size_snapshot text,
      quantity_snapshot numeric(12, 3),
      created_at timestamp with time zone not null default now()
    )
  `);
  await db.execute(sql`create unique index if not exists proof_version_line_items_version_line_uidx on proof_version_line_items (proof_version_id, line_item_id)`);

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

  app.post("/api/proofing/line-items/:lineItemId/generate-preview", isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const parsed = z.object({ sourceId: z.string().trim().min(1).optional() }).safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ success: false, message: fromZodError(parsed.error).message });
      const result = await db.transaction(async (tx) => generateLineItemArtworkPreviewDerivative(tx, {
        organizationId,
        lineItemId: String(req.params.lineItemId),
        sourceId: parsed.data.sourceId ?? null,
      }));

      return res.json({ success: true, data: result, message: result.message });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || "Failed to generate artwork preview derivative" });
    }
  });

  app.get("/api/proofing/line-item/:lineItemId/eligible-artwork", isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const preparation = await getProofArtworkPreparation(db, {
        organizationId,
        lineItemId: String(req.params.lineItemId),
      });
      const sources = preparation.sources;
      const eligibleCount = sources.filter((source) => source.eligible).length;

      return res.json({
        success: true,
        data: {
          sources,
          artworkSummary: {
            totalQuantity: preparation.totalQuantity,
            artworkCount: preparation.artworkCount,
            allocationMode: preparation.allocationMode,
            allocationIssue: preparation.allocationIssue,
          },
          eligibleCount,
          disabledReason: eligibleCount > 0 ? null : "no eligible artwork found",
          disabledReasonCode: eligibleCount > 0 ? null : "no_eligible_artwork_found",
        },
      });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ error: error?.message || "Failed to resolve eligible artwork" });
    }
  });

  app.post("/api/proofing/line-item/:lineItemId/versions", isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const requestBody = req.body?.mode
        ? req.body
        : req.body?.proofFileId
          ? { ...req.body, mode: "uploaded" }
          : req.body;

      const parsed = z.discriminatedUnion("mode", [
        z.object({
          mode: z.literal("uploaded"),
          proofFileId: z.string().min(1),
          internalNotes: z.string().optional().nullable(),
        }),
        z.object({
          mode: z.literal("generated"),
          artworkSourceIds: z.array(z.string().min(1)).optional(),
          internalNotes: z.string().optional().nullable(),
        }),
      ]).safeParse(requestBody);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const lineItemId = String(req.params.lineItemId);
      const created = await db.transaction(async (tx) => {
        const result = parsed.data.mode === "generated"
          ? await createGeneratedDraftProofVersion(tx, {
              organizationId,
              lineItemId,
              actorUserId: userId,
              artworkSourceIds: parsed.data.artworkSourceIds ?? null,
              internalNotes: parsed.data.internalNotes ?? null,
            })
          : {
              proofVersion: await createLineItemProofVersion(tx, {
                organizationId,
                lineItemId,
                proofFileId: parsed.data.proofFileId,
                createdByUserId: userId,
                internalNotes: parsed.data.internalNotes ?? null,
              }),
              proofing: null,
            };
        const proofVersion = result.proofVersion;

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

        const proofing = result.proofing ?? await resolveLineItemProofingTruth(tx, {
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
      if ((error?.statusCode || 500) === 400 && error?.message === INCOMPLETE_PROOF_MESSAGE) {
        return res.status(400).json({ success: false, message: INCOMPLETE_PROOF_MESSAGE });
      }
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
          artworkSourceIds: z.array(z.string().min(1)).optional(),
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
          artworkSourceIds: "artworkSourceIds" in parsed.data ? parsed.data.artworkSourceIds ?? null : null,
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
      if ((error?.statusCode || 500) === 400 && error?.message === INCOMPLETE_PROOF_MESSAGE) {
        return res.status(400).json({ success: false, message: INCOMPLETE_PROOF_MESSAGE });
      }
      return res.status(error?.statusCode || 500).json({
        success: false,
        error: error?.message || "Failed to create and send proof",
        reason: error?.code || null,
      });
    }
  });

  app.post("/api/proofing/versions/:proofVersionId/cancel", isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const parsed = z.object({
        reason: z.string().optional().nullable(),
      }).safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const result = await db.transaction(async (tx) => {
        const cancelResult = await cancelProofVersion(tx, {
          organizationId,
          proofVersionId: String(req.params.proofVersionId),
          actorUserId: userId,
          reason: parsed.data.reason ?? null,
        });

        await tx.insert(auditLogs).values({
          organizationId,
          userId,
          userName: req.user?.email || req.user?.name || null,
          actionType: "UPDATE",
          entityType: "line_item_proof_version",
          entityId: cancelResult.proofVersion.id,
          entityName: `Proof v${cancelResult.proofVersion.versionNumber}`,
          description: `Cancelled proof version ${cancelResult.proofVersion.versionNumber}`,
          oldValues: { status: "awaiting_response" },
          newValues: {
            status: cancelResult.proofVersion.status,
            orderId: cancelResult.lineItem.orderId,
            lineItemId: cancelResult.lineItem.lineItemId,
            reason: parsed.data.reason ?? null,
          },
        } as any);

        const proofing = await resolveLineItemProofingTruth(tx, {
          organizationId,
          lineItemId: cancelResult.lineItem.lineItemId,
        });

        return {
          proofId: cancelResult.lineItem.lineItemId,
          versionId: cancelResult.proofVersion.id,
          status: cancelResult.proofVersion.status,
          proofing,
        };
      });

      return res.json({ success: true, data: result, message: "Proof version cancelled." });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || "Failed to cancel proof version" });
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

  app.post("/api/proofing/line-items/manual-approval-override", isAuthenticated, tenantContext, isAdmin, async (req: any, res: Response) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const parsed = z.object({
        lineItemIds: z.array(z.string().trim().min(1)).min(1, "Select at least one proof item to override"),
        overrideReason: z.string().trim().min(1, "Override reason is required"),
        internalNote: z.string().optional().nullable(),
      }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });
      if (new Set(parsed.data.lineItemIds).size !== parsed.data.lineItemIds.length) {
        return res.status(400).json({ error: "Selected proof items must not contain duplicates" });
      }

      const overrides = await db.transaction((tx) => recordManualProofApprovalOverrides(tx, {
        organizationId,
        lineItemIds: parsed.data.lineItemIds,
        actorUserId: userId,
        actorName: req.user?.name ?? null,
        actorEmail: req.user?.email ?? null,
        overrideReason: parsed.data.overrideReason,
        internalNote: parsed.data.internalNote ?? null,
      }));
      return res.json({ success: true, data: { items: overrides.map((override, index) => ({ lineItemId: parsed.data.lineItemIds[index], ...override })) } });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({ error: error?.message || "Failed to record manual approval overrides" });
    }
  });

  app.get("/api/portal/proof/:token", async (req: any, res: Response) => {
    try {
      const validation = await validateProofToken(db, String(req.params.token));
      const [attachment] = await db
        .select({
          id: orderAttachments.id,
          fileName: orderAttachments.fileName,
          mimeType: orderAttachments.mimeType,
          description: orderAttachments.description,
          fileRecordId: orderAttachments.fileRecordId,
          fileUrl: orderAttachments.fileUrl,
          thumbKey: orderAttachments.thumbKey,
          previewKey: orderAttachments.previewKey,
          thumbnailUrl: orderAttachments.thumbnailUrl,
        })
        .from(orderAttachments)
        .where(eq(orderAttachments.id, validation.proofVersion.proofFileId))
        .limit(1);

      const artifact = attachment
        ? buildProofArtifactSummary({
          attachment: {
            ...attachment,
            pagePreviewCount: 0,
            pageThumbCount: 0,
          },
          snapshot: null,
        })
        : null;

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
              previewStatus: artifact?.previewStatus ?? "missing_preview",
              previewError: artifact?.previewError ?? null,
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

        if (validation.proofVersion.status === "cancelled" || validation.currentApprovalState.status === "cancelled") {
          throw Object.assign(new Error("This proof version has been cancelled and is no longer available for approval."), { statusCode: 409 });
        }

        if (validation.proofVersion.status === "superseded" || validation.currentApprovalState.status === "superseded") {
          throw Object.assign(new Error("This proof version has been replaced by a newer proof and is no longer available for approval."), { statusCode: 409 });
        }

        if (
          validation.proofVersion.status === "approved" ||
          validation.proofVersion.status === "rejected" ||
          validation.proofVersion.status === "revision_requested" ||
          validation.currentApprovalState.isResolved
        ) {
          throw Object.assign(new Error("This proof has already been reviewed."), { statusCode: 409 });
        }

        if (validation.proofVersion.status !== "awaiting_response" || validation.currentApprovalState.status !== "pending") {
          throw Object.assign(new Error("Only active sent proof versions awaiting response can be decided"), { statusCode: 409 });
        }

        const [attachment] = await tx
          .select({
            id: orderAttachments.id,
            fileName: orderAttachments.fileName,
            mimeType: orderAttachments.mimeType,
            description: orderAttachments.description,
            fileRecordId: orderAttachments.fileRecordId,
            fileUrl: orderAttachments.fileUrl,
            thumbKey: orderAttachments.thumbKey,
            previewKey: orderAttachments.previewKey,
            thumbnailUrl: orderAttachments.thumbnailUrl,
          })
          .from(orderAttachments)
          .where(eq(orderAttachments.id, validation.proofVersion.proofFileId))
          .limit(1);

        if (!attachment) {
          throw Object.assign(new Error("Proof attachment not found"), { statusCode: 404 });
        }

        const artifact = buildProofArtifactSummary({
          attachment: {
            ...attachment,
            pagePreviewCount: 0,
            pageThumbCount: 0,
          },
          snapshot: null,
        });

        if (artifact.previewStatus !== "ready") {
          throw Object.assign(new Error(INCOMPLETE_PROOF_MESSAGE), { statusCode: 400 });
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
      if ((error?.statusCode || 500) === 400 && error?.message === INCOMPLETE_PROOF_MESSAGE) {
        return res.status(400).json({ success: false, message: INCOMPLETE_PROOF_MESSAGE });
      }
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
    await db.delete(proofVersionLineItems).where(eq(proofVersionLineItems.organizationId, orgId));
    await db.execute(sql`delete from line_item_proof_versions where organization_id = ${orgId}`);
    await db.execute(sql`delete from order_attachments where order_id = ${orderId}`);
    await db.execute(sql`delete from line_item_files where organization_id = ${orgId}`);
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
      artworkMimeType?: string;
      artworkThumbStatus?: string | null;
      artworkThumbKey?: string | null;
      artworkPreviewKey?: string | null;
      artworkThumbError?: string | null;
      artworkFileName?: string;
      artworkFileUrl?: string;
      artworkStorageProvider?: string | null;
      sortOrder?: number;
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
    const artworkMimeType = options?.artworkMimeType ?? "application/pdf";
    const artworkThumbStatus = options?.artworkThumbStatus ?? null;
    const artworkThumbKey = options?.artworkThumbKey ?? null;
    const artworkPreviewKey = options?.artworkPreviewKey ?? null;
    const artworkThumbError = options?.artworkThumbError ?? null;
    const artworkFileName = options?.artworkFileName ?? `${name}-artwork.pdf`;
    const artworkFileUrl = options?.artworkFileUrl ?? `https://example.com/${artworkFileId}.pdf`;
    const artworkStorageProvider = options?.artworkStorageProvider ?? null;
    const sortOrder = options?.sortOrder ?? 0;

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
        ${lineItemId}, ${orderId}, ${productId}, ${`Line ${name}`}, ${1}, ${10}, ${10}, ${sortOrder}, ${requiresDesign}, ${requiresProofApproval}, ${requiresPrepress}, ${designStatus}, ${workflowState}, ${"new"}
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
          role,
          mime_type
        )
        values
          (${proofFileA}, ${orderId}, ${lineItemId}, ${userId}, ${"Proof User"}, ${`${name}-proof-a.pdf`}, ${`https://example.com/${proofFileA}.pdf`}, ${"proof"}, ${"application/pdf"}),
          (${proofFileB}, ${orderId}, ${lineItemId}, ${userId}, ${"Proof User"}, ${`${name}-proof-b.pdf`}, ${`https://example.com/${proofFileB}.pdf`}, ${"proof"}, ${"application/pdf"})
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
          mime_type,
          is_primary,
          thumb_status,
          thumb_key,
          preview_key,
          thumb_error,
          storage_provider
        )
        values (
          ${artworkFileId}, ${orderId}, ${lineItemId}, ${userId}, ${"Proof User"}, ${artworkFileName}, ${artworkFileUrl}, ${"artwork"}, ${artworkMimeType}, ${true}, ${artworkThumbStatus}, ${artworkThumbKey}, ${artworkPreviewKey}, ${artworkThumbError}, ${artworkStorageProvider}
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

  async function seedLocalImageForPreviewTest(storageKey: string) {
    const sourcePath = path.join(process.cwd(), "client", "public", "favicon.png");
    const targetPath = resolveLocalStoragePath(storageKey);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    return targetPath;
  }

  test("returns a safe 400 when no artwork file exists for preview generation", async () => {
    const { lineItemId } = await createLineItemFixture("generate_preview_missing_art", {
      addArtwork: false,
    });

    const res = await request(app)
      .post(`/api/proofing/line-items/${lineItemId}/generate-preview`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .expect(400);

    expect(res.body).toMatchObject({
      success: false,
      message: "No artwork file is attached to this line item.",
    });
  });

  test("eligible artwork resolver finds visible line item artwork attachments", async () => {
    const { lineItemId, artworkFileId } = await createLineItemFixture("eligible_artwork_attachment", {
      addArtwork: true,
      artworkMimeType: "image/png",
      artworkFileName: "visible-artwork.png",
      artworkPreviewKey: "proofing-tests/visible-artwork-preview.png",
    });

    const res = await request(app)
      .get(`/api/proofing/line-item/${lineItemId}/eligible-artwork`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .expect(200);

    expect(res.body?.data?.eligibleCount).toBeGreaterThan(0);
    expect(res.body?.data?.artworkSummary).toEqual(expect.objectContaining({
      artworkCount: expect.any(Number),
      allocationMode: "unspecified",
    }));
    expect(res.body?.data?.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: artworkFileId,
          sourceType: "line_item_artwork",
          eligible: true,
          side: "na",
          previewStatus: "ready",
          recoveryAction: null,
          allocatedQuantity: null,
        }),
      ]),
    );
  });

  test("eligible artwork resolver includes normal order-entry line item uploads with generic role", async () => {
    const { lineItemId } = await createLineItemFixture("eligible_order_entry_uploads", {
      addArtwork: false,
      attachProofFiles: false,
    });

    const uploadIds = [
      `upload_pdf_${Date.now()}`,
      `upload_png_${Date.now()}`,
      `upload_jpg_${Date.now()}`,
      `upload_txt_${Date.now()}`,
    ];

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
        mime_type
      )
      values
        (${uploadIds[0]}, ${orderId}, ${lineItemId}, ${userId}, ${"Proof User"}, ${"normal-upload.pdf"}, ${"uploads/normal-upload.pdf"}, ${"other"}, ${"application/pdf"}),
        (${uploadIds[1]}, ${orderId}, ${lineItemId}, ${userId}, ${"Proof User"}, ${"normal-upload.png"}, ${"uploads/normal-upload.png"}, ${"other"}, ${"image/png"}),
        (${uploadIds[2]}, ${orderId}, ${lineItemId}, ${userId}, ${"Proof User"}, ${"normal-upload.jpg"}, ${"uploads/normal-upload.jpg"}, ${"other"}, ${"image/jpeg"}),
        (${uploadIds[3]}, ${orderId}, ${lineItemId}, ${userId}, ${"Proof User"}, ${"not-proofable.txt"}, ${"uploads/not-proofable.txt"}, ${"other"}, ${"text/plain"})
    `);

    const res = await request(app)
      .get(`/api/proofing/line-item/${lineItemId}/eligible-artwork`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .expect(200);

    expect(res.body?.data?.eligibleCount).toBe(3);
    expect(res.body?.data?.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: uploadIds[0], role: "other", eligible: true }),
        expect.objectContaining({ id: uploadIds[1], role: "other", eligible: true }),
        expect.objectContaining({ id: uploadIds[2], role: "other", eligible: true }),
        expect.objectContaining({
          id: uploadIds[3],
          role: "other",
          eligible: false,
          eligibilityReason: "unsupported file type",
        }),
      ]),
    );
  });

  test("eligible artwork resolver includes active line_item_files and excludes superseded files", async () => {
    const { lineItemId } = await createLineItemFixture("eligible_line_item_files", {
      addArtwork: false,
      attachProofFiles: false,
    });

    const activeOriginalId = `line_file_original_${Date.now()}`;
    const activeFinalId = `line_file_final_${Date.now()}`;
    const supersededId = `line_file_superseded_${Date.now()}`;

    await db.insert(lineItemFiles).values([
      {
        id: activeOriginalId,
        organizationId: orgId,
        orderId,
        lineItemId,
        role: "original",
        status: "active",
        storagePath: "uploads/original.pdf",
        storageKey: "uploads/original.pdf",
        originalFilename: "original.pdf",
        mimeType: "application/pdf",
        sizeBytes: 123,
        createdByUserId: userId,
      },
      {
        id: activeFinalId,
        organizationId: orgId,
        orderId,
        lineItemId,
        role: "final",
        status: "active",
        storagePath: "uploads/final.png",
        storageKey: "uploads/final.png",
        originalFilename: "final.png",
        mimeType: "image/png",
        sizeBytes: 456,
        createdByUserId: userId,
      },
      {
        id: supersededId,
        organizationId: orgId,
        orderId,
        lineItemId,
        role: "original",
        status: "superseded",
        storagePath: "uploads/old.pdf",
        storageKey: "uploads/old.pdf",
        originalFilename: "old.pdf",
        mimeType: "application/pdf",
        sizeBytes: 789,
        createdByUserId: userId,
      },
    ] as any);

    const sources = await listEligibleProofArtworkSources(db, {
      organizationId: orgId,
      lineItemId,
    });

    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: activeOriginalId, sourceType: "line_item_file", eligible: true }),
        expect.objectContaining({ id: activeFinalId, sourceType: "line_item_file", eligible: true }),
      ]),
    );
    expect(sources.some((source) => source.id === supersededId)).toBe(false);

    const displaySource = await getEligibleProofArtworkSourceForDisplay(db, {
      organizationId: orgId,
      lineItemId,
      sourceType: "line_item_file",
      sourceId: activeFinalId,
    });

    expect(displaySource).toMatchObject({
      sourceType: "line_item_file",
      sourceId: activeFinalId,
      fileName: "final.png",
      fileUrl: "uploads/final.png",
    });
  });

  test("generated proof draft can use selected generic uploaded artwork source", async () => {
    const { lineItemId } = await createLineItemFixture("generic_upload_generated_draft", {
      addArtwork: false,
      attachProofFiles: false,
    });
    const genericArtworkId = `generic_artwork_${Date.now()}`;

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
        mime_type
      )
      values (
        ${genericArtworkId}, ${orderId}, ${lineItemId}, ${userId}, ${"Proof User"}, ${"generic-upload.pdf"}, ${"uploads/generic-upload.pdf"}, ${"other"}, ${"application/pdf"}
      )
    `);

    const createRes = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/versions`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ mode: "generated", artworkSourceIds: [genericArtworkId], internalNotes: "generic upload draft" })
      .expect(200);

    expect(createRes.body?.data?.proofing?.currentProofInputSnapshot?.sourceArtwork).toEqual(
      expect.objectContaining({
        sourceId: genericArtworkId,
        fileName: "generic-upload.pdf",
      }),
    );
  });

  test("eligible artwork resolver returns clear reason when no artwork exists", async () => {
    const { lineItemId } = await createLineItemFixture("eligible_artwork_missing", {
      addArtwork: false,
    });

    const res = await request(app)
      .get(`/api/proofing/line-item/${lineItemId}/eligible-artwork`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .expect(200);

    expect(res.body?.data).toMatchObject({
      eligibleCount: 0,
      disabledReasonCode: "no_eligible_artwork_found",
    });
  });

  test("returns success when a preview derivative already exists", async () => {
    const { lineItemId } = await createLineItemFixture("generate_preview_exists", {
      addArtwork: true,
      artworkThumbStatus: "thumb_ready",
      artworkThumbKey: "thumbs/existing.jpg",
      artworkPreviewKey: "previews/existing.jpg",
    });

    const res = await request(app)
      .post(`/api/proofing/line-items/${lineItemId}/generate-preview`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .expect(200);

    expect(res.body).toMatchObject({
      success: true,
      message: "Preview already exists.",
      data: {
        derivativeStatus: "ready",
        previewStatus: "ready",
      },
    });
  });

  test("generates a missing artwork preview derivative through the existing image pipeline", async () => {
    const storageKey = `proofing-tests/${Date.now()}-artwork.png`;
    await seedLocalImageForPreviewTest(storageKey);

    const { lineItemId, artworkFileId } = await createLineItemFixture("generate_preview_pdf", {
      addArtwork: true,
      artworkMimeType: "image/png",
      artworkFileName: "generate-preview-artwork.png",
      artworkFileUrl: storageKey,
      artworkStorageProvider: "local",
      artworkThumbStatus: "uploaded",
    });

    const res = await request(app)
      .post(`/api/proofing/line-items/${lineItemId}/generate-preview`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .expect(200);

    expect(res.body).toMatchObject({
      success: true,
      message: "Preview generated successfully.",
      data: {
        derivativeStatus: "ready",
        previewStatus: "ready",
      },
    });

    const [attachment] = await db
      .select({
        thumbStatus: orderAttachments.thumbStatus,
        thumbKey: orderAttachments.thumbKey,
        previewKey: orderAttachments.previewKey,
      })
      .from(orderAttachments)
      .where(eq(orderAttachments.id, artworkFileId))
      .limit(1);

    expect(attachment?.thumbStatus).toBe("thumb_ready");
    expect(attachment?.thumbKey).toContain(artworkFileId);
    expect(attachment?.previewKey).toContain(artworkFileId);
  });

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

  test("staff can cancel an active sent proof and return the queue to awaiting send", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("cancel_sent_proof");
    const { proofVersionId } = await createAndSendProof(lineItemId, proofFileA);

    const cancelRes = await request(app)
      .post(`/api/proofing/versions/${proofVersionId}/cancel`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ reason: "Artwork was outdated" })
      .expect(200);

    expect(cancelRes.body).toMatchObject({
      success: true,
      message: "Proof version cancelled.",
      data: {
        proofId: lineItemId,
        versionId: proofVersionId,
        status: "cancelled",
      },
    });

    const proofing = proofingReadModelSchema.parse(cancelRes.body.data.proofing);
    expect(proofing.currentActionableProofVersionId).toBeNull();
    expect(proofing.workflowState).toBe("awaiting_proof_approval");
    expect(proofing.requiresProofApproval).toBe(true);

    const queue = proofingQueueResponseSchema.parse((await request(app)
      .get("/api/proofing/queue")
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .expect(200)).body.data);

    const row = queue.rows.find((item) => item.lineItemId === lineItemId);
  expect(row?.currentQueueStatus).toBe("no_active_proof");

    const [audit] = await db
      .select({
        actionType: auditLogs.actionType,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        description: auditLogs.description,
      })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, proofVersionId))
      .orderBy(sql`${auditLogs.createdAt} desc`)
      .limit(1);

    expect(audit?.actionType).toBe("UPDATE");
    expect(audit?.entityType).toBe("line_item_proof_version");
    expect(audit?.description).toContain("Cancelled proof version");
  });

  test("discarding a draft only removes the draft reference, not original artwork", async () => {
    const { lineItemId, artworkFileId } = await createLineItemFixture("discard_draft_keeps_artwork", {
      attachProofFiles: false,
      addArtwork: true,
      artworkPreviewKey: "proofing-tests/artwork-preview.png",
      artworkThumbKey: "proofing-tests/artwork-thumb.png",
    });

    const proofVersion = await db.transaction((tx) =>
      createLineItemProofVersionFromExistingAttachment(tx, {
        organizationId: orgId,
        lineItemId,
        attachmentId: artworkFileId,
        createdByUserId: userId,
        internalNotes: "draft from artwork",
      }),
    );

    const cancelResult = await db.transaction((tx) =>
      cancelProofVersion(tx, {
        organizationId: orgId,
        proofVersionId: proofVersion.id,
        actorUserId: userId,
        reason: "operator discarded temp draft",
      }),
    );

    expect(cancelResult.proofVersion.status).toBe("cancelled");

    const [artwork] = await db
      .select({ id: orderAttachments.id, role: orderAttachments.role })
      .from(orderAttachments)
      .where(eq(orderAttachments.id, artworkFileId))
      .limit(1);

    expect(artwork).toMatchObject({ id: artworkFileId, role: "artwork" });
  });

  test("staff cannot cancel approved or already-resolved proof versions", async () => {
    const approvedFixture = await createLineItemFixture("cancel_approved_proof");
    const approvedSend = await createAndSendProof(approvedFixture.lineItemId, approvedFixture.proofFileA);

    await request(app)
      .post(`/api/proofing/versions/${approvedSend.proofVersionId}/respond`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ decision: "approved" })
      .expect(200);

    const approvedRes = await request(app)
      .post(`/api/proofing/versions/${approvedSend.proofVersionId}/cancel`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ reason: "too late" })
      .expect(400);

    expect(approvedRes.body.message).toBe("Resolved proof versions cannot be cancelled from this workflow.");

    const revisionFixture = await createLineItemFixture("cancel_revision_requested");
    const revisionSend = await createAndSendProof(revisionFixture.lineItemId, revisionFixture.proofFileA);

    await request(app)
      .post(`/api/proofing/versions/${revisionSend.proofVersionId}/respond`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ decision: "revision_requested" })
      .expect(200);

    const revisionRes = await request(app)
      .post(`/api/proofing/versions/${revisionSend.proofVersionId}/cancel`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ reason: "already handled" })
      .expect(400);

    expect(revisionRes.body.message).toBe("Resolved proof versions cannot be cancelled from this workflow.");
  });

  test("cancelled proof tokens become read-only and cannot approve", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("cancelled_portal_token");
    const { proofVersionId } = await createAndSendProof(lineItemId, proofFileA);
    const token = await createPortalToken(lineItemId, proofVersionId);

    await request(app)
      .post(`/api/proofing/versions/${proofVersionId}/cancel`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ reason: "Wrong proof sent" })
      .expect(200);

    const getRes = await request(app)
      .get(`/api/portal/proof/${token}`)
      .expect(200);

    expect(getRes.body?.data?.status).toBe("cancelled");

    const actionRes = await request(app)
      .post(`/api/portal/proof/${token}/action`)
      .send({ action: "approve" })
      .expect(409);

    expect(actionRes.body?.error).toBe("This proof version has been cancelled and is no longer available for approval.");
  });

  test("portal superseded proof tokens remain read-only with replaced messaging", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("superseded_portal_token");
    const { proofVersionId } = await createAndSendProof(lineItemId, proofFileA);
    const token = await createPortalToken(lineItemId, proofVersionId);

    await db
      .update(lineItemProofVersions)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(eq(lineItemProofVersions.id, proofVersionId));

    const getRes = await request(app)
      .get(`/api/portal/proof/${token}`)
      .expect(200);

    expect(getRes.body?.data?.status).toBe("superseded");

    const actionRes = await request(app)
      .post(`/api/portal/proof/${token}/action`)
      .send({ action: "reject", comment: "old link" })
      .expect(409);

    expect(actionRes.body?.error).toBe("This proof version has been replaced by a newer proof and is no longer available for approval.");
  });

  test("cancelled proofs do not satisfy the production proof gate", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("cancelled_gate_blocked");
    const { proofVersionId } = await createAndSendProof(lineItemId, proofFileA);

    await request(app)
      .post(`/api/proofing/versions/${proofVersionId}/cancel`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ reason: "Wrong proof sent" })
      .expect(200);

    const gate = await resolveLineItemProofReleaseGate(db, {
      organizationId: orgId,
      lineItemId,
    });

    expect(gate.allowed).toBe(false);
    expect(gate.approved).toBe(false);
    expect(gate.blockedReason).toBe("Cannot release to production until proof approved");
  });

  test("after cancellation, staff can send a corrected proof version", async () => {
    const { lineItemId, proofFileA, proofFileB } = await createLineItemFixture("cancel_then_replace");
    const { proofVersionId } = await createAndSendProof(lineItemId, proofFileA);

    await request(app)
      .post(`/api/proofing/versions/${proofVersionId}/cancel`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ reason: "Sending corrected file" })
      .expect(200);

    const createRes = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/versions`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ proofFileId: proofFileB, internalNotes: "replacement proof" })
      .expect(200);

    const replacementVersionId = createRes.body?.data?.proofVersion?.id as string;

    const sendRes = await request(app)
      .post(`/api/proofing/versions/${replacementVersionId}/send`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ sentToEmail: "customer@example.com" })
      .expect(200);

    expect(sendRes.body?.data?.proofVersion?.status).toBe("awaiting_response");
    const proofing = proofingReadModelSchema.parse(sendRes.body?.data?.proofing);
    expect(proofing.currentActionableProofVersion?.id).toBe(replacementVersionId);
    const cancelledVersion = proofing.proofVersionHistory.find((version) => version.id === proofVersionId);
    expect(cancelledVersion?.status).toBe("cancelled");
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
    expect(proofing.currentDisplayedProofArtifact?.previewStatus).toBe("ready");
    expect(proofing.currentProofInputSnapshot?.lineItemId).toBe(lineItemId);
  });

  test("blocks sending a generated proof when the saved artwork cannot produce a preview", async () => {
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
      .expect(400);

    expect(res.body).toMatchObject({ success: false, message: INCOMPLETE_PROOF_MESSAGE });

    const truth = await resolveLineItemProofingTruth(db, {
      organizationId: orgId,
      lineItemId,
    });

    expect(truth.currentActionableProofVersionId).toBeNull();
    expect(truth.currentProofInputSnapshot?.sourceArtwork?.sourceId).toBe(artworkFileId);
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

    expect(res.body).toMatchObject({
      success: false,
      error: "No eligible artwork files found for this line item",
      reason: "no_eligible_artwork_found",
    });

    const truth = await resolveLineItemProofingTruth(db, {
      organizationId: orgId,
      lineItemId,
    });

    expect(truth.currentActionableProofVersionId).toBeNull();
  });

  test("creates generated draft from selected line item artwork without mutating original artwork", async () => {
    const { lineItemId, artworkFileId } = await createLineItemFixture("generated_draft_selected_artwork", {
      attachProofFiles: false,
      addArtwork: true,
      artworkMimeType: "image/png",
      artworkFileName: "selected-artwork.png",
      artworkPreviewKey: "proofing-tests/selected-artwork-preview.png",
      requiresProofApproval: true,
    });

    const res = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/versions`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ mode: "generated", artworkSourceIds: [artworkFileId], internalNotes: "selected artwork draft" })
      .expect(200);

    expect(res.body?.data?.proofVersion?.status).toBe("draft");
    const proofing = proofingReadModelSchema.parse(res.body?.data?.proofing);
    expect(proofing.currentProofInputSnapshot?.sourceArtwork?.sourceId).toBe(artworkFileId);
    expect(proofing.currentActionableProofVersion?.proofFileId).not.toBe(artworkFileId);

    const [artwork] = await db
      .select({ id: orderAttachments.id, role: orderAttachments.role })
      .from(orderAttachments)
      .where(eq(orderAttachments.id, artworkFileId))
      .limit(1);

    expect(artwork).toMatchObject({ id: artworkFileId, role: "artwork" });
  });

  test("auto-syncs persisted artwork into a draft proof without sending a customer-visible proof", async () => {
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

    expect(result.status).toBe("draft_created");

    const truth = await resolveLineItemProofingTruth(db, {
      organizationId: orgId,
      lineItemId,
    });

    expect(truth.workflowState).toBe("ready_for_prepress");
    expect(truth.currentActionableProofVersion?.status).toBe("draft");
    expect(truth.currentActionableProofVersion?.sentToEmail).toBeNull();
    expect(truth.currentActionableProofVersion?.proofFileId).not.toBe(artworkFileId);

    const queue = await listProofingQueue(db, {
      organizationId: orgId,
      slice: "awaiting_send",
    });

    expect(queue.rows.some((row: any) => row.lineItemId === lineItemId)).toBe(true);
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

    expect(result.status).toBe("draft_refreshed");

    const truth = await resolveLineItemProofingTruth(db, {
      organizationId: orgId,
      lineItemId,
    });

    expect(truth.approvedProofVersionId).toBeNull();
    expect(truth.workflowState).toBe("ready_for_prepress");
    expect(truth.currentActionableProofVersion?.status).toBe("draft");
    expect(truth.currentActionableProofVersion?.sentToEmail).toBeNull();

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

  test("manual override clears proof blocking without routing incomplete design to prepress", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("override_incomplete_design", {
      workflowState: "in_design",
      designStatus: "in_design",
      requiresDesign: true,
      requiresPrepress: true,
      requiresProofApproval: true,
    });

    const draftRes = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/versions`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ proofFileId: proofFileA })
      .expect(200);

    const proofVersionId = draftRes.body?.data?.proofVersion?.id as string;

    const overrideRes = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/manual-approval-override`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ proofVersionId, overrideReason: "Production recovery approval" })
      .expect(200);

    expect(overrideRes.body?.data?.workflowTransition?.toState).toBe("in_design");

    const [lineItem] = await db
      .select({
        workflowState: orderLineItems.workflowState,
        designStatus: orderLineItems.designStatus,
        approvedProofVersionId: orderLineItems.approvedProofVersionId,
      })
      .from(orderLineItems)
      .where(eq(orderLineItems.id, lineItemId))
      .limit(1);

    expect(lineItem?.workflowState).toBe("in_design");
    expect(lineItem?.designStatus).toBe("in_design");
    expect(lineItem?.approvedProofVersionId).toBe(proofVersionId);
  });

  test("remove proof gate clears proof requirement without routing incomplete design to prepress", async () => {
    const { lineItemId } = await createLineItemFixture("remove_gate_incomplete_design", {
      workflowState: "in_design",
      designStatus: "in_design",
      requiresDesign: true,
      requiresPrepress: true,
      requiresProofApproval: true,
    });

    const removeRes = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/mark-proof-not-required`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ reason: "Proof waived for recovery" })
      .expect(200);

    expect(removeRes.body?.data?.workflowTransition?.toState).toBe("in_design");

    const [lineItem] = await db
      .select({
        workflowState: orderLineItems.workflowState,
        designStatus: orderLineItems.designStatus,
        requiresProofApproval: orderLineItems.requiresProofApproval,
      })
      .from(orderLineItems)
      .where(eq(orderLineItems.id, lineItemId))
      .limit(1);

    expect(lineItem?.workflowState).toBe("in_design");
    expect(lineItem?.designStatus).toBe("in_design");
    expect(lineItem?.requiresProofApproval).toBe(false);
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

    expect(overrideRes.body?.data?.workflowTransition?.toState).toBe("awaiting_proof_approval");
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

  test("bulk override approves only the selected proof items", async () => {
    const first = await createLineItemFixture("bulk_override_first");
    const second = await createLineItemFixture("bulk_override_second");
    const untouched = await createLineItemFixture("bulk_override_untouched");
    const firstProof = await createAndSendProof(first.lineItemId, first.proofFileA);
    const secondProof = await createAndSendProof(second.lineItemId, second.proofFileA);
    await createAndSendProof(untouched.lineItemId, untouched.proofFileA);

    const response = await request(app)
      .post("/api/proofing/line-items/manual-approval-override")
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ lineItemIds: [first.lineItemId, second.lineItemId], overrideReason: "Combined proof approved by phone" })
      .expect(200);

    expect(response.body).toMatchObject({ success: true, data: { items: [{ lineItemId: first.lineItemId }, { lineItemId: second.lineItemId }] } });
    const overriddenRows = await db
      .select({ lineItemId: lineItemProofManualApprovalOverrides.lineItemId, proofVersionId: lineItemProofManualApprovalOverrides.proofVersionId })
      .from(lineItemProofManualApprovalOverrides)
      .where(inArray(lineItemProofManualApprovalOverrides.lineItemId, [first.lineItemId, second.lineItemId]));
    expect(overriddenRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ lineItemId: first.lineItemId, proofVersionId: firstProof.proofVersionId }),
      expect.objectContaining({ lineItemId: second.lineItemId, proofVersionId: secondProof.proofVersionId }),
    ]));

    const [untouchedLineItem] = await db
      .select({ approvedProofVersionId: orderLineItems.approvedProofVersionId })
      .from(orderLineItems)
      .where(eq(orderLineItems.id, untouched.lineItemId));
    expect(untouchedLineItem?.approvedProofVersionId).toBeNull();
  });

  test("bulk override rejects empty, cross-tenant, and partially invalid selections without changes", async () => {
    const valid = await createLineItemFixture("bulk_override_atomic_valid");
    await createAndSendProof(valid.lineItemId, valid.proofFileA);

    await request(app)
      .post("/api/proofing/line-items/manual-approval-override")
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ lineItemIds: [], overrideReason: "No items" })
      .expect(400);

    await request(app)
      .post("/api/proofing/line-items/manual-approval-override")
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", "other_tenant")
      .send({ lineItemIds: [valid.lineItemId], overrideReason: "Wrong tenant" })
      .expect(404);

    await request(app)
      .post("/api/proofing/line-items/manual-approval-override")
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ lineItemIds: [valid.lineItemId, "missing_line_item"], overrideReason: "All or none" })
      .expect(404);

    const [validLineItem] = await db
      .select({ approvedProofVersionId: orderLineItems.approvedProofVersionId })
      .from(orderLineItems)
      .where(eq(orderLineItems.id, valid.lineItemId));
    expect(validLineItem?.approvedProofVersionId).toBeNull();
    const overrides = await db
      .select({ id: lineItemProofManualApprovalOverrides.id })
      .from(lineItemProofManualApprovalOverrides)
      .where(eq(lineItemProofManualApprovalOverrides.lineItemId, valid.lineItemId));
    expect(overrides).toHaveLength(0);
  });

  test("manual approval override recovers a proof-blocked rejected line item", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("override_rejected_recovery");
    const { proofVersionId } = await createAndSendProof(lineItemId, proofFileA);

    await request(app)
      .post(`/api/proofing/versions/${proofVersionId}/respond`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ decision: "rejected", responseNotes: "Customer called back and approved offline later" })
      .expect(200);

    await db
      .update(orderLineItems)
      .set({ workflowState: "awaiting_proof_approval", requiresProofApproval: true, approvedProofVersionId: null })
      .where(eq(orderLineItems.id, lineItemId));

    const overrideRes = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/manual-approval-override`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ proofVersionId, overrideReason: "Customer approved offline after rejection" })
      .expect(200);

    expect(overrideRes.body?.data?.workflowTransition?.toState).toBe("awaiting_proof_approval");
    const proofing = proofingReadModelSchema.parse(overrideRes.body?.data?.proofing);
    expect(proofing.approvedProofSource).toBe("manual_override");
    expect(proofing.approvedProofVersionId).toBe(proofVersionId);
  });

  test("manual approval override can recover after staff cancellation without converting cancelled proof status", async () => {
    const { lineItemId, proofFileA } = await createLineItemFixture("override_cancelled_recovery");
    const { proofVersionId } = await createAndSendProof(lineItemId, proofFileA);

    await request(app)
      .post(`/api/proofing/versions/${proofVersionId}/cancel`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ reason: "Customer approved cancelled proof by phone" })
      .expect(200);

    const overrideRes = await request(app)
      .post(`/api/proofing/line-item/${lineItemId}/manual-approval-override`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ proofVersionId, overrideReason: "Customer approved cancelled proof by phone" })
      .expect(200);

    expect(overrideRes.body?.data?.workflowTransition?.toState).toBe("awaiting_proof_approval");
    const proofing = proofingReadModelSchema.parse(overrideRes.body?.data?.proofing);
    expect(proofing.approvedProofSource).toBe("manual_override");
    expect(proofing.approvedProofVersionId).toBe(proofVersionId);
    expect(proofing.approvedProofVersion?.status).toBe("cancelled");
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
      .expect(200);

    expect(invalidDraftOverrideRes.body?.data?.workflowTransition?.toState).toBe("ready_for_prepress");

    const staleFixture = await createLineItemFixture("override_invalid_approved");
    const { proofVersionId } = await createAndSendProof(staleFixture.lineItemId, staleFixture.proofFileA);
    await request(app)
      .post(`/api/proofing/versions/${proofVersionId}/respond`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send({ decision: "approved" })
      .expect(200);

    const staleOverrideRes = await request(app)
      .post(`/api/proofing/line-item/${staleFixture.lineItemId}/manual-approval-override`)
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

  test("portal approve and reject share terminal validation", async () => {
    const approveFixture = await createLineItemFixture("portal_terminal_approve");
    const approveSend = await createAndSendProof(approveFixture.lineItemId, approveFixture.proofFileA);
    const approveToken = await createPortalToken(approveFixture.lineItemId, approveSend.proofVersionId);

    await request(app)
      .post(`/api/portal/proof/${approveToken}/action`)
      .send({ action: "approve", comment: "Approved" })
      .expect(200);

    const secondApprove = await request(app)
      .post(`/api/portal/proof/${approveToken}/action`)
      .send({ action: "approve", comment: "Again" })
      .expect(409);
    expect(secondApprove.body?.error).toBe("This proof has already been reviewed.");

    const rejectFixture = await createLineItemFixture("portal_terminal_reject");
    const rejectSend = await createAndSendProof(rejectFixture.lineItemId, rejectFixture.proofFileA);
    const rejectToken = await createPortalToken(rejectFixture.lineItemId, rejectSend.proofVersionId);

    await request(app)
      .post(`/api/portal/proof/${rejectToken}/action`)
      .send({ action: "reject", comment: "Wrong file" })
      .expect(200);

    const secondReject = await request(app)
      .post(`/api/portal/proof/${rejectToken}/action`)
      .send({ action: "reject", comment: "Again" })
      .expect(409);
    expect(secondReject.body?.error).toBe("This proof has already been reviewed.");
  });

  test("blocks portal approval when the proof artifact is metadata-only", async () => {
    const { lineItemId } = await createLineItemFixture("portal_incomplete", {
      attachProofFiles: false,
      requiresProofApproval: true,
      requiresPrepress: true,
      workflowState: "awaiting_proof_approval",
    });
    const incompleteProofFileId = `proof_incomplete_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    await db.execute(sql`
      insert into order_attachments (
        id,
        order_id,
        order_line_item_id,
        uploaded_by_user_id,
        uploaded_by_name,
        file_name,
        role,
        mime_type,
        description
      ) values (
        ${incompleteProofFileId},
        ${orderId},
        ${lineItemId},
        ${userId},
        ${"Proof User"},
        ${"portal-incomplete-proof.pdf"},
        ${"proof"},
        ${"application/pdf"},
        ${"[proof-artifact:generated-basic] [proof-preview:metadata-only] Generated basic proof from persisted line-item truth."}
      )
    `);

    const createdDraft = await db.transaction((tx) =>
      createLineItemProofVersion(tx, {
        organizationId: orgId,
        lineItemId,
        proofFileId: incompleteProofFileId,
        createdByUserId: userId,
        internalNotes: "metadata only",
        sourceAction: "proof_file_generated",
      }),
    );

    await db.execute(sql`
      update line_item_proof_versions
      set
        status = 'awaiting_response'::line_item_proof_version_status,
        sent_to_email = ${"customer@example.com"},
        sent_at = now()
      where id = ${createdDraft.id}
    `);

    const token = await createPortalToken(lineItemId, createdDraft.id);

    const viewRes = await request(app)
      .get(`/api/portal/proof/${token}`)
      .expect(200);

    expect(viewRes.body?.data?.attachments?.[0]?.previewStatus).toBe("metadata_only");

    const actionRes = await request(app)
      .post(`/api/portal/proof/${token}/action`)
      .send({ action: "approve", comment: "Looks good" })
      .expect(400);

    expect(actionRes.body).toMatchObject({ success: false, message: INCOMPLETE_PROOF_MESSAGE });
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

  test("creates one combined proof package in persisted line-item order", async () => {
    const firstStorageKey = `proofing-tests/${Date.now()}-combined-first.png`;
    const secondStorageKey = `proofing-tests/${Date.now()}-combined-second.png`;
    await seedLocalImageForPreviewTest(firstStorageKey);
    await seedLocalImageForPreviewTest(secondStorageKey);
    const first = await createLineItemFixture("combined_order_first", {
      requiresProofApproval: true,
      addArtwork: true,
      artworkMimeType: "image/png",
      artworkFileName: "combined-first.png",
      artworkFileUrl: firstStorageKey,
      artworkStorageProvider: "local",
      sortOrder: 10,
    });
    const second = await createLineItemFixture("combined_order_second", {
      requiresProofApproval: true,
      addArtwork: true,
      artworkMimeType: "image/png",
      artworkFileName: "combined-second.png",
      artworkFileUrl: secondStorageKey,
      artworkStorageProvider: "local",
      sortOrder: 20,
    });

    const created = await db.transaction((tx) => createGeneratedCombinedProofVersion(tx, {
      organizationId: orgId,
      lineItemIds: [second.lineItemId, first.lineItemId],
      actorUserId: userId,
    }));

    expect(created.lineItems.map((item) => item.lineItemId)).toEqual([first.lineItemId, second.lineItemId]);
    const members = await db
      .select({ lineItemId: proofVersionLineItems.lineItemId, sortOrder: proofVersionLineItems.sortOrder })
      .from(proofVersionLineItems)
      .where(eq(proofVersionLineItems.proofVersionId, created.proofVersion.id))
      .orderBy(proofVersionLineItems.sortOrder);
    expect(members).toEqual([
      { lineItemId: first.lineItemId, sortOrder: 0 },
      { lineItemId: second.lineItemId, sortOrder: 1 },
    ]);
  });

  test("combined proof approval updates every included line item", async () => {
    const first = await createLineItemFixture("combined_first", { requiresProofApproval: true });
    const second = await createLineItemFixture("combined_second", { requiresProofApproval: true });

    const proofVersion = await db.transaction(async (tx) => {
      const created = await createLineItemProofVersion(tx, {
        organizationId: orgId,
        lineItemId: first.lineItemId,
        proofFileId: first.proofFileA,
        createdByUserId: userId,
      });
      await tx.insert(proofVersionLineItems).values({
        organizationId: orgId,
        orderId,
        proofVersionId: created.id,
        lineItemId: second.lineItemId,
        sortOrder: 1,
        lineItemLabelSnapshot: "Line combined_second",
      });
      await markProofVersionSent(tx, {
        organizationId: orgId,
        proofVersionId: created.id,
        actorUserId: userId,
        sentToEmail: "customer@example.com",
      });
      return created;
    });

    const token = await createPortalToken(first.lineItemId, proofVersion.id);
    await request(app)
      .post(`/api/portal/proof/${token}/action`)
      .send({ action: "approve", comment: "Combined package approved" })
      .expect(200);

    const rows = await db
      .select({ id: orderLineItems.id, approvedProofVersionId: orderLineItems.approvedProofVersionId })
      .from(orderLineItems)
      .where(inArray(orderLineItems.id, [first.lineItemId, second.lineItemId]));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.approvedProofVersionId === proofVersion.id)).toBe(true);

    const secondaryTruth = await db.transaction((tx) => resolveLineItemProofingTruth(tx, {
      organizationId: orgId,
      lineItemId: second.lineItemId,
    }));
    expect(secondaryTruth.approvedProofVersion?.id).toBe(proofVersion.id);
  });

  test("combined proof rejection updates every included line item", async () => {
    const first = await createLineItemFixture("combined_reject_first", { requiresProofApproval: true });
    const second = await createLineItemFixture("combined_reject_second", { requiresProofApproval: true });

    const proofVersion = await db.transaction(async (tx) => {
      const created = await createLineItemProofVersion(tx, {
        organizationId: orgId,
        lineItemId: first.lineItemId,
        proofFileId: first.proofFileA,
        createdByUserId: userId,
      });
      await tx.insert(proofVersionLineItems).values({
        organizationId: orgId,
        orderId,
        proofVersionId: created.id,
        lineItemId: second.lineItemId,
        sortOrder: 1,
        lineItemLabelSnapshot: "Line combined_reject_second",
      });
      await markProofVersionSent(tx, {
        organizationId: orgId,
        proofVersionId: created.id,
        actorUserId: userId,
        sentToEmail: "customer@example.com",
      });
      return created;
    });

    const token = await createPortalToken(first.lineItemId, proofVersion.id);
    await request(app)
      .post(`/api/portal/proof/${token}/action`)
      .send({ action: "reject", comment: "Please revise both lines" })
      .expect(200);

    const firstTruth = await db.transaction((tx) => resolveLineItemProofingTruth(tx, {
      organizationId: orgId,
      lineItemId: first.lineItemId,
    }));
    const secondTruth = await db.transaction((tx) => resolveLineItemProofingTruth(tx, {
      organizationId: orgId,
      lineItemId: second.lineItemId,
    }));
    expect(firstTruth.proofVersionHistory[0]?.status).toBe("rejected");
    expect(secondTruth.proofVersionHistory[0]?.status).toBe("rejected");
    expect(firstTruth.proofDecisionHistory[0]?.decision).toBe("rejected");
    expect(secondTruth.proofDecisionHistory[0]?.decision).toBe("rejected");
  });
});
