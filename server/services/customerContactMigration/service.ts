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
  type MatchResult,
  type NormalizedCompanySource,
  type NormalizedContactSource,
} from "./matching";

type DbClient = typeof db;
type CsvReportKind = "completed-mappings" | "exceptions" | "rejected-records" | "conflicts" | "failed-records";
type ReviewRecordType = "company" | "contact";
type ReviewDecisionAction = "accept_proposed" | "choose_existing" | "create_new" | "ignore";

const csvReportHeaders: Record<CsvReportKind, string[]> = {
  "completed-mappings": ["type", "rowNumber", "sourceRecordId", "entityId", "linkId", "customerId", "contactId"],
  exceptions: ["type", "rowNumber", "sourceRecordId", "status", "error", "warnings"],
  "rejected-records": ["type", "rowNumber", "sourceRecordId", "error"],
  conflicts: ["type", "rowNumber", "sourceRecordId", "candidates"],
  "failed-records": ["type", "rowNumber", "sourceRecordId", "error"],
};

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

type CompanySourceDraft = {
  sourceSystem: "quickbooks" | "infoflo";
  sourceRecordId: string | null;
  quickBooksCustomerId: string | null;
  rawJson: unknown;
  normalized: NormalizedCompanySource & { permanentPatch: Record<string, unknown>; proofEmail?: string | null; additionalInfoFloSourceRecordIds?: string[] };
  warnings: string[];
  forcedMatch?: MatchResult;
};

export type CompanySourceConsolidationSummary = {
  quickBooksInfoFloCompanyMatches: number;
  quickBooksOnlyCompanies: number;
  infoFloOnlyCompanies: number;
  ambiguousCompanyMatches: number;
  rejectedCompanies: number;
  unmatchedQuickBooksCompanies: number;
  unmatchedInfoFloCompanies: number;
};

export type MigrationReviewDecisionInput = {
  organizationId: string;
  batchId: string;
  recordType: ReviewRecordType;
  recordId: string;
  action: ReviewDecisionAction;
  selectedEntityId?: string | null;
  actorUserId: string;
};

export type MigrationFinalizePreviewCounts = {
  companiesToCreate: number;
  companiesToUpdate: number;
  contactsToCreate: number;
  contactsToUpdate: number;
  relationshipsToCreate: number;
  relationshipsToUpdate: number;
  remainingUnresolved: number;
};

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

const unresolvedCompanyStatuses = new Set(["ambiguous", "failed"]);
const unresolvedContactStatuses = new Set(["ambiguous_person", "company_missing", "failed"]);
const unresolvedRelationshipStatuses = new Set(["ambiguous", "failed"]);

