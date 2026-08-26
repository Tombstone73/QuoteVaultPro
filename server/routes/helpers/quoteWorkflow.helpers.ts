/**
 * quoteWorkflow.helpers.ts
 *
 * Quote-specific helper cluster promoted from closure-local scope in server/routes.ts.
 * These helpers are shared by inline quote route handlers and extracted route modules.
 *
 * Placement: server/routes/helpers/quoteWorkflow.helpers.ts
 */

import { eq, and, asc } from "drizzle-orm";
import { db } from "../../db";
import {
  quotes,
  quoteLineItems,
  quoteAttachments,
  quoteAttachmentPages,
  auditLogs,
  organizations,
} from "@shared/schema";
import {
  getEffectiveWorkflowState,
  isValidTransition,
  getTransitionBlockReason,
  isQuoteLocked,
  DB_TO_WORKFLOW,
  APPROVED_LOCK_MESSAGE,
  CONVERTED_LOCK_MESSAGE,
  type QuoteStatusDB,
  type QuoteWorkflowState,
} from "@shared/quoteWorkflow";
import {
  allocateJobNumber,
  isDocumentNumberUniqueViolation,
  toDocumentNumberConflictError,
} from "../../services/documentNumberingService";

/**
 * Get effective workflow state for a quote
 */
export const getQuoteWorkflowState = (quote: any): QuoteWorkflowState => {
  const dbStatus = quote.status as QuoteStatusDB;
  const validUntil = quote.validUntil;
  const hasOrder = !!quote.convertedToOrderId;
  return getEffectiveWorkflowState(dbStatus, validUntil, hasOrder);
};

/**
 * Check if quote is locked (immutable)
 */
export const isQuoteLockedFn = (quote: any): boolean => {
  const state = getQuoteWorkflowState(quote);
  return isQuoteLocked(state);
};

/**
 * Assert quote is editable, return false and send error response if locked
 */
export const assertQuoteEditable = (res: any, quote: any): boolean => {
  const state = getQuoteWorkflowState(quote);
  if (isQuoteLocked(state)) {
    const message = state === 'approved' ? APPROVED_LOCK_MESSAGE : CONVERTED_LOCK_MESSAGE;
    res.status(409).json({ error: message });
    return false;
  }
  return true;
};

/**
 * Validate status transition, return false and send error if invalid
 */
export const assertValidTransition = (res: any, quote: any, newDbStatus: QuoteStatusDB): boolean => {
  const currentState = getQuoteWorkflowState(quote);
  const targetState = DB_TO_WORKFLOW[newDbStatus];

  if (!isValidTransition(currentState, targetState)) {
    const reason = getTransitionBlockReason(currentState, targetState);
    res.status(403).json({ error: reason });
    return false;
  }
  return true;
};

// Helper: Get organization preferences
export async function getOrgPreferences(organizationId: string): Promise<any> {
  try {
    const [org] = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!org) return {};
    return (org.settings as any)?.preferences || {};
  } catch (error) {
    console.error('[getOrgPreferences] Error:', error);
    return {};
  }
}

