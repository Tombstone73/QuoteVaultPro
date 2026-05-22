import type { Express } from "express";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

import {
  assets,
  assetLinks,
  auditLogs,
  customerContacts,
  customers,
  materials,
  orderAttachments,
  orderLineItems,
  orders,
  productionEvents,
  productionJobs,
  reprintRequests,
  users,
} from "@shared/schema";

import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import {
  appendEvent,
  consumeReservedMaterialsForLineItem,
  getProductionConfigForOrganization,
  getTimerStateForJob,
  productionStatusSchema,
  productionViewKeySchema,
  toSeconds,
} from "./production.shared";
import { stationResolver } from "../services/stations/stationResolver";
import {
  createRequestLogOnce,
  enrichAttachmentWithUrls,
  resolveOriginalFileAccess,
} from "../lib/supabaseObjectHelpers";
import {
  isDesignOwnershipJob,
  isPrepressOwnershipJob,
  resolveActiveProductionOwners,
} from "../services/productionOwnership";
import { routeLineItemToProduction } from "../services/productionRoutingService";

/**
 * Canonical station key for the Fulfillment station.
 * Production jobs at non-prepress, non-design stations route here on completion.
 * Fulfillment jobs route the line item to "completed" on completion.
 */
const FULFILLMENT_STATION_KEY = "fulfillment";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

