import crypto from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  auditLogs,
  customerContactImportBatches,
  customerContactImportCompanyRecords,
  customerContactImportContactRecords,
  customerContactImportRelationshipRecords,
  customerContactQuickBooksSourceSnapshots,
  customerContactLinks,
  customerContacts,
  customers,
  externalIdentityMappings,
  type CustomerContactImportBatch,
  type CustomerContactQuickBooksSourceSnapshot,
} from "@shared/schema";
import {
  fetchQBCustomersForMigrationSource,
  getQuickBooksCustomerMigrationSourceStatus,
  type QuickBooksCustomerMigrationSourceStatus,
} from "../../quickbooksService";
import { parseBool, parseCsvOrThrow, parseNum } from "../../utils/csvImportUtils";
import {
  emailDomain,
  isGenericSharedEmail,
  matchCompany,
  matchContact,
  normalizeCompanyName,
  normalizeEmail,
  normalizePersonName,
  normalizePhone,
  relationshipFlagsFromInfoFloType,
  type ContactLike,
  type ExternalIdentityLike,
  type NormalizedCompanySource,
  type NormalizedContactSource,
} from "./matching";

type DbClient = typeof db;

export interface QuickBooksCustomerSource {
  Id?: string;
  DisplayName?: string;
  CompanyName?: string;
  PrimaryEmailAddr?: { Address?: string } | string;
  PrimaryPhone?: { FreeFormNumber?: string } | string;
  BillAddr?: Record<string, unknown>;
  ShipAddr?: Record<string, unknown>;
  Taxable?: boolean;
  Balance?: unknown;
  TermRef?: { name?: string; value?: string } | string;
}

export interface CreateMigrationBatchInput {
  organizationId: string;
  actorUserId: string;
  sourceLabel?: string | null;
  quickBooksSourceSnapshotId?: string | null;
  quickBooksCustomers?: QuickBooksCustomerSource[];
  qbSourceLabel?: string | null;
  infoFloCompanyCsv?: string | null;
  infoFloCompanyFilename?: string | null;
  infoFloContactsCsv?: string | null;
  infoFloContactsFilename?: string | null;
}

function checksum(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return crypto.createHash("sha256").update(value).digest("hex");
}

function read(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function parseCsvAllowEmpty(csv: string | null | undefined): { rows: Record<string, string>[]; warnings: string[] } {
  if (!csv || !csv.trim()) return { rows: [], warnings: ["CSV file is empty."] };
  try {
    return { rows: parseCsvOrThrow(csv), warnings: [] };
  } catch (error: any) {
    if (error?.message === "CSV must contain at least one data row") {
      return { rows: [], warnings: ["CSV file contains headers but no data rows."] };
    }
    throw error;
  }
}

function qbText(value: unknown, nestedKey?: string): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (nestedKey && typeof value === "object") {
    const nested = (value as Record<string, unknown>)[nestedKey];
    return typeof nested === "string" && nested.trim() ? nested.trim() : null;
  }
  return null;
}

function qbAddress(addr: Record<string, unknown> | undefined) {
  return {
    street1: qbText(addr?.Line1),
    street2: qbText(addr?.Line2),
    city: qbText(addr?.City),
    state: qbText(addr?.CountrySubDivisionCode),
    postalCode: qbText(addr?.PostalCode),
    country: qbText(addr?.Country),
  };
}

function normalizeQbCustomer(qb: QuickBooksCustomerSource): NormalizedCompanySource & { permanentPatch: Record<string, unknown> } {
  const billing = qbAddress(qb.BillAddr);
  const shipping = qbAddress(qb.ShipAddr);
  const email = qbText(qb.PrimaryEmailAddr, "Address");
  const phone = qbText(qb.PrimaryPhone, "FreeFormNumber");
  const name = qbText(qb.CompanyName) || qbText(qb.DisplayName) || "";
  return {
    sourceRecordId: qb.Id ?? null,
    quickBooksCustomerId: qb.Id ?? null,
    quickBooksCustomerName: qbText(qb.DisplayName),
    name,
    email,
    phone,
    street1: billing.street1,
    city: billing.city,
    state: billing.state,
    postalCode: billing.postalCode,
    permanentPatch: {
      companyName: name || qbText(qb.DisplayName) || "Unnamed QuickBooks Customer",
      email,
      phone,
      billingStreet1: billing.street1,
      billingStreet2: billing.street2,
      billingCity: billing.city,
      billingState: billing.state,
      billingPostalCode: billing.postalCode,
      billingCountry: billing.country,
      shippingStreet1: shipping.street1,
      shippingStreet2: shipping.street2,
      shippingCity: shipping.city,
      shippingState: shipping.state,
      shippingPostalCode: shipping.postalCode,
      shippingCountry: shipping.country,
      isTaxExempt: qb.Taxable === false ? true : undefined,
      currentBalance: parseNum(qb.Balance),
      externalAccountingId: qb.Id,
      syncStatus: qb.Id ? "synced" : undefined,
      syncedAt: qb.Id ? new Date() : undefined,
    },
  };
}

