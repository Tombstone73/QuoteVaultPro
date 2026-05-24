/**
 * orgResetService.ts
 *
 * Two surgical, permanent reset actions scoped strictly to one organizationId.
 *
 * Action 1 — resetTransactionalData
 *   Deletes operational/transactional records.
 *   Preserves: org record, users/auth, company settings, products, product options,
 *              PBV2 trees, pricing formulas, materials, inventory catalog, email OAuth,
 *              QB OAuth, core app configuration.
 *
 * Action 2 — resetQuickBooksImportData
 *   Undoes a QB import without wiping the rest of the tenant.
 *   Preserves: org, users, products, materials, QB OAuth (unless explicitly
 *              requested), and manually-created customers/contacts.
 *
 * Both actions run inside a single DB transaction so partial deletes are
 * impossible. Child rows are deleted before parent rows to satisfy FK constraints.
 */

import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import {
  accountingSyncJobs,
  auditLogs,
  customerContacts,
  customerCreditTransactions,
  customerNotes,
  customerProductionFolderReferences,
  customerVisibleProducts,
  customers,
  fulfillmentEvents,
  importJobRows,
  importJobs,
  inboundOrderDecisionFlags,
  inboundOrderEvents,
  inboundOrderFiles,
  inboundOrderLineItems,
  inboundOrderRecords,
  inboundOrderReviewSnapshots,
  inboundOrderSources,
  inboundOrderWarnings,
  inventoryReservations,
  invoiceEmailLogs,
  invoiceLineItems,
  invoiceReminderLogs,
  invoiceReminderSettings,
  invoices,
  jobFiles,
  jobNotes,
  jobStatusLog,
  jobStatuses,
  jobs,
  lineItemDesignBriefs,
  lineItemDesignCostSummaries,
  lineItemFiles,
  lineItemProofApprovals,
  lineItemProofManualApprovalOverrides,
  lineItemProofVersions,
  oauthConnections,
  orderAttachments,
  orderAuditLog,
  orderInternalNotes,
  orderLineItemComponents,
  orderLineItemNotes,
  orderLineItems,
  orderListNotes,
  orderMaterialUsage,
  orderStatusEvents,
  orderStatusPills,
  orderWorkflowStatuses,
  orderWorkflowTransitions,
  orderWorkflowVersions,
  orders,
  outboundNotifications,
  payments,
  paymentWebhookEvents,
  pickupTickets,
  portalFollowUpItems,
  prepressSessions,
  productionEvents,
  productionJobs,
  proofAccessTokens,
  quoteAttachmentPages,
  quoteAttachments,
  quoteLineItems,
  quoteListNotes,
  quoteWorkflowStates,
  quotes,
  reprintRequests,
  shipmentItems,
  shipmentOrders,
  shipments,
} from '../../shared/schema';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Drizzle does not guard empty IN lists — skip the delete if ids is empty. */
async function deleteWhereIn(
  tx: any,
  table: any,
  idColumn: any,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await tx.delete(table).where(inArray(idColumn, ids));
  return Number((result as any).rowCount ?? (result as any).count ?? 0);
}

/** Collect IDs from an org-scoped parent table. */
async function orgIds(tx: any, table: any, idCol: any, orgCol: any, orgId: string): Promise<string[]> {
  const rows = await tx.select({ id: idCol }).from(table).where(eq(orgCol, orgId));
  return rows.map((r: any) => r.id);
}

// ---------------------------------------------------------------------------
// Action 1: Reset Transactional Data
// ---------------------------------------------------------------------------

export type TransactionalResetResult = {
  success: true;
  data: {
    deletedCounts: Record<string, number>;
    warnings: string[];
    preservedCategories: string[];
  };
};

