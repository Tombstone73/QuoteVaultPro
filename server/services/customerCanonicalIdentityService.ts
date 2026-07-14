import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  customerContactImportCompanyRecords,
  customerContactImportContactRecords,
  customerContactImportRelationshipRecords,
  customerContactLinks,
  customerContacts,
  customerCreditTransactions,
  customerNotes,
  customerPortalAccess,
  customerPortalCompanySettings,
  customerPortalOnboardingBatchItems,
  customerProductionFolderReferences,
  customerVisibleProducts,
  customers,
  externalIdentityMappings,
  inboundAttachmentClassificationRules,
  inboundOrderRecords,
  invoices,
  orders,
  quotes,
  type Customer,
  type ExternalIdentityMapping,
} from "@shared/schema";

export type CustomerIdentityRecord = Pick<Customer, "id" | "companyName" | "externalAccountingId" | "status">;

export type CustomerMergeDecision =
  | {
      action: "merge";
      survivorCustomerId: string;
      duplicateCustomerId: string;
      reason: "same_quickbooks_id" | "single_quickbooks_survivor" | "explicit_review";
      requiresReviewedAction: boolean;
      quickBooksCustomerId: string | null;
    }
  | {
      action: "block";
      code: "QUICKBOOKS_ID_CONFLICT" | "SAME_CUSTOMER";
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

  if (leftQb && rightQb && leftQb !== rightQb) {
    return {
      action: "block",
      code: "QUICKBOOKS_ID_CONFLICT",
      message: `Companies have different QuickBooks customer IDs (${leftQb} and ${rightQb}); an automatic merge is blocked.`,
      leftQuickBooksCustomerId: leftQb,
      rightQuickBooksCustomerId: rightQb,
    };
  }

  if (leftQb && rightQb && leftQb === rightQb) {
    const preferred = input.preferredSurvivorId === right.id ? right : left;
    const duplicate = preferred.id === left.id ? right : left;
    return {
      action: "merge",
      survivorCustomerId: preferred.id,
      duplicateCustomerId: duplicate.id,
      reason: "same_quickbooks_id",
      requiresReviewedAction: false,
      quickBooksCustomerId: leftQb,
    };
  }

  if (leftQb || rightQb) {
    const survivor = leftQb ? left : right;
    const duplicate = leftQb ? right : left;
    return {
      action: "merge",
      survivorCustomerId: survivor.id,
      duplicateCustomerId: duplicate.id,
      reason: "single_quickbooks_survivor",
      requiresReviewedAction: true,
      quickBooksCustomerId: leftQb ?? rightQb,
    };
  }

  const preferred = input.preferredSurvivorId === right.id ? right : left;
  const duplicate = preferred.id === left.id ? right : left;
  return {
    action: "merge",
    survivorCustomerId: preferred.id,
    duplicateCustomerId: duplicate.id,
    reason: "explicit_review",
    requiresReviewedAction: true,
    quickBooksCustomerId: null,
  };
}

type DbClient = typeof db;

export async function mergeDuplicateCustomers(input: {
  organizationId: string;
  survivorCustomerId: string;
  duplicateCustomerId: string;
  actorUserId?: string | null;
  reviewed?: boolean;
  reason?: string | null;
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

    if (decision.survivorCustomerId !== input.survivorCustomerId) {
      throw new CustomerIdentityConflictError(
        "SURVIVOR_MUST_CARRY_QUICKBOOKS_ID",
        "The QuickBooks-backed company must be selected as the survivor.",
        {
          requestedSurvivorCustomerId: input.survivorCustomerId,
          canonicalSurvivorCustomerId: decision.survivorCustomerId,
          quickBooksCustomerId: decision.quickBooksCustomerId,
        },
      );
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
    const survivorQb = cleanId(survivor.externalAccountingId);
    const duplicateQb = cleanId(duplicate.externalAccountingId);

    console.info("[CUSTOMER IDENTITY] merge started", {
      organizationId: input.organizationId,
      survivorCustomerId: survivor.id,
      duplicateCustomerId: duplicate.id,
      survivorQuickBooksCustomerId: survivorQb,
      duplicateQuickBooksCustomerId: duplicateQb,
      reviewed: input.reviewed === true,
      reason: decision.reason,
    });

    if (!survivorQb && duplicateQb) {
      const [updated] = await tx
        .update(customers)
        .set({ externalAccountingId: duplicateQb, updatedAt: new Date() })
        .where(and(eq(customers.organizationId, input.organizationId), eq(customers.id, survivor.id)))
        .returning({ id: customers.id });
      counts.customerQuickBooksIdPromoted = updated ? 1 : 0;
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
    counts.invoicesMoved = Number((await tx.update(invoices).set({ customerId: survivor.id, updatedAt: new Date() }).where(and(eq(invoices.organizationId, input.organizationId), eq(invoices.customerId, duplicate.id))).returning({ id: invoices.id })).length);
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
      counts.portalCompanySettingsRemoved = Number((await tx
        .delete(customerPortalCompanySettings)
        .where(and(eq(customerPortalCompanySettings.organizationId, input.organizationId), eq(customerPortalCompanySettings.customerId, duplicate.id)))
        .returning({ id: customerPortalCompanySettings.id })).length);
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
    let identitiesMoved = 0;
    for (const identity of duplicateIdentities) {
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
    counts.externalIdentitiesMoved = identitiesMoved;

    counts.notesMoved = Number((await tx.update(customerNotes).set({ customerId: survivor.id, updatedAt: new Date() }).where(eq(customerNotes.customerId, duplicate.id)).returning({ id: customerNotes.id })).length);
    counts.creditTransactionsMoved = Number((await tx.update(customerCreditTransactions).set({ customerId: survivor.id }).where(eq(customerCreditTransactions.customerId, duplicate.id)).returning({ id: customerCreditTransactions.id })).length);

    const archivedNote = [
      duplicate.notes,
      `Superseded by customer ${survivor.id} during reviewed canonical customer merge${input.reason ? `: ${input.reason}` : "."}`,
    ].filter(Boolean).join("\n");
    await tx
      .update(customers)
      .set({ status: "archived", isActive: false, notes: archivedNote, updatedAt: new Date() })
      .where(and(eq(customers.organizationId, input.organizationId), eq(customers.id, duplicate.id)));

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
      survivorCustomerId: survivor.id,
      duplicateCustomerId: duplicate.id,
      counts,
    };
  });
}