export function registerProductionJobsRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdminOrOwner: any;
    assertInternalUser: (req: any, res: any) => boolean;
  },
): void {
  const { isAuthenticated, tenantContext, isAdminOrOwner, assertInternalUser } = middleware;

  // 1) GET /api/production/jobs?status=&station=&orderId=
  app.get("/api/production/jobs", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const statusRaw = req.query.status as string | undefined;
      const viewRaw = req.query.view as string | undefined;
      const stationRaw = req.query.station as string | undefined;
      const stationCandidate = stationRaw ?? viewRaw;
      const searchRaw = req.query.search as string | undefined;
      const orderIdRaw = req.query.orderId as string | undefined;
      const statusParsed = statusRaw ? productionStatusSchema.safeParse(statusRaw) : null;
      const viewParsed = viewRaw ? productionViewKeySchema.safeParse(viewRaw) : null;
      const stationParsed = stationCandidate ? productionViewKeySchema.safeParse(stationCandidate) : null;
      if (statusParsed && !statusParsed.success) {
        return res.status(400).json({ error: "Invalid status" });
      }
      if (viewParsed && !viewParsed.success) {
        return res.status(400).json({ error: "Invalid view" });
      }
      // BUGFIX: Make station optional to support Overview page showing ALL jobs across all stations
      if (stationCandidate && !stationParsed?.success) {
        return res.status(400).json({ error: "Invalid station" });
      }
      const status = statusParsed?.success ? statusParsed.data : undefined;
      const view = viewParsed?.success ? viewParsed.data : undefined;
      const station = stationParsed?.data; // May be undefined for "all stations" query
      const resolvedStationId = station
        ? await stationResolver.resolveStationId({ organizationId, stationKey: station })
        : null;
      const search = typeof searchRaw === "string" ? searchRaw.trim() : "";

      const config = await getProductionConfigForOrganization(organizationId);
      if (process.env.NODE_ENV !== "production") {
        console.log("[DEV][GET /api/production/jobs] params:", { organizationId, status, view, station, enabledViews: config.enabledViews });
      }
      if (station && !config.enabledViews.includes(station)) {
        // Station not in this org's enabledViews — return empty rather than 403.
        if (process.env.NODE_ENV !== "production") {
          console.log("[DEV][GET /api/production/jobs] station '" + station + "' not in enabledViews " + JSON.stringify(config.enabledViews) + " — returning []");
        }
        return res.json({ success: true, data: [] });
      }

      // FIX: lineItemId filter was too strict - production_jobs can exist without line items during initial intake
      // Station scoping is OPTIONAL - when omitted, returns ALL jobs across all stations (for Overview)
      // orderId filtering for sibling production jobs on same order
      const whereClause = and(
        eq(productionJobs.organizationId, organizationId),
        station
          ? (resolvedStationId
              ? sql`production_jobs.station_id = ${resolvedStationId}`
              : eq(productionJobs.stationKey, station))
          : undefined,
        status ? eq(productionJobs.status, status) : undefined,
        orderIdRaw ? eq(productionJobs.orderId, orderIdRaw) : undefined,
      );

      const prepressGateApplies = station && (station === 'flatbed' || station === 'roll');
      const activeBoardQuery = !status || !["done", "void", "canceled", "cancelled"].includes(String(status).toLowerCase());

      const baseRows = await db
        .select({
          id: productionJobs.id,
          orderId: productionJobs.orderId,
          lineItemId: productionJobs.lineItemId,
          stationKey: productionJobs.stationKey,
          stepKey: productionJobs.stepKey,
          status: productionJobs.status,
          startedAt: productionJobs.startedAt,
          completedAt: productionJobs.completedAt,
          totalSeconds: productionJobs.totalSeconds,
          createdAt: productionJobs.createdAt,
          updatedAt: productionJobs.updatedAt,
          orderNumber: orders.orderNumber,
          dueDate: orders.dueDate,
          priority: orders.priority,
          fulfillmentStatus: orders.fulfillmentStatus,
          routingTarget: orders.routingTarget,
          customerId: customers.id,
          customerName: customers.companyName,
          // Prepress gate fields (null when no line item linked)
          lineItemRequiresPrepress: orderLineItems.requiresPrepress,
          lineItemStatus: orderLineItems.status,
        })
        .from(productionJobs)
        .innerJoin(orders, eq(productionJobs.orderId, orders.id))
        .innerJoin(customers, eq(orders.customerId, customers.id))
        .leftJoin(orderLineItems, eq(productionJobs.lineItemId, orderLineItems.id))
        .where(whereClause)
        .orderBy(desc(productionJobs.updatedAt));

      const lineItemIdsForOwnership = Array.from(
        new Set(
          baseRows
            .map((row) => row.lineItemId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      );

      const activeOwnerByLineItem = lineItemIdsForOwnership.length > 0
        ? await resolveActiveProductionOwners(db, {
            organizationId,
            lineItemIds: lineItemIdsForOwnership,
            debugLabel: "GET /api/production/jobs",
          })
        : new Map<string, any>();

      const filteredRows = baseRows.filter((row) => {
        if (!row.lineItemId) {
          return activeBoardQuery ? !["done", "void", "canceled", "cancelled"].includes(String(row.status || "").toLowerCase()) : true;
        }

        if (!activeBoardQuery) {
          return true;
        }

        const activeOwner = activeOwnerByLineItem.get(row.lineItemId);
        if (!activeOwner) {
          return false;
        }

        if (activeOwner.id !== row.id) {
          return false;
        }

        if (prepressGateApplies && isPrepressOwnershipJob(activeOwner)) {
          return false;
        }

        return true;
      });

      // DEV-only logging: show how many items were gated
      if (process.env.NODE_ENV !== "production") {
        const gatedCount = baseRows.length - filteredRows.length;
        if (gatedCount > 0) {
          console.log(`[DEV][GET /api/production/jobs] owner filter excluded ${gatedCount} of ${baseRows.length} rows`, {
            station: station ?? null,
            prepressGateApplies,
            activeBoardQuery,
          });
        }
      }

      if (filteredRows.length === 0) {
        return res.json({ success: true, data: [] });
      }

      const jobIds = filteredRows.map((r) => r.id);

      const timerEventRows = await db
        .select({
          productionJobId: productionEvents.productionJobId,
          type: productionEvents.type,
          createdAt: productionEvents.createdAt,
        })
        .from(productionEvents)
        .where(
          and(
            eq(productionEvents.organizationId, organizationId),
            inArray(productionEvents.productionJobId, jobIds),
            inArray(productionEvents.type, ["timer_started", "timer_stopped"]),
          ),
        )
        .orderBy(desc(productionEvents.createdAt));

      const latestTimerEventByJobId = new Map<string, { type: string; createdAt: any }>();
      for (const row of timerEventRows) {
        if (!latestTimerEventByJobId.has(row.productionJobId)) {
          latestTimerEventByJobId.set(row.productionJobId, { type: row.type, createdAt: row.createdAt });
        }
      }

      const reprintCountsRows = await db
        .select({
          productionJobId: productionEvents.productionJobId,
          count: sql<number>`count(*)::int`,
        })
        .from(productionEvents)
        .where(
          and(
            eq(productionEvents.organizationId, organizationId),
            inArray(productionEvents.productionJobId, jobIds),
            eq(productionEvents.type, "reprint_incremented"),
          ),
        )
        .groupBy(productionEvents.productionJobId);

      const reprintCountByJobId = new Map<string, number>();
      for (const r of reprintCountsRows) {
        reprintCountByJobId.set(r.productionJobId, Number(r.count) || 0);
      }

      const noteRows = await db
        .select({
          id: productionEvents.id,
          productionJobId: productionEvents.productionJobId,
          payload: productionEvents.payload,
          createdAt: productionEvents.createdAt,
        })
        .from(productionEvents)
        .where(
          and(
            eq(productionEvents.organizationId, organizationId),
            inArray(productionEvents.productionJobId, jobIds),
            eq(productionEvents.type, "note"),
          ),
        )
        .orderBy(desc(productionEvents.createdAt))
        .limit(500);

      const notesByJobId = new Map<string, Array<{ id: string; text: string; createdAt: string }>>();
      for (const row of noteRows) {
        const list = notesByJobId.get(row.productionJobId) ?? [];
        if (list.length >= 5) continue;
        const text = typeof (row.payload as any)?.text === "string" ? (row.payload as any).text : "";
        if (!text.trim()) continue;
        list.push({ id: row.id, text, createdAt: new Date(row.createdAt as any).toISOString() });
        notesByJobId.set(row.productionJobId, list);
      }

      const routingEventRows = await db
        .select({
          productionJobId: productionEvents.productionJobId,
          type: productionEvents.type,
          payload: productionEvents.payload,
          createdAt: productionEvents.createdAt,
        })
        .from(productionEvents)
        .where(
          and(
            eq(productionEvents.organizationId, organizationId),
            inArray(productionEvents.productionJobId, jobIds),
            inArray(productionEvents.type, ["intake", "routing_override"]),
          ),
        )
        .orderBy(desc(productionEvents.createdAt));

      const latestRoutingEventByJobId = new Map<string, { payload: any; type: string }>();
      for (const row of routingEventRows) {
        if (!latestRoutingEventByJobId.has(row.productionJobId)) {
          latestRoutingEventByJobId.set(row.productionJobId, {
            payload: row.payload ?? {},
            type: row.type,
          });
        }
      }

      // Batched order enrichment for cockpit UI (no schema changes, no N+1)
      const orderIds = Array.from(new Set(filteredRows.map((r) => r.orderId)));

      // Collect BOTH order IDs (for context) AND explicit line item IDs from production_jobs
      // This ensures we fetch the specific line item each job references, even if it's
      // not the first/default line item for the order
      const productionLineItemIds = Array.from(
        new Set(
          filteredRows
            .map((r) => r.lineItemId)
            .filter((v): v is string => typeof v === "string" && !!v.trim()),
        ),
      );

      // Query strategy: Fetch line items by order ID (for context) OR by explicit line item ID
      // This handles both normal cases (line items belong to order) and edge cases
      // (orphaned/reassigned line items that production_jobs still references)
      const lineItemRows = await db
        .select({
          orderId: orderLineItems.orderId,
          id: orderLineItems.id,
          description: orderLineItems.description,
          quantity: orderLineItems.quantity,
          width: orderLineItems.width,
          height: orderLineItems.height,
          materialId: orderLineItems.materialId,
          productType: orderLineItems.productType,
          status: orderLineItems.status,
          sortOrder: orderLineItems.sortOrder,
          selectedOptions: orderLineItems.selectedOptions, // For deriving Sides (single/double)
          createdAt: orderLineItems.createdAt,
        })
        .from(orderLineItems)
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .where(
          and(
            eq(orders.organizationId, organizationId),
            or(
              inArray(orderLineItems.orderId, orderIds),
              productionLineItemIds.length > 0 ? inArray(orderLineItems.id, productionLineItemIds) : undefined,
            ),
          ),
        )
        .orderBy(asc(orderLineItems.orderId), asc(orderLineItems.sortOrder), asc(orderLineItems.createdAt));

      const materialIds = Array.from(
        new Set(
          lineItemRows
            .map((li) => li.materialId)
            .filter((v): v is string => typeof v === "string" && !!v.trim()),
        ),
      );

      const materialRows = materialIds.length
        ? await db
            .select({ id: materials.id, name: materials.name })
            .from(materials)
            .where(and(eq(materials.organizationId, organizationId), inArray(materials.id, materialIds)))
        : [];

      const materialNameById = new Map<string, string>();
      for (const m of materialRows) {
        materialNameById.set(m.id, m.name);
      }

      const lineItemsByOrderId = new Map<
        string,
        Array<{
          id: string;
          description: string;
          quantity: number;
          width: any;
          height: any;
          materialId: string | null;
          materialName: string | null;
          productType: string;
          status: string;
          sortOrder: number;
          selectedOptions: any; // ADDED: For Sides derivation
          createdAt: any;
        }>
      >();

      const lineItemById = new Map<
        string,
        {
          id: string;
          description: string;
          quantity: number;
          width: any;
          height: any;
          materialId: string | null;
          materialName: string | null;
          productType: string;
          status: string;
          sortOrder: number;
          selectedOptions: any; // ADDED: For Sides derivation
          createdAt: any;
        }
      >();
      for (const li of lineItemRows) {
        const list = lineItemsByOrderId.get(li.orderId) ?? [];
        const mapped = {
          id: li.id,
          description: li.description,
          quantity: Number(li.quantity) || 0,
          width: li.width,
          height: li.height,
          materialId: li.materialId ?? null,
          materialName: li.materialId ? materialNameById.get(li.materialId) ?? null : null,
          productType: li.productType,
          status: li.status,
          sortOrder: Number(li.sortOrder) || 0,
          selectedOptions: li.selectedOptions ?? [], // ADDED: Pass through selected_options
          createdAt: li.createdAt,
        };
        list.push(mapped);
        lineItemsByOrderId.set(li.orderId, list);
        lineItemById.set(li.id, mapped);
      }

      const attachmentRows = await db
        .select({
          id: orderAttachments.id,
          orderId: orderAttachments.orderId,
          orderLineItemId: orderAttachments.orderLineItemId,
          fileRecordId: orderAttachments.fileRecordId,
          fileName: orderAttachments.fileName,
          fileUrl: orderAttachments.fileUrl,
          thumbKey: orderAttachments.thumbKey,
          previewKey: orderAttachments.previewKey,
          thumbnailUrl: orderAttachments.thumbnailUrl,
          role: orderAttachments.role,
          side: orderAttachments.side,
          isPrimary: orderAttachments.isPrimary,
          thumbStatus: orderAttachments.thumbStatus,
          createdAt: orderAttachments.createdAt,
        })
        .from(orderAttachments)
        .innerJoin(orders, eq(orderAttachments.orderId, orders.id))
        .where(
          and(
            eq(orders.organizationId, organizationId),
            inArray(orderAttachments.orderId, orderIds),
            eq(orderAttachments.role, "artwork"),
          ),
        )
        .orderBy(desc(orderAttachments.isPrimary), asc(orderAttachments.side), desc(orderAttachments.createdAt));

      // ALSO fetch artwork from new assets + assetLinks system (newer uploads may use this)
      // Join: assetLinks -> assets to get files linked to orders or line items
      const assetLinkRows = await db
        .select({
          id: assets.id,
          parentType: assetLinks.parentType,
          parentId: assetLinks.parentId,
          role: assetLinks.role,
          fileName: assets.fileName,
          fileRecordId: assets.fileRecordId,
          thumbKey: assets.thumbKey,
          previewKey: assets.previewKey,
          previewStatus: assets.previewStatus,
          createdAt: assetLinks.createdAt,
        })
        .from(assetLinks)
        .innerJoin(assets, eq(assetLinks.assetId, assets.id))
        .where(
          and(
            eq(assetLinks.organizationId, organizationId),
            or(
              // Assets linked to orders
              and(
                eq(assetLinks.parentType, "order"),
                inArray(assetLinks.parentId, orderIds),
              ),
              // Assets linked to line items (if we have production line item IDs)
              productionLineItemIds.length > 0
                ? and(
                    eq(assetLinks.parentType, "order_line_item"),
                    inArray(assetLinks.parentId, productionLineItemIds),
                  )
                : undefined,
            ),
          ),
        )
        .orderBy(desc(assetLinks.createdAt));

      const artworkByOrderId = new Map<
        string,
        Array<{
          id: string;
          orderLineItemId: string | null;
          fileName: string;
          fileUrl: string | null;
          availabilityStatus?: 'available' | 'archived' | 'restoring' | 'missing';
          thumbKey: string | null;
          previewKey: string | null;
          thumbnailUrl: string | null;
          side: string;
          isPrimary: boolean;
          thumbStatus: string | null;
        }>
      >();

      const artworkByLineItemId = new Map<
        string,
        Array<{
          id: string;
          orderLineItemId: string | null;
          fileName: string;
          fileUrl: string | null;
          availabilityStatus?: 'available' | 'archived' | 'restoring' | 'missing';
          thumbKey: string | null;
          previewKey: string | null;
          thumbnailUrl: string | null;
          side: string;
          isPrimary: boolean;
          thumbStatus: string | null;
        }>
      >();

      const attachmentLogOnce = createRequestLogOnce();
      const enrichedAttachmentRows = await Promise.all(
        attachmentRows.map((row) => enrichAttachmentWithUrls(row, { logOnce: attachmentLogOnce })),
      );

      for (const a of enrichedAttachmentRows) {
        const mapped = {
          id: a.id,
          orderLineItemId: a.orderLineItemId ?? null,
          fileName: a.fileName,
          fileUrl: a.originalUrl ?? null,
          availabilityStatus: a.availabilityStatus,
          thumbKey: a.thumbKey ?? null,
          previewKey: a.previewKey ?? null,
          thumbnailUrl: a.thumbnailUrl ?? null,
          side: a.side ?? "na",
          isPrimary: !!a.isPrimary,
          thumbStatus: a.thumbStatus ?? null,
        };

        // By order (fallback)
        const orderList = artworkByOrderId.get(a.orderId) ?? [];
        if (orderList.length < 6) {
          orderList.push(mapped);
          artworkByOrderId.set(a.orderId, orderList);
        }

        // By line item (preferred)
        if (a.orderLineItemId) {
          const liList = artworkByLineItemId.get(a.orderLineItemId) ?? [];
          if (liList.length < 6) {
            liList.push(mapped);
            artworkByLineItemId.set(a.orderLineItemId, liList);
          }
        }
      }

      // Process new assets/assetLinks data and merge into artwork maps
      const assetLogOnce = createRequestLogOnce();
      const { enrichAssetPreviewUrls } = await import('../services/assets/enrichAssetWithUrls');
      for (const link of assetLinkRows) {
        const [originalAccess, enrichedAsset] = await Promise.all([
          resolveOriginalFileAccess(link, { logOnce: assetLogOnce }),
          enrichAssetPreviewUrls(link as any),
        ]);
        const mapped = {
          id: link.id,
          orderLineItemId: link.parentType === "order_line_item" ? link.parentId : null,
          fileName: link.fileName,
          fileUrl: originalAccess.originalUrl,
          availabilityStatus: originalAccess.availabilityStatus,
          thumbKey: link.thumbKey ?? null,
          previewKey: link.previewKey ?? null,
          thumbnailUrl:
            (enrichedAsset as any).previewThumbnailUrl ??
            (enrichedAsset as any).thumbnailUrl ??
            (enrichedAsset as any).thumbUrl ??
            null,
          side: "na", // New assets system doesn't track side yet, could enhance later
          isPrimary: false, // New assets system doesn't track isPrimary yet
          thumbStatus: link.previewStatus ?? null,
        };

        // Add to appropriate map based on parentType
        if (link.parentType === "order") {
          const orderList = artworkByOrderId.get(link.parentId) ?? [];
          if (orderList.length < 6) {
            orderList.push(mapped);
            artworkByOrderId.set(link.parentId, orderList);
          }
        } else if (link.parentType === "order_line_item") {
          const liList = artworkByLineItemId.get(link.parentId) ?? [];
          if (liList.length < 6) {
            liList.push(mapped);
            artworkByLineItemId.set(link.parentId, liList);
          }
        }
      }

      const normalizeObjectsUrl = (url: string | null | undefined): string | undefined => {
        if (!url) return undefined;
        if (url.startsWith("/objects/")) return url;
        if (url.startsWith("http")) {
          const match = url.match(/\/objects\/(.+?)(?:\?|$)/);
          if (match) return `/objects/${match[1]}`;
          return url;
        }
        return `/objects/${String(url).replace(/^\/+/, "")}`;
      };

      const getFileExt = (fileNameOrUrl: string | null | undefined): string => {
        const s = String(fileNameOrUrl || "").toLowerCase();
        const noQuery = s.split("?")[0];
        const idx = noQuery.lastIndexOf(".");
        return idx >= 0 ? noQuery.slice(idx + 1) : "";
      };

      const isImageExt = (ext: string): boolean =>
        ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "svg"].includes(ext);

      const computePreviewUrl = (art: any): string | undefined => {
        const thumbUrl = normalizeObjectsUrl(art?.thumbnailUrl);
        if (thumbUrl) return thumbUrl;
        return undefined;
      };

      const now = Date.now();
      const data = filteredRows.map((row) => {
        const lastTimer = latestTimerEventByJobId.get(row.id);
        const isRunning = lastTimer?.type === "timer_started";
        const runningSince = isRunning ? new Date(lastTimer!.createdAt as any).toISOString() : null;
        const currentSeconds =
          Number(row.totalSeconds) +
          (isRunning ? toSeconds(now - new Date(lastTimer!.createdAt as any).getTime()) : 0);

        const orderLineItemsList = lineItemsByOrderId.get(row.orderId) ?? [];

        // CRITICAL: Use the SPECIFIC line item referenced by production_jobs.line_item_id
        // This ensures derived fields (qty/size/sides/media) match what the job is actually producing
        const primaryLineItem = row.lineItemId ? lineItemById.get(row.lineItemId) ?? null : orderLineItemsList[0] ?? null;


        // DEV: Log when production job references a line item that wasn't found
        if (process.env.NODE_ENV === "development" && row.lineItemId && !primaryLineItem) {
          console.warn(`[Production Job ${row.id}] Line item ${row.lineItemId} not found. Order ${row.orderId} has ${orderLineItemsList.length} line items.`);
        }

        // Ensure the primary line item appears first in the items array for UI consistency
        // If production job has a specific line_item_id, that line item should be primary
        const orderLineItemsTop = primaryLineItem
          ? [
              primaryLineItem,
              ...orderLineItemsList.filter((li) => li.id !== primaryLineItem.id).slice(0, 2),
            ]
          : orderLineItemsList.slice(0, 3);
        const totalQuantity = orderLineItemsList.reduce((sum, li) => sum + (Number(li.quantity) || 0), 0);

        const artwork = row.lineItemId
          ? artworkByLineItemId.get(row.lineItemId) ?? artworkByOrderId.get(row.orderId) ?? []
          : artworkByOrderId.get(row.orderId) ?? [];

        // DEV: Log when production job has no artwork
        if (process.env.NODE_ENV === "development" && artwork.length === 0) {
          console.warn(`[Production Job ${row.id}] No artwork found. LineItemId: ${row.lineItemId}, OrderId: ${row.orderId}`);
        }

        const sidesSet = new Set<string>();
        for (const a of artwork) {
          const s = (a.side || "").toLowerCase();
          if (s === "front" || s === "back") sidesSet.add(s);
        }
        const artworkBasedSides = sidesSet.size > 0 ? sidesSet.size : null;

        // DERIVE DISPLAY FIELDS (Backend responsibility - UI should not infer)
        // These fields are computed here to keep business logic centralized and consistent.

        // 1) Media: Material name from joined materials table, fallback to line item description
        let media = String(primaryLineItem?.materialName || "").trim();
        if (!media) {
          // Fallback: Use line item description if no material name
          media = String(primaryLineItem?.description || "").trim();
        }
        if (!media) {
          media = "—"; // Only show "—" if both materialName and description are empty
        }

        // 2) Size: Format width × height if both exist
        const width = primaryLineItem?.width;
        const height = primaryLineItem?.height;
        const size = (width && height) ? `${width} × ${height}` : "—";

        // 3) Sides: Parse selected_options for "Single Sided" / "Double Sided" choice
        let sides: string = "—";
        if (primaryLineItem?.selectedOptions && Array.isArray(primaryLineItem.selectedOptions)) {
          const sidesOption = primaryLineItem.selectedOptions.find((opt: any) => {
            const optName = String(opt.optionName || "").toLowerCase();
            return optName.includes("side") || optName.includes("print");
          });
          if (sidesOption) {
            const val = String(sidesOption.value || "").toLowerCase();
            if (val.includes("single") || val === "1") {
              sides = "Single";
            } else if (val.includes("double") || val === "2") {
              sides = "Double";
            }
          }
        }
        // Fallback: if selected_options didn't provide sides, use artwork count
        if (sides === "—" && artworkBasedSides) {
          sides = artworkBasedSides === 1 ? "Single" : "Double";
        }

        const qty = Number(primaryLineItem?.quantity ?? 0) || 0;

        // Job description: Prefer line item description, fallback to "Job #{id}"
        const jobDescription = String(primaryLineItem?.description || "").trim() || `Job #${row.id.slice(-8)}`;

        const artworkThumbs = (artwork ?? []).slice(0, 2).map((a) => ({
          id: a.id,
          fileName: a.fileName,
          fileUrl: a.fileUrl, // Full file URL for download/display
          thumbnailUrl: a.thumbnailUrl,
          thumbKey: a.thumbKey,
          side: a.side,
          isPrimary: a.isPrimary,
          thumbStatus: a.thumbStatus,
        }));

        // Explicit preview/file URLs for fast board/list thumbnail rendering
        const frontBySide = artwork.find((a) => String(a?.side || "").toLowerCase() === "front");
        const backBySide = artwork.find((a) => String(a?.side || "").toLowerCase() === "back");
        const primaryArt = artwork.find((a) => !!a?.isPrimary);
        const frontArt = frontBySide ?? primaryArt ?? artwork[0] ?? null;
        const backArt = backBySide ?? artwork.find((a) => a && frontArt && a.id !== frontArt.id) ?? null;

        const frontFileUrl = frontArt ? normalizeObjectsUrl(frontArt.fileUrl) : undefined;
        const backFileUrl = backArt ? normalizeObjectsUrl(backArt.fileUrl) : undefined;
        const frontPreviewUrl = frontArt ? computePreviewUrl(frontArt) : undefined;
        const backPreviewUrl = backArt ? computePreviewUrl(backArt) : undefined;

        const notes = notesByJobId.get(row.id) ?? [];
        const routingMeta = latestRoutingEventByJobId.get(row.id);
        const routingPayload = routingMeta?.payload ?? {};
        const routingReasonRaw = routingPayload?.routingReason;
        const routingSourceRaw = routingPayload?.source ?? routingPayload?.trigger ?? routingMeta?.type;
        const idempotencyNoteRaw = routingPayload?.idempotencyNote;

        return {
          id: row.id,
          // Stable, UI-ready fields (no guessing / no missing keys)
          productionJobId: row.id, // Explicit production job ID for clarity
          jobId: row.id,
          lineItemId: String(row.lineItemId ?? ""),
          orderId: row.orderId,
          orderNumber: String(row.orderNumber ?? ""), // Order number at top level for easy access
          customerName: String(row.customerName ?? "—"),
          dueDate: row.dueDate ?? null,
          stationKey: String(row.stationKey ?? ""),
          stepKey: String(row.stepKey ?? ""),
          routingReason: typeof routingReasonRaw === "string" && routingReasonRaw.trim() ? String(routingReasonRaw) : null,
          routingSource: typeof routingSourceRaw === "string" && String(routingSourceRaw).trim() ? String(routingSourceRaw) : null,
          idempotencyNote:
            typeof idempotencyNoteRaw === "string" && String(idempotencyNoteRaw).trim()
              ? String(idempotencyNoteRaw)
              : null,
          // LIVE LINE ITEM FIELDS (top-level for easy frontend access)
          qty,                // LIVE: from line item, updates when qty changed
          jobDescription,     // LIVE: from line item description
          size,              // LIVE: computed from line item width/height
          sides,             // LIVE: parsed from line item selectedOptions
          media,             // LIVE: from line item material or description
          // Legacy field for backwards compatibility
          mediaLabel: media,
          // NEW: explicit preview URLs for Production Overview thumbnails
          frontPreviewUrl,
          backPreviewUrl,
          frontFileUrl,
          backFileUrl,
          artwork: artworkThumbs,
          notes,
          // Back-compat: treat view as stationKey
          view: station ?? view ?? config.defaultView,
          status: row.status,
          startedAt: row.startedAt,
          completedAt: row.completedAt,
          totalSeconds: Number(row.totalSeconds) || 0,
          timer: {
            isRunning,
            runningSince,
            currentSeconds,
          },
          reprintCount: reprintCountByJobId.get(row.id) ?? 0,
          order: {
            id: row.orderId,
            customerId: row.customerId,
            orderNumber: row.orderNumber,
            customerName: row.customerName,
            dueDate: row.dueDate,
            priority: row.priority,
            fulfillmentStatus: row.fulfillmentStatus,
            routingTarget: row.routingTarget,
            lineItems: {
              count: orderLineItemsList.length,
              totalQuantity,
              primary: primaryLineItem,
              items: orderLineItemsTop,
            },
            artwork,
            sides: artworkBasedSides, // Keep original artwork-based count for backwards compatibility
          },
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      });

      const filtered = search
        ? data.filter((j) => {
            const q = search.toLowerCase();
            const orderNumber = String(j.order?.orderNumber ?? "").toLowerCase();
            const customerName = String(j.order?.customerName ?? "").toLowerCase();
            const desc = String(j.order?.lineItems?.primary?.description ?? "").toLowerCase();
            return orderNumber.includes(q) || customerName.includes(q) || desc.includes(q);
          })
        : data;

      // DEV: Log response shape for verification
      if (process.env.NODE_ENV === "development" && filtered.length > 0) {
        console.log(`[GET /api/production/jobs] Returning ${filtered.length} jobs. Sample keys:`, Object.keys(filtered[0]));

        const g: any = global as any;
        if (!g.__dev_logged_production_jobs_preview_coverage) {
          g.__dev_logged_production_jobs_preview_coverage = true;
          const withFront = filtered.filter((j: any) => !!j.frontPreviewUrl).length;
          console.log(`[GET /api/production/jobs] preview coverage`, {
            total: filtered.length,
            withFrontPreviewUrl: withFront,
          });
        }
      }

      res.json({ success: true, data: filtered });
    } catch (error) {
      console.error("Error fetching production jobs:", error);
      res.status(500).json({ error: "Failed to fetch production jobs" });
    }
  });

  // Extra (needed for detail UI): GET /api/production/jobs/:jobId
  app.get("/api/production/jobs/:jobId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const jobId = String(req.params.jobId || "");
      if (!jobId.trim()) return res.status(400).json({ error: "jobId required" });

      // Fetch production job ONLY (org-scoped). Related entities are fetched separately to avoid brittle joins.
      const jobRows = await db
        .select({
          id: productionJobs.id,
          orderId: productionJobs.orderId,
          lineItemId: productionJobs.lineItemId,
          stationKey: productionJobs.stationKey,
          stepKey: productionJobs.stepKey,
          status: productionJobs.status,
          startedAt: productionJobs.startedAt,
          completedAt: productionJobs.completedAt,
          totalSeconds: productionJobs.totalSeconds,
          createdAt: productionJobs.createdAt,
          updatedAt: productionJobs.updatedAt,
        })
        .from(productionJobs)
        .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
        .limit(1);

      const job = jobRows[0];
      if (!job) return res.status(404).json({ error: "Production job not found" });

      const orderId = String(job.orderId || "");
      const lineItemId = String(job.lineItemId || "");
      if (!orderId) return res.status(404).json({ error: "Order not found for production job" });
      if (!lineItemId) return res.status(404).json({ error: "Line item not found for production job" });

      const orderRows = await db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          dueDate: orders.dueDate,
          priority: orders.priority,
          fulfillmentStatus: orders.fulfillmentStatus,
          routingTarget: orders.routingTarget,
          customerName: customers.companyName,
          contactId: orders.contactId,
          notesInternal: orders.notesInternal,
        })
        .from(orders)
        .leftJoin(customers, and(eq(orders.customerId, customers.id), eq(customers.organizationId, organizationId)))
        .where(and(eq(orders.organizationId, organizationId), eq(orders.id, orderId)))
        .limit(1);

      const order = orderRows[0];
      if (!order) return res.status(404).json({ error: "Order not found for production job" });

      // Contact name (for production ticket). Fail-soft: never block job detail.
      let contactName: string | null = null;
      if (order.contactId) {
        try {
          const contactRows = await db
            .select({ firstName: customerContacts.firstName, lastName: customerContacts.lastName })
            .from(customerContacts)
            .where(eq(customerContacts.id, order.contactId))
            .limit(1);
          const c = contactRows[0];
          if (c) {
            const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
            contactName = name || null;
          }
        } catch {
          contactName = null;
        }
      }

      const events = await db
        .select({
          id: productionEvents.id,
          type: productionEvents.type,
          payload: productionEvents.payload,
          actorUserId: productionEvents.actorUserId,
          createdAt: productionEvents.createdAt,
        })
        .from(productionEvents)
        .where(and(eq(productionEvents.organizationId, organizationId), eq(productionEvents.productionJobId, jobId)))
        .orderBy(desc(productionEvents.createdAt))
        .limit(250);

      // "Who's job it is" — production jobs have no explicit assignee, so we
      // derive it from the most recent operator action on the job (timer
      // start/stop, note, reprint). Best-effort; null when no actor is known.
      let assignedTo: string | null = null;
      const latestActorId = events.find(
        (e) => typeof e.actorUserId === "string" && e.actorUserId,
      )?.actorUserId;
      if (latestActorId) {
        try {
          const userRows = await db
            .select({ firstName: users.firstName, lastName: users.lastName, email: users.email })
            .from(users)
            .where(eq(users.id, latestActorId))
            .limit(1);
          const u = userRows[0];
          if (u) {
            const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
            assignedTo = name || u.email || null;
          }
        } catch {
          assignedTo = null;
        }
      }

      const latestRoutingEvent = events.find((event) => event.type === "routing_override" || event.type === "intake") ?? null;
      const latestRoutingPayload = (latestRoutingEvent?.payload as any) ?? {};
      const routingReason =
        typeof latestRoutingPayload?.routingReason === "string" && latestRoutingPayload.routingReason.trim()
          ? String(latestRoutingPayload.routingReason)
          : null;
      const routingSource =
        typeof latestRoutingPayload?.source === "string" && latestRoutingPayload.source.trim()
          ? String(latestRoutingPayload.source)
          : typeof latestRoutingPayload?.trigger === "string" && latestRoutingPayload.trigger.trim()
            ? String(latestRoutingPayload.trigger)
            : latestRoutingEvent?.type ?? null;
      const idempotencyNote =
        typeof latestRoutingPayload?.idempotencyNote === "string" && latestRoutingPayload.idempotencyNote.trim()
          ? String(latestRoutingPayload.idempotencyNote)
          : null;

      const timerState = await getTimerStateForJob(organizationId, jobId);
      const now = Date.now();
      const currentSeconds =
        Number(job.totalSeconds) +
        (timerState.isRunning && timerState.runningSince
          ? toSeconds(now - new Date(timerState.runningSince as any).getTime())
          : 0);

      const lineItemRows = await db
        .select({
          id: orderLineItems.id,
          orderId: orderLineItems.orderId,
          description: orderLineItems.description,
          quantity: orderLineItems.quantity,
          width: orderLineItems.width,
          height: orderLineItems.height,
          materialId: orderLineItems.materialId,
          productType: orderLineItems.productType,
          status: orderLineItems.status,
          sortOrder: orderLineItems.sortOrder,
          selectedOptions: orderLineItems.selectedOptions,
          productionNotes: orderLineItems.productionNotes,
          createdAt: orderLineItems.createdAt,
        })
        .from(orderLineItems)
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .where(and(eq(orders.organizationId, organizationId), eq(orderLineItems.orderId, orderId)))
        .orderBy(asc(orderLineItems.sortOrder), asc(orderLineItems.createdAt));

      const materialIds = Array.from(
        new Set(lineItemRows.map((li) => li.materialId).filter((v): v is string => typeof v === "string" && !!v.trim())),
      );

      const materialNameById = new Map<string, string>();
      if (materialIds.length > 0) {
        const materialRows = await db
          .select({ id: materials.id, name: materials.name })
          .from(materials)
          .where(and(eq(materials.organizationId, organizationId), inArray(materials.id, materialIds)));
        for (const m of materialRows) materialNameById.set(m.id, m.name);
      }

      const lineItems = lineItemRows.map((li) => ({
        id: li.id,
        description: li.description,
        quantity: Number(li.quantity) || 0,
        width: li.width,
        height: li.height,
        materialId: li.materialId ?? null,
        materialName: li.materialId ? materialNameById.get(li.materialId) ?? null : null,
        productType: li.productType,
        status: li.status,
        sortOrder: Number(li.sortOrder) || 0,
        selectedOptions: li.selectedOptions ?? [],
        productionNotes: li.productionNotes ?? null,
        createdAt: li.createdAt,
      }));

      const primaryLineItem = lineItems.find((li) => li.id === lineItemId) ?? null;
      if (!primaryLineItem) return res.status(404).json({ error: "Line item not found for production job" });

      const attachmentRows = await db
        .select({
          id: orderAttachments.id,
          orderId: orderAttachments.orderId,
          orderLineItemId: orderAttachments.orderLineItemId,
          fileRecordId: orderAttachments.fileRecordId,
          fileName: orderAttachments.fileName,
          fileUrl: orderAttachments.fileUrl,
          thumbKey: orderAttachments.thumbKey,
          previewKey: orderAttachments.previewKey,
          thumbnailUrl: orderAttachments.thumbnailUrl,
          role: orderAttachments.role,
          side: orderAttachments.side,
          isPrimary: orderAttachments.isPrimary,
          thumbStatus: orderAttachments.thumbStatus,
          createdAt: orderAttachments.createdAt,
        })
        .from(orderAttachments)
        .innerJoin(orders, eq(orderAttachments.orderId, orders.id))
        .where(
          and(
            eq(orders.organizationId, organizationId),
            eq(orderAttachments.orderId, orderId),
            eq(orderAttachments.role, "artwork"),
          ),
        )
        .orderBy(desc(orderAttachments.isPrimary), asc(orderAttachments.side), desc(orderAttachments.createdAt))
        .limit(50);

      const byOrder: Array<any> = [];
      const byLineItem = new Map<string, Array<any>>();
      const orderAttachmentLogOnce = createRequestLogOnce();
      const enrichedOrderAttachments = await Promise.all(
        attachmentRows.map((row) => enrichAttachmentWithUrls(row, { logOnce: orderAttachmentLogOnce })),
      );

      for (const a of enrichedOrderAttachments) {
        const mapped = {
          id: a.id,
          orderLineItemId: a.orderLineItemId ?? null,
          fileName: a.fileName,
          fileUrl: a.originalUrl ?? null,
          availabilityStatus: a.availabilityStatus,
          thumbKey: a.thumbKey ?? null,
          previewKey: a.previewKey ?? null,
          thumbnailUrl: a.thumbnailUrl ?? null,
          side: a.side ?? "na",
          isPrimary: !!a.isPrimary,
          thumbStatus: a.thumbStatus ?? null,
        };
        if (byOrder.length < 12) byOrder.push(mapped);
        if (a.orderLineItemId) {
          const list = byLineItem.get(a.orderLineItemId) ?? [];
          if (list.length < 12) {
            list.push(mapped);
            byLineItem.set(a.orderLineItemId, list);
          }
        }
      }

      // ALSO fetch artwork from new assets + assetLinks system (newer uploads may use this)
      // Fail-soft: if this optional query fails, do not 500 job detail.
      try {
        const assetLinkRows = await db
          .select({
            id: assets.id,
            parentType: assetLinks.parentType,
            parentId: assetLinks.parentId,
            fileName: assets.fileName,
            fileRecordId: assets.fileRecordId,
            thumbKey: assets.thumbKey,
            previewKey: assets.previewKey,
            previewStatus: assets.previewStatus,
            mimeType: assets.mimeType,
            sizeBytes: assets.sizeBytes,
            createdAt: assetLinks.createdAt,
          })
          .from(assetLinks)
          .innerJoin(assets, eq(assetLinks.assetId, assets.id))
          .where(
            and(
              eq(assetLinks.organizationId, organizationId),
              or(
                and(eq(assetLinks.parentType, "order"), eq(assetLinks.parentId, orderId)),
                and(eq(assetLinks.parentType, "order_line_item"), eq(assetLinks.parentId, lineItemId)),
              ),
            ),
          )
          .orderBy(desc(assetLinks.createdAt));

        const assetLogOnce = createRequestLogOnce();
        const { enrichAssetPreviewUrls } = await import('../services/assets/enrichAssetWithUrls');
        for (const link of assetLinkRows) {
          const [originalAccess, enrichedAsset] = await Promise.all([
            resolveOriginalFileAccess(link, { logOnce: assetLogOnce }),
            enrichAssetPreviewUrls(link as any),
          ]);
          const mapped = {
            id: link.id,
            orderLineItemId: link.parentType === "order_line_item" ? link.parentId : null,
            fileName: link.fileName,
            fileUrl: originalAccess.originalUrl,
            availabilityStatus: originalAccess.availabilityStatus,
            thumbKey: link.thumbKey ?? null,
            previewKey: link.previewKey ?? null,
            thumbnailUrl:
              (enrichedAsset as any).previewThumbnailUrl ??
              (enrichedAsset as any).thumbnailUrl ??
              (enrichedAsset as any).thumbUrl ??
              null,
            side: "na",
            isPrimary: false,
            thumbStatus: link.previewStatus ?? null,
            mimeType: link.mimeType ?? null,
            sizeBytes: link.sizeBytes ?? null,
          };

          if (byOrder.length < 12 && link.parentType === "order") {
            byOrder.push(mapped);
          }

          if (link.parentType === "order_line_item" && link.parentId) {
            const list = byLineItem.get(link.parentId) ?? [];
            if (list.length < 12) {
              list.push(mapped);
              byLineItem.set(link.parentId, list);
            }
          }
        }
      } catch (e: any) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[DEV][GET /api/production/jobs/:jobId] asset artwork query failed (ignored)", {
            jobId,
            organizationId,
            message: String(e?.message || e),
          });
        }
      }

      const artwork = byLineItem.get(lineItemId) ?? byOrder;
      const sidesSet = new Set<string>();
      for (const a of artwork) {
        const s = (a.side || "").toLowerCase();
        if (s === "front" || s === "back") sidesSet.add(s);
      }
      const artworkBasedSides = sidesSet.size > 0 ? sidesSet.size : null;

      // DERIVE LIVE DISPLAY FIELDS (match overview endpoint logic)
      // 1) Media
      let media = String(primaryLineItem?.materialName || "").trim();
      if (!media) {
        media = String(primaryLineItem?.description || "").trim();
      }
      if (!media) media = "—";

      // 2) Size
      const width = primaryLineItem?.width;
      const height = primaryLineItem?.height;
      const size = width && height ? `${width} × ${height}` : "—";

      // 3) Sides
      let sides: string = "—";
      if (primaryLineItem?.selectedOptions && Array.isArray(primaryLineItem.selectedOptions)) {
        const sidesOption = primaryLineItem.selectedOptions.find((opt: any) => {
          const optName = String(opt.optionName || "").toLowerCase();
          return optName.includes("side") || optName.includes("print");
        });
        if (sidesOption) {
          const val = String((sidesOption as any).value || "").toLowerCase();
          if (val.includes("single") || val === "1") {
            sides = "Single";
          } else if (val.includes("double") || val === "2") {
            sides = "Double";
          }
        }
      }
      if (sides === "—" && artworkBasedSides) {
        sides = artworkBasedSides === 1 ? "Single" : "Double";
      }

      const qty = Number(primaryLineItem?.quantity ?? 0) || 0;
      const jobDescription = String(primaryLineItem?.description || "").trim() || `Job #${job.id.slice(-8)}`;

      // Sibling jobs list for operator workflow
      const otherJobsRows = await db
        .select({
          id: productionJobs.id,
          lineItemId: productionJobs.lineItemId,
          stationKey: productionJobs.stationKey,
          stepKey: productionJobs.stepKey,
          status: productionJobs.status,
          createdAt: productionJobs.createdAt,
        })
        .from(productionJobs)
        .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.orderId, orderId)))
        .orderBy(asc(productionJobs.createdAt));

      const lineItemById = new Map(lineItems.map((li) => [li.id, li] as const));
      const otherJobsInOrder = otherJobsRows.map((r) => {
        const li = r.lineItemId ? lineItemById.get(r.lineItemId) ?? null : null;
        const artworkForRow = r.lineItemId ? byLineItem.get(r.lineItemId) ?? byOrder : byOrder;

        const rowSidesSet = new Set<string>();
        for (const a of artworkForRow ?? []) {
          const s = String((a as any).side || "").toLowerCase();
          if (s === "front" || s === "back") rowSidesSet.add(s);
        }
        const rowArtworkSides = rowSidesSet.size > 0 ? rowSidesSet.size : null;

        let rowMedia = String(li?.materialName || "").trim();
        if (!rowMedia) rowMedia = String(li?.description || "").trim();
        if (!rowMedia) rowMedia = "—";

        const rowWidth = li?.width;
        const rowHeight = li?.height;
        const rowSize = rowWidth && rowHeight ? `${rowWidth} × ${rowHeight}` : "—";

        let rowSides: string = "—";
        if (li?.selectedOptions && Array.isArray(li.selectedOptions)) {
          const sidesOption = li.selectedOptions.find((opt: any) => {
            const optName = String(opt.optionName || "").toLowerCase();
            return optName.includes("side") || optName.includes("print");
          });
          if (sidesOption) {
            const val = String((sidesOption as any).value || "").toLowerCase();
            if (val.includes("single") || val === "1") {
              rowSides = "Single";
            } else if (val.includes("double") || val === "2") {
              rowSides = "Double";
            }
          }
        }
        if (rowSides === "—" && rowArtworkSides) {
          rowSides = rowArtworkSides === 1 ? "Single" : "Double";
        }

        const rowQty = Number(li?.quantity ?? 0) || 0;
        const rowDesc = String(li?.description || "").trim() || `Job #${String(r.id).slice(-8)}`;

        return {
          id: r.id,
          jobId: r.id,
          lineItemId: r.lineItemId,
          stationKey: r.stationKey,
          stepKey: r.stepKey,
          status: r.status,
          qty: rowQty,
          size: rowSize,
          sides: rowSides,
          media: rowMedia,
          jobDescription: rowDesc,
          dueDate: order.dueDate ?? null,
          createdAt: r.createdAt,
        };
      });

      const reprintCountRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(productionEvents)
        .where(
          and(
            eq(productionEvents.organizationId, organizationId),
            eq(productionEvents.productionJobId, jobId),
            eq(productionEvents.type, "reprint_incremented"),
          ),
        );

      res.json({
        success: true,
        data: {
          id: job.id,
          stationKey: job.stationKey,
          stepKey: job.stepKey,
          routingReason,
          routingSource,
          idempotencyNote,
          lineItemId: job.lineItemId,
          orderId,
          status: job.status,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          totalSeconds: Number(job.totalSeconds) || 0,
          timer: {
            isRunning: timerState.isRunning,
            runningSince: timerState.runningSince ? new Date(timerState.runningSince as any).toISOString() : null,
            currentSeconds,
          },
          reprintCount: Number(reprintCountRows[0]?.count) || 0,
          // LIVE LINE ITEM FIELDS (top-level for operator UI)
          qty,
          jobDescription,
          size,
          sides,
          media,
          mediaLabel: media,
          // Convenience top-level order context
          orderNumber: order.orderNumber,
          customerName: String(order.customerName || "—"),
          dueDate: order.dueDate ?? null,
          priority: order.priority ?? null,
          // Production ticket fields
          contactName,
          assignedTo,
          internalNotes: order.notesInternal ?? null,
          productionNotes: primaryLineItem?.productionNotes ?? null,
          // Convenience top-level artwork (same list used in order.artwork)
          artwork,
          order: {
            id: orderId,
            orderNumber: order.orderNumber,
            customerName: String(order.customerName || "—"),
            contactName,
            dueDate: order.dueDate,
            priority: order.priority,
            fulfillmentStatus: order.fulfillmentStatus,
            routingTarget: order.routingTarget,
            internalNotes: order.notesInternal ?? null,
            lineItems: {
              count: lineItems.length,
              totalQuantity: lineItems.reduce((sum, li) => sum + (Number(li.quantity) || 0), 0),
              primary: primaryLineItem,
              items: lineItems.slice(0, 20),
            },
            artwork,
            sides: artworkBasedSides,
          },
          otherJobsInOrder,
          events,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        },
      });

      // DEV-only: Log once to verify payload counts (no secrets)
      if (process.env.NODE_ENV === "development") {
        const g: any = global as any;
        if (!g.__dev_logged_production_job_detail_payload) {
          g.__dev_logged_production_job_detail_payload = true;
          console.log("[DEV][GET /api/production/jobs/:jobId] OK", {
            jobId,
            organizationId,
            artworkCount: Array.isArray(artwork) ? artwork.length : 0,
            otherJobsInOrderCount: Array.isArray(otherJobsInOrder) ? otherJobsInOrder.length : 0,
          });
        }
      }
    } catch (error: any) {
      if (process.env.NODE_ENV === "development") {
        console.error("[DEV] Error in GET /api/production/jobs/:jobId", {
          jobId: String(req?.params?.jobId || ""),
          organizationId: getRequestOrganizationId(req),
          message: String(error?.message || error),
          stack: String(error?.stack || ""),
        });
      } else {
        console.error("Error fetching production job:", String(error?.message || error));
      }
      res.status(500).json({ error: "Failed to fetch production job" });
    }
  });

  // 2) POST /api/production/jobs/from-order/:orderId
  // HARD DEPRECATED: Order-level production is no longer supported.
  app.post("/api/production/jobs/from-order/:orderId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const orderId = req.params.orderId;
      console.warn(
        `[ProductionDeprecated] Attempted order-level job creation for orderId=${orderId}. Order-level production is deprecated; use line-item status routing.`,
      );
      res.status(410).json({
        error: "Order-level production is deprecated. Production jobs are created per line item via status routing.",
      });
    } catch (error) {
      console.error("Error creating production job:", error);
      res.status(500).json({ error: "Failed to create production job" });
    }
  });

  // 2b) POST /api/production/jobs/:jobId/routing (explicit override)
  // This is the ONLY supported way to change station_key/step_key after a job exists.
  app.post(
    "/api/production/jobs/:jobId/routing",
    isAuthenticated,
    tenantContext,
    isAdminOrOwner,
    async (req: any, res) => {
      try {
        if (!assertInternalUser(req, res)) return;
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

        const bodySchema = z
          .object({
            stationKey: z.string().min(1),
            stepKey: z.string().min(1),
            reason: z.string().optional(),
          })
          .strict();

        const parsed = bodySchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "Invalid routing override" });

        const jobId = String(req.params.jobId);
        const nextStationKey = parsed.data.stationKey.trim();
        const nextStepKey = parsed.data.stepKey.trim();

        const result = await db.transaction(async (tx) => {
          const rows = await tx
            .select({
              id: productionJobs.id,
              orderId: productionJobs.orderId,
              lineItemId: productionJobs.lineItemId,
              stationKey: productionJobs.stationKey,
              stepKey: productionJobs.stepKey,
              status: productionJobs.status,
            })
            .from(productionJobs)
            .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
            .limit(1);

          const job = rows[0];
          if (!job) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });

          // If station is changing and line item is linked, use canonical close/create
          const stationChanging = job.stationKey !== nextStationKey;
          if (stationChanging && job.lineItemId) {
            const { transitionToStation } = await import("../services/productionOwnership");
            const transition = await transitionToStation(tx, {
              organizationId,
              orderId: job.orderId,
              lineItemId: job.lineItemId,
              targetStationKey: nextStationKey,
              targetStepKey: nextStepKey,
              reason: parsed.data.reason ?? "admin_routing_override",
              actorUserId: getUserId(req.user) ?? null,
            });

            // Return the newly created job
            const newRows = await tx
              .select({
                id: productionJobs.id,
                orderId: productionJobs.orderId,
                lineItemId: productionJobs.lineItemId,
                stationKey: productionJobs.stationKey,
                stepKey: productionJobs.stepKey,
                status: productionJobs.status,
                updatedAt: productionJobs.updatedAt,
              })
              .from(productionJobs)
              .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, transition.createdJobId)))
              .limit(1);

            return newRows[0];
          }

          // Same station, step change only — update in place
          await tx
            .update(productionJobs)
            .set({
              stationKey: nextStationKey,
              stepKey: nextStepKey,
              updatedAt: new Date(),
            })
            .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));

          await appendEvent({
            tx,
            organizationId,
            productionJobId: jobId,
            type: "routing_override",
            actorUserId: getUserId(req.user) ?? null,
            payload: {
              from: { stationKey: job.stationKey, stepKey: job.stepKey },
              to: { stationKey: nextStationKey, stepKey: nextStepKey },
              reason: parsed.data.reason ?? null,
            },
          });

          const updatedRows = await tx
            .select({
              id: productionJobs.id,
              orderId: productionJobs.orderId,
              lineItemId: productionJobs.lineItemId,
              stationKey: productionJobs.stationKey,
              stepKey: productionJobs.stepKey,
              status: productionJobs.status,
              updatedAt: productionJobs.updatedAt,
            })
            .from(productionJobs)
            .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
            .limit(1);

          return updatedRows[0];
        });

        res.json({ success: true, data: result });
      } catch (error: any) {
        const status = error?.statusCode || 500;
        console.error("Error overriding production routing:", error);
        res.status(status).json({ error: error?.message || "Failed to override routing" });
      }
    },
  );

  // 3) POST /api/production/jobs/:jobId/start
  app.post("/api/production/jobs/:jobId/start", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);

      const jobId = req.params.jobId;
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const jobRows = await tx
          .select()
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        const job = jobRows[0];
        if (!job) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });
        if (job.status === "done") throw Object.assign(new Error("Job is done; reopen first"), { statusCode: 400 });

        const timerState = await getTimerStateForJob(organizationId, jobId, tx);
        if (timerState.isRunning) {
          return job;
        }

        await appendEvent({
          tx,
          organizationId,
          productionJobId: jobId,
          type: "timer_started",
          actorUserId: userId ?? null,
        });

        await tx
          .update(productionJobs)
          .set({
            status: job.status === "queued" ? "in_progress" : job.status,
            startedAt: job.startedAt ?? now,
            updatedAt: now,
          })
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));

        const updatedRows = await tx
          .select()
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        return updatedRows[0];
      });

      res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error starting production timer:", error);
      res.status(status).json({ error: error?.message || "Failed to start timer" });
    }
  });

  // 4) POST /api/production/jobs/:jobId/stop
  app.post("/api/production/jobs/:jobId/stop", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);

      const jobId = req.params.jobId;
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const jobRows = await tx
          .select()
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        const job = jobRows[0];
        if (!job) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });

        const lastStartRows = await tx
          .select({ createdAt: productionEvents.createdAt, type: productionEvents.type })
          .from(productionEvents)
          .where(
            and(
              eq(productionEvents.organizationId, organizationId),
              eq(productionEvents.productionJobId, jobId),
              inArray(productionEvents.type, ["timer_started", "timer_stopped"]),
            ),
          )
          .orderBy(desc(productionEvents.createdAt))
          .limit(1);

        const last = lastStartRows[0];
        if (!last || last.type !== "timer_started") {
          return job;
        }

        const startedAtMs = new Date(last.createdAt as any).getTime();
        const deltaSeconds = toSeconds(now.getTime() - startedAtMs);

        await appendEvent({
          tx,
          organizationId,
          productionJobId: jobId,
          type: "timer_stopped",
          actorUserId: userId ?? null,
          payload: { seconds: deltaSeconds },
        });

        await tx
          .update(productionJobs)
          .set({
            totalSeconds: (Number(job.totalSeconds) || 0) + deltaSeconds,
            updatedAt: now,
          })
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));

        const updatedRows = await tx
          .select()
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        return updatedRows[0];
      });

      res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error stopping production timer:", error);
      res.status(status).json({ error: error?.message || "Failed to stop timer" });
    }
  });

  // 5) POST /api/production/jobs/:jobId/complete
  app.post("/api/production/jobs/:jobId/complete", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const jobId = req.params.jobId;
      const now = new Date();
      const skipProduction = req.body?.skipProduction === true;

      const result = await db.transaction(async (tx) => {
        const jobRows = await tx
          .select()
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        const job = jobRows[0];
        if (!job) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });
        if (job.status === "done") return job;

        // queued -> done requires explicit skipProduction
        if (job.status === "queued" && !skipProduction) {
          throw Object.assign(new Error("Cannot complete from queued without skipProduction"), { statusCode: 400 });
        }

        // If timer is running, stop it first.
        const lastTimer = await tx
          .select({ createdAt: productionEvents.createdAt, type: productionEvents.type })
          .from(productionEvents)
          .where(
            and(
              eq(productionEvents.organizationId, organizationId),
              eq(productionEvents.productionJobId, jobId),
              inArray(productionEvents.type, ["timer_started", "timer_stopped"]),
            ),
          )
          .orderBy(desc(productionEvents.createdAt))
          .limit(1);
        const last = lastTimer[0];
        if (last?.type === "timer_started") {
          const startedAtMs = new Date(last.createdAt as any).getTime();
          const deltaSeconds = toSeconds(now.getTime() - startedAtMs);
          await appendEvent({
            tx,
            organizationId,
            productionJobId: jobId,
            type: "timer_stopped",
            actorUserId: userId,
            payload: { seconds: deltaSeconds },
          });
          await tx
            .update(productionJobs)
            .set({ totalSeconds: (Number(job.totalSeconds) || 0) + deltaSeconds })
            .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));
        }

        await tx
          .update(productionJobs)
          .set({ status: "done", completedAt: now, updatedAt: now })
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));

        if (job.lineItemId && job.orderId) {
          await consumeReservedMaterialsForLineItem(tx, {
            organizationId,
            orderId: job.orderId,
            lineItemId: job.lineItemId,
            productionJobId: jobId,
            userId,
          });

          const [lineItem] = await tx
            .select({
              workflowState: orderLineItems.workflowState,
              status: orderLineItems.status,
            })
            .from(orderLineItems)
            .where(and(eq(orderLineItems.orderId, job.orderId), eq(orderLineItems.id, job.lineItemId)))
            .limit(1);

          if (lineItem && lineItem.workflowState !== "completed" && lineItem.workflowState !== "canceled") {
            const completingStationKey = String(job.stationKey ?? "").trim().toLowerCase();
            const isFulfillmentStation = completingStationKey === FULFILLMENT_STATION_KEY;
            const isPrepressStation = isPrepressOwnershipJob(job);
            const isDesignStation = isDesignOwnershipJob(job);

            if (isFulfillmentStation) {
              // Fulfillment done → complete the line item.
              await tx
                .update(orderLineItems)
                .set({ workflowState: "completed", status: "complete", updatedAt: now })
                .where(eq(orderLineItems.id, job.lineItemId));

              await appendEvent({
                tx,
                organizationId,
                productionJobId: jobId,
                type: "note",
                payload: {
                  eventType: "workflow_transition",
                  fromState: lineItem.workflowState,
                  toState: "completed",
                  lifecycleStatus: "complete",
                  ownerAction: "completed",
                  actorUserId: userId,
                  metadata: {
                    source: "fulfillment_job_complete",
                    skipProduction,
                    previousLifecycleStatus: lineItem.status,
                  },
                },
              });
            } else if (isPrepressStation || isDesignStation) {
              // Prepress/Design jobs have dedicated handoff routes (send-to-print,
              // design-complete). Completing the job record here does NOT advance the
              // line-item workflow — callers must use those routes instead.
              console.warn(
                `[ProductionJobComplete] Station "${completingStationKey}" job ${jobId} completed via job-complete endpoint. ` +
                `Line item workflow state unchanged (was: ${lineItem.workflowState}). ` +
                `Use /prepress/.../send-to-print or design-complete routes for workflow advancement.`,
              );
            } else {
              // Production station (Roll, Flatbed, CNC, Lamination, Fabrication, Finishing, etc.)
              // done → route line item to Fulfillment station for packing/shipping.
              // routeLineItemToProduction fails closed with a clear error if the
              // "fulfillment" station does not exist in this org's stations table.
              console.log(
                `[ProductionJobComplete] Station "${completingStationKey}" job ${jobId} complete — routing line item ${job.lineItemId} to Fulfillment.`,
              );
              try {
                await routeLineItemToProduction({
                  tx,
                  organizationId,
                  orderId: job.orderId,
                  lineItemId: job.lineItemId,
                  stationKey: FULFILLMENT_STATION_KEY,
                  stepKey: "fulfillment",
                  trigger: "line_item_status",
                  actorUserId: userId,
                  extraEventPayload: {
                    routingReason: "production_station_complete",
                    previousStationKey: completingStationKey,
                    previousJobId: jobId,
                  },
                });
              } catch (routeErr: any) {
                // Re-throw with enriched context so the caller sees exactly what to fix.
                throw Object.assign(
                  new Error(
                    `[ProductionJobComplete] Cannot route line item ${job.lineItemId} to Fulfillment after completing station "${completingStationKey}". ` +
                    (routeErr?.message ?? String(routeErr)) +
                    ` — ensure a station with key="${FULFILLMENT_STATION_KEY}" exists in Production Settings for this organisation.`,
                  ),
                  { statusCode: routeErr?.statusCode ?? 409, cause: routeErr },
                );
              }
            }
          }
        }

        await tx.insert(auditLogs).values({
          organizationId,
          userId: userId ?? null,
          userName: req.user?.email || req.user?.name || null,
          actionType: "UPDATE",
          entityType: "production_job",
          entityId: jobId,
          entityName: jobId,
          description: skipProduction ? "Production job completed (skip production)" : "Production job completed",
          oldValues: { status: job.status },
          newValues: { status: "done" },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        const updatedRows = await tx
          .select()
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        return updatedRows[0];
      });

      res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error completing production job:", error);
      res.status(status).json({ error: error?.message || "Failed to complete job" });
    }
  });

  // 6) POST /api/production/jobs/:jobId/reopen
  app.post("/api/production/jobs/:jobId/reopen", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const jobId = req.params.jobId;
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const jobRows = await tx
          .select()
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        const job = jobRows[0];
        if (!job) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });
        if (job.status !== "done") {
          throw Object.assign(new Error("Only done jobs can be reopened"), { statusCode: 400 });
        }

        await tx
          .update(productionJobs)
          .set({ status: "in_progress", completedAt: null, updatedAt: now })
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));

        await appendEvent({
          tx,
          organizationId,
          productionJobId: jobId,
          type: "note",
          actorUserId: userId ?? null,
          payload: { system: true, text: "Job reopened" },
        });

        await tx.insert(auditLogs).values({
          organizationId,
          userId: userId ?? null,
          userName: req.user?.email || req.user?.name || null,
          actionType: "UPDATE",
          entityType: "production_job",
          entityId: jobId,
          entityName: jobId,
          description: "Production job reopened",
          oldValues: { status: job.status },
          newValues: { status: "in_progress" },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        const updatedRows = await tx
          .select()
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        return updatedRows[0];
      });

      res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error reopening production job:", error);
      res.status(status).json({ error: error?.message || "Failed to reopen job" });
    }
  });

  // 7) POST /api/production/jobs/:jobId/reprint
  app.post("/api/production/jobs/:jobId/reprint", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      const jobId = req.params.jobId;

      await db.transaction(async (tx) => {
        const jobRows = await tx
          .select({ id: productionJobs.id })
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        if (!jobRows[0]) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });
        await appendEvent({
          tx,
          organizationId,
          productionJobId: jobId,
          type: "reprint_incremented",
          actorUserId: userId ?? null,
        });
        await tx
          .update(productionJobs)
          .set({ updatedAt: new Date() })
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));
      });

      res.json({ success: true, data: { success: true } });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error recording reprint:", error);
      res.status(status).json({ error: error?.message || "Failed to record reprint" });
    }
  });

  // PROMPT E: POST /api/production/line-item/:lineItemId/reprint
  // Creates a detailed reprint request record from the production board.
  app.post("/api/production/line-item/:lineItemId/reprint", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "User ID not found" });

      const { lineItemId } = req.params;

      const bodySchema = z.object({
        fileId: z.string().optional(),
        filename: z.string().trim().min(1, "Filename required").max(512),
        quantity: z.coerce.number().positive("Quantity must be greater than 0"),
        units: z.string().trim().min(1, "Units required").max(64),
        reason: z.string().trim().min(1, "Reason required").max(2000),
        noPrintsCompletedYet: z.boolean().optional().default(false),
      });
      const parsed = bodySchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });

      const { fileId, filename, quantity, units, reason, noPrintsCompletedYet } = parsed.data;

      // Verify line item belongs to this org
      const [lineItem] = await db
        .select({ id: orderLineItems.id, orderId: orderLineItems.orderId })
        .from(orderLineItems)
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .where(and(eq(orderLineItems.id, lineItemId), eq(orders.organizationId, organizationId)))
        .limit(1);
      if (!lineItem) return res.status(404).json({ error: "Line item not found" });

      // Insert reprint request
      const [reprintReq] = await db
        .insert(reprintRequests)
        .values({
          organizationId,
          lineItemId,
          fileId: fileId || null,
          filename,
          quantity: String(quantity),
          units,
          reason,
          noPrintsCompletedYet: noPrintsCompletedYet ?? false,
          createdByUserId: userId,
          status: 'open',
        })
        .returning({ id: reprintRequests.id });

      // Audit log
      await db.insert(auditLogs).values({
        organizationId,
        userId,
        userName: (req.user as any)?.email || (req.user as any)?.name || null,
        actionType: "CREATE",
        entityType: "reprint_request",
        entityId: reprintReq?.id || lineItemId,
        entityName: `Reprint – ${filename}`,
        description: "Reprint request created from production board",
        newValues: { filename, quantity, units, reason, noPrintsCompletedYet },
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
      } as any);

      res.json({ success: true, data: { id: reprintReq?.id } });
    } catch (error: any) {
      console.error("[Reprint Request] Error:", error);
      res.status(500).json({ error: error?.message || "Failed to create reprint request" });
    }
  });

  // 8) PUT /api/production/jobs/:jobId/media-used
  app.put("/api/production/jobs/:jobId/media-used", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);

      const jobId = req.params.jobId;
      const mediaSchema = z.object({
        text: z.string().trim().min(1).max(500),
        qty: z.coerce.number().optional(),
        unit: z.string().trim().max(32).optional(),
        comment: z.string().trim().min(1, "Reason is required").max(2000),
      });
      const parsed = mediaSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });

      await db.transaction(async (tx) => {
        const jobRows = await tx
          .select({ id: productionJobs.id })
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        if (!jobRows[0]) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });
        await appendEvent({
          tx,
          organizationId,
          productionJobId: jobId,
          type: "media_used_set",
          actorUserId: userId ?? null,
          payload: parsed.data,
        });
        await tx
          .update(productionJobs)
          .set({ updatedAt: new Date() })
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));
      });

      res.json({ success: true, data: { success: true } });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error setting media used:", error);
      res.status(status).json({ error: error?.message || "Failed to set media used" });
    }
  });

  // Extra (timeline): POST /api/production/jobs/:jobId/note
  app.post("/api/production/jobs/:jobId/note", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);

      const jobId = req.params.jobId;
      const noteSchema = z.object({ text: z.string().trim().min(1).max(1000) });
      const parsed = noteSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });

      await db.transaction(async (tx) => {
        const jobRows = await tx
          .select({ id: productionJobs.id })
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        if (!jobRows[0]) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });
        await appendEvent({
          tx,
          organizationId,
          productionJobId: jobId,
          type: "note",
          actorUserId: userId ?? null,
          payload: { text: parsed.data.text, actorUserId: userId ?? null },
        });
        await tx
          .update(productionJobs)
          .set({ updatedAt: new Date() })
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));
      });

      res.json({ success: true, data: { success: true } });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error adding production note:", error);
      res.status(status).json({ error: error?.message || "Failed to add note" });
    }
  });

  // PATCH /api/production/notes/:noteId - Edit production note
  app.patch("/api/production/notes/:noteId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const noteId = req.params.noteId;
      const noteSchema = z.object({ text: z.string().trim().min(1).max(1000) });
      const parsed = noteSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });

      await db.transaction(async (tx) => {
        const noteRows = await tx
          .select({
            id: productionEvents.id,
            type: productionEvents.type,
            productionJobId: productionEvents.productionJobId,
            payload: productionEvents.payload,
          })
          .from(productionEvents)
          .where(and(eq(productionEvents.organizationId, organizationId), eq(productionEvents.id, noteId)))
          .limit(1);

        const note = noteRows[0];
        if (!note) throw Object.assign(new Error("Note not found"), { statusCode: 404 });
        if (note.type !== "note") throw Object.assign(new Error("Event is not a note"), { statusCode: 400 });

        const updatedPayload = { ...(note.payload ?? {}), text: parsed.data.text, edited: true };
        await tx
          .update(productionEvents)
          .set({ payload: updatedPayload })
          .where(and(eq(productionEvents.organizationId, organizationId), eq(productionEvents.id, noteId)));

        await tx
          .update(productionJobs)
          .set({ updatedAt: new Date() })
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, note.productionJobId)));
      });

      res.json({ success: true, data: { success: true } });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error editing production note:", error);
      res.status(status).json({ error: error?.message || "Failed to edit note" });
    }
  });

  // DELETE /api/production/notes/:noteId - Delete production note (soft delete)
  app.delete("/api/production/notes/:noteId", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const noteId = req.params.noteId;

      await db.transaction(async (tx) => {
        const noteRows = await tx
          .select({
            id: productionEvents.id,
            type: productionEvents.type,
            productionJobId: productionEvents.productionJobId,
            payload: productionEvents.payload,
          })
          .from(productionEvents)
          .where(and(eq(productionEvents.organizationId, organizationId), eq(productionEvents.id, noteId)))
          .limit(1);

        const note = noteRows[0];
        if (!note) throw Object.assign(new Error("Note not found"), { statusCode: 404 });
        if (note.type !== "note") throw Object.assign(new Error("Event is not a note"), { statusCode: 400 });

        const updatedPayload = { ...(note.payload ?? {}), deleted: true };
        await tx
          .update(productionEvents)
          .set({ payload: updatedPayload })
          .where(and(eq(productionEvents.organizationId, organizationId), eq(productionEvents.id, noteId)));

        await tx
          .update(productionJobs)
          .set({ updatedAt: new Date() })
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, note.productionJobId)));
      });

      res.json({ success: true, data: { success: true } });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error deleting production note:", error);
      res.status(status).json({ error: error?.message || "Failed to delete note" });
    }
  });

  // 9) PATCH /api/production/jobs/:jobId/status - Inline status update (queued/in_progress/done)
  app.patch("/api/production/jobs/:jobId/status", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });
      const userId = getUserId(req.user);

      const jobId = req.params.jobId;
      const statusSchema = z.object({
        status: z.enum(["queued", "in_progress", "done"]),
        stepKey: z.string().nullable().optional(),
      });
      const parsed = statusSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: fromZodError(parsed.error).message });

      const newStatus = parsed.data.status;
      const newStepKey = parsed.data.stepKey !== undefined ? parsed.data.stepKey : undefined;
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const jobRows = await tx
          .select()
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        const job = jobRows[0];
        if (!job) throw Object.assign(new Error("Production job not found"), { statusCode: 404 });

        // IDEMPOTENCY: If status and stepKey unchanged, return success without DB writes
        const stepKeyUnchanged = newStepKey === undefined || job.stepKey === newStepKey;
        if (job.status === newStatus && stepKeyUnchanged) {
          if (process.env.NODE_ENV === "development") {
            console.log(`[Production] Status/stepKey update no-op (already ${newStatus}/${job.stepKey}):`, {
              organizationId,
              jobId,
              status: newStatus,
              stepKey: newStepKey
            });
          }
          return job;
        }

        // If setting to done, stop timer if running
        if (newStatus === "done") {
          const lastTimer = await tx
            .select({ createdAt: productionEvents.createdAt, type: productionEvents.type })
            .from(productionEvents)
            .where(
              and(
                eq(productionEvents.organizationId, organizationId),
                eq(productionEvents.productionJobId, jobId),
                inArray(productionEvents.type, ["timer_started", "timer_stopped"]),
              ),
            )
            .orderBy(desc(productionEvents.createdAt))
            .limit(1);
          const last = lastTimer[0];
          if (last?.type === "timer_started") {
            const startedAtMs = new Date(last.createdAt as any).getTime();
            const deltaSeconds = toSeconds(now.getTime() - startedAtMs);
            await appendEvent({
              tx,
              organizationId,
              productionJobId: jobId,
              type: "timer_stopped",
              payload: { seconds: deltaSeconds },
            });
            await tx
              .update(productionJobs)
              .set({ totalSeconds: (Number(job.totalSeconds) || 0) + deltaSeconds })
              .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));
          }
        }

        // Update status and stepKey
        const updateData: any = { status: newStatus, updatedAt: now };
        if (newStepKey !== undefined) {
          updateData.stepKey = newStepKey;
        }
        if (newStatus === "done") {
          updateData.completedAt = now;
        } else if ((job.status as string) === "done" && (newStatus as string) !== "done") {
          updateData.completedAt = null; // Reopening
        }
        if (newStatus === "in_progress" && !job.startedAt) {
          updateData.startedAt = now;
        }

        await tx
          .update(productionJobs)
          .set(updateData)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)));

        await appendEvent({
          tx,
          organizationId,
          productionJobId: jobId,
          type: "status_changed",
          payload: {
            previousStatus: job.status,
            newStatus,
            previousStepKey: job.stepKey,
            newStepKey: newStepKey === undefined ? job.stepKey : newStepKey,
            actorUserId: userId ?? null,
          },
        });

        if (newStatus === "done" && job.lineItemId && job.orderId) {
          const actorUserId = userId;
          if (!actorUserId) {
            throw new Error("Missing user id for inventory consumption");
          }
          await consumeReservedMaterialsForLineItem(tx, {
            organizationId,
            orderId: job.orderId,
            lineItemId: job.lineItemId,
            productionJobId: jobId,
            userId: actorUserId,
          });
        }

        await tx.insert(auditLogs).values({
          organizationId,
          userId: userId ?? null,
          userName: req.user?.email || req.user?.name || null,
          actionType: "UPDATE",
          entityType: "production_job",
          entityId: jobId,
          entityName: jobId,
          description: `Production job status changed to ${newStatus}`,
          oldValues: { status: job.status },
          newValues: { status: newStatus },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        } as any);

        const updatedRows = await tx
          .select()
          .from(productionJobs)
          .where(and(eq(productionJobs.organizationId, organizationId), eq(productionJobs.id, jobId)))
          .limit(1);
        return updatedRows[0];
      });

      res.json({ success: true, data: result });
    } catch (error: any) {
      const status = error?.statusCode || 500;
      console.error("Error updating production job status:", error);
      res.status(status).json({ error: error?.message || "Failed to update status" });
    }
  });
}