function normalizeInfoFloCompany(row: Record<string, string>): NormalizedCompanySource & { permanentPatch: Record<string, unknown>; proofEmail?: string | null } {
  const billingStreet1 = read(row, ["Billing Street 1", "Billing Address 1", "Address", "Street 1"]);
  const shippingStreet1 = read(row, ["Shipping Street 1", "Shipping Address 1", "Ship Address", "Ship Street 1"]);
  const name = read(row, ["Name", "Company", "Company Name"]);
  const email = read(row, ["Email", "E-mail"]);
  const phone = read(row, ["Phone", "Main Phone"]);
  return {
    sourceRecordId: read(row, ["Entry Id", "Entry ID", "ID"]) || null,
    quickBooksCustomerName: read(row, ["QuickBooks Customer Name", "QB Customer Name"]) || null,
    name,
    email,
    phone,
    street1: billingStreet1 || shippingStreet1 || null,
    city: read(row, ["Billing City", "City"]) || null,
    state: read(row, ["Billing State", "State"]) || null,
    postalCode: read(row, ["Billing Postal Code", "Postal Code", "Zip"]) || null,
    proofEmail: read(row, ["Proof Email", "Proof E-mail"]) || null,
    permanentPatch: {
      companyName: name,
      email: email || undefined,
      phone: phone || undefined,
      billingStreet1: billingStreet1 || undefined,
      billingStreet2: read(row, ["Billing Street 2", "Billing Address 2"]) || undefined,
      billingCity: read(row, ["Billing City", "City"]) || undefined,
      billingState: read(row, ["Billing State", "State"]) || undefined,
      billingPostalCode: read(row, ["Billing Postal Code", "Postal Code", "Zip"]) || undefined,
      shippingStreet1: shippingStreet1 || undefined,
      shippingStreet2: read(row, ["Shipping Street 2", "Shipping Address 2"]) || undefined,
      shippingCity: read(row, ["Shipping City"]) || undefined,
      shippingState: read(row, ["Shipping State"]) || undefined,
      shippingPostalCode: read(row, ["Shipping Postal Code", "Shipping Zip"]) || undefined,
      isTaxExempt: parseBool(read(row, ["Tax Exempt", "Is Tax Exempt"])) ?? undefined,
      taxExemptReason: read(row, ["Tax Exempt Reason"]) || undefined,
      currentBalance: parseNum(read(row, ["Open Balance", "Balance", "Credit"])),
      notes: read(row, ["Notes", "Metadata"]) || undefined,
    },
  };
}

function normalizeInfoFloContact(row: Record<string, string>): NormalizedContactSource & { permanentPatch: Record<string, unknown> } {
  const firstName = read(row, ["First Name", "FirstName"]);
  const lastName = read(row, ["Last Name", "LastName"]);
  const fullName = read(row, ["Full Name", "Name"]);
  const personName = normalizePersonName(firstName, lastName, fullName);
  return {
    sourceRecordId: read(row, ["Entry Id", "Entry ID", "ID"]) || null,
    firstName: personName?.firstName ?? firstName,
    lastName: personName?.lastName ?? lastName,
    fullName,
    companyName: read(row, ["Company", "Company Name"]) || null,
    email: read(row, ["Email", "E-mail"]) || null,
    phone: read(row, ["Phone"]) || null,
    mobile: read(row, ["Mobile", "Cell"]) || null,
    title: read(row, ["Title"]) || null,
    type: read(row, ["Type"]) || null,
    billToEmail: read(row, ["Bill To Email", "Bill To E-mail"]) || null,
    proofEmail: read(row, ["Proof Email", "Proof E-mail"]) || null,
    permanentPatch: {
      firstName: personName?.firstName ?? firstName,
      lastName: personName?.lastName ?? lastName,
      title: read(row, ["Title"]) || undefined,
      email: read(row, ["Email", "E-mail"]) || undefined,
      phone: read(row, ["Phone"]) || undefined,
      mobile: read(row, ["Mobile", "Cell"]) || undefined,
      street1: read(row, ["Street 1", "Address 1"]) || undefined,
      street2: read(row, ["Street 2", "Address 2"]) || undefined,
      city: read(row, ["City"]) || undefined,
      state: read(row, ["State"]) || undefined,
      postalCode: read(row, ["Postal Code", "Zip"]) || undefined,
      flags: [],
    },
  };
}

function compactPatch<T extends Record<string, unknown>>(patch: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    result[key] = value;
  }
  return result as T;
}

