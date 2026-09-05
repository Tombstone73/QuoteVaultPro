import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  customerContactImportCompanyRecords,
  customerContactImportContactRecords,
  customerContactImportRelationshipRecords,
  customerContactLinks,
  customerContacts,
  customerCreditTransactions,
  customerMergeOperations,
  customerNotes,
  customerPortalAccess,
  customerPortalCompanySettings,
  customerPortalOnboardingBatchItems,
  customerProductionFolderReferences,
  customerVisibleProducts,
  customers,
  auditLogs,
  externalIdentityMappings,
  inboundAttachmentClassificationRules,
  inboundOrderRecords,
  invoices,
  orders,
  payments,
  quotes,
  type Customer,
  type ExternalIdentityMapping,
} from "@shared/schema";
import { InvalidQuickBooksCustomerIdError, selectRetainedQuickBooksCustomerId } from "@shared/quickBooksCustomerIdSelection";

export type CustomerIdentityRecord = Pick<Customer, "id" | "companyName" | "externalAccountingId" | "status">;

export type CustomerMergeDecision =
  | {
      action: "merge";
      survivorCustomerId: string;
      duplicateCustomerId: string;
      reason: "same_quickbooks_id" | "single_quickbooks_id" | "lowest_quickbooks_id_retained" | "explicit_review";
      requiresReviewedAction: boolean;
      quickBooksCustomerId: string | null;
      retiredQuickBooksCustomerIds: string[];
    }
  | {
      action: "block";
      code: "QUICKBOOKS_ID_CONFLICT" | "SAME_CUSTOMER" | "INVALID_QUICKBOOKS_CUSTOMER_ID";
      message: string;
      leftQuickBooksCustomerId: string | null;
      rightQuickBooksCustomerId: string | null;
    };

export class CustomerIdentityConflictError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CustomerIdentityConflictError";
  }
}

const mergeSelectableFields = [
  "companyName", "displayName", "email", "phone", "website",
  "billingAddress", "billingStreet1", "billingStreet2", "billingCity", "billingState", "billingPostalCode", "billingCountry",
  "shippingAddress", "shippingStreet1", "shippingStreet2", "shippingCity", "shippingState", "shippingPostalCode", "shippingCountry",
  "customerType", "taxId", "creditLimit", "pricingTier", "defaultDiscountPercent", "defaultMarkupPercent", "defaultMarginPercent",
  "productVisibilityMode", "isTaxExempt", "taxRateOverride", "taxExemptReason", "taxExemptCertificateRef", "paymentTerms", "blindShipping", "alwaysRequireProof", "assignedTo", "notes",
] as const;
type MergeSelectableField = typeof mergeSelectableFields[number];

function comparableFieldValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" ? value.trim() : String(value);
}