function firstCandidateId(row: { matchCandidatesJson?: unknown }): string | null {
  const candidates = Array.isArray(row.matchCandidatesJson) ? row.matchCandidatesJson as Array<Record<string, unknown>> : [];
  const sorted = [...candidates].sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
  const id = sorted[0]?.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function countMigrationUnresolvedRows(batch: {
  companyRows: Array<{ status: string }>;
  contactRows: Array<{ status: string }>;
  relationshipRows: Array<{ status: string }>;
}): number {
  return batch.companyRows.filter((row) => unresolvedCompanyStatuses.has(String(row.status))).length +
    batch.contactRows.filter((row) => unresolvedContactStatuses.has(String(row.status))).length +
    batch.relationshipRows.filter((row) => unresolvedRelationshipStatuses.has(String(row.status))).length;
}

export function buildFinalizePreviewCounts(batch: {
  companyRows: Array<{ status: string; selectedCustomerId?: string | null }>;
  contactRows: Array<{ status: string; selectedContactId?: string | null }>;
  relationshipRows: Array<{ status: string; selectedLinkId?: string | null }>;
}): MigrationFinalizePreviewCounts {
  const remainingUnresolved = countMigrationUnresolvedRows(batch);
  return {
    companiesToCreate: batch.companyRows.filter((row) => row.status === "new_company").length,
    companiesToUpdate: batch.companyRows.filter((row) => row.status === "matched_existing" && row.selectedCustomerId).length,
    contactsToCreate: batch.contactRows.filter((row) => !unresolvedContactStatuses.has(String(row.status)) && row.status !== "rejected" && row.status !== "failed" && !row.selectedContactId).length,
    contactsToUpdate: batch.contactRows.filter((row) => !unresolvedContactStatuses.has(String(row.status)) && row.selectedContactId).length,
    relationshipsToCreate: batch.relationshipRows.filter((row) => row.status === "ready" && !row.selectedLinkId).length,
    relationshipsToUpdate: batch.relationshipRows.filter((row) => row.status === "ready" && row.selectedLinkId).length,
    remainingUnresolved,
  };
}

export function buildCompanyReviewPatch(row: Record<string, any>, decision: Pick<MigrationReviewDecisionInput, "action" | "selectedEntityId" | "actorUserId">) {
  const reviewDecisionJson = {
    action: decision.action,
    selectedEntityId: decision.selectedEntityId ?? null,
    decidedByUserId: decision.actorUserId,
    decidedAt: new Date().toISOString(),
  };
  if (decision.action === "accept_proposed") {
    const selectedCustomerId = decision.selectedEntityId || firstCandidateId(row);
    if (!selectedCustomerId) throw Object.assign(new Error("No proposed company match is available."), { statusCode: 400 });
    return { status: "matched_existing", selectedCustomerId, reviewDecisionJson, errorMessage: null };
  }
  if (decision.action === "choose_existing") {
    if (!decision.selectedEntityId) throw Object.assign(new Error("selectedEntityId is required."), { statusCode: 400 });
    return { status: "matched_existing", selectedCustomerId: decision.selectedEntityId, reviewDecisionJson, errorMessage: null };
  }
  if (decision.action === "create_new") {
    return { status: "new_company", selectedCustomerId: null, reviewDecisionJson, errorMessage: null };
  }
  return { status: "rejected", selectedCustomerId: null, reviewDecisionJson, errorMessage: "Ignored by reviewer." };
}

export function buildContactReviewPatch(row: Record<string, any>, decision: Pick<MigrationReviewDecisionInput, "action" | "selectedEntityId" | "actorUserId">) {
  const reviewDecisionJson = {
    action: decision.action,
    selectedEntityId: decision.selectedEntityId ?? null,
    decidedByUserId: decision.actorUserId,
    decidedAt: new Date().toISOString(),
  };
  if (decision.action === "accept_proposed") {
    const selectedContactId = decision.selectedEntityId || firstCandidateId(row);
    if (!selectedContactId) throw Object.assign(new Error("No proposed contact match is available."), { statusCode: 400 });
    return { status: "matched_existing_person", selectedContactId, reviewDecisionJson, errorMessage: null };
  }
  if (decision.action === "choose_existing") {
    if (!decision.selectedEntityId) throw Object.assign(new Error("selectedEntityId is required."), { statusCode: 400 });
    return { status: "matched_existing_person", selectedContactId: decision.selectedEntityId, reviewDecisionJson, errorMessage: null };
  }
  if (decision.action === "create_new") {
    return { status: "company_matched", selectedContactId: null, reviewDecisionJson, errorMessage: null };
  }
  return { status: "rejected", selectedContactId: null, reviewDecisionJson, errorMessage: "Ignored by reviewer." };
}

export function buildDependentContactPatchAfterCompanyDecision(
  currentStatus: string,
  companyPatch: { status: string; selectedCustomerId?: string | null },
) {
  if (currentStatus !== "company_pending") return null;
  if (companyPatch.status === "rejected") {
    return {
      status: "rejected",
      selectedCustomerId: null,
      errorMessage: "Parent company source ignored by reviewer.",
    };
  }
  return {
    status: "company_matched",
    selectedCustomerId: companyPatch.selectedCustomerId ?? null,
    errorMessage: null,
  };
}

export function buildRelationshipPatchAfterCompanyDecision(companyPatch: { status: string; selectedCustomerId?: string | null }) {
  return {
    selectedCustomerId: companyPatch.selectedCustomerId ?? null,
    status: companyPatch.status === "rejected" ? "skipped" : "ready",
    errorMessage: companyPatch.status === "rejected" ? "Company source ignored by reviewer." : null,
  };
}

function companySourceNameKeys(source: NormalizedCompanySource): Set<string> {
  return new Set([
    normalizeCompanyName(source.name),
    normalizeCompanyName(source.quickBooksCustomerName),
  ].filter(Boolean));
}

function companySourcesLikelySame(infoFlo: NormalizedCompanySource, quickBooks: NormalizedCompanySource): boolean {
  const infoFloKeys = companySourceNameKeys(infoFlo);
  const quickBooksKeys = companySourceNameKeys(quickBooks);
  for (const key of Array.from(infoFloKeys)) {
    if (quickBooksKeys.has(key)) return true;
  }
  return false;
}

const SYSTEM_COMPANY_NAME_PATTERNS = [
  /\btest\b/i,
  /\bfake\b/i,
  /\bsample\b/i,
  /\bdummy\b/i,
  /\bsystem\b/i,
  /\binfoflo\s+support\b/i,
];

function validateInfoFloCompanySource(source: NormalizedCompanySource): string[] {
  const warnings: string[] = [];
  const name = String(source.name ?? "").trim();
  const normalizedName = normalizeCompanyName(name);
  if (!name || !normalizedName) {
    warnings.push("InfoFlo company name is blank or malformed.");
  }
  if (SYSTEM_COMPANY_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
    warnings.push("InfoFlo company appears to be a system/test record.");
  }
  return warnings;
}

function nonEmptyString(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function conflictingFieldNames(
  a: NormalizedCompanySource & { permanentPatch: Record<string, unknown> },
  b: NormalizedCompanySource & { permanentPatch: Record<string, unknown> },
): string[] {
  const checks: Array<[string, unknown, unknown]> = [
    ["email", normalizeEmail(a.email), normalizeEmail(b.email)],
    ["phone", normalizePhone(a.phone), normalizePhone(b.phone)],
    ["street1", nonEmptyString(a.street1)?.toLowerCase(), nonEmptyString(b.street1)?.toLowerCase()],
    ["postalCode", nonEmptyString(a.postalCode), nonEmptyString(b.postalCode)],
  ];
  return checks
    .filter(([, left, right]) => Boolean(left && right && left !== right))
    .map(([field]) => field);
}

function mergeInfoFloCompanySources(
  sources: Array<{ raw: Record<string, string>; normalized: NormalizedCompanySource & { permanentPatch: Record<string, unknown>; proofEmail?: string | null } }>,
): NormalizedCompanySource & { permanentPatch: Record<string, unknown>; proofEmail?: string | null; additionalInfoFloSourceRecordIds?: string[] } {
  const primary = sources[0].normalized;
  const mergedPatch: Record<string, unknown> = { ...primary.permanentPatch };
  for (const source of sources.slice(1)) {
    for (const [key, value] of Object.entries(source.normalized.permanentPatch)) {
      if (mergedPatch[key] === undefined || mergedPatch[key] === null || mergedPatch[key] === "") {
        mergedPatch[key] = value;
      }
    }
  }
  const sourceIds = sources.map((source) => source.normalized.sourceRecordId).filter((value): value is string => Boolean(value));
  return {
    ...primary,
    email: primary.email ?? sources.find((source) => source.normalized.email)?.normalized.email ?? null,
    phone: primary.phone ?? sources.find((source) => source.normalized.phone)?.normalized.phone ?? null,
    street1: primary.street1 ?? sources.find((source) => source.normalized.street1)?.normalized.street1 ?? null,
    city: primary.city ?? sources.find((source) => source.normalized.city)?.normalized.city ?? null,
    state: primary.state ?? sources.find((source) => source.normalized.state)?.normalized.state ?? null,
    postalCode: primary.postalCode ?? sources.find((source) => source.normalized.postalCode)?.normalized.postalCode ?? null,
    proofEmail: primary.proofEmail ?? sources.find((source) => source.normalized.proofEmail)?.normalized.proofEmail ?? null,
    additionalInfoFloSourceRecordIds: sourceIds.slice(1),
    permanentPatch: compactPatch(mergedPatch),
  };
}

type InfoFloCompanyGroupRow = {
  raw: Record<string, string>;
  normalized: NormalizedCompanySource & { permanentPatch: Record<string, unknown>; proofEmail?: string | null };
  warnings: string[];
};

function consolidateInfoFloCompanyRows(rows: Record<string, string>[]): CompanySourceDraft[] {
  const groups = new Map<string, InfoFloCompanyGroupRow[]>();
  for (const raw of rows) {
    const normalized = normalizeInfoFloCompany(raw);
    const warnings = validateInfoFloCompanySource(normalized);
    const key = warnings.length > 0
      ? `__invalid__:${normalized.sourceRecordId ?? groups.size}`
      : normalizeCompanyName(normalized.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ raw, normalized, warnings });
  }

  const drafts: CompanySourceDraft[] = [];
  for (const group of Array.from(groups.values())) {
    const invalid = group.filter((row) => row.warnings.length > 0);
    if (invalid.length > 0) {
      for (const row of invalid) {
        drafts.push({
          sourceSystem: "infoflo",
          sourceRecordId: row.normalized.sourceRecordId ?? null,
          quickBooksCustomerId: row.normalized.quickBooksCustomerId ?? null,
          rawJson: row.raw,
          normalized: row.normalized,
          warnings: row.warnings,
          forcedMatch: {
            status: "rejected",
            candidates: [],
            warnings: row.warnings,
          },
        });
      }
      continue;
    }

    if (group.length === 1) {
      const row = group[0];
      drafts.push({
        sourceSystem: "infoflo",
        sourceRecordId: row.normalized.sourceRecordId ?? null,
        quickBooksCustomerId: row.normalized.quickBooksCustomerId ?? null,
        rawJson: row.raw,
        normalized: row.normalized,
        warnings: [],
      });
      continue;
    }

    const conflicts = new Set<string>();
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        conflictingFieldNames(group[i].normalized, group[j].normalized).forEach((field) => conflicts.add(field));
      }
    }
    const merged = mergeInfoFloCompanySources(group);
    const sourceIds = group
      .map((row) => row.normalized.sourceRecordId)
      .filter((sourceRecordId): sourceRecordId is string => Boolean(sourceRecordId));
    if (conflicts.size > 0) {
      const warnings = [`Conflicting duplicate InfoFlo company rows: ${Array.from(conflicts).join(", ")}.`];
      drafts.push({
        sourceSystem: "infoflo",
        sourceRecordId: merged.sourceRecordId ?? null,
        quickBooksCustomerId: merged.quickBooksCustomerId ?? null,
        rawJson: { infoFloDuplicates: group.map((row) => row.raw) },
        normalized: merged,
        warnings,
        forcedMatch: {
          status: "ambiguous",
          candidates: sourceIds.map((id) => ({
            id: String(id),
            confidence: "review",
            reason: "Conflicting duplicate InfoFlo company source row",
            score: 82,
          })),
          warnings,
        },
      });
      continue;
    }

    drafts.push({
      sourceSystem: "infoflo",
      sourceRecordId: merged.sourceRecordId ?? null,
      quickBooksCustomerId: merged.quickBooksCustomerId ?? null,
      rawJson: { infoFloDuplicates: group.map((row) => row.raw) },
      normalized: merged,
      warnings: ["Duplicate InfoFlo company rows were consolidated before relationship matching."],
    });
  }
  return drafts;
}