async function loadExternalIdentities(dbClient: DbClient, organizationId: string): Promise<ExternalIdentityLike[]> {
  return dbClient
    .select({
      entityType: externalIdentityMappings.entityType,
      entityId: externalIdentityMappings.entityId,
      sourceSystem: externalIdentityMappings.sourceSystem,
      sourceEntityType: externalIdentityMappings.sourceEntityType,
      sourceRecordId: externalIdentityMappings.sourceRecordId,
    })
    .from(externalIdentityMappings)
    .where(eq(externalIdentityMappings.organizationId, organizationId));
}

async function loadContactLikes(dbClient: DbClient, organizationId: string): Promise<ContactLike[]> {
  const contacts = await dbClient
    .select()
    .from(customerContacts)
    .where(eq(customerContacts.organizationId, organizationId));

  if (contacts.length === 0) return [];

  const contactIds = contacts.map((contact) => contact.id);
  const links = contactIds.length > 0
    ? await dbClient
      .select({ contactId: customerContactLinks.contactId, customerId: customerContactLinks.customerId })
      .from(customerContactLinks)
      .where(and(eq(customerContactLinks.organizationId, organizationId), inArray(customerContactLinks.contactId, contactIds), sql`${customerContactLinks.status} <> 'removed'`))
    : [];

  return contacts.map((contact) => ({
    id: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    mobile: contact.mobile,
    externalSource: contact.externalSource,
    externalSourceId: contact.externalSourceId,
    externalSourceType: contact.externalSourceType,
    linkedCustomerIds: links.filter((link) => link.contactId === contact.id).map((link) => link.customerId),
  }));
}