function cleanId(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

export function getQuickBooksCompanyId(
  customer: Pick<CustomerIdentityRecord, "externalAccountingId">,
  identities: Array<Pick<ExternalIdentityMapping, "entityId" | "sourceSystem" | "sourceEntityType" | "sourceRecordId">> = [],
): string | null {
  const direct = cleanId(customer.externalAccountingId);
  if (direct) return direct;

  const mapped = identities.find((identity) =>
    identity.sourceSystem === "quickbooks" &&
    identity.sourceEntityType === "customer"
  );
  return cleanId(mapped?.sourceRecordId);
}

export function decideCustomerMerge(input: {
  left: CustomerIdentityRecord;
  right: CustomerIdentityRecord;
  leftIdentities?: Array<Pick<ExternalIdentityMapping, "entityId" | "sourceSystem" | "sourceEntityType" | "sourceRecordId">>;
  rightIdentities?: Array<Pick<ExternalIdentityMapping, "entityId" | "sourceSystem" | "sourceEntityType" | "sourceRecordId">>;
  reviewed?: boolean;
  preferredSurvivorId?: string | null;
}): CustomerMergeDecision {
  const { left, right } = input;
  if (left.id === right.id) {
    return {
      action: "block",
      code: "SAME_CUSTOMER",
      message: "Cannot merge a company into itself.",
      leftQuickBooksCustomerId: getQuickBooksCompanyId(left, input.leftIdentities),
      rightQuickBooksCustomerId: getQuickBooksCompanyId(right, input.rightIdentities),
    };
  }

  const leftQb = getQuickBooksCompanyId(left, input.leftIdentities);
  const rightQb = getQuickBooksCompanyId(right, input.rightIdentities);

  const preferred = input.preferredSurvivorId === right.id ? right : left;
  const duplicate = preferred.id === left.id ? right : left;
  let quickBooksResolution: ReturnType<typeof selectRetainedQuickBooksCustomerId>;
  try {
    quickBooksResolution = selectRetainedQuickBooksCustomerId([leftQb, rightQb]);
  } catch (error) {
    if (error instanceof InvalidQuickBooksCustomerIdError) {
      return {
        action: "block",
        code: "INVALID_QUICKBOOKS_CUSTOMER_ID",
        message: "Customer merge cannot safely resolve a malformed QuickBooks customer ID. Correct the local accounting mapping and retry.",
        leftQuickBooksCustomerId: leftQb,
        rightQuickBooksCustomerId: rightQb,
      };
    }
    throw error;
  }

  if (leftQb && rightQb && leftQb === rightQb) {
    return {
      action: "merge",
      survivorCustomerId: preferred.id,
      duplicateCustomerId: duplicate.id,
      reason: "same_quickbooks_id",
      requiresReviewedAction: false,
      quickBooksCustomerId: quickBooksResolution.retainedQuickBooksCustomerId,
      retiredQuickBooksCustomerIds: [],
    };
  }

  if (leftQb && rightQb) {
    return {
      action: "merge",
      survivorCustomerId: preferred.id,
      duplicateCustomerId: duplicate.id,
      reason: "lowest_quickbooks_id_retained",
      requiresReviewedAction: true,
      quickBooksCustomerId: quickBooksResolution.retainedQuickBooksCustomerId,
      retiredQuickBooksCustomerIds: quickBooksResolution.retiredQuickBooksCustomerIds,
    };
  }

  if (leftQb || rightQb) {
    return {
      action: "merge",
      survivorCustomerId: preferred.id,
      duplicateCustomerId: duplicate.id,
      reason: "single_quickbooks_id",
      requiresReviewedAction: true,
      quickBooksCustomerId: quickBooksResolution.retainedQuickBooksCustomerId,
      retiredQuickBooksCustomerIds: [],
    };
  }

  return {
    action: "merge",
    survivorCustomerId: preferred.id,
    duplicateCustomerId: duplicate.id,
    reason: "explicit_review",
    requiresReviewedAction: true,
    quickBooksCustomerId: null,
    retiredQuickBooksCustomerIds: [],
  };
}

function getQuickBooksMergePreview(
  selectedCustomers: CustomerIdentityRecord[],
  identities: Array<Pick<ExternalIdentityMapping, "entityId" | "sourceSystem" | "sourceEntityType" | "sourceRecordId">>,
) {
  const quickBooksCustomerIds = selectedCustomers.map((customer) => getQuickBooksCompanyId(
    customer,
    identities.filter((identity) => identity.entityId === customer.id),
  ));
  try {
    const resolution = selectRetainedQuickBooksCustomerId(quickBooksCustomerIds);
    const retainedQuickBooksCustomerId = resolution.retainedQuickBooksCustomerId;
    return {
      retainedQuickBooksCustomerId,
      retiredQuickBooksCustomerIds: resolution.retiredQuickBooksCustomerIds,
      warning: resolution.retiredQuickBooksCustomerIds.length > 0 && retainedQuickBooksCustomerId
        ? `QuickBooks duplicate detected. Future QuickBooks activity will use customer ${retainedQuickBooksCustomerId}. Existing QuickBooks history will not be changed.`
        : null,
    };
  } catch (error) {
    if (error instanceof InvalidQuickBooksCustomerIdError) {
      throw new CustomerIdentityConflictError(
        "INVALID_QUICKBOOKS_CUSTOMER_ID",
        "Customer merge cannot safely resolve a malformed QuickBooks customer ID. Correct the local accounting mapping and retry.",
        { quickBooksCustomerIds },
      );
    }
    throw error;
  }
}

type DbClient = typeof db;

export async function mergeDuplicateCustomers(input: {
  organizationId: string;
  survivorCustomerId: string;
  duplicateCustomerId: string;
  actorUserId?: string | null;
  reviewed?: boolean;
  reason?: string | null;
  mergeOperationId?: string | null;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? db;
  return dbClient.transaction(async (tx: any) => {
    const ids = [input.survivorCustomerId, input.duplicateCustomerId];
    const rows = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.organizationId, input.organizationId), inArray(customers.id, ids)));

    const survivor = rows.find((row: Customer) => row.id === input.survivorCustomerId);
    const duplicate = rows.find((row: Customer) => row.id === input.duplicateCustomerId);
    if (!survivor || !duplicate) {
      throw new CustomerIdentityConflictError("CUSTOMER_NOT_FOUND", "One or both companies were not found in this organization.", {
        organizationId: input.organizationId,
        survivorCustomerId: input.survivorCustomerId,
        duplicateCustomerId: input.duplicateCustomerId,
      });
    }

    if ((survivor as any).mergedIntoCustomerId) {
      throw new CustomerIdentityConflictError("SURVIVOR_ALREADY_MERGED", "Choose the final active customer as the survivor.", {
        survivorCustomerId: survivor.id,
        mergedIntoCustomerId: (survivor as any).mergedIntoCustomerId,
      });
    }
    if ((duplicate as any).mergedIntoCustomerId) {
      if ((duplicate as any).mergedIntoCustomerId === survivor.id) {
        return { success: true, alreadyMerged: true, survivorCustomerId: survivor.id, duplicateCustomerId: duplicate.id, counts: {} };
      }
      throw new CustomerIdentityConflictError("SOURCE_ALREADY_MERGED", "A selected source customer was already merged into a different customer.", {
        duplicateCustomerId: duplicate.id,
        mergedIntoCustomerId: (duplicate as any).mergedIntoCustomerId,
      });
    }

    const identities = await tx
      .select()
      .from(externalIdentityMappings)
      .where(and(
        eq(externalIdentityMappings.organizationId, input.organizationId),
        eq(externalIdentityMappings.entityType, "customer"),
        inArray(externalIdentityMappings.entityId, ids),
      ));

    const decision = decideCustomerMerge({
      left: survivor,
      right: duplicate,
      leftIdentities: identities.filter((identity: ExternalIdentityMapping) => identity.entityId === survivor.id),
      rightIdentities: identities.filter((identity: ExternalIdentityMapping) => identity.entityId === duplicate.id),
      reviewed: input.reviewed,
      preferredSurvivorId: input.survivorCustomerId,
    });

    if (decision.action === "block") {
      throw new CustomerIdentityConflictError(decision.code, decision.message, {
        organizationId: input.organizationId,
        survivorCustomerId: input.survivorCustomerId,
        duplicateCustomerId: input.duplicateCustomerId,
        leftQuickBooksCustomerId: decision.leftQuickBooksCustomerId,
        rightQuickBooksCustomerId: decision.rightQuickBooksCustomerId,
      });
    }

    if (decision.requiresReviewedAction && !input.reviewed) {
      throw new CustomerIdentityConflictError(
        "REVIEW_REQUIRED",
        "This merge requires explicit admin review because only one company has the authoritative QuickBooks ID or neither company has one.",
        {
          organizationId: input.organizationId,
          survivorCustomerId: input.survivorCustomerId,
          duplicateCustomerId: input.duplicateCustomerId,
          quickBooksCustomerId: decision.quickBooksCustomerId,
        },
      );
    }

    const startedAt = Date.now();
    const counts: Record<string, number> = {};
    const survivorQb = getQuickBooksCompanyId(
      survivor,
      identities.filter((identity: ExternalIdentityMapping) => identity.entityId === survivor.id),
    );
    const duplicateQb = getQuickBooksCompanyId(
      duplicate,
      identities.filter((identity: ExternalIdentityMapping) => identity.entityId === duplicate.id),
    );
    const survivorDirectQb = cleanId(survivor.externalAccountingId);
    const quickBooksResolution = {
      survivorOriginalQuickBooksCustomerId: survivorQb,
      sourceOriginalQuickBooksCustomerId: duplicateQb,
      retainedQuickBooksCustomerId: decision.quickBooksCustomerId,
      retiredQuickBooksCustomerIds: decision.retiredQuickBooksCustomerIds,
    };

    console.info("[CUSTOMER IDENTITY] merge started", {
      organizationId: input.organizationId,
      survivorCustomerId: survivor.id,
      duplicateCustomerId: duplicate.id,
      survivorQuickBooksCustomerId: survivorQb,
      duplicateQuickBooksCustomerId: duplicateQb,
      reviewed: input.reviewed === true,
      reason: decision.reason,
    });

    if (decision.quickBooksCustomerId && survivorDirectQb !== decision.quickBooksCustomerId) {
      const [updated] = await tx
        .update(customers)
        .set({ externalAccountingId: decision.quickBooksCustomerId, updatedAt: new Date() })
        .where(and(eq(customers.organizationId, input.organizationId), eq(customers.id, survivor.id)))
        .returning({ id: customers.id });
      counts.customerQuickBooksIdResolved = updated ? 1 : 0;
    }

    const duplicateLinks = await tx
      .select()
      .from(customerContactLinks)
      .where(and(eq(customerContactLinks.organizationId, input.organizationId), eq(customerContactLinks.customerId, duplicate.id)));

    let movedLinks = 0;
    let skippedDuplicateLinks = 0;
    for (const link of duplicateLinks) {
      const [existingSurvivorLink] = await tx
        .select({ id: customerContactLinks.id })
        .from(customerContactLinks)
        .where(and(
          eq(customerContactLinks.organizationId, input.organizationId),
          eq(customerContactLinks.customerId, survivor.id),
          eq(customerContactLinks.contactId, link.contactId),
          sql`${customerContactLinks.status} <> 'removed'`,
        ))
        .limit(1);

      if (existingSurvivorLink) {
        await tx
          .update(customerContactLinks)
          .set({ status: "removed", isPrimary: false, updatedAt: new Date() })
          .where(eq(customerContactLinks.id, link.id));
        skippedDuplicateLinks += 1;
      } else {
        await tx
          .update(customerContactLinks)
          .set({ customerId: survivor.id, updatedAt: new Date() })
          .where(eq(customerContactLinks.id, link.id));
        movedLinks += 1;
      }
    }
    counts.contactLinksMoved = movedLinks;
    counts.contactLinksSkippedAsDuplicates = skippedDuplicateLinks;

    counts.contactsLegacyCustomerIdMoved = Number((await tx
      .update(customerContacts)
      .set({ customerId: survivor.id, updatedAt: new Date() })
      .where(and(eq(customerContacts.organizationId, input.organizationId), eq(customerContacts.customerId, duplicate.id)))
      .returning({ id: customerContacts.id })).length);

    counts.quotesMoved = Number((await tx.update(quotes).set({ customerId: survivor.id, updatedAt: new Date() }).where(and(eq(quotes.organizationId, input.organizationId), eq(quotes.customerId, duplicate.id))).returning({ id: quotes.id })).length);
    counts.ordersMoved = Number((await tx.update(orders).set({ customerId: survivor.id, updatedAt: new Date() }).where(and(eq(orders.organizationId, input.organizationId), eq(orders.customerId, duplicate.id))).returning({ id: orders.id })).length);
    // Unsynchronized invoices resolve their CustomerRef at send time and must
    // be re-approved after their local customer changes. Completed provider
    // history stays immutable: retain its version, approval and sync state.
    counts.invoicesMoved = Number((await tx.update(invoices).set({
      customerId: survivor.id,
      accountingUpdatedAt: sql`case when coalesce(${invoices.qbInvoiceId}, ${invoices.externalAccountingId}, '') = '' then now() else ${invoices.accountingUpdatedAt} end`,
      updatedAt: new Date(),
      invoiceVersion: sql`case when coalesce(${invoices.qbInvoiceId}, ${invoices.externalAccountingId}, '') = '' then ${invoices.invoiceVersion} + 1 else ${invoices.invoiceVersion} end`,
      accountingApprovedAt: sql`case when coalesce(${invoices.qbInvoiceId}, ${invoices.externalAccountingId}, '') = '' then null else ${invoices.accountingApprovedAt} end`,
      accountingApprovedByUserId: sql`case when coalesce(${invoices.qbInvoiceId}, ${invoices.externalAccountingId}, '') = '' then null else ${invoices.accountingApprovedByUserId} end`,
      accountingApprovalRevokedAt: sql`case when coalesce(${invoices.qbInvoiceId}, ${invoices.externalAccountingId}, '') = '' and ${invoices.accountingApprovedAt} is not null then now() else ${invoices.accountingApprovalRevokedAt} end`,
    }).where(and(eq(invoices.organizationId, input.organizationId), eq(invoices.customerId, duplicate.id))).returning({ id: invoices.id })).length);
    counts.portalAccessMoved = Number((await tx.update(customerPortalAccess).set({ customerId: survivor.id, updatedAt: new Date() }).where(and(eq(customerPortalAccess.organizationId, input.organizationId), eq(customerPortalAccess.customerId, duplicate.id))).returning({ id: customerPortalAccess.id })).length);
    counts.portalBatchItemsMoved = Number((await tx.update(customerPortalOnboardingBatchItems).set({ customerId: survivor.id, updatedAt: new Date() }).where(and(eq(customerPortalOnboardingBatchItems.organizationId, input.organizationId), eq(customerPortalOnboardingBatchItems.customerId, duplicate.id))).returning({ id: customerPortalOnboardingBatchItems.id })).length);
    counts.productionFolderRefsMoved = Number((await tx.update(customerProductionFolderReferences).set({ customerId: survivor.id, updatedAt: new Date() }).where(and(eq(customerProductionFolderReferences.organizationId, input.organizationId), eq(customerProductionFolderReferences.customerId, duplicate.id))).returning({ id: customerProductionFolderReferences.id })).length);
    counts.inboundRulesMoved = Number((await tx.update(inboundAttachmentClassificationRules).set({ customerId: survivor.id, updatedAt: new Date() }).where(and(eq(inboundAttachmentClassificationRules.organizationId, input.organizationId), eq(inboundAttachmentClassificationRules.customerId, duplicate.id))).returning({ id: inboundAttachmentClassificationRules.id })).length);
    counts.inboundRecordsMoved = Number((await tx.update(inboundOrderRecords).set({ matchedCustomerId: survivor.id, updatedAt: new Date() }).where(and(eq(inboundOrderRecords.organizationId, input.organizationId), eq(inboundOrderRecords.matchedCustomerId, duplicate.id))).returning({ id: inboundOrderRecords.id })).length);
    counts.importCompanySelectionsMoved = Number((await tx.update(customerContactImportCompanyRecords).set({ selectedCustomerId: survivor.id, updatedAt: new Date() }).where(and(eq(customerContactImportCompanyRecords.organizationId, input.organizationId), eq(customerContactImportCompanyRecords.selectedCustomerId, duplicate.id))).returning({ id: customerContactImportCompanyRecords.id })).length);
    counts.importContactSelectionsMoved = Number((await tx.update(customerContactImportContactRecords).set({ selectedCustomerId: survivor.id, updatedAt: new Date() }).where(and(eq(customerContactImportContactRecords.organizationId, input.organizationId), eq(customerContactImportContactRecords.selectedCustomerId, duplicate.id))).returning({ id: customerContactImportContactRecords.id })).length);
    counts.importRelationshipSelectionsMoved = Number((await tx.update(customerContactImportRelationshipRecords).set({ selectedCustomerId: survivor.id, updatedAt: new Date() }).where(and(eq(customerContactImportRelationshipRecords.organizationId, input.organizationId), eq(customerContactImportRelationshipRecords.selectedCustomerId, duplicate.id))).returning({ id: customerContactImportRelationshipRecords.id })).length);

    const [survivorPortalSettings] = await tx
      .select({ id: customerPortalCompanySettings.id })
      .from(customerPortalCompanySettings)
      .where(and(eq(customerPortalCompanySettings.organizationId, input.organizationId), eq(customerPortalCompanySettings.customerId, survivor.id)))
      .limit(1);
    if (survivorPortalSettings) {
      // Settings conflict: retain the duplicate setting on the archived source
      // for recovery/audit instead of silently discarding it. The survivor's
      // existing setting remains the active portal policy.
      counts.portalCompanySettingsRetainedOnMergedSource = Number((await tx
        .select({ id: customerPortalCompanySettings.id })
        .from(customerPortalCompanySettings)
        .where(and(eq(customerPortalCompanySettings.organizationId, input.organizationId), eq(customerPortalCompanySettings.customerId, duplicate.id)))
        .limit(1)).length);
    } else {
      counts.portalCompanySettingsMoved = Number((await tx
        .update(customerPortalCompanySettings)
        .set({ customerId: survivor.id, updatedAt: new Date() })
        .where(and(eq(customerPortalCompanySettings.organizationId, input.organizationId), eq(customerPortalCompanySettings.customerId, duplicate.id)))
        .returning({ id: customerPortalCompanySettings.id })).length);
    }

    const visibleProducts = await tx
      .select({ productId: customerVisibleProducts.productId })
      .from(customerVisibleProducts)
      .where(eq(customerVisibleProducts.customerId, duplicate.id));
    let visibleProductsMoved = 0;
    for (const row of visibleProducts) {
      await tx
        .insert(customerVisibleProducts)
        .values({ customerId: survivor.id, productId: row.productId })
        .onConflictDoNothing();
      visibleProductsMoved += 1;
    }
    if (visibleProducts.length > 0) {
      await tx.delete(customerVisibleProducts).where(eq(customerVisibleProducts.customerId, duplicate.id));
    }
    counts.visibleProductsMoved = visibleProductsMoved;

    const duplicateIdentities = identities.filter((identity: ExternalIdentityMapping) => identity.entityId === duplicate.id);
    const retiredQuickBooksIdentityMappings = identities.filter((identity: ExternalIdentityMapping) =>
      identity.sourceSystem === "quickbooks" &&
      identity.sourceEntityType === "customer" &&
      cleanId(identity.sourceRecordId) !== decision.quickBooksCustomerId,
    );
    let identitiesMoved = 0;
    for (const identity of duplicateIdentities) {
      const isNonRetainedQuickBooksCustomerIdentity =
        identity.sourceSystem === "quickbooks" &&
        identity.sourceEntityType === "customer" &&
        cleanId(identity.sourceRecordId) !== decision.quickBooksCustomerId;
      if (isNonRetainedQuickBooksCustomerIdentity) continue;
      await tx
        .insert(externalIdentityMappings)
        .values({
          organizationId: identity.organizationId,
          entityType: identity.entityType,
          entityId: survivor.id,
          sourceSystem: identity.sourceSystem,
          sourceEntityType: identity.sourceEntityType,
          sourceRecordId: identity.sourceRecordId,
          sourceDisplayName: identity.sourceDisplayName,
          metadataJson: identity.metadataJson,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            externalIdentityMappings.organizationId,
            externalIdentityMappings.sourceSystem,
            externalIdentityMappings.sourceEntityType,
            externalIdentityMappings.sourceRecordId,
          ],
          set: {
            entityType: identity.entityType,
            entityId: survivor.id,
            sourceDisplayName: identity.sourceDisplayName,
            metadataJson: identity.metadataJson,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          },
        });
      identitiesMoved += 1;
    }
    if (duplicateIdentities.length > 0) {
      await tx
        .delete(externalIdentityMappings)
        .where(and(
          eq(externalIdentityMappings.organizationId, input.organizationId),
          eq(externalIdentityMappings.entityType, "customer"),
          eq(externalIdentityMappings.entityId, duplicate.id),
        ));
    }
    if (retiredQuickBooksIdentityMappings.length > 0) {
      await tx
        .delete(externalIdentityMappings)
        .where(and(
          eq(externalIdentityMappings.organizationId, input.organizationId),
          eq(externalIdentityMappings.entityType, "customer"),
          inArray(externalIdentityMappings.id, retiredQuickBooksIdentityMappings.map((identity) => identity.id)),
        ));
    }
    counts.externalIdentitiesMoved = identitiesMoved;
    counts.retiredQuickBooksIdentityMappingsRemoved = retiredQuickBooksIdentityMappings.length;

    counts.notesMoved = Number((await tx.update(customerNotes).set({ customerId: survivor.id, updatedAt: new Date() }).where(eq(customerNotes.customerId, duplicate.id)).returning({ id: customerNotes.id })).length);
    counts.creditTransactionsMoved = Number((await tx.update(customerCreditTransactions).set({ customerId: survivor.id }).where(eq(customerCreditTransactions.customerId, duplicate.id)).returning({ id: customerCreditTransactions.id })).length);

    const archivedNote = [
      duplicate.notes,
      `Superseded by customer ${survivor.id} during reviewed canonical customer merge${input.reason ? `: ${input.reason}` : "."}`,
    ].filter(Boolean).join("\n");
    await tx
      .update(customers)
      .set({
        status: "archived",
        isActive: false,
        notes: archivedNote,
        mergedIntoCustomerId: survivor.id,
        mergedAt: new Date(),
        mergedByUserId: input.actorUserId ?? null,
        customerMergeOperationId: input.mergeOperationId ?? null,
        updatedAt: new Date(),
      } as any)
      .where(and(eq(customers.organizationId, input.organizationId), eq(customers.id, duplicate.id)));

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.actorUserId ?? null,
      actionType: "customer_merged",
      entityType: "customer",
      entityId: duplicate.id,
      entityName: duplicate.companyName,
      description: `Merged customer into ${survivor.companyName}.`,
      newValues: { survivorCustomerId: survivor.id, mergeOperationId: input.mergeOperationId ?? null, counts, quickBooksResolution } as any,
    } as any);

    console.info("[CUSTOMER IDENTITY] merge committed", {
      organizationId: input.organizationId,
      survivorCustomerId: survivor.id,
      duplicateCustomerId: duplicate.id,
      elapsedMs: Date.now() - startedAt,
      counts,
    });

    return {
      success: true,
      decision,
      quickBooksResolution,
      survivorCustomerId: survivor.id,
      duplicateCustomerId: duplicate.id,
      counts,
    };
  });
}