function mergeCompanySources(
  quickBooks: NormalizedCompanySource & { permanentPatch: Record<string, unknown> },
  infoFlo: NormalizedCompanySource & { permanentPatch: Record<string, unknown>; proofEmail?: string | null },
): NormalizedCompanySource & { permanentPatch: Record<string, unknown>; proofEmail?: string | null; additionalInfoFloSourceRecordIds?: string[] } {
  const permanentPatch = compactPatch({
    ...quickBooks.permanentPatch,
    ...infoFlo.permanentPatch,
    externalAccountingId: quickBooks.quickBooksCustomerId ?? (quickBooks.permanentPatch as any).externalAccountingId,
    syncStatus: quickBooks.quickBooksCustomerId ? "synced" : (quickBooks.permanentPatch as any).syncStatus,
    syncedAt: quickBooks.quickBooksCustomerId ? (quickBooks.permanentPatch as any).syncedAt : undefined,
  });
  return {
    ...quickBooks,
    ...infoFlo,
    sourceRecordId: infoFlo.sourceRecordId,
    quickBooksCustomerId: quickBooks.quickBooksCustomerId,
    quickBooksCustomerName: quickBooks.quickBooksCustomerName,
    name: infoFlo.name || quickBooks.name,
    email: infoFlo.email || quickBooks.email,
    phone: infoFlo.phone || quickBooks.phone,
    street1: infoFlo.street1 || quickBooks.street1,
    city: infoFlo.city || quickBooks.city,
    state: infoFlo.state || quickBooks.state,
    postalCode: infoFlo.postalCode || quickBooks.postalCode,
    proofEmail: infoFlo.proofEmail,
    additionalInfoFloSourceRecordIds: (infoFlo as any).additionalInfoFloSourceRecordIds,
    permanentPatch,
  };
}

