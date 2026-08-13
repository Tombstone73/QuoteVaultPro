/**
 * timeline.routes.ts
 *
 * Unified Timeline and Audit Logs routes extracted from server/routes.ts.
 *
 * Routes:
 *   GET /api/timeline
 *   GET /api/audit-logs
 *
 * Placement: server/routes/timeline.routes.ts
 * Registered by: server/routes.ts via registerTimelineRoutes
 */

import type { Express } from "express";
import { eq, and, desc, inArray, or } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";
import {
  quotes,
  orders,
  auditLogs,
  orderAuditLog,
  quoteWorkflowStates,
  shipments,
  invoices,
  payments,
  jobs,
  jobStatusLog,
  jobStatuses,
  productionEvents,
  productionJobs,
  users,
} from "@shared/schema";

export function registerTimelineRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isOwner: any;
  },
): void {
  const { isAuthenticated, tenantContext, isOwner } = middleware;

  // ---------------------------------------------------------------------------
  // Unified Timeline API (read-only)
  // ---------------------------------------------------------------------------
  app.get("/api/timeline", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const quoteId = (req.query.quoteId as string | undefined) || undefined;
      const orderId = (req.query.orderId as string | undefined) || undefined;
      const invoiceId = (req.query.invoiceId as string | undefined) || undefined;

      if (!quoteId && !orderId && !invoiceId) {
        return res.status(400).json({ message: "Provide quoteId, orderId, and/or invoiceId" });
      }

      const rawLimit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

      type TimelineDto = {
        id: string;
        occurredAt: string;
        actorName: string | null;
        actorUserId: string | null;
        entityType: string;
        eventType: string;
        message: string;
        metadata: any;
      };

      const toIso = (value: any): string => {
        if (!value) return new Date(0).toISOString();
        try {
          if (value instanceof Date) return value.toISOString();
          const d = new Date(String(value));
          return Number.isFinite(d.getTime()) ? d.toISOString() : new Date(0).toISOString();
        } catch {
          return new Date(0).toISOString();
        }
      };

      const quoteIds = new Set<string>();
      const orderIds = new Set<string>();
      const invoiceIds = new Set<string>();

      // Validate and expand quote/order context
      if (quoteId) {
        const q = await db
          .select()
          .from(quotes)
          .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
          .limit(1)
          .then((rows) => rows[0]);
        if (!q) return res.status(404).json({ message: "Quote not found" });
        quoteIds.add(q.id);

        const convertedToOrderId = (q as any)?.convertedToOrderId as string | null | undefined;
        if (convertedToOrderId) {
          const o = await db
            .select({ id: orders.id })
            .from(orders)
            .where(and(eq(orders.id, convertedToOrderId), eq(orders.organizationId, organizationId)))
            .limit(1)
            .then((rows) => rows[0]);
          if (o?.id) orderIds.add(o.id);
        }

        // Fallback: some systems link order via orders.quoteId
        const linkedOrders = await db
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.quoteId, q.id), eq(orders.organizationId, organizationId)));
        for (const o of linkedOrders) orderIds.add(o.id);
      }

      if (orderId) {
        const o = await db
          .select()
          .from(orders)
          .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
          .limit(1)
          .then((rows) => rows[0]);
        if (!o) return res.status(404).json({ message: "Order not found" });
        orderIds.add(o.id);
        if (o.quoteId) quoteIds.add(o.quoteId);
      }

      if (invoiceId) {
        const invoice = await db
          .select({ id: invoices.id, orderId: invoices.orderId })
          .from(invoices)
          .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId)))
          .limit(1)
          .then((rows) => rows[0]);
        if (!invoice) return res.status(404).json({ message: "Invoice not found" });
        invoiceIds.add(invoice.id);
        if (invoice.orderId) orderIds.add(invoice.orderId);
      }

      // Helper: best-effort user name lookup (fail-soft)
      const userNameCache = new Map<string, string>();
      const getActorName = async (userId: string | null | undefined, fallback?: string | null) => {
        if (fallback && String(fallback).trim() !== "") return String(fallback);
        if (!userId) return null;
        const cached = userNameCache.get(userId);
        if (cached) return cached;
        try {
          const u = await db
            .select({ firstName: users.firstName, lastName: users.lastName, email: users.email })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1)
            .then((rows) => rows[0]);
          const name = u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || null : null;
          if (name) userNameCache.set(userId, name);
          return name;
        } catch {
          return null;
        }
      };

      const events: TimelineDto[] = [];

      const getProductionEventLabel = (type: string, payload: any, row: any) => {
        const stationKey = String(payload?.newStation ?? payload?.to?.stationKey ?? payload?.stationKey ?? row.jobStationKey ?? "").trim();
        const previousStation = String(payload?.previousStation ?? payload?.from?.stationKey ?? payload?.previousStationKey ?? "").trim();
        const eventType = String(payload?.eventType || "").trim();

        switch (type) {
          case 'status_changed': {
            const previousStatus = payload?.previousStatus ?? null;
            const nextStatus = payload?.newStatus ?? null;
            if (previousStatus && nextStatus) return `Production status changed: ${previousStatus} → ${nextStatus}`;
            if (nextStatus) return `Production status changed to ${nextStatus}`;
            return 'Production status changed';
          }
          case 'timer_started':
            return 'Production timer started';
          case 'timer_stopped':
            return payload?.seconds ? `Production timer stopped (${payload.seconds}s)` : 'Production timer stopped';
          case 'routing_override':
            if (previousStation || stationKey) {
              return `Production routing updated: ${previousStation || 'unknown'} → ${stationKey || 'unknown'}`;
            }
            return 'Production routing updated';
          case 'intake':
            return stationKey ? `Production routed to ${stationKey}` : 'Production job created';
          case 'reprint_incremented':
            return 'Reprint count incremented';
          case 'media_used_set':
            return 'Production media usage updated';
          case 'note':
            switch (eventType) {
              case 'workflow_transition': {
                const previousStatus = payload?.fromState ?? payload?.previousStatus ?? null;
                const nextStatus = payload?.toState ?? payload?.newStatus ?? null;
                if (previousStatus && nextStatus) return `Workflow transitioned: ${previousStatus} → ${nextStatus}`;
                return 'Workflow transitioned';
              }
              case 'workflow_reconciled':
                return 'Workflow reconciled';
              case 'materials_reserved':
                return 'Materials reserved for production';
              case 'materials_consumed':
                return 'Materials consumed in production';
              default:
                return String(payload?.message || payload?.note || 'Production note');
            }
          default:
            return type.replace(/_/g, ' ');
        }
      };

      // 1) Quote audit log via audit_logs
      try {
        const qIds = Array.from(quoteIds);
        const oIds = Array.from(orderIds);
        const auditEntityConds: any[] = [];
        if (qIds.length) {
          auditEntityConds.push(and(eq(auditLogs.entityType, 'quote'), inArray(auditLogs.entityId, qIds)));
        }
        if (oIds.length) {
          auditEntityConds.push(and(eq(auditLogs.entityType, 'order'), inArray(auditLogs.entityId, oIds)));
        }
        const iIds = Array.from(invoiceIds);
        if (iIds.length) {
          auditEntityConds.push(and(eq(auditLogs.entityType, 'invoice'), inArray(auditLogs.entityId, iIds)));
        }

        const audit: any[] = auditEntityConds.length
          ? await db
            .select()
            .from(auditLogs)
            .where(and(eq(auditLogs.organizationId, organizationId), or(...auditEntityConds)))
            .orderBy(desc(auditLogs.createdAt))
            .limit(Math.min(limit * 3, 300))
          : [];

        for (const row of audit) {
          events.push({
            id: `audit:${row.id}`,
            occurredAt: toIso(row.createdAt),
            actorName: row.userName || null,
            actorUserId: row.userId || null,
            entityType: row.entityType,
            eventType: row.actionType,
            message: row.description,
            metadata: {
              entityId: row.entityId,
              entityName: row.entityName,
              oldValues: row.oldValues,
              newValues: row.newValues,
            },
          });
        }
      } catch (err) {
        console.warn('[Timeline] auditLogs unavailable:', err);
      }

      // 2) Order audit log table (order_audit_log)
      try {
        const oIds = Array.from(orderIds);
        if (oIds.length) {
          const oAudit = await db
            .select()
            .from(orderAuditLog)
            .where(inArray(orderAuditLog.orderId, oIds))
            .orderBy(desc(orderAuditLog.createdAt))
            .limit(Math.min(limit * 3, 300));

          for (const row of oAudit) {
            // Generate human-readable message based on actionType and metadata
            let message = row.note || '';

            if (!message) {
              const meta = row.metadata as any || {};

              switch (row.actionType) {
                case 'status_change':
                case 'status_transition':
                case 'status_pill_changed':
                  if (row.fromStatus && row.toStatus) {
                    message = `Status changed: ${row.fromStatus} → ${row.toStatus}`;
                  } else if (row.toStatus) {
                    message = `Status changed to ${row.toStatus}`;
                  } else {
                    message = 'Status updated';
                  }
                  break;

                case 'priority_change':
                  if (meta.oldValue && meta.newValue) {
                    message = `Priority changed: ${meta.oldValue} → ${meta.newValue}`;
                  } else if (meta.newValue) {
                    message = `Priority set to ${meta.newValue}`;
                  } else {
                    message = 'Priority updated';
                  }
                  break;

                case 'due_date_change':
                  if (meta.oldValue && meta.newValue) {
                    message = `Due date changed: ${meta.oldValue} → ${meta.newValue}`;
                  } else if (meta.newValue) {
                    message = `Due date set to ${meta.newValue}`;
                  } else {
                    message = 'Due date updated';
                  }
                  break;

                case 'promised_date_change':
                  if (meta.oldValue && meta.newValue) {
                    message = `Promised date changed: ${meta.oldValue} → ${meta.newValue}`;
                  } else if (meta.newValue) {
                    message = `Promised date set to ${meta.newValue}`;
                  } else {
                    message = 'Promised date updated';
                  }
                  break;

                case 'label_change':
                case 'job_label_change':
                  if (meta.oldValue && meta.newValue) {
                    message = `Job label changed: "${meta.oldValue}" → "${meta.newValue}"`;
                  } else if (meta.newValue) {
                    message = `Job label set to "${meta.newValue}"`;
                  } else {
                    message = 'Job label updated';
                  }
                  break;

                case 'po_number_change':
                  if (meta.oldValue && meta.newValue) {
                    message = `PO # changed: ${meta.oldValue} → ${meta.newValue}`;
                  } else if (meta.newValue) {
                    message = `PO # set to ${meta.newValue}`;
                  } else {
                    message = 'PO # updated';
                  }
                  break;

                case 'line_item_status_change':
                  if (meta.lineItemId && meta.oldStatus && meta.newStatus) {
                    message = `Line item status changed: ${meta.oldStatus} → ${meta.newStatus}`;
                  } else {
                    message = 'Line item status updated';
                  }
                  break;

                case 'line_items_auto_marked_done':
                  if (meta.count) {
                    message = `Auto-marked ${meta.count} line item(s) as Done`;
                  } else {
                    message = 'Auto-marked line items as Done';
                  }
                  break;

                case 'file_uploaded':
                case 'attachment_uploaded':
                  if (meta.fileName) {
                    message = `Attachment uploaded: ${meta.fileName}`;
                  } else {
                    message = 'Attachment uploaded';
                  }
                  break;

                case 'converted_by_customer':
                  message = 'Order created from customer approval';
                  break;

                case 'order_created_from_inbound':
                case 'inbound_order_converted': {
                  const sourceReference = meta.sourceReference ?? meta.inboundReference;
                  message = sourceReference
                    ? `Order created from inbound draft (${sourceReference})`
                    : 'Order created from inbound draft';
                  break;
                }

                case 'note_added':
                  message = 'Note added';
                  break;

                case 'proof_draft_created':
                  message = 'Proof draft created';
                  break;

                case 'proof_file_uploaded':
                  message = 'Proof file uploaded';
                  break;

                case 'proof_file_generated':
                  message = 'Proof file generated';
                  break;

                case 'proof_sent':
                  message = 'Proof sent for review';
                  break;

                case 'proof_resent':
                  message = 'Proof resent for review';
                  break;

                case 'proof_approved':
                  message = 'Proof approved';
                  break;

                case 'proof_rejected':
                  message = 'Proof rejected';
                  break;

                case 'proof_revision_requested':
                  message = 'Proof revision requested';
                  break;

                case 'proof_superseded':
                  message = 'Proof superseded';
                  break;

                case 'design_started':
                  message = 'Design started';
                  break;

                case 'design_paused':
                  message = 'Design paused';
                  break;

                case 'design_resumed':
                  message = 'Design resumed';
                  break;

                case 'design_completed':
                  message = 'Design completed';
                  break;

                case 'design_sent_to_proofing':
                  message = 'Design sent to proofing';
                  break;

                case 'prepress_started':
                  message = 'Prepress started';
                  break;

                case 'prepress_completed':
                  message = 'Prepress completed';
                  break;

                case 'prepress_sent_back_for_correction':
                  message = 'Sent back to prepress for correction';
                  break;

                case 'prepress_routed':
                  message = 'Prepress routed to next station';
                  break;

                case 'prepress_file_prepared':
                  message = 'Prepress prepared final file';
                  break;

                default:
                  // Fallback: use status transition if available, else actionType
                  if (row.fromStatus || row.toStatus) {
                    message = `${row.fromStatus || ''} → ${row.toStatus || ''}`.trim();
                  } else {
                    message = row.actionType.replace(/_/g, ' ');
                  }
              }
            }

            events.push({
              id: `order_audit:${row.id}`,
              occurredAt: toIso(row.createdAt),
              actorName: row.userName || (await getActorName(row.userId ?? null, null)),
              actorUserId: row.userId || null,
              entityType: 'order',
              eventType: row.actionType,
              message,
              metadata: {
                orderId: row.orderId,
                orderLineItemId: (row as any).orderLineItemId ?? null,
                fromStatus: row.fromStatus,
                toStatus: row.toStatus,
                metadata: row.metadata,
                structuredEvent: (row.metadata as any)?.structuredEvent ?? null,
              },
            });
          }
        }
      } catch (err) {
        console.warn('[Timeline] orderAuditLog unavailable:', err);
      }

      // 3) Production events (routing, timers, materials, direct status changes)
      try {
        const oIds = Array.from(orderIds);
        if (oIds.length) {
          const prod = await db
            .select({
              id: productionEvents.id,
              type: productionEvents.type,
              payload: productionEvents.payload,
              createdAt: productionEvents.createdAt,
              eventOrderId: productionEvents.orderId,
              eventOrderLineItemId: productionEvents.orderLineItemId,
              eventActorUserId: productionEvents.actorUserId,
              productionJobId: productionEvents.productionJobId,
              jobOrderId: productionJobs.orderId,
              jobLineItemId: productionJobs.lineItemId,
              jobStationKey: productionJobs.stationKey,
              jobStepKey: productionJobs.stepKey,
            })
            .from(productionEvents)
            .innerJoin(productionJobs, eq(productionJobs.id, productionEvents.productionJobId))
            .where(
              and(
                eq(productionEvents.organizationId, organizationId),
                inArray(productionJobs.orderId, oIds),
              ),
            )
            .orderBy(desc(productionEvents.createdAt))
            .limit(Math.min(limit * 4, 400));

          for (const row of prod) {
            const payload = (row.payload as any) || {};
            const actorUserId = row.eventActorUserId || payload.actorUserId || null;
            const resolvedOrderId = row.eventOrderId || row.jobOrderId || payload.orderId || null;
            const resolvedOrderLineItemId =
              row.eventOrderLineItemId || row.jobLineItemId || payload.orderLineItemId || payload.lineItemId || null;
            const eventType = row.type === 'note' ? String(payload.eventType || row.type) : row.type;

            events.push({
              id: `production_event:${row.id}`,
              occurredAt: toIso(row.createdAt),
              actorName: await getActorName(actorUserId, null),
              actorUserId,
              entityType: 'production',
              eventType,
              message: getProductionEventLabel(row.type, payload, row),
              metadata: {
                productionJobId: row.productionJobId,
                orderId: resolvedOrderId,
                orderLineItemId: resolvedOrderLineItemId,
                actorUserId,
                station: row.jobStationKey,
                step: row.jobStepKey,
                previousStatus: payload.previousStatus ?? payload.fromState ?? payload.oldStatus ?? null,
                newStatus: payload.newStatus ?? payload.toState ?? payload.status ?? null,
                previousStation: payload.previousStation ?? payload.from?.stationKey ?? payload.previousStationKey ?? null,
                newStation: payload.newStation ?? payload.to?.stationKey ?? payload.stationKey ?? row.jobStationKey ?? null,
                waitType: payload.waitType ?? null,
                payload,
              },
            });
          }
        }
      } catch (err) {
        console.warn('[Timeline] productionEvents unavailable:', err);
      }

      // 4) Quote workflow state (if present) - current state as an event (best effort)
      try {
        const qIds = Array.from(quoteIds);
        if (qIds.length) {
          const states = await db
            .select()
            .from(quoteWorkflowStates)
            .where(inArray(quoteWorkflowStates.quoteId, qIds));

          for (const row of states) {
            let actorUserId: string | null = null;
            if (row.status === 'staff_approved') actorUserId = row.approvedByStaffUserId ?? null;
            if (row.status === 'customer_approved') actorUserId = row.approvedByCustomerUserId ?? null;
            if (row.status === 'rejected') actorUserId = row.rejectedByUserId ?? null;

            events.push({
              id: `quote_workflow:${row.id}`,
              occurredAt: toIso(row.updatedAt),
              actorName: await getActorName(actorUserId, null),
              actorUserId,
              entityType: 'quote',
              eventType: 'workflow_status',
              message: `Quote workflow status: ${row.status}`,
              metadata: {
                quoteId: row.quoteId,
                status: row.status,
                staffNotes: row.staffNotes,
                customerNotes: row.customerNotes,
                rejectionReason: row.rejectionReason,
              },
            });
          }
        }
      } catch (err) {
        console.warn('[Timeline] quoteWorkflowStates unavailable:', err);
      }

      // 5) Shipments (shipped/delivered)
      try {
        const oIds = Array.from(orderIds);
        if (oIds.length) {
          const rows = await db
            .select()
            .from(shipments)
            .where(inArray(shipments.orderId, oIds))
            .orderBy(desc(shipments.createdAt))
            .limit(Math.min(limit * 2, 200));

          for (const s of rows) {
            const actorName = await getActorName(s.createdByUserId, null);
            const tracking = s.trackingNumber ? ` (${s.trackingNumber})` : '';

            events.push({
              id: `shipment_shipped:${s.id}`,
              occurredAt: toIso(s.shippedAt),
              actorName,
              actorUserId: s.createdByUserId,
              entityType: 'shipment',
              eventType: 'shipped',
              message: `Shipped via ${s.carrier}${tracking}`,
              metadata: { shipmentId: s.id, orderId: s.orderId, carrier: s.carrier, trackingNumber: s.trackingNumber },
            });

            if (s.deliveredAt) {
              events.push({
                id: `shipment_delivered:${s.id}`,
                occurredAt: toIso(s.deliveredAt),
                actorName,
                actorUserId: s.createdByUserId,
                entityType: 'shipment',
                eventType: 'delivered',
                message: `Delivered via ${s.carrier}${tracking}`,
                metadata: { shipmentId: s.id, orderId: s.orderId, carrier: s.carrier, trackingNumber: s.trackingNumber },
              });
            }
          }
        }
      } catch (err) {
        console.warn('[Timeline] shipments unavailable:', err);
      }

      // 6) Invoices + payments
      const invoiceIdToNumber = new Map<string, number>();
      try {
        const oIds = Array.from(orderIds);
        const directInvoiceIds = Array.from(invoiceIds);
        if (oIds.length || directInvoiceIds.length) {
          const invoiceConditions: any[] = [];
          if (oIds.length) invoiceConditions.push(inArray(invoices.orderId, oIds));
          if (directInvoiceIds.length) invoiceConditions.push(inArray(invoices.id, directInvoiceIds));
          const inv = await db
            .select()
            .from(invoices)
            .where(and(eq(invoices.organizationId, organizationId), or(...invoiceConditions)))
            .orderBy(desc(invoices.createdAt))
            .limit(Math.min(limit * 2, 200));

          for (const i of inv) {
            invoiceIdToNumber.set(i.id, i.invoiceNumber);
            events.push({
              id: `invoice:${i.id}`,
              occurredAt: toIso(i.createdAt),
              actorName: await getActorName(i.createdByUserId, null),
              actorUserId: i.createdByUserId,
              entityType: 'invoice',
              eventType: 'created',
              message: `Invoice #${i.invoiceNumber} created (${i.status})`,
              metadata: { invoiceId: i.id, invoiceNumber: i.invoiceNumber, orderId: i.orderId, status: i.status, total: i.total },
            });
          }

          const invoiceIds = inv.map((x) => x.id);
          if (invoiceIds.length) {
            const pay = await db
              .select()
              .from(payments)
              .where(and(eq(payments.organizationId, organizationId), inArray(payments.invoiceId, invoiceIds)))
              .orderBy(desc(payments.appliedAt))
              .limit(Math.min(limit * 3, 300));

            for (const p of pay) {
              const invoiceNumber = invoiceIdToNumber.get(p.invoiceId);
              const invoiceLabel = invoiceNumber != null ? `Invoice #${invoiceNumber}` : `Invoice ${p.invoiceId}`;
              events.push({
                id: `payment:${p.id}`,
                occurredAt: toIso(p.appliedAt),
                actorName: await getActorName(p.createdByUserId, null),
                actorUserId: p.createdByUserId,
                entityType: 'payment',
                eventType: 'applied',
                message: `Payment $${Number(p.amount).toFixed(2)} (${p.method}) applied to ${invoiceLabel}`,
                metadata: { paymentId: p.id, invoiceId: p.invoiceId, amount: p.amount, method: p.method, notes: p.notes },
              });
            }
          }
        }
      } catch (err) {
        console.warn('[Timeline] invoices/payments unavailable:', err);
      }

      // 7) Job status log (production)
      try {
        const oIds = Array.from(orderIds);
        if (oIds.length) {
          const js = await db
            .select({
              jobId: jobs.id,
              statusKey: jobs.statusKey,
              logId: jobStatusLog.id,
              oldStatusKey: jobStatusLog.oldStatusKey,
              newStatusKey: jobStatusLog.newStatusKey,
              userId: jobStatusLog.userId,
              createdAt: jobStatusLog.createdAt,
            })
            .from(jobStatusLog)
            .innerJoin(jobs, eq(jobs.id, jobStatusLog.jobId))
            .where(inArray(jobs.orderId, oIds as any))
            .orderBy(desc(jobStatusLog.createdAt))
            .limit(Math.min(limit * 3, 300));

          const uniqueKeys = Array.from(new Set(js.map((x) => x.newStatusKey).filter(Boolean)));
          const keyToLabel = new Map<string, string>();
          try {
            if (uniqueKeys.length) {
              const labels = await db
                .select({ key: jobStatuses.key, label: jobStatuses.label })
                .from(jobStatuses)
                .where(and(eq(jobStatuses.organizationId, organizationId), inArray(jobStatuses.key, uniqueKeys)));
              for (const l of labels) keyToLabel.set(l.key, l.label);
            }
          } catch {
            // ignore label lookup failures
          }

          for (const row of js) {
            const label = keyToLabel.get(row.newStatusKey) || row.newStatusKey;
            const oldLabel = row.oldStatusKey ? (keyToLabel.get(row.oldStatusKey) || row.oldStatusKey) : null;
            const msg = oldLabel ? `Job status: ${oldLabel} → ${label}` : `Job status: ${label}`;
            events.push({
              id: `job_status:${row.logId}`,
              occurredAt: toIso(row.createdAt),
              actorName: await getActorName(row.userId ?? null, null),
              actorUserId: row.userId || null,
              entityType: 'job',
              eventType: 'status_change',
              message: msg,
              metadata: {
                jobId: row.jobId,
                oldStatusKey: row.oldStatusKey,
                newStatusKey: row.newStatusKey,
              },
            });
          }
        }
      } catch (err) {
        console.warn('[Timeline] jobStatusLog unavailable:', err);
      }

      // Sort DESC and apply limit
      events.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
      const sliced = events.slice(0, limit);

      return res.json({ success: true, data: sliced });
    } catch (error) {
      console.error('[Timeline] Error:', error);
      return res.status(500).json({ message: 'Failed to fetch timeline' });
    }
  });

  // ---------------------------------------------------------------------------
  // Audit Logs routes (owner only)
  // ---------------------------------------------------------------------------
  app.get("/api/audit-logs", isAuthenticated, tenantContext, isOwner, async (req, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const filters: any = {};

      if (req.query.userId) filters.userId = req.query.userId as string;
      if (req.query.actionType) filters.actionType = req.query.actionType as string;
      if (req.query.entityType) filters.entityType = req.query.entityType as string;
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);
      if (req.query.limit) filters.limit = parseInt(req.query.limit as string, 10);

      const logs = await storage.getAuditLogs(organizationId, filters);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      res.status(500).json({ message: "Failed to fetch audit logs" });
    }
  });
}