export async function getCustomerMergePreview(input: {
  organizationId: string;
  customerIds: string[];
}) {
  const customerIds = Array.from(new Set(input.customerIds.map((id) => id.trim()).filter(Boolean)));
  if (customerIds.length < 2) throw new CustomerIdentityConflictError("MERGE_SELECTION_TOO_SMALL", "Select at least two customers to merge.");
  const rows = await db.select().from(customers).where(and(
    eq(customers.organizationId, input.organizationId),
    inArray(customers.id, customerIds),
  ));
  if (rows.length !== customerIds.length) throw new CustomerIdentityConflictError("CUSTOMER_NOT_FOUND", "Every selected customer must belong to this organization.");
  const conflicts: Record<string, Array<{ customerId: string; value: unknown }>> = {};
  for (const field of mergeSelectableFields) {
    const values = rows.map((customer: any) => ({ customerId: customer.id, value: customer[field] }))
      .filter((entry) => comparableFieldValue(entry.value) !== null);
    if (new Set(values.map((entry) => comparableFieldValue(entry.value))).size > 1) conflicts[field] = values;
  }
  const ids = rows.map((row) => row.id);
  const identities = await db
    .select({
      entityId: externalIdentityMappings.entityId,
      sourceSystem: externalIdentityMappings.sourceSystem,
      sourceEntityType: externalIdentityMappings.sourceEntityType,
      sourceRecordId: externalIdentityMappings.sourceRecordId,
    })
    .from(externalIdentityMappings)
    .where(and(
      eq(externalIdentityMappings.organizationId, input.organizationId),
      eq(externalIdentityMappings.entityType, "customer"),
      inArray(externalIdentityMappings.entityId, ids),
    ));
  const quickBooksResolution = getQuickBooksMergePreview(rows, identities);
  const count = async (table: any, field: any) => Number((await db.select({ count: sql<number>`count(*)::int` }).from(table).where(and(eq((table as any).organizationId, input.organizationId), inArray(field, ids))))[0]?.count ?? 0);
  const relationshipCounts = {
    contacts: Number((await db.select({ count: sql<number>`count(*)::int` }).from(customerContactLinks).where(and(eq(customerContactLinks.organizationId, input.organizationId), inArray(customerContactLinks.customerId, ids))))[0]?.count ?? 0),
    orders: await count(orders, orders.customerId),
    quotes: await count(quotes, quotes.customerId),
    invoices: await count(invoices, invoices.customerId),
    payments: Number((await db.select({ count: sql<number>`count(*)::int` }).from(payments).innerJoin(invoices, eq(payments.invoiceId, invoices.id)).where(and(eq(payments.organizationId, input.organizationId), inArray(invoices.customerId, ids))))[0]?.count ?? 0),
    portalUsers: await count(customerPortalAccess, customerPortalAccess.customerId),
    notes: Number((await db.select({ count: sql<number>`count(*)::int` }).from(customerNotes).where(inArray(customerNotes.customerId, ids)))[0]?.count ?? 0),
  };
  const primaryContacts = await db.select({
    contactId: customerContactLinks.contactId,
    customerId: customerContactLinks.customerId,
    firstName: customerContacts.firstName,
    lastName: customerContacts.lastName,
    email: customerContacts.email,
  }).from(customerContactLinks).innerJoin(customerContacts, eq(customerContacts.id, customerContactLinks.contactId)).where(and(
    eq(customerContactLinks.organizationId, input.organizationId),
    inArray(customerContactLinks.customerId, ids),
    eq(customerContactLinks.status, "active"),
    eq(customerContactLinks.isPrimary, true),
  ));
  return { customers: rows, conflicts, relationshipCounts, primaryContacts, quickBooksResolution };
}