export function buildConsolidatedCompanySourceDrafts(
  quickBooksCustomers: QuickBooksCustomerSource[],
  infoFloCompanyRows: Record<string, string>[],
): { drafts: CompanySourceDraft[]; summary: CompanySourceConsolidationSummary } {
  const quickBooksDrafts = quickBooksCustomers.map((raw) => ({
    raw,
    normalized: normalizeQbCustomer(raw),
  }));
  const matchedQuickBooksIndexes = new Set<number>();
  const infoFloDrafts = consolidateInfoFloCompanyRows(infoFloCompanyRows);
  const drafts: CompanySourceDraft[] = [];
  let quickBooksInfoFloCompanyMatches = 0;
  let ambiguousCompanyMatches = 0;
  let unmatchedInfoFloCompanies = 0;
  let rejectedCompanies = 0;

  for (const infoFloDraft of infoFloDrafts) {
    const normalized = infoFloDraft.normalized;
    if (infoFloDraft.forcedMatch?.status === "rejected") {
      rejectedCompanies++;
      drafts.push(infoFloDraft);
      continue;
    }

    const candidates = quickBooksDrafts
      .map((quickBooks, index) => ({ ...quickBooks, index }))
      .filter((quickBooks) => companySourcesLikelySame(normalized, quickBooks.normalized));

    if (infoFloDraft.forcedMatch?.status === "ambiguous") {
      ambiguousCompanyMatches++;
      drafts.push(infoFloDraft);
      continue;
    }

    if (candidates.length === 1) {
      const quickBooks = candidates[0];
      matchedQuickBooksIndexes.add(quickBooks.index);
      quickBooksInfoFloCompanyMatches++;
      drafts.push({
        sourceSystem: "infoflo",
        sourceRecordId: normalized.sourceRecordId ?? null,
        quickBooksCustomerId: quickBooks.normalized.quickBooksCustomerId ?? null,
        rawJson: { quickBooks: quickBooks.raw, infoFlo: infoFloDraft.rawJson },
        normalized: mergeCompanySources(quickBooks.normalized, normalized),
        warnings: [...infoFloDraft.warnings, "QuickBooks and InfoFlo company sources were consolidated before relationship matching."],
      });
      continue;
    }

    if (candidates.length > 1) {
      ambiguousCompanyMatches++;
      drafts.push({
        sourceSystem: "infoflo",
        sourceRecordId: normalized.sourceRecordId ?? null,
        quickBooksCustomerId: normalized.quickBooksCustomerId ?? null,
        rawJson: infoFloDraft.rawJson,
        normalized,
        warnings: ["Multiple staged QuickBooks companies match this InfoFlo company; manual review required."],
        forcedMatch: {
          status: "ambiguous",
          candidates: candidates.map((quickBooks) => ({
            id: String(quickBooks.normalized.quickBooksCustomerId ?? quickBooks.index),
            confidence: "review",
            reason: "Ambiguous staged QuickBooks company source",
            score: 82,
          })),
          warnings: [],
        },
      });
      continue;
    }

    unmatchedInfoFloCompanies++;
    drafts.push({
      sourceSystem: "infoflo",
      sourceRecordId: normalized.sourceRecordId ?? null,
      quickBooksCustomerId: normalized.quickBooksCustomerId ?? null,
      rawJson: infoFloDraft.rawJson,
      normalized,
      warnings: infoFloDraft.warnings,
    });
  }

  for (let index = 0; index < quickBooksDrafts.length; index++) {
    if (matchedQuickBooksIndexes.has(index)) continue;
    const quickBooks = quickBooksDrafts[index];
    drafts.push({
      sourceSystem: "quickbooks",
      sourceRecordId: quickBooks.normalized.sourceRecordId ?? null,
      quickBooksCustomerId: quickBooks.normalized.quickBooksCustomerId ?? null,
      rawJson: quickBooks.raw,
      normalized: quickBooks.normalized,
      warnings: [],
    });
  }

  return {
    drafts,
    summary: {
      quickBooksInfoFloCompanyMatches,
      quickBooksOnlyCompanies: quickBooksCustomers.length - matchedQuickBooksIndexes.size,
      infoFloOnlyCompanies: unmatchedInfoFloCompanies,
      ambiguousCompanyMatches,
      rejectedCompanies,
      unmatchedQuickBooksCompanies: quickBooksCustomers.length - matchedQuickBooksIndexes.size,
      unmatchedInfoFloCompanies,
    },
  };
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
      const companySourceConsolidation = buildConsolidatedCompanySourceDrafts(qbCustomers, companyCsv.rows);

      for (let index = 0; index < companySourceConsolidation.drafts.length; index++) {
        const draft = companySourceConsolidation.drafts[index];
        const normalized = draft.normalized;
        const match = draft.forcedMatch ?? matchCompany(normalized, existingCompanies, identities);
        const warnings = [...draft.warnings, ...match.warnings];
        companyValues.push({
          organizationId: input.organizationId,
          batchId: batch.id,
          rowNumber: index + 1,
          status: match.status === "matched" ? "matched_existing" : match.status === "ambiguous" ? "ambiguous" : match.status === "rejected" ? "rejected" : "new_company",
          sourceSystem: draft.sourceSystem,
          sourceRecordId: draft.sourceRecordId,
          quickBooksCustomerId: normalized.quickBooksCustomerId ?? null,
          selectedCustomerId: match.selectedId ?? null,
          rawJson: draft.rawJson,
          normalizedJson: normalized,
          matchCandidatesJson: match.candidates,
          proposedChangesJson: compactPatch(normalized.permanentPatch),
          warningsJson: warnings,
          errorMessage: match.status === "rejected" ? warnings.join("; ") : null,
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
        const companyIsResolved = Boolean(
          relatedCompany &&
          !["ambiguous", "rejected", "failed"].includes(String(relatedCompany.status))
        );
        const selectedCustomerId = companyIsResolved ? relatedCompany?.selectedCustomerId ?? null : null;
        const contactForMatch = { ...normalized, relatedCustomerId: selectedCustomerId };
        const match = matchContact(contactForMatch, existingContacts, identities);
        const companyStatus = companyIsResolved ? "company_matched" : relatedCompany ? "company_pending" : relatedCompanyRows.length > 1 ? "company_pending" : "company_missing";
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
            ...(relatedCompanyRows.length > 1 ? ["Contact has multiple plausible staged company parents."] : []),
            ...(relatedCompany && !companyIsResolved ? ["Contact is waiting on parent company resolution."] : []),
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
        const companyPending = Boolean(companyRecord && ["ambiguous", "rejected", "failed"].includes(String(companyRecord.status)));
        const contactPending = String(contactRecord.status) === "company_pending";
        const contactBlocked = ["rejected", "ambiguous_person", "failed"].includes(String(contactRecord.status));
        const flags = relationshipFlagsFromInfoFloType(normalized.type);
        relationshipValues.push({
          organizationId: input.organizationId,
          batchId: batch.id,
          companyRecordId: companyRecord?.id ?? null,
          contactRecordId: contactRecord.id,
          status: !companyRecord ? "ambiguous" : !companyPending && !contactBlocked && !contactPending ? "ready" : companyPending || contactPending ? "pending_company" : "ambiguous",
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
            ...(companyPending || contactPending ? ["Relationship is waiting on parent company resolution."] : []),
          ],
          updatedAt: new Date(),
        });
      }

      if (relationshipValues.length > 0) {
        await tx.insert(customerContactImportRelationshipRecords).values(relationshipValues);
      }

      const unresolved =
        companyValues.filter((row) => ["ambiguous", "rejected"].includes(row.status)).length +
        contactValues.filter((row) => ["ambiguous_person", "company_missing", "rejected", "failed"].includes(row.status)).length +
        relationshipValues.filter((row) => ["ambiguous", "failed"].includes(row.status)).length;

      const summary = {
        quickBooksCompaniesRead: qbCustomers.length,
        infoFloCompaniesRead: companyCsv.rows.length,
        infoFloContactsRead: contactsCsv.rows.length,
        stagedCompanies: companyValues.length,
        uniqueStagedCompanies: companyValues.length,
        stagedContacts: contactValues.length,
        stagedRelationships: relationshipValues.length,
        proposedRelationships: relationshipValues.length,
        unresolved,
        quickBooksInfoFloCompanyMatches: companySourceConsolidation.summary.quickBooksInfoFloCompanyMatches,
        matchedQuickBooksInfoFloCompanies: companySourceConsolidation.summary.quickBooksInfoFloCompanyMatches,
        quickBooksOnlyCompanies: companySourceConsolidation.summary.quickBooksOnlyCompanies,
        infoFloOnlyCompanies: companySourceConsolidation.summary.infoFloOnlyCompanies,
        trueNewCompanies: companyValues.filter((row) => row.status === "new_company").length,
        ambiguousCompanyMatches: companyValues.filter((row) => row.status === "ambiguous").length,
        ambiguousCompanies: companyValues.filter((row) => row.status === "ambiguous").length,
        rejectedCompanies: companyValues.filter((row) => row.status === "rejected").length,
        unmatchedQuickBooksCompanies: companySourceConsolidation.summary.unmatchedQuickBooksCompanies,
        unmatchedInfoFloCompanies: companySourceConsolidation.summary.unmatchedInfoFloCompanies,
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
    return { batch, companyRows, contactRows, relationshipRows, finalizePreview: buildFinalizePreviewCounts({ companyRows, contactRows, relationshipRows }) };
  }

  private async refreshBatchReviewState(tx: any, organizationId: string, batchId: string) {
    const [companyRows, contactRows, relationshipRows] = await Promise.all([
      tx.select().from(customerContactImportCompanyRecords).where(eq(customerContactImportCompanyRecords.batchId, batchId)),
      tx.select().from(customerContactImportContactRecords).where(eq(customerContactImportContactRecords.batchId, batchId)),
      tx.select().from(customerContactImportRelationshipRecords).where(eq(customerContactImportRelationshipRecords.batchId, batchId)),
    ]);
    const preview = buildFinalizePreviewCounts({ companyRows, contactRows, relationshipRows });
    const [batch] = await tx
      .select()
      .from(customerContactImportBatches)
      .where(and(eq(customerContactImportBatches.organizationId, organizationId), eq(customerContactImportBatches.id, batchId)))
      .limit(1);
    const summaryJson = { ...((batch?.summaryJson as any) ?? {}), ...preview };
    await tx
      .update(customerContactImportBatches)
      .set({
        status: preview.remainingUnresolved > 0 ? "needs_review" : "ready_to_finalize",
        summaryJson,
        updatedAt: new Date(),
      })
      .where(and(eq(customerContactImportBatches.organizationId, organizationId), eq(customerContactImportBatches.id, batchId)));
    return preview;
  }

  async applyReviewDecision(input: MigrationReviewDecisionInput) {
    return this.dbClient.transaction(async (tx: any) => {
      const now = new Date();
      if (input.recordType === "company") {
        const [row] = await tx
          .select()
          .from(customerContactImportCompanyRecords)
          .where(and(
            eq(customerContactImportCompanyRecords.organizationId, input.organizationId),
            eq(customerContactImportCompanyRecords.batchId, input.batchId),
            eq(customerContactImportCompanyRecords.id, input.recordId),
          ))
          .limit(1);
        if (!row) throw Object.assign(new Error("Company review record not found."), { statusCode: 404 });
        const patch = buildCompanyReviewPatch(row, input);
        await tx
          .update(customerContactImportCompanyRecords)
          .set({ ...patch, updatedAt: now })
          .where(eq(customerContactImportCompanyRecords.id, input.recordId));
        const dependentRelationships = await tx
          .select({ contactRecordId: customerContactImportRelationshipRecords.contactRecordId })
          .from(customerContactImportRelationshipRecords)
          .where(and(
            eq(customerContactImportRelationshipRecords.batchId, input.batchId),
            eq(customerContactImportRelationshipRecords.companyRecordId, input.recordId),
          ));
        const dependentContactIds = dependentRelationships
          .map((relationship: { contactRecordId?: string | null }) => relationship.contactRecordId)
          .filter((id: string | null | undefined): id is string => Boolean(id));
        if (dependentContactIds.length > 0) {
          const dependentPatch = buildDependentContactPatchAfterCompanyDecision("company_pending", patch);
          if (dependentPatch) {
            await tx
              .update(customerContactImportContactRecords)
              .set({ ...dependentPatch, updatedAt: now })
              .where(and(
                eq(customerContactImportContactRecords.batchId, input.batchId),
                inArray(customerContactImportContactRecords.id, dependentContactIds),
                eq(customerContactImportContactRecords.status, "company_pending"),
              ));
          }
        }
        const relationshipPatch = buildRelationshipPatchAfterCompanyDecision(patch);
        await tx
          .update(customerContactImportRelationshipRecords)
          .set({
            ...relationshipPatch,
            updatedAt: now,
          })
          .where(and(
            eq(customerContactImportRelationshipRecords.batchId, input.batchId),
            eq(customerContactImportRelationshipRecords.companyRecordId, input.recordId),
          ));
      } else {
        const [row] = await tx
          .select()
          .from(customerContactImportContactRecords)
          .where(and(
            eq(customerContactImportContactRecords.organizationId, input.organizationId),
            eq(customerContactImportContactRecords.batchId, input.batchId),
            eq(customerContactImportContactRecords.id, input.recordId),
          ))
          .limit(1);
        if (!row) throw Object.assign(new Error("Contact review record not found."), { statusCode: 404 });
        const patch = buildContactReviewPatch(row, input);
        await tx
          .update(customerContactImportContactRecords)
          .set({ ...patch, updatedAt: now })
          .where(eq(customerContactImportContactRecords.id, input.recordId));
        await tx
          .update(customerContactImportRelationshipRecords)
          .set({
            selectedContactId: patch.selectedContactId ?? null,
            status: patch.status === "rejected" ? "skipped" : "ready",
            errorMessage: patch.status === "rejected" ? "Contact source ignored by reviewer." : null,
            updatedAt: now,
          })
          .where(and(
            eq(customerContactImportRelationshipRecords.batchId, input.batchId),
            eq(customerContactImportRelationshipRecords.contactRecordId, input.recordId),
          ));
      }

      const preview = await this.refreshBatchReviewState(tx, input.organizationId, input.batchId);
      return { preview };
    });
  }

  async listBatches(organizationId: string, limit = 25): Promise<CustomerContactImportBatch[]> {
    return this.dbClient
      .select()
      .from(customerContactImportBatches)
      .where(eq(customerContactImportBatches.organizationId, organizationId))
      .orderBy(sql`${customerContactImportBatches.createdAt} desc`)
      .limit(Math.min(100, Math.max(1, limit)));
  }

  async finalizeBatch(organizationId: string, batchId: string, actorUserId: string, confirmation: string, allowUnresolvedSkips = false) {
    if (confirmation !== "FINALIZE") {
      throw Object.assign(new Error("Explicit FINALIZE confirmation is required."), { statusCode: 400 });
    }

    return this.dbClient.transaction(async (tx: any) => {
      const currentCompanyRows = await tx.select().from(customerContactImportCompanyRecords).where(eq(customerContactImportCompanyRecords.batchId, batchId));
      const currentContactRows = await tx.select().from(customerContactImportContactRecords).where(eq(customerContactImportContactRecords.batchId, batchId));
      const currentRelationshipRows = await tx.select().from(customerContactImportRelationshipRecords).where(eq(customerContactImportRelationshipRecords.batchId, batchId));
      const preview = buildFinalizePreviewCounts({
        companyRows: currentCompanyRows,
        contactRows: currentContactRows,
        relationshipRows: currentRelationshipRows,
      });
      if (preview.remainingUnresolved > 0 && !allowUnresolvedSkips) {
        throw Object.assign(new Error("Resolve remaining exceptions or explicitly approve unresolved skips before finalizing."), { statusCode: 409 });
      }

      const allowedStatuses = (allowUnresolvedSkips
        ? ["ready_to_finalize", "completed_with_exceptions", "needs_review"]
        : ["ready_to_finalize", "completed_with_exceptions"]) as CustomerContactImportBatch["status"][];
      const [lockedBatch] = await tx
        .update(customerContactImportBatches)
        .set({ status: "finalizing", lockedAt: new Date(), lockToken: crypto.randomUUID(), updatedAt: new Date() })
        .where(and(
          eq(customerContactImportBatches.organizationId, organizationId),
          eq(customerContactImportBatches.id, batchId),
          inArray(customerContactImportBatches.status, allowedStatuses),
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
        if (row.status === "rejected" || unresolvedCompanyStatuses.has(String(row.status))) {
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
          const additionalInfoFloSourceRecordIds = Array.isArray((row.normalizedJson as any)?.additionalInfoFloSourceRecordIds)
            ? (row.normalizedJson as any).additionalInfoFloSourceRecordIds.filter((sourceRecordId: unknown): sourceRecordId is string => typeof sourceRecordId === "string" && sourceRecordId.trim().length > 0)
            : [];
          for (const sourceRecordId of additionalInfoFloSourceRecordIds) {
            await upsertExternalIdentity(tx, {
              organizationId,
              entityType: "customer",
              entityId: customerId,
              sourceSystem: "infoflo",
              sourceEntityType: "company",
              sourceRecordId,
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
        if (row.status === "rejected" || unresolvedContactStatuses.has(String(row.status))) {
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
        if (!customerId || !contactId || row.status === "ambiguous" || row.status === "failed") {
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
          summaryJson: { ...(lockedBatch.summaryJson as any), finalization: counts, unresolvedSkipsApproved: allowUnresolvedSkips },
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

  buildReportRows(kind: CsvReportKind, batch: Awaited<ReturnType<CustomerContactMigrationService["getBatch"]>>): Array<Record<string, unknown>> {
    if (!batch) return [];
    if (kind === "completed-mappings") {
      return [
        ...batch.companyRows.filter((row) => row.status === "imported").map((row) => ({ type: "company", rowNumber: row.rowNumber, sourceRecordId: row.sourceRecordId, entityId: row.selectedCustomerId })),
        ...batch.contactRows.filter((row) => row.status === "imported").map((row) => ({ type: "contact", rowNumber: row.rowNumber, sourceRecordId: row.sourceRecordId, entityId: row.selectedContactId })),
        ...batch.relationshipRows.filter((row) => row.status === "created" || row.status === "updated").map((row) => ({ type: "relationship", sourceRecordId: row.sourceRecordId, linkId: row.selectedLinkId, customerId: row.selectedCustomerId, contactId: row.selectedContactId })),
      ];
    }
    if (kind === "exceptions") {
      return [
        ...batch.companyRows.filter((row) => row.status === "ambiguous" || row.status === "failed").map((row) => ({ type: "company", rowNumber: row.rowNumber, sourceRecordId: row.sourceRecordId, status: row.status, error: row.errorMessage, warnings: row.warningsJson })),
        ...batch.contactRows.filter((row) => row.status.includes("ambiguous") || row.status === "failed" || row.status === "company_missing").map((row) => ({ type: "contact", rowNumber: row.rowNumber, sourceRecordId: row.sourceRecordId, status: row.status, error: row.errorMessage, warnings: row.warningsJson })),
        ...batch.relationshipRows.filter((row) => row.status === "ambiguous" || row.status === "failed" || row.status === "skipped").map((row) => ({ type: "relationship", sourceRecordId: row.sourceRecordId, status: row.status, error: row.errorMessage, warnings: row.warningsJson })),
      ];
    }
    if (kind === "rejected-records") {
      return [
        ...batch.companyRows.filter((row) => row.status === "rejected").map((row) => ({ type: "company", rowNumber: row.rowNumber, sourceRecordId: row.sourceRecordId, error: row.errorMessage })),
        ...batch.contactRows.filter((row) => row.status === "rejected").map((row) => ({ type: "contact", rowNumber: row.rowNumber, sourceRecordId: row.sourceRecordId, error: row.errorMessage })),
      ];
    }
    if (kind === "conflicts") {
      return [
        ...batch.companyRows.filter((row) => row.status === "ambiguous").map((row) => ({ type: "company", rowNumber: row.rowNumber, sourceRecordId: row.sourceRecordId, candidates: row.matchCandidatesJson })),
        ...batch.contactRows.filter((row) => row.status === "ambiguous_person").map((row) => ({ type: "contact", rowNumber: row.rowNumber, sourceRecordId: row.sourceRecordId, candidates: row.matchCandidatesJson })),
      ];
    }
    return [
      ...batch.companyRows.filter((row) => row.status === "failed").map((row) => ({ type: "company", rowNumber: row.rowNumber, sourceRecordId: row.sourceRecordId, error: row.errorMessage })),
      ...batch.contactRows.filter((row) => row.status === "failed").map((row) => ({ type: "contact", rowNumber: row.rowNumber, sourceRecordId: row.sourceRecordId, error: row.errorMessage })),
      ...batch.relationshipRows.filter((row) => row.status === "failed").map((row) => ({ type: "relationship", sourceRecordId: row.sourceRecordId, error: row.errorMessage })),
    ];
  }

  buildCsvReport(rows: Array<Record<string, unknown>>, headers: string[]): string {
    const orderedHeaders = headers.length > 0
      ? headers
      : Array.from(rows.reduce((set, row) => {
          Object.keys(row).forEach((key) => set.add(key));
          return set;
        }, new Set<string>()));
    const escape = (value: unknown) => {
      const text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [orderedHeaders.join(","), ...rows.map((row) => orderedHeaders.map((header) => escape(row[header])).join(","))].join("\r\n") + "\r\n";
  }

  buildReportCsv(kind: string, batchId: string, batch: Awaited<ReturnType<CustomerContactMigrationService["getBatch"]>>) {
    if (!(kind in csvReportHeaders)) return null;
    const reportKind = kind as CsvReportKind;
    const rows = this.buildReportRows(reportKind, batch);
    return {
      body: this.buildCsvReport(rows, csvReportHeaders[reportKind]),
      contentType: "text/csv; charset=utf-8",
      contentDisposition: `attachment; filename="${reportKind}-${batchId}.csv"`,
      rowCount: rows.length,
    };
  }
}

export const customerContactMigrationService = new CustomerContactMigrationService();