export async function resetTransactionalData(
  organizationId: string,
  userId: string,
): Promise<TransactionalResetResult> {
  const counts: Record<string, number> = {};
  const warnings: string[] = [];

  const del = async (tx: any, label: string, table: any, condition: any) => {
    const result = await tx.delete(table).where(condition);
    const n = Number((result as any).rowCount ?? (result as any).count ?? 0);
    counts[label] = (counts[label] ?? 0) + n;
    return n;
  };

  const orgEq = (col: any) => eq(col, organizationId);

  await db.transaction(async (tx) => {
    // ── Step 1: Proof / line-item file chains ──────────────────────────────
    // lineItemProofVersions has organizationId; delete its children first.
    const proofVersionIds = (
      await tx
        .select({ id: lineItemProofVersions.id })
        .from(lineItemProofVersions)
        .innerJoin(orderLineItems, eq(lineItemProofVersions.lineItemId, orderLineItems.id))
        .innerJoin(orders, eq(orderLineItems.orderId, orders.id))
        .where(orgEq(orders.organizationId))
    ).map((r: any) => r.id);

    await deleteWhereIn(tx, lineItemProofApprovals, lineItemProofApprovals.proofVersionId, proofVersionIds);
    counts['lineItemProofApprovals'] = counts['lineItemProofApprovals'] ?? 0;
    await deleteWhereIn(tx, lineItemProofManualApprovalOverrides, lineItemProofManualApprovalOverrides.proofVersionId, proofVersionIds);
    counts['lineItemProofManualApprovalOverrides'] = counts['lineItemProofManualApprovalOverrides'] ?? 0;
    await deleteWhereIn(tx, proofAccessTokens, proofAccessTokens.proofVersionId, proofVersionIds);
    counts['proofAccessTokens'] = counts['proofAccessTokens'] ?? 0;

    await del(tx, 'lineItemProofVersions', lineItemProofVersions, orgEq(lineItemProofVersions.organizationId));
    await del(tx, 'prepressSessions', prepressSessions, orgEq(prepressSessions.organizationId));

    // ── Step 2: Line-item design and file children ─────────────────────────
    // lineItemFiles, lineItemDesignCostSummaries, orderLineItemNotes all have lineItemId.
    // lineItemDesignBriefs uses orderLineItemId.
    // orderLineItemComponents uses orderLineItemId.
    // All also have organizationId — delete directly by org for simplicity.
    await del(tx, 'lineItemFiles', lineItemFiles, orgEq(lineItemFiles.organizationId));
    await del(tx, 'lineItemDesignBriefs', lineItemDesignBriefs, orgEq(lineItemDesignBriefs.organizationId));
    await del(tx, 'lineItemDesignCostSummaries', lineItemDesignCostSummaries, orgEq(lineItemDesignCostSummaries.organizationId));
    await del(tx, 'orderLineItemNotes', orderLineItemNotes, orgEq(orderLineItemNotes.organizationId));
    await del(tx, 'orderLineItemComponents', orderLineItemComponents, orgEq(orderLineItemComponents.organizationId));

    // ── Step 3: Payment webhook events (org-scoped, no FK to payments) ─────
    await del(tx, 'paymentWebhookEvents', paymentWebhookEvents, orgEq(paymentWebhookEvents.organizationId));

    // ── Step 4: Invoice children (before invoices, before customers) ────────
    await del(tx, 'invoiceEmailLogs', invoiceEmailLogs, orgEq(invoiceEmailLogs.organizationId));
    await del(tx, 'invoiceReminderLogs', invoiceReminderLogs, orgEq(invoiceReminderLogs.organizationId));
    await del(tx, 'invoiceReminderSettings', invoiceReminderSettings, orgEq(invoiceReminderSettings.organizationId));

    // Delete payments then invoices (invoiceLineItems cascade from invoices)
    await del(tx, 'payments', payments, orgEq(payments.organizationId));
    await del(tx, 'invoices', invoices, orgEq(invoices.organizationId));
    // invoiceLineItems cascade-deleted by the DB on invoices delete

    // ── Step 5: Job children ───────────────────────────────────────────────
    // jobStatuses has organizationId; jobFiles, jobNotes, jobStatusLog have jobId.
    await del(tx, 'jobStatuses', jobStatuses, orgEq(jobStatuses.organizationId));

    const jobIds = (
      await tx.select({ id: jobs.id }).from(jobs).where(orgEq(jobs.organizationId))
    ).map((r: any) => r.id);

    await deleteWhereIn(tx, jobFiles, jobFiles.jobId, jobIds);
    counts['jobFiles'] = counts['jobFiles'] ?? 0;
    await deleteWhereIn(tx, jobNotes, jobNotes.jobId, jobIds);
    counts['jobNotes'] = counts['jobNotes'] ?? 0;
    await deleteWhereIn(tx, jobStatusLog, jobStatusLog.jobId, jobIds);
    counts['jobStatusLog'] = counts['jobStatusLog'] ?? 0;
    await del(tx, 'jobs', jobs, orgEq(jobs.organizationId));

    // ── Step 6: Order children (before orders) ─────────────────────────────
    // Some order-child tables lack organizationId — delete by orderId IN (orderIds).
    const orderIds = (
      await tx.select({ id: orders.id }).from(orders).where(orgEq(orders.organizationId))
    ).map((r: any) => r.id);

    await deleteWhereIn(tx, orderMaterialUsage, orderMaterialUsage.orderId, orderIds);
    counts['orderMaterialUsage'] = counts['orderMaterialUsage'] ?? 0;
    await deleteWhereIn(tx, orderAttachments, orderAttachments.orderId, orderIds);
    counts['orderAttachments'] = counts['orderAttachments'] ?? 0;
    await deleteWhereIn(tx, orderAuditLog, orderAuditLog.orderId, orderIds);
    counts['orderAuditLog'] = counts['orderAuditLog'] ?? 0;

    // These tables do have organizationId — delete directly.
    await del(tx, 'inventoryReservations', inventoryReservations, orgEq(inventoryReservations.organizationId));
    await del(tx, 'orderInternalNotes', orderInternalNotes, orgEq(orderInternalNotes.organizationId));
    await del(tx, 'orderListNotes', orderListNotes, orgEq(orderListNotes.organizationId));
    await del(tx, 'orderStatusEvents', orderStatusEvents, orgEq(orderStatusEvents.organizationId));
    await del(tx, 'orderStatusPills', orderStatusPills, orgEq(orderStatusPills.organizationId));
    // orderWorkflowTransitions reference orderWorkflowStatuses — delete transitions first
    await del(tx, 'orderWorkflowTransitions', orderWorkflowTransitions, orgEq(orderWorkflowTransitions.organizationId));
    await del(tx, 'orderWorkflowStatuses', orderWorkflowStatuses, orgEq(orderWorkflowStatuses.organizationId));
    await del(tx, 'orderWorkflowVersions', orderWorkflowVersions, orgEq(orderWorkflowVersions.organizationId));
    await del(tx, 'reprintRequests', reprintRequests, orgEq(reprintRequests.organizationId));
    await del(tx, 'pickupTickets', pickupTickets, orgEq(pickupTickets.organizationId));
    await del(tx, 'fulfillmentEvents', fulfillmentEvents, orgEq(fulfillmentEvents.organizationId));

    // Shipment chain
    const shipmentIds = (
      await tx.select({ id: shipments.id }).from(shipments).where(orgEq(shipments.organizationId))
    ).map((r: any) => r.id);
    await deleteWhereIn(tx, shipmentItems, shipmentItems.shipmentId, shipmentIds);
    counts['shipmentItems'] = counts['shipmentItems'] ?? 0;
    await deleteWhereIn(tx, shipmentOrders, shipmentOrders.shipmentId, shipmentIds);
    counts['shipmentOrders'] = counts['shipmentOrders'] ?? 0;
    await del(tx, 'shipments', shipments, orgEq(shipments.organizationId));

    // productionEvents cascade from productionJobs — delete explicitly for count.
    await del(tx, 'productionEvents', productionEvents, orgEq(productionEvents.organizationId));

    // orderLineItems has no organizationId — delete by orderId IN (orderIds).
    await deleteWhereIn(tx, orderLineItems, orderLineItems.orderId, orderIds);
    counts['orderLineItems'] = counts['orderLineItems'] ?? 0;

    // Delete orders — productionJobs cascade from orders (cascade FK)
    await del(tx, 'orders', orders, orgEq(orders.organizationId));
    // productionJobs cascade from orders — count them separately after the fact
    await del(tx, 'productionJobs', productionJobs, orgEq(productionJobs.organizationId));

    // ── Step 7: Quote children (before quotes) ─────────────────────────────
    const quoteIds = (
      await tx.select({ id: quotes.id }).from(quotes).where(orgEq(quotes.organizationId))
    ).map((r: any) => r.id);

    const attachmentIds = (
      await tx.select({ id: quoteAttachments.id }).from(quoteAttachments).where(orgEq(quoteAttachments.organizationId))
    ).map((r: any) => r.id);

    // quoteAttachmentPages uses attachmentId (not quoteAttachmentId)
    await deleteWhereIn(tx, quoteAttachmentPages, quoteAttachmentPages.attachmentId, attachmentIds);
    counts['quoteAttachmentPages'] = counts['quoteAttachmentPages'] ?? 0;
    await del(tx, 'quoteAttachments', quoteAttachments, orgEq(quoteAttachments.organizationId));
    await deleteWhereIn(tx, quoteListNotes, quoteListNotes.quoteId, quoteIds);
    counts['quoteListNotes'] = counts['quoteListNotes'] ?? 0;
    await deleteWhereIn(tx, quoteWorkflowStates, quoteWorkflowStates.quoteId, quoteIds);
    counts['quoteWorkflowStates'] = counts['quoteWorkflowStates'] ?? 0;
    // quoteLineItems cascade from quotes
    await del(tx, 'quotes', quotes, orgEq(quotes.organizationId));

    // ── Step 8: Customer children (before customers, after invoices deleted) ─
    // customerContacts has no organizationId — delete by customerId IN (customerIds).
    const customerIds = (
      await tx.select({ id: customers.id }).from(customers).where(orgEq(customers.organizationId))
    ).map((r: any) => r.id);

    await deleteWhereIn(tx, customerNotes, customerNotes.customerId, customerIds);
    counts['customerNotes'] = counts['customerNotes'] ?? 0;
    await deleteWhereIn(tx, customerCreditTransactions, customerCreditTransactions.customerId, customerIds);
    counts['customerCreditTransactions'] = counts['customerCreditTransactions'] ?? 0;
    await deleteWhereIn(tx, customerProductionFolderReferences, customerProductionFolderReferences.customerId, customerIds);
    counts['customerProductionFolderReferences'] = counts['customerProductionFolderReferences'] ?? 0;
    await deleteWhereIn(tx, customerVisibleProducts, customerVisibleProducts.customerId, customerIds);
    counts['customerVisibleProducts'] = counts['customerVisibleProducts'] ?? 0;
    // customerContacts cascade from customers; delete explicitly for count
    await deleteWhereIn(tx, customerContacts, customerContacts.customerId, customerIds);
    counts['customerContacts'] = counts['customerContacts'] ?? 0;
    await del(tx, 'customers', customers, orgEq(customers.organizationId));

    // ── Step 9: Inbound order chain ────────────────────────────────────────
    // inbound child tables use inboundRecordId (not inboundOrderRecordId)
    const inboundSourceIds = (
      await tx.select({ id: inboundOrderSources.id }).from(inboundOrderSources).where(orgEq(inboundOrderSources.organizationId))
    ).map((r: any) => r.id);

    const inboundRecordIds = inboundSourceIds.length > 0
      ? (await tx.select({ id: inboundOrderRecords.id }).from(inboundOrderRecords).where(inArray(inboundOrderRecords.sourceId, inboundSourceIds))).map((r: any) => r.id)
      : [];

    await deleteWhereIn(tx, inboundOrderDecisionFlags, inboundOrderDecisionFlags.inboundRecordId, inboundRecordIds);
    counts['inboundOrderDecisionFlags'] = counts['inboundOrderDecisionFlags'] ?? 0;
    await deleteWhereIn(tx, inboundOrderEvents, inboundOrderEvents.inboundRecordId, inboundRecordIds);
    counts['inboundOrderEvents'] = counts['inboundOrderEvents'] ?? 0;
    await deleteWhereIn(tx, inboundOrderFiles, inboundOrderFiles.inboundRecordId, inboundRecordIds);
    counts['inboundOrderFiles'] = counts['inboundOrderFiles'] ?? 0;
    await deleteWhereIn(tx, inboundOrderLineItems, inboundOrderLineItems.inboundRecordId, inboundRecordIds);
    counts['inboundOrderLineItems'] = counts['inboundOrderLineItems'] ?? 0;
    await deleteWhereIn(tx, inboundOrderReviewSnapshots, inboundOrderReviewSnapshots.inboundRecordId, inboundRecordIds);
    counts['inboundOrderReviewSnapshots'] = counts['inboundOrderReviewSnapshots'] ?? 0;
    await deleteWhereIn(tx, inboundOrderWarnings, inboundOrderWarnings.inboundRecordId, inboundRecordIds);
    counts['inboundOrderWarnings'] = counts['inboundOrderWarnings'] ?? 0;
    await deleteWhereIn(tx, inboundOrderRecords, inboundOrderRecords.sourceId, inboundSourceIds);
    counts['inboundOrderRecords'] = counts['inboundOrderRecords'] ?? 0;
    await del(tx, 'inboundOrderSources', inboundOrderSources, orgEq(inboundOrderSources.organizationId));

    // ── Step 10: Import jobs ───────────────────────────────────────────────
    // importJobRows uses jobId (not importJobId)
    const importJobIds = (
      await tx.select({ id: importJobs.id }).from(importJobs).where(orgEq(importJobs.organizationId))
    ).map((r: any) => r.id);
    await deleteWhereIn(tx, importJobRows, importJobRows.jobId, importJobIds);
    counts['importJobRows'] = counts['importJobRows'] ?? 0;
    await del(tx, 'importJobs', importJobs, orgEq(importJobs.organizationId));

    // ── Step 11: Misc org-scoped transactional tables ──────────────────────
    await del(tx, 'portalFollowUpItems', portalFollowUpItems, orgEq(portalFollowUpItems.organizationId));
    await del(tx, 'outboundNotifications', outboundNotifications, orgEq(outboundNotifications.organizationId));
    await del(tx, 'accountingSyncJobs', accountingSyncJobs, orgEq(accountingSyncJobs.organizationId));

    // ── Step 12: Audit logs ────────────────────────────────────────────────
    // Delete all prior audit logs; the reset completion entry is written next, inside the tx.
    await del(tx, 'auditLogs', auditLogs, orgEq(auditLogs.organizationId));

    // ── Final: reset audit log (inside tx so it survives on commit) ──────
    await tx.insert(auditLogs).values({
      organizationId,
      userId,
      actionType: 'org.transactional_reset.completed',
      entityType: 'organization',
      entityId: organizationId,
      description: 'Transactional data reset completed',
      newValues: { deletedCounts: counts },
    });
  });

  return {
    success: true,
    data: {
      deletedCounts: counts,
      warnings,
      preservedCategories: [
        'organization',
        'users & memberships',
        'products, product options, PBV2 trees',
        'materials & inventory catalog',
        'pricing formulas & rules',
        'company settings',
        'email OAuth / settings',
        'QuickBooks OAuth connection',
        'tax zones & rules',
        'storage configuration',
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Action 2: Reset QuickBooks Import Data
// ---------------------------------------------------------------------------

export type QBResetOptions = {
  disconnectOAuth?: boolean;
  deleteQBCustomers?: boolean;
};

export type QBResetResult = {
  success: true;
  data: {
    deletedCounts: Record<string, number>;
    warnings: string[];
    preservedCategories: string[];
  };
};

export async function resetQuickBooksImportData(
  organizationId: string,
  userId: string,
  opts: QBResetOptions = {},
): Promise<QBResetResult> {
  const { disconnectOAuth = false, deleteQBCustomers = true } = opts;

  const counts: Record<string, number> = {};
  const warnings: string[] = [];

  const del = async (tx: any, label: string, table: any, condition: any) => {
    const result = await tx.delete(table).where(condition);
    const n = Number((result as any).rowCount ?? (result as any).count ?? 0);
    counts[label] = (counts[label] ?? 0) + n;
    return n;
  };

  const orgEq = (col: any) => eq(col, organizationId);

  await db.transaction(async (tx) => {
    // ── QB-imported invoices ───────────────────────────────────────────────
    const qbInvoiceIds = (
      await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(orgEq(invoices.organizationId), eq(invoices.importSource, 'quickbooks')))
    ).map((r: any) => r.id);

    if (qbInvoiceIds.length > 0) {
      // Delete payments on these QB invoices (paymentWebhookEvents has no FK to payments)
      const qbPaymentIds = (
        await tx
          .select({ id: payments.id })
          .from(payments)
          .where(and(orgEq(payments.organizationId), inArray(payments.invoiceId, qbInvoiceIds)))
      ).map((r: any) => r.id);

      await deleteWhereIn(tx, payments, payments.id, qbPaymentIds);
      counts['payments'] = qbPaymentIds.length;

      const emailLogResult = await tx.delete(invoiceEmailLogs).where(
        and(orgEq(invoiceEmailLogs.organizationId), inArray(invoiceEmailLogs.invoiceId, qbInvoiceIds))
      );
      counts['invoiceEmailLogs'] = Number((emailLogResult as any).rowCount ?? 0);

      const reminderLogResult = await tx.delete(invoiceReminderLogs).where(
        and(orgEq(invoiceReminderLogs.organizationId), inArray(invoiceReminderLogs.invoiceId, qbInvoiceIds))
      );
      counts['invoiceReminderLogs'] = Number((reminderLogResult as any).rowCount ?? 0);

      // Delete QB invoices (invoiceLineItems cascade)
      await deleteWhereIn(tx, invoices, invoices.id, qbInvoiceIds);
      counts['invoices'] = qbInvoiceIds.length;
    } else {
      counts['invoices'] = 0;
      warnings.push('No QB-imported invoices found (importSource = "quickbooks").');
    }

    // ── QB sync field cleanup on remaining invoices ────────────────────────
    await tx
      .update(invoices)
      .set({
        externalAccountingId: null,
        qbInvoiceId: null,
        qbSyncStatus: 'pending',
        qbLastError: null,
        syncError: null,
        syncedAt: null,
        syncStatus: 'pending',
      })
      .where(
        and(
          orgEq(invoices.organizationId),
          isNotNull(invoices.externalAccountingId),
        ),
      );

    // ── QB-sourced customer contacts ───────────────────────────────────────
    // customerContacts has no organizationId — join through customers to scope to org.
    const qbContactIds = (
      await tx
        .select({ id: customerContacts.id })
        .from(customerContacts)
        .innerJoin(customers, eq(customerContacts.customerId, customers.id))
        .where(and(
          orgEq(customers.organizationId),
          eq(customerContacts.externalSource, 'quickbooks'),
        ))
    ).map((r: any) => r.id);

    await deleteWhereIn(tx, customerContacts, customerContacts.id, qbContactIds);
    counts['customerContacts (QB-sourced)'] = qbContactIds.length;

    // ── QB-imported customers ──────────────────────────────────────────────
    if (deleteQBCustomers) {
      // Safe identification: customers with a non-null externalAccountingId
      // that have no remaining invoices and no orders.
      const qbCustomerCandidates = await tx
        .select({ id: customers.id, companyName: customers.companyName })
        .from(customers)
        .where(and(orgEq(customers.organizationId), isNotNull(customers.externalAccountingId)));

      const safeToDelete: string[] = [];
      const skipped: string[] = [];

      for (const c of qbCustomerCandidates) {
        const hasOrders = (
          await tx
            .select({ id: orders.id })
            .from(orders)
            .where(and(orgEq(orders.organizationId), eq(orders.customerId, c.id)))
            .limit(1)
        ).length > 0;

        const hasInvoices = (
          await tx
            .select({ id: invoices.id })
            .from(invoices)
            .where(and(orgEq(invoices.organizationId), eq(invoices.customerId, c.id)))
            .limit(1)
        ).length > 0;

        if (!hasOrders && !hasInvoices) {
          safeToDelete.push(c.id);
        } else {
          skipped.push(c.companyName ?? c.id);
        }
      }

      if (skipped.length > 0) {
        warnings.push(
          `${skipped.length} QB-imported customer(s) were skipped because they still have linked orders or invoices: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ` … and ${skipped.length - 5} more` : ''}.`,
        );
      }

      if (safeToDelete.length > 0) {
        // Delete customer children first (QB contacts already gone above)
        await deleteWhereIn(tx, customerNotes, customerNotes.customerId, safeToDelete);
        await deleteWhereIn(tx, customerCreditTransactions, customerCreditTransactions.customerId, safeToDelete);
        await deleteWhereIn(tx, customerProductionFolderReferences, customerProductionFolderReferences.customerId, safeToDelete);
        await deleteWhereIn(tx, customerVisibleProducts, customerVisibleProducts.customerId, safeToDelete);
        await deleteWhereIn(tx, customerContacts, customerContacts.customerId, safeToDelete);
        await deleteWhereIn(tx, customers, customers.id, safeToDelete);
        counts['customers'] = safeToDelete.length;
      } else {
        counts['customers'] = 0;
        if (qbCustomerCandidates.length > 0) {
          warnings.push('All QB-identified customers have linked records and were skipped. No customers were deleted.');
        }
      }
    } else {
      warnings.push('Customer deletion was not requested (deleteQBCustomers=false). QB sync fields cleared instead.');
    }

    // ── Clear QB sync fields on remaining customers ────────────────────────
    await tx
      .update(customers)
      .set({
        externalAccountingId: null,
        syncStatus: null,
        syncError: null,
        syncedAt: null,
      })
      .where(and(orgEq(customers.organizationId), isNotNull(customers.externalAccountingId)));

    // ── QB sync jobs ───────────────────────────────────────────────────────
    await del(
      tx,
      'accountingSyncJobs',
      accountingSyncJobs,
      and(orgEq(accountingSyncJobs.organizationId), eq(accountingSyncJobs.provider, 'quickbooks')),
    );

    // ── OAuth disconnect (optional) ────────────────────────────────────────
    if (disconnectOAuth) {
      await del(
        tx,
        'oauthConnections (QB)',
        oauthConnections,
        and(orgEq(oauthConnections.organizationId), eq(oauthConnections.provider, 'quickbooks')),
      );
    }

    // ── Audit log ──────────────────────────────────────────────────────────
    await tx.insert(auditLogs).values({
      organizationId,
      userId,
      actionType: 'org.qb_import_reset.completed',
      entityType: 'organization',
      entityId: organizationId,
      description: 'QuickBooks import data reset completed',
      newValues: {
        deletedCounts: counts,
        disconnectOAuth,
        deleteQBCustomers,
        warnings,
      },
    });
  });

  const preserved = [
    'organization, users & memberships',
    'products, materials & pricing config',
    'company settings & email OAuth',
    disconnectOAuth ? '(QB OAuth disconnected as requested)' : 'QuickBooks OAuth connection',
  ];

  return {
    success: true,
    data: {
      deletedCounts: counts,
      warnings,
      preservedCategories: preserved,
    },
  };
}