export const cloneQuoteToDraft = async (args: {
  tx: any;
  organizationId: string;
  userId: string;
  userName: string;
  sourceQuoteId: string;
  isInternalUser: boolean;
  operation: 'duplicate' | 'revise';
  includeArtwork: boolean;
}) => {
  try {
    const {
      tx,
      organizationId,
      userId,
      userName,
      sourceQuoteId,
      isInternalUser,
      operation,
      includeArtwork,
    } = args;

  const whereParts = [
    eq(quotes.id, sourceQuoteId),
    eq(quotes.organizationId, organizationId),
  ];

  if (!isInternalUser) {
    whereParts.push(eq(quotes.userId, userId));
  }

  const sourceQuote = await tx
    .select()
    .from(quotes)
    .where(and(...whereParts))
    .limit(1)
    .then((rows: any[]) => rows[0]);

  if (!sourceQuote) {
    throw Object.assign(new Error('Quote not found'), { statusCode: 404 });
  }

  if (operation === 'revise') {
    const isApproved = String((sourceQuote as any).status) === 'active';
    const isConverted = !!(sourceQuote as any).convertedToOrderId;

    if (!isApproved && !isConverted) {
      throw Object.assign(new Error('Only approved or converted quotes can be revised.'), { statusCode: 409 });
    }
  }

  const jobNumber = await allocateJobNumber(organizationId, tx);
  const nextQuoteNumber = jobNumber;
  const displayNumber = String(jobNumber);
  const numberCore = jobNumber;

  const [newQuote] = await tx
    .insert(quotes)
    .values({
      organizationId,
      quoteNumber: nextQuoteNumber,
      jobNumber,
      displayNumber,
      numberCore,
      label: operation === 'duplicate' ? null : sourceQuote.label,
      userId: sourceQuote.userId,
      status: 'draft' as any,
      customerId: sourceQuote.customerId,
      contactId: sourceQuote.contactId,
      customerName: sourceQuote.customerName,
      source: sourceQuote.source,
      subtotal: sourceQuote.subtotal,
      taxRate: sourceQuote.taxRate,
      taxAmount: sourceQuote.taxAmount,
      taxableSubtotal: sourceQuote.taxableSubtotal,
      marginPercentage: sourceQuote.marginPercentage,
      discountAmount: sourceQuote.discountAmount,
      totalPrice: sourceQuote.totalPrice,

      billToName: sourceQuote.billToName,
      billToCompany: sourceQuote.billToCompany,
      billToAddress1: sourceQuote.billToAddress1,
      billToAddress2: sourceQuote.billToAddress2,
      billToCity: sourceQuote.billToCity,
      billToState: sourceQuote.billToState,
      billToPostalCode: sourceQuote.billToPostalCode,
      billToCountry: sourceQuote.billToCountry,
      billToPhone: sourceQuote.billToPhone,
      billToEmail: sourceQuote.billToEmail,

      shippingMethod: sourceQuote.shippingMethod,
      shippingMode: sourceQuote.shippingMode,
      shipToName: sourceQuote.shipToName,
      shipToCompany: sourceQuote.shipToCompany,
      shipToAddress1: sourceQuote.shipToAddress1,
      shipToAddress2: sourceQuote.shipToAddress2,
      shipToCity: sourceQuote.shipToCity,
      shipToState: sourceQuote.shipToState,
      shipToPostalCode: sourceQuote.shipToPostalCode,
      shipToCountry: sourceQuote.shipToCountry,
      shipToPhone: sourceQuote.shipToPhone,
      shipToEmail: sourceQuote.shipToEmail,
      carrier: sourceQuote.carrier,
      carrierAccountNumber: sourceQuote.carrierAccountNumber,
      shippingInstructions: sourceQuote.shippingInstructions,

      requestedDueDate: sourceQuote.requestedDueDate,
      validUntil: sourceQuote.validUntil,

      convertedToOrderId: null,
    } as any)
    .returning();

  const sourceLineItems = await tx
    .select()
    .from(quoteLineItems)
    .where(eq(quoteLineItems.quoteId, sourceQuoteId))
    .orderBy(asc(quoteLineItems.displayOrder), asc(quoteLineItems.createdAt));

  const lineItemIdMap = new Map<string, string>();

  for (const li of sourceLineItems) {
    const [createdLi] = await tx
      .insert(quoteLineItems)
      .values({
        quoteId: newQuote.id,
        status: (li.status as any) ?? 'active',
        productId: li.productId,
        productName: li.productName,
        variantId: li.variantId,
        variantName: li.variantName,
        productType: li.productType,
        width: li.width,
        height: li.height,
        quantity: li.quantity,
        specsJson: li.specsJson,
        selectedOptions: li.selectedOptions as any,
        linePrice: li.linePrice,
        formulaLinePrice: (li as any).formulaLinePrice ?? null,
        priceOverride: (li as any).priceOverride ?? null,
        priceBreakdown: li.priceBreakdown as any,
        materialUsages: (li as any).materialUsages ?? [],
        taxAmount: (li as any).taxAmount ?? '0',
        isTaxableSnapshot: (li as any).isTaxableSnapshot ?? true,
        displayOrder: li.displayOrder,
        isTemporary: false,
        createdByUserId: li.createdByUserId ?? null,
        // Canonical routing intent (migration 0015) — preserved through clone/revise
        requiresDesign: (li as any).requiresDesign ?? false,
        requiresPrepress: (li as any).requiresPrepress ?? null,
      } as any)
      .returning();

    lineItemIdMap.set(li.id, createdLi.id);
  }

  if (includeArtwork) {
    const sourceAttachments = await tx
      .select()
      .from(quoteAttachments)
      .where(and(
        eq(quoteAttachments.quoteId, sourceQuoteId),
        eq(quoteAttachments.organizationId, organizationId),
      ))
      .orderBy(asc(quoteAttachments.createdAt));

    for (const att of sourceAttachments) {
      const mappedLineItemId = att.quoteLineItemId
        ? (lineItemIdMap.get(att.quoteLineItemId) ?? null)
        : null;

      if (att.quoteLineItemId && !mappedLineItemId) {
        throw Object.assign(new Error('Attachment references a line item that could not be mapped.'), { statusCode: 500 });
      }

      const [createdAtt] = await tx
        .insert(quoteAttachments)
        .values({
          quoteId: newQuote.id,
          quoteLineItemId: mappedLineItemId,
          organizationId,
          fileRecordId: att.fileRecordId,
          uploadedByUserId: att.uploadedByUserId,
          uploadedByName: att.uploadedByName,

          fileName: att.fileName,
          fileUrl: att.fileUrl ?? null,
          fileSize: att.fileSize,
          mimeType: att.mimeType,
          description: att.description,

          originalFilename: att.originalFilename,
          storedFilename: att.storedFilename,
          relativePath: att.relativePath,
          storageProvider: att.storageProvider,
          extension: att.extension,
          sizeBytes: att.sizeBytes,
          checksum: att.checksum,
          productionQuantity: att.productionQuantity ?? null,
          productionGroupId: att.productionGroupId ?? null,
          productionRole: att.productionRole ?? "artwork",

          thumbnailRelativePath: att.thumbnailRelativePath,
          thumbnailGeneratedAt: att.thumbnailGeneratedAt,
          thumbStatus: att.thumbStatus,
          thumbKey: att.thumbKey,
          previewKey: att.previewKey,
          thumbError: att.thumbError,

          pageCount: att.pageCount,
          pageCountStatus: att.pageCountStatus,
          pageCountError: att.pageCountError,
          pageCountUpdatedAt: att.pageCountUpdatedAt,

          bucket: att.bucket,
          updatedAt: new Date(),
        } as any)
        .returning();

      const { hasQuoteAttachmentPagesTable } = await import('../../db');
      const pagesTableExists = hasQuoteAttachmentPagesTable();

      if (pagesTableExists === true) {
        try {
          const sourcePages = await tx
            .select()
            .from(quoteAttachmentPages)
            .where(and(
              eq(quoteAttachmentPages.attachmentId, att.id),
              eq(quoteAttachmentPages.organizationId, organizationId),
            ))
            .orderBy(asc(quoteAttachmentPages.pageIndex));

          for (const p of sourcePages) {
            await tx
              .insert(quoteAttachmentPages)
              .values({
                organizationId,
                attachmentId: createdAtt.id,
                pageIndex: p.pageIndex,
                thumbStatus: p.thumbStatus,
                thumbFileRecordId: p.thumbFileRecordId,
                thumbKey: null,
                previewFileRecordId: p.previewFileRecordId,
                previewKey: null,
                thumbError: p.thumbError,
                updatedAt: new Date(),
              } as any);
          }
        } catch (error: any) {
          const pgCode = error?.code;
          const logPrefix = operation === 'revise' ? '[ReviseQuote]' : '[DuplicateQuote]';
          if (pgCode === '42P01') {
            console.warn(`${logPrefix} Skipping attachment page copy: quote_attachment_pages missing (42P01)`);
          } else {
            console.error(`${logPrefix} Error copying attachment pages (non-fatal):`, error);
          }
        }
      } else {
        const logPrefix = operation === 'revise' ? '[ReviseQuote]' : '[DuplicateQuote]';
        console.log(`${logPrefix} Skipping attachment page copy: quote_attachment_pages table not available`);
      }
    }
  }

  const actionSuffix = operation === 'revise'
    ? ''
    : includeArtwork
      ? ' with artwork'
      : '';

  await tx.insert(auditLogs).values({
    organizationId,
    userId,
    userName,
    actionType: 'CREATE',
    entityType: 'quote',
    entityId: newQuote.id,
    entityName: newQuote.quoteNumber != null ? String(newQuote.quoteNumber) : undefined,
    description: operation === 'revise'
      ? `Created as revision of quote ${sourceQuote.quoteNumber ?? ''}`.trim()
      : `Created as duplicate of quote ${sourceQuote.quoteNumber ?? ''}${actionSuffix}`.trim(),
    newValues: operation === 'revise'
      ? { sourceQuoteId: sourceQuote.id, sourceQuoteNumber: sourceQuote.quoteNumber }
      : { sourceQuoteId: sourceQuote.id, sourceQuoteNumber: sourceQuote.quoteNumber, includeArtwork },
  } as any);

  await tx.insert(auditLogs).values({
    organizationId,
    userId,
    userName,
    actionType: 'UPDATE',
    entityType: 'quote',
    entityId: sourceQuote.id,
    entityName: sourceQuote.quoteNumber != null ? String(sourceQuote.quoteNumber) : undefined,
    description: operation === 'revise'
      ? `Revised to quote ${newQuote.quoteNumber ?? ''}`.trim()
      : `Duplicated to quote ${newQuote.quoteNumber ?? ''}${actionSuffix}`.trim(),
    newValues: operation === 'revise'
      ? { revisedQuoteId: newQuote.id, revisedQuoteNumber: newQuote.quoteNumber }
      : { duplicatedQuoteId: newQuote.id, duplicatedQuoteNumber: newQuote.quoteNumber, includeArtwork },
  } as any);

    return {
      id: newQuote.id,
      quoteNumber: newQuote.quoteNumber,
      includeArtwork,
    };
  } catch (error) {
    if (isDocumentNumberUniqueViolation(error)) throw toDocumentNumberConflictError(error);
    throw error;
  }
};