/** Multi-source, admin-reviewed canonical customer merge boundary. */
export async function mergeCustomers(input: {
  organizationId: string;
  survivorCustomerId: string;
  sourceCustomerIds: string[];
  actorUserId: string;
  fieldChoices: Partial<Record<MergeSelectableField, string>>;
  primaryContactId?: string | null;
  reviewed: boolean;
  reason?: string | null;
}) {
  const sourceCustomerIds = Array.from(new Set(input.sourceCustomerIds.map((id) => id.trim()).filter((id) => id && id !== input.survivorCustomerId)));
  if (!input.reviewed) throw new CustomerIdentityConflictError("REVIEW_REQUIRED", "Confirm the reviewed customer merge before it can execute.");
  if (!sourceCustomerIds.length) throw new CustomerIdentityConflictError("MERGE_SELECTION_TOO_SMALL", "Select at least one source customer in addition to the survivor.");
  const preview = await getCustomerMergePreview({ organizationId: input.organizationId, customerIds: [input.survivorCustomerId, ...sourceCustomerIds] });
  for (const field of Object.keys(preview.conflicts)) {
    const choice = input.fieldChoices[field as MergeSelectableField];
    if (!choice || ![input.survivorCustomerId, ...sourceCustomerIds].includes(choice)) {
      throw new CustomerIdentityConflictError("FIELD_CONFLICT_RESOLUTION_REQUIRED", `Choose the canonical value for ${field}.`, { field, candidates: preview.conflicts[field] });
    }
  }
  if (preview.primaryContacts.length > 1 && !input.primaryContactId) {
    throw new CustomerIdentityConflictError("PRIMARY_CONTACT_RESOLUTION_REQUIRED", "Choose the primary contact for the surviving customer.", { primaryContacts: preview.primaryContacts });
  }

  return db.transaction(async (tx: any) => {
    const selectedIds = [input.survivorCustomerId, ...sourceCustomerIds];
    const selected = await tx.select().from(customers).where(and(eq(customers.organizationId, input.organizationId), inArray(customers.id, selectedIds))).orderBy(asc(customers.id)).for("update");
    if (selected.length !== selectedIds.length) throw new CustomerIdentityConflictError("CUSTOMER_NOT_FOUND", "Every selected customer must belong to this organization.");
    const survivor = selected.find((customer: Customer) => customer.id === input.survivorCustomerId)!;
    if ((survivor as any).mergedIntoCustomerId) throw new CustomerIdentityConflictError("SURVIVOR_ALREADY_MERGED", "Choose the final active customer as the survivor.");
    const alreadyMergedSources = selected.filter((customer: Customer) => customer.id !== survivor.id && (customer as any).mergedIntoCustomerId);
    if (alreadyMergedSources.length === sourceCustomerIds.length) {
      const wrongSurvivor = alreadyMergedSources.find((customer: any) => customer.mergedIntoCustomerId !== survivor.id);
      if (wrongSurvivor) throw new CustomerIdentityConflictError("SOURCE_ALREADY_MERGED", "A selected source customer was already merged into a different customer.", { sourceCustomerId: wrongSurvivor.id, mergedIntoCustomerId: wrongSurvivor.mergedIntoCustomerId });
      return { success: true, alreadyMerged: true, mergeOperationId: (alreadyMergedSources[0] as any).customerMergeOperationId ?? null, survivorCustomerId: survivor.id, sourceCustomerIds, relationshipCounts: {} };
    }
    if (alreadyMergedSources.length) throw new CustomerIdentityConflictError("SOURCE_ALREADY_MERGED", "A selected source customer was already merged; retry only the same complete merge or start a new reviewed merge.");
    const patch: Record<string, unknown> = {};
    for (const [field, choiceCustomerId] of Object.entries(input.fieldChoices)) {
      if (!(mergeSelectableFields as readonly string[]).includes(field)) continue;
      const source = selected.find((customer: Customer) => customer.id === choiceCustomerId);
      if (!source) throw new CustomerIdentityConflictError("FIELD_CHOICE_INVALID", "A chosen field source is not part of this merge.", { field, choiceCustomerId });
      patch[field] = (source as any)[field];
    }
    if (Object.keys(patch).length) await tx.update(customers).set({ ...patch, updatedAt: new Date() } as any).where(and(eq(customers.organizationId, input.organizationId), eq(customers.id, survivor.id)));
    const [operation] = await tx.insert(customerMergeOperations).values({
      organizationId: input.organizationId,
      survivorCustomerId: survivor.id,
      sourceCustomerIds,
      actorUserId: input.actorUserId,
      fieldChoices: input.fieldChoices as any,
      relationshipCounts: {},
      warnings: [],
    } as any).returning();
    const results = [] as any[];
    for (const duplicateCustomerId of sourceCustomerIds) {
      results.push(await mergeDuplicateCustomers({
        organizationId: input.organizationId,
        survivorCustomerId: survivor.id,
        duplicateCustomerId,
        actorUserId: input.actorUserId,
        reviewed: true,
        reason: input.reason ?? null,
        mergeOperationId: operation.id,
        dbClient: tx,
      }));
    }
    const relationshipCounts = results.reduce((total, result) => {
      for (const [key, value] of Object.entries(result.counts ?? {})) total[key] = Number(total[key] ?? 0) + Number(value ?? 0);
      return total;
    }, {} as Record<string, number>);
    const activeSurvivorLinks = await tx.select().from(customerContactLinks).where(and(
      eq(customerContactLinks.organizationId, input.organizationId),
      eq(customerContactLinks.customerId, survivor.id),
      eq(customerContactLinks.status, "active"),
    )).orderBy(asc(customerContactLinks.createdAt), asc(customerContactLinks.id));
    const primaryContactId = input.primaryContactId ?? activeSurvivorLinks.find((link: any) => link.isPrimary)?.contactId ?? null;
    if (primaryContactId) {
      if (!activeSurvivorLinks.some((link: any) => link.contactId === primaryContactId)) throw new CustomerIdentityConflictError("PRIMARY_CONTACT_INVALID", "The selected primary contact is not linked to the surviving customer.");
      await tx.update(customerContactLinks).set({ isPrimary: false, updatedAt: new Date() }).where(and(eq(customerContactLinks.organizationId, input.organizationId), eq(customerContactLinks.customerId, survivor.id), eq(customerContactLinks.status, "active")));
      await tx.update(customerContactLinks).set({ isPrimary: true, updatedAt: new Date() }).where(and(eq(customerContactLinks.organizationId, input.organizationId), eq(customerContactLinks.customerId, survivor.id), eq(customerContactLinks.contactId, primaryContactId), eq(customerContactLinks.status, "active")));
      relationshipCounts.primaryContactNormalized = 1;
    }
    const quickBooksResolutions = results.map((result) => result.quickBooksResolution).filter(Boolean);
    const warnings = quickBooksResolutions
      .filter((resolution: any) => resolution.retiredQuickBooksCustomerIds?.length)
      .map((resolution: any) => `QuickBooks mapping retained ${resolution.retainedQuickBooksCustomerId}; retired local mapping(s): ${resolution.retiredQuickBooksCustomerIds.join(", ")}.`);
    await tx.update(customerMergeOperations).set({ relationshipCounts, warnings } as any).where(eq(customerMergeOperations.id, operation.id));
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      actionType: "customer_merge_completed",
      entityType: "customer",
      entityId: survivor.id,
      entityName: survivor.companyName,
      description: `Merged ${sourceCustomerIds.length} customer record(s) into the canonical customer.`,
      newValues: { mergeOperationId: operation.id, sourceCustomerIds, fieldChoices: input.fieldChoices, relationshipCounts, quickBooksResolutions } as any,
    } as any);
    return { success: true, mergeOperationId: operation.id, survivorCustomerId: survivor.id, sourceCustomerIds, fieldChoices: input.fieldChoices, relationshipCounts, quickBooksResolutions };
  });
}