async function upsertExternalIdentity(
  tx: any,
  args: {
    organizationId: string;
    entityType: string;
    entityId: string;
    sourceSystem: string;
    sourceEntityType: string;
    sourceRecordId?: string | null;
    sourceDisplayName?: string | null;
    metadataJson?: Record<string, unknown> | null;
  },
) {
  if (!args.sourceRecordId) return;
  await tx
    .insert(externalIdentityMappings)
    .values({
      organizationId: args.organizationId,
      entityType: args.entityType,
      entityId: args.entityId,
      sourceSystem: args.sourceSystem,
      sourceEntityType: args.sourceEntityType,
      sourceRecordId: args.sourceRecordId,
      sourceDisplayName: args.sourceDisplayName ?? null,
      metadataJson: args.metadataJson ?? null,
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
        entityType: args.entityType,
        entityId: args.entityId,
        sourceDisplayName: args.sourceDisplayName ?? null,
        metadataJson: args.metadataJson ?? null,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

export class CustomerContactMigrationService {
  constructor(private readonly dbClient: DbClient = db) {}

  async getQuickBooksSourceStatus(organizationId: string): Promise<QuickBooksCustomerMigrationSourceStatus> {
    return getQuickBooksCustomerMigrationSourceStatus(organizationId);
  }

  async retrieveQuickBooksSourceSnapshot(input: { organizationId: string; actorUserId: string }) {
    const result = await fetchQBCustomersForMigrationSource(input.organizationId);
    const [snapshot] = await this.dbClient
      .insert(customerContactQuickBooksSourceSnapshots)
      .values({
        organizationId: input.organizationId,
        sourceMode: "live",
        status: "ready",
        connectedCompanyName: result.status.connectedCompanyName,
        quickBooksCompanyId: result.status.quickBooksCompanyId,
        lastSuccessfulSyncAt: result.status.lastSuccessfulSyncAt,
        retrievedCount: result.customers.length,
        rawCustomersJson: result.customers,
        createdByUserId: input.actorUserId,
        updatedAt: new Date(),
      })
      .returning();

    return {
      snapshot,
      status: result.status,
      retrievedAt: result.retrievedAt,
      customerCount: result.customers.length,
    };
  }

  async uploadQuickBooksSourceSnapshot(input: {
    organizationId: string;
    actorUserId: string;
    quickBooksCustomers: QuickBooksCustomerSource[];
  }) {
    const customers = Array.isArray(input.quickBooksCustomers) ? input.quickBooksCustomers : [];
    const status = await getQuickBooksCustomerMigrationSourceStatus(input.organizationId).catch(() => null);
    const [snapshot] = await this.dbClient
      .insert(customerContactQuickBooksSourceSnapshots)
      .values({
        organizationId: input.organizationId,
        sourceMode: "upload",
        status: "ready",
        connectedCompanyName: status?.connectedCompanyName ?? null,
        quickBooksCompanyId: status?.quickBooksCompanyId ?? null,
        lastSuccessfulSyncAt: status?.lastSuccessfulSyncAt ?? null,
        retrievedCount: customers.length,
        rawCustomersJson: customers as Record<string, unknown>[],
        createdByUserId: input.actorUserId,
        updatedAt: new Date(),
      })
      .returning();

    return {
      snapshot,
      status,
      retrievedAt: snapshot.createdAt,
      customerCount: customers.length,
    };
  }

  private async loadQuickBooksSourceSnapshot(organizationId: string, snapshotId: string): Promise<CustomerContactQuickBooksSourceSnapshot> {
    const [snapshot] = await this.dbClient
      .select()
      .from(customerContactQuickBooksSourceSnapshots)
      .where(and(
        eq(customerContactQuickBooksSourceSnapshots.organizationId, organizationId),
        eq(customerContactQuickBooksSourceSnapshots.id, snapshotId),
        eq(customerContactQuickBooksSourceSnapshots.status, "ready"),
      ))
      .limit(1);

    if (!snapshot) {
      throw Object.assign(new Error("QuickBooks source snapshot was not found or is not ready."), { statusCode: 400 });
    }

    return snapshot;
  }

  async createBatch(input: CreateMigrationBatchInput) {
    const companyCsv = parseCsvAllowEmpty(input.infoFloCompanyCsv);
    const contactsCsv = parseCsvAllowEmpty(input.infoFloContactsCsv);
    const qbSnapshot = input.quickBooksSourceSnapshotId
      ? await this.loadQuickBooksSourceSnapshot(input.organizationId, input.quickBooksSourceSnapshotId)
      : null;
    const qbCustomers = qbSnapshot
      ? ((qbSnapshot.rawCustomersJson ?? []) as QuickBooksCustomerSource[])
      : input.quickBooksCustomers ?? [];
    const qbSourceLabel = input.qbSourceLabel
      ?? (qbSnapshot?.sourceMode === "live"
        ? `Connected QuickBooks: ${qbSnapshot.connectedCompanyName ?? qbSnapshot.quickBooksCompanyId ?? "unknown company"}`
        : qbSnapshot?.sourceMode === "upload"
          ? "Uploaded QuickBooks customer JSON fallback"
          : null);
    const qbSourceSummary = qbSnapshot
      ? {
          snapshotId: qbSnapshot.id,
          mode: qbSnapshot.sourceMode,
          connectedCompanyName: qbSnapshot.connectedCompanyName,
          quickBooksCompanyId: qbSnapshot.quickBooksCompanyId,
          lastSuccessfulSyncAt: qbSnapshot.lastSuccessfulSyncAt,
          retrievedCount: qbSnapshot.retrievedCount,
          apiError: qbSnapshot.apiError,
        }
      : input.quickBooksCustomers
        ? { mode: "legacy_upload", retrievedCount: qbCustomers.length }
        : null;

    const existingCompanies = await this.dbClient.select().from(customers).where(eq(customers.organizationId, input.organizationId));
    const existingContacts = await loadContactLikes(this.dbClient, input.organizationId);
    const identities = await loadExternalIdentities(this.dbClient, input.organizationId);

    return this.dbClient.transaction(async (tx: any) => {
      const [batch] = await tx
        .insert(customerContactImportBatches)
        .values({
          organizationId: input.organizationId,
          status: "matching",
          sourceLabel: input.sourceLabel ?? null,
          qbSourceLabel,
          infoFloCompanyFilename: input.infoFloCompanyFilename ?? null,
          infoFloCompanyChecksum: checksum(input.infoFloCompanyCsv),
          infoFloContactsFilename: input.infoFloContactsFilename ?? null,
          infoFloContactsChecksum: checksum(input.infoFloContactsCsv),
          createdByUserId: input.actorUserId,
          summaryJson: {
            quickBooksCompaniesRead: qbCustomers.length,
            infoFloCompaniesRead: companyCsv.rows.length,
            infoFloContactsRead: contactsCsv.rows.length,
            quickBooksSource: qbSourceSummary,
            warnings: [...companyCsv.warnings, ...contactsCsv.warnings],
          },
          updatedAt: new Date(),
        })
        .returning();

      const stagedCompanies: Array<{ row: any; normalized: NormalizedCompanySource & { permanentPatch: Record<string, unknown>; proofEmail?: string | null } }> = [];
      const companyValues: any[] = [];

      for (let index = 0; index < qbCustomers.length; index++) {
        const raw = qbCustomers[index];
        const normalized = normalizeQbCustomer(raw);
        const match = matchCompany(normalized, existingCompanies, identities);
        companyValues.push({
          organizationId: input.organizationId,
          batchId: batch.id,
          rowNumber: index + 1,
          status: match.status === "matched" ? "matched_existing" : match.status === "ambiguous" ? "ambiguous" : "new_company",
          sourceSystem: "quickbooks",
          sourceRecordId: normalized.sourceRecordId ?? null,
          quickBooksCustomerId: normalized.quickBooksCustomerId ?? null,
          selectedCustomerId: match.selectedId ?? null,
          rawJson: raw,
          normalizedJson: normalized,
          matchCandidatesJson: match.candidates,
          proposedChangesJson: compactPatch(normalized.permanentPatch),
          warningsJson: match.warnings,
          updatedAt: new Date(),
        });
      }

      for (let index = 0; index < companyCsv.rows.length; index++) {
        const raw = companyCsv.rows[index];
        const normalized = normalizeInfoFloCompany(raw);
        const match = matchCompany(normalized, existingCompanies, identities);
        companyValues.push({
          organizationId: input.organizationId,
          batchId: batch.id,
          rowNumber: qbCustomers.length + index + 1,
          status: match.status === "matched" ? "matched_existing" : match.status === "ambiguous" ? "ambiguous" : match.status === "rejected" ? "rejected" : "new_company",
          sourceSystem: "infoflo",
          sourceRecordId: normalized.sourceRecordId ?? null,
          quickBooksCustomerId: normalized.quickBooksCustomerId ?? null,
          selectedCustomerId: match.selectedId ?? null,
          rawJson: raw,
          normalizedJson: normalized,
          matchCandidatesJson: match.candidates,
          proposedChangesJson: compactPatch(normalized.permanentPatch),
          warningsJson: match.warnings,
          errorMessage: match.status === "rejected" ? match.warnings.join("; ") : null,
          updatedAt: new Date(),
        });
      }

      const insertedCompanies = companyValues.length > 0
        ? await tx.insert(customerContactImportCompanyRecords).values(companyValues).returning()
        : [];

      for (let i = 0; i < insertedCompanies.length; i++) {
        stagedCompanies.push({ row: insertedCompanies[i], normalized: companyValues[i].normalizedJson });
      }

      const companyBySourceId = new Map<string, any>();
      const companyByNormalizedName = new Map<string, any[]>();
      for (const staged of stagedCompanies) {
        if (staged.normalized.sourceRecordId) companyBySourceId.set(String(staged.normalized.sourceRecordId), staged.row);
        const normalizedName = normalizeCompanyName(staged.normalized.name);
        if (!companyByNormalizedName.has(normalizedName)) companyByNormalizedName.set(normalizedName, []);
        companyByNormalizedName.get(normalizedName)!.push(staged.row);
      }

      const contactValues: any[] = [];
      const relationshipValues: any[] = [];
      for (let index = 0; index < contactsCsv.rows.length; index++) {
        const raw = contactsCsv.rows[index];
        const normalized = normalizeInfoFloContact(raw);
        const relatedCompanyName = normalizeCompanyName(normalized.companyName);
        const relatedCompanyRows = companyByNormalizedName.get(relatedCompanyName) ?? [];
        const relatedCompany = relatedCompanyRows.length === 1 ? relatedCompanyRows[0] : null;
        const selectedCustomerId = relatedCompany?.selectedCustomerId ?? null;
        const contactForMatch = { ...normalized, relatedCustomerId: selectedCustomerId };
        const match = matchContact(contactForMatch, existingContacts, identities);
        const companyStatus = relatedCompany ? "company_matched" : relatedCompanyRows.length > 1 ? "company_ambiguous" : "company_missing";
        const status = match.status === "matched"
          ? "matched_existing_person"
          : match.status === "ambiguous"
            ? "ambiguous_person"
            : match.status === "rejected"
              ? "rejected"
              : companyStatus;

        contactValues.push({
          organizationId: input.organizationId,
          batchId: batch.id,
          rowNumber: index + 1,
          status,
          sourceSystem: "infoflo",
          sourceRecordId: normalized.sourceRecordId ?? null,
          selectedContactId: match.selectedId ?? null,
          selectedCustomerId,
          rawJson: raw,
          normalizedJson: normalized,
          matchCandidatesJson: match.candidates,
          proposedChangesJson: compactPatch(normalized.permanentPatch),
          warningsJson: [
            ...match.warnings,
            ...(relatedCompanyRows.length > 1 ? ["Contact company is ambiguous."] : []),
            ...(!relatedCompany ? ["Contact company was not matched in the staged company data."] : []),
          ],
          errorMessage: match.status === "rejected" ? match.warnings.join("; ") : null,
          updatedAt: new Date(),
        });
      }

      const insertedContacts = contactValues.length > 0
        ? await tx.insert(customerContactImportContactRecords).values(contactValues).returning()
        : [];

      for (let index = 0; index < insertedContacts.length; index++) {
        const contactRecord = insertedContacts[index];
        const normalized = contactValues[index].normalizedJson as NormalizedContactSource;
        if (!contactRecord.selectedCustomerId && !normalized.companyName) continue;
        const relatedCompanyRows = companyByNormalizedName.get(normalizeCompanyName(normalized.companyName)) ?? [];
        const companyRecord = relatedCompanyRows.length === 1 ? relatedCompanyRows[0] : null;
        const flags = relationshipFlagsFromInfoFloType(normalized.type);
        relationshipValues.push({
          organizationId: input.organizationId,
          batchId: batch.id,
          companyRecordId: companyRecord?.id ?? null,
          contactRecordId: contactRecord.id,
          status: companyRecord && contactRecord.status !== "rejected" ? "ready" : "ambiguous",
          selectedCustomerId: contactRecord.selectedCustomerId ?? companyRecord?.selectedCustomerId ?? null,
          selectedContactId: contactRecord.selectedContactId ?? null,
          isPrimary: flags.isPrimary,
          isBilling: Boolean(normalizeEmail(normalized.billToEmail)),
          isProof: Boolean(normalizeEmail(normalized.proofEmail)),
          relationshipStatus: "active",
          role: normalized.title ?? null,
          sourceSystem: "infoflo",
          sourceRecordId: normalized.sourceRecordId ?? null,
          proposedChangesJson: {
            billToEmail: normalized.billToEmail ?? null,
            proofEmail: normalized.proofEmail ?? null,
            genericEmail: isGenericSharedEmail(normalized.email),
          },
          warningsJson: [
            ...(normalizeEmail(normalized.billToEmail) ? ["Bill To Email staged as relationship billing evidence."] : []),
            ...(normalizeEmail(normalized.proofEmail) ? ["Proof Email staged as relationship proof evidence."] : []),
          ],
          updatedAt: new Date(),
        });
      }

      if (relationshipValues.length > 0) {
        await tx.insert(customerContactImportRelationshipRecords).values(relationshipValues);
      }

      const unresolved =
        companyValues.filter((row) => ["ambiguous", "rejected"].includes(row.status)).length +
        contactValues.filter((row) => ["ambiguous_person", "company_ambiguous", "company_missing", "rejected"].includes(row.status)).length +
        relationshipValues.filter((row) => row.status === "ambiguous").length;

      const summary = {
        quickBooksCompaniesRead: qbCustomers.length,
        infoFloCompaniesRead: companyCsv.rows.length,
        infoFloContactsRead: contactsCsv.rows.length,
        stagedCompanies: companyValues.length,
        stagedContacts: contactValues.length,
        stagedRelationships: relationshipValues.length,
        unresolved,
        quickBooksSource: qbSourceSummary,
        warnings: [...companyCsv.warnings, ...contactsCsv.warnings],
      };

      const [updatedBatch] = await tx
        .update(customerContactImportBatches)
        .set({
          status: unresolved > 0 ? "needs_review" : "ready_to_finalize",
          summaryJson: summary,
          updatedAt: new Date(),
        })
        .where(eq(customerContactImportBatches.id, batch.id))
        .returning();

      return { batch: updatedBatch, summary };
    });
  }

  async getBatch(organizationId: string, batchId: string) {
    const [batch] = await this.dbClient
      .select()
      .from(customerContactImportBatches)
      .where(and(eq(customerContactImportBatches.organizationId, organizationId), eq(customerContactImportBatches.id, batchId)))
      .limit(1);
    if (!batch) return null;
    const [companyRows, contactRows, relationshipRows] = await Promise.all([
      this.dbClient.select().from(customerContactImportCompanyRecords).where(eq(customerContactImportCompanyRecords.batchId, batch.id)).orderBy(customerContactImportCompanyRecords.rowNumber),
      this.dbClient.select().from(customerContactImportContactRecords).where(eq(customerContactImportContactRecords.batchId, batch.id)).orderBy(customerContactImportContactRecords.rowNumber),
      this.dbClient.select().from(customerContactImportRelationshipRecords).where(eq(customerContactImportRelationshipRecords.batchId, batch.id)).orderBy(customerContactImportRelationshipRecords.createdAt),
    ]);
    return { batch, companyRows, contactRows, relationshipRows };
  }

  async listBatches(organizationId: string, limit = 25): Promise<CustomerContactImportBatch[]> {
    return this.dbClient
      .select()
      .from(customerContactImportBatches)
      .where(eq(customerContactImportBatches.organizationId, organizationId))
      .orderBy(sql`${customerContactImportBatches.createdAt} desc`)
      .limit(Math.min(100, Math.max(1, limit)));
  }

  async finalizeBatch(organizationId: string, batchId: string, actorUserId: string, confirmation: string) {
    if (confirmation !== "FINALIZE") {
      throw Object.assign(new Error("Explicit FINALIZE confirmation is required."), { statusCode: 400 });
    }

    return this.dbClient.transaction(async (tx: any) => {
      const [lockedBatch] = await tx
        .update(customerContactImportBatches)
        .set({ status: "finalizing", lockedAt: new Date(), lockToken: crypto.randomUUID(), updatedAt: new Date() })
        .where(and(
          eq(customerContactImportBatches.organizationId, organizationId),
          eq(customerContactImportBatches.id, batchId),
          inArray(customerContactImportBatches.status, ["ready_to_finalize", "completed_with_exceptions"]),
        ))
        .returning();

      if (!lockedBatch) {
        throw Object.assign(new Error("Batch is not ready to finalize or is already finalizing."), { statusCode: 409 });
      }

      const companyRows = await tx.select().from(customerContactImportCompanyRecords).where(eq(customerContactImportCompanyRecords.batchId, batchId)).orderBy(customerContactImportCompanyRecords.rowNumber);
      const contactRows = await tx.select().from(customerContactImportContactRecords).where(eq(customerContactImportContactRecords.batchId, batchId)).orderBy(customerContactImportContactRecords.rowNumber);
      const relationshipRows = await tx.select().from(customerContactImportRelationshipRecords).where(eq(customerContactImportRelationshipRecords.batchId, batchId));

      const companyIdByRecord = new Map<string, string>();
      const contactIdByRecord = new Map<string, string>();
      const counts = {
        existingCompaniesMatched: 0,
        newCompaniesCreated: 0,
        existingContactsMatched: 0,
        newContactsCreated: 0,
        relationshipsCreated: 0,
        relationshipsUpdated: 0,
        primaryContactsAssigned: 0,
        billingContactsAssigned: 0,
        proofContactsAssigned: 0,
        rejectedRecords: 0,
        failedRecords: 0,
      };

      for (const row of companyRows) {
        if (row.status === "rejected") {
          counts.rejectedRecords++;
          continue;
        }
        const patch = compactPatch((row.proposedChangesJson ?? {}) as Record<string, unknown>);
        let customerId = row.selectedCustomerId ?? null;

        try {
          if (customerId) {
            const updatePatch = { ...patch, updatedAt: new Date() };
            delete (updatePatch as any).externalAccountingId;
            if (Object.keys(updatePatch).length > 1) {
              await tx.update(customers).set(updatePatch).where(and(eq(customers.organizationId, organizationId), eq(customers.id, customerId)));
            }
            counts.existingCompaniesMatched++;
          } else {
            const [created] = await tx
              .insert(customers)
              .values({
                organizationId,
                companyName: String(patch.companyName || `Imported Company ${row.rowNumber}`),
                customerType: "business",
                ...patch,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning();
            customerId = created.id;
            counts.newCompaniesCreated++;
          }

          companyIdByRecord.set(row.id, customerId);
          if (row.quickBooksCustomerId) {
            await upsertExternalIdentity(tx, {
              organizationId,
              entityType: "customer",
              entityId: customerId,
              sourceSystem: "quickbooks",
              sourceEntityType: "customer",
              sourceRecordId: row.quickBooksCustomerId,
              sourceDisplayName: String((row.normalizedJson as any)?.name ?? ""),
            });
          }
          if (row.sourceSystem === "infoflo" && row.sourceRecordId) {
            await upsertExternalIdentity(tx, {
              organizationId,
              entityType: "customer",
              entityId: customerId,
              sourceSystem: "infoflo",
              sourceEntityType: "company",
              sourceRecordId: row.sourceRecordId,
              sourceDisplayName: String((row.normalizedJson as any)?.name ?? ""),
            });
          }
          await tx.update(customerContactImportCompanyRecords).set({ status: "imported", selectedCustomerId: customerId, updatedAt: new Date() }).where(eq(customerContactImportCompanyRecords.id, row.id));
        } catch (error: any) {
          counts.failedRecords++;
          await tx.update(customerContactImportCompanyRecords).set({ status: "failed", errorMessage: error?.message ?? "Company finalization failed", updatedAt: new Date() }).where(eq(customerContactImportCompanyRecords.id, row.id));
          throw error;
        }
      }

      for (const row of contactRows) {
        if (row.status === "rejected") {
          counts.rejectedRecords++;
          continue;
        }
        const patch = compactPatch((row.proposedChangesJson ?? {}) as Record<string, unknown>);
        let contactId = row.selectedContactId ?? null;
        try {
          if (contactId) {
            await tx.update(customerContacts).set({ ...patch, updatedAt: new Date() }).where(and(eq(customerContacts.organizationId, organizationId), eq(customerContacts.id, contactId)));
            counts.existingContactsMatched++;
          } else {
            const [created] = await tx
              .insert(customerContacts)
              .values({
                organizationId,
                customerId: null,
                firstName: String(patch.firstName || "Imported"),
                lastName: String(patch.lastName || "Contact"),
                ...patch,
                externalSource: row.sourceSystem,
                externalSourceId: row.sourceRecordId,
                externalSourceType: row.sourceSystem === "infoflo" ? "contact" : "customer_primary_contact",
                status: "active",
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning();
            contactId = created.id;
            counts.newContactsCreated++;
          }

          contactIdByRecord.set(row.id, contactId);
          if (row.sourceSystem === "infoflo" && row.sourceRecordId) {
            await upsertExternalIdentity(tx, {
              organizationId,
              entityType: "contact",
              entityId: contactId,
              sourceSystem: "infoflo",
              sourceEntityType: "contact",
              sourceRecordId: row.sourceRecordId,
              sourceDisplayName: `${patch.firstName ?? ""} ${patch.lastName ?? ""}`.trim(),
            });
          }
          await tx.update(customerContactImportContactRecords).set({ status: "imported", selectedContactId: contactId, updatedAt: new Date() }).where(eq(customerContactImportContactRecords.id, row.id));
        } catch (error: any) {
          counts.failedRecords++;
          await tx.update(customerContactImportContactRecords).set({ status: "failed", errorMessage: error?.message ?? "Contact finalization failed", updatedAt: new Date() }).where(eq(customerContactImportContactRecords.id, row.id));
          throw error;
        }
      }

      for (const row of relationshipRows) {
        const customerId = row.selectedCustomerId ?? (row.companyRecordId ? companyIdByRecord.get(row.companyRecordId) : null);
        const contactId = row.selectedContactId ?? (row.contactRecordId ? contactIdByRecord.get(row.contactRecordId) : null);
        if (!customerId || !contactId || row.status === "ambiguous") {
          await tx.update(customerContactImportRelationshipRecords).set({ status: "skipped", errorMessage: "Relationship was not ready.", updatedAt: new Date() }).where(eq(customerContactImportRelationshipRecords.id, row.id));
          continue;
        }

        if (row.isPrimary) {
          await tx.update(customerContactLinks).set({ isPrimary: false, updatedAt: new Date() }).where(and(eq(customerContactLinks.organizationId, organizationId), eq(customerContactLinks.customerId, customerId), eq(customerContactLinks.status, "active")));
        }

        const [existing] = await tx
          .select()
          .from(customerContactLinks)
          .where(and(
            eq(customerContactLinks.organizationId, organizationId),
            eq(customerContactLinks.customerId, customerId),
            eq(customerContactLinks.contactId, contactId),
            sql`${customerContactLinks.status} <> 'removed'`,
          ))
          .limit(1);

        const linkPatch = {
          organizationId,
          customerId,
          contactId,
          status: row.relationshipStatus ?? "active",
          isPrimary: row.isPrimary,
          isBilling: row.isBilling,
          isProof: row.isProof,
          role: row.role,
          sourceSystem: row.sourceSystem,
          sourceRecordId: row.sourceRecordId,
          updatedAt: new Date(),
        };

        const [link] = existing
          ? await tx.update(customerContactLinks).set(linkPatch).where(eq(customerContactLinks.id, existing.id)).returning()
          : await tx.insert(customerContactLinks).values({ ...linkPatch, createdAt: new Date() }).returning();

        if (row.isPrimary) counts.primaryContactsAssigned++;
        if (row.isBilling) counts.billingContactsAssigned++;
        if (row.isProof) counts.proofContactsAssigned++;
        if (existing) counts.relationshipsUpdated++; else counts.relationshipsCreated++;

        await tx.update(customerContacts).set({ customerId, updatedAt: new Date() }).where(and(eq(customerContacts.organizationId, organizationId), eq(customerContacts.id, contactId), sql`${customerContacts.customerId} IS NULL`));
        await tx.update(customerContactImportRelationshipRecords).set({ status: existing ? "updated" : "created", selectedCustomerId: customerId, selectedContactId: contactId, selectedLinkId: link.id, updatedAt: new Date() }).where(eq(customerContactImportRelationshipRecords.id, row.id));

        if (row.sourceRecordId) {
          await upsertExternalIdentity(tx, {
            organizationId,
            entityType: "customer_contact_link",
            entityId: link.id,
            sourceSystem: row.sourceSystem ?? "infoflo",
            sourceEntityType: "relationship",
            sourceRecordId: row.sourceRecordId,
          });
        }
      }

      await tx.insert(auditLogs).values({
        organizationId,
        userId: actorUserId,
        actionType: "customer_contact_migration.finalized",
        entityType: "customer_contact_import_batch",
        entityId: batchId,
        description: "Finalized customer/contact migration batch.",
        newValues: counts,
      });

      const finalStatus = counts.failedRecords > 0 ? "completed_with_exceptions" : "completed";
      const [updatedBatch] = await tx
        .update(customerContactImportBatches)
        .set({
          status: finalStatus,
          finalizedByUserId: actorUserId,
          finalizedAt: new Date(),
          summaryJson: { ...(lockedBatch.summaryJson as any), finalization: counts },
          updatedAt: new Date(),
        })
        .where(eq(customerContactImportBatches.id, batchId))
        .returning();

      return { batch: updatedBatch, counts };
    }).catch(async (error: any) => {
      await this.dbClient
        .update(customerContactImportBatches)
        .set({
          status: "failed",
          failingStage: "finalization",
          errorMessage: error?.message ?? "Finalization failed",
          updatedAt: new Date(),
        })
        .where(and(eq(customerContactImportBatches.organizationId, organizationId), eq(customerContactImportBatches.id, batchId)));
      throw error;
    });
  }

  buildCsvReport(rows: Array<Record<string, unknown>>): string {
    const headers = Array.from(rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()));
    if (headers.length === 0) return "";
    const escape = (value: unknown) => {
      const text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
  }
}

export const customerContactMigrationService = new CustomerContactMigrationService();
