export type MatchConfidence = "exact" | "strong" | "review" | "none";

export interface MatchCandidate {
  id: string;
  confidence: MatchConfidence;
  reason: string;
  score: number;
}

export interface CompanyLike {
  id: string;
  companyName: string | null;
  email?: string | null;
  phone?: string | null;
  billingStreet1?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingPostalCode?: string | null;
  shippingStreet1?: string | null;
  shippingCity?: string | null;
  shippingState?: string | null;
  shippingPostalCode?: string | null;
  externalAccountingId?: string | null;
}

export interface ExternalIdentityLike {
  entityType: string;
  entityId: string;
  sourceSystem: string;
  sourceEntityType: string;
  sourceRecordId: string;
}

export interface ContactLike {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  externalSource?: string | null;
  externalSourceId?: string | null;
  externalSourceType?: string | null;
  linkedCustomerIds?: string[];
}

export interface NormalizedCompanySource {
  sourceRecordId?: string | null;
  quickBooksCustomerId?: string | null;
  quickBooksCustomerName?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  street1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

export interface NormalizedContactSource {
  sourceRecordId?: string | null;
  firstName: string;
  lastName: string;
  fullName?: string | null;
  companyName?: string | null;
  relatedCustomerId?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  title?: string | null;
  type?: string | null;
  billToEmail?: string | null;
  proofEmail?: string | null;
}

export interface MatchResult {
  status: "matched" | "new" | "ambiguous" | "rejected";
  selectedId?: string;
  candidates: MatchCandidate[];
  warnings: string[];
}

const LEGAL_SUFFIXES = new Set([
  "llc",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "ltd",
  "limited",
  "company",
  "co",
]);

const GENERIC_LOCAL_PARTS = new Set([
  "accounting",
  "accounts",
  "billing",
  "orders",
  "order",
  "info",
  "graphics",
  "sales",
  "support",
  "admin",
  "office",
  "customerservice",
  "customer.service",
  "hello",
  "contact",
]);

const SYSTEM_NAME_PATTERNS = [
  /\binfoflo\s+support\b/i,
  /\btest\s+(user|contact|record)\b/i,
  /\bfake\s+(user|contact|record)\b/i,
  /\bsystem\s+(user|contact)\b/i,
];

export function normalizeCompanyName(value: unknown): string {
  const words = String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) {
    words.pop();
  }

  return words.join(" ");
}

export function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "").trim();
  if (!email) return null;
  const normalized = email.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

export function emailDomain(value: unknown): string | null {
  const email = normalizeEmail(value);
  if (!email) return null;
  const [, domain] = email.split("@");
  return domain || null;
}

export function isGenericSharedEmail(value: unknown): boolean {
  const email = normalizeEmail(value);
  if (!email) return false;
  const [local] = email.split("@");
  return GENERIC_LOCAL_PARTS.has(local.replace(/[-_]/g, ".").replace(/\.+/g, ".")) || GENERIC_LOCAL_PARTS.has(local.replace(/[-_.]/g, ""));
}

export function normalizePhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function normalizePersonName(firstName: unknown, lastName: unknown, fullName?: unknown): { firstName: string; lastName: string; displayName: string } | null {
  let first = String(firstName ?? "").trim();
  let last = String(lastName ?? "").trim();
  const full = String(fullName ?? "").trim();

  if ((!first || !last) && full) {
    const parts = full.replace(/\s+/g, " ").split(" ").filter(Boolean);
    if (!first && parts.length > 1) first = parts[0];
    if (!last && parts.length > 1) last = parts.slice(1).join(" ");
  }

  first = first.replace(/\s+/g, " ");
  last = last.replace(/\s+/g, " ");
  const displayName = `${first} ${last}`.trim();

  if (!first || !last) return null;
  if (SYSTEM_NAME_PATTERNS.some((pattern) => pattern.test(displayName))) return null;
  if (/^(n\/a|na|none|null|unknown)$/i.test(first) || /^(n\/a|na|none|null|unknown)$/i.test(last)) return null;

  return { firstName: first, lastName: last, displayName };
}

function onlyOneTopCandidate(candidates: MatchCandidate[]): MatchCandidate | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  if (sorted.length > 1 && sorted[0].score === sorted[1].score) return null;
  return sorted[0];
}

function candidate(id: string, confidence: MatchConfidence, reason: string, score: number): MatchCandidate {
  return { id, confidence, reason, score };
}

export function matchCompany(
  source: NormalizedCompanySource,
  existingCompanies: CompanyLike[],
  externalIdentities: ExternalIdentityLike[] = [],
): MatchResult {
  const warnings: string[] = [];
  const candidates: MatchCandidate[] = [];
  const normalizedName = normalizeCompanyName(source.name);

  if (!normalizedName && !source.quickBooksCustomerId && !source.sourceRecordId) {
    return { status: "rejected", candidates: [], warnings: ["Missing company identity."] };
  }

  if (source.quickBooksCustomerId) {
    const exactQb = existingCompanies.filter((company) => String(company.externalAccountingId ?? "") === String(source.quickBooksCustomerId));
    if (exactQb.length === 1) {
      return { status: "matched", selectedId: exactQb[0].id, candidates: [candidate(exactQb[0].id, "exact", "Existing QuickBooks Customer ID", 100)], warnings };
    }
    if (exactQb.length > 1) {
      return { status: "ambiguous", candidates: exactQb.map((company) => candidate(company.id, "exact", "Duplicate QuickBooks Customer ID", 100)), warnings };
    }
  }

  if (source.sourceRecordId) {
    const exactInfoFlo = externalIdentities.filter((identity) =>
      identity.entityType === "customer" &&
      identity.sourceSystem === "infoflo" &&
      identity.sourceEntityType === "company" &&
      String(identity.sourceRecordId) === String(source.sourceRecordId)
    );
    if (exactInfoFlo.length === 1) {
      return { status: "matched", selectedId: exactInfoFlo[0].entityId, candidates: [candidate(exactInfoFlo[0].entityId, "exact", "Existing InfoFlo company Entry ID", 98)], warnings };
    }
    if (exactInfoFlo.length > 1) {
      return { status: "ambiguous", candidates: exactInfoFlo.map((identity) => candidate(identity.entityId, "exact", "Duplicate InfoFlo company Entry ID", 98)), warnings };
    }
  }

  if (source.quickBooksCustomerName) {
    const qbNameMatches = existingCompanies.filter((company) => company.companyName === source.quickBooksCustomerName);
    if (qbNameMatches.length === 1) {
      return { status: "matched", selectedId: qbNameMatches[0].id, candidates: [candidate(qbNameMatches[0].id, "exact", "Exact QuickBooks Customer Name", 95)], warnings };
    }
    if (qbNameMatches.length > 1) {
      return { status: "ambiguous", candidates: qbNameMatches.map((company) => candidate(company.id, "exact", "Ambiguous QuickBooks Customer Name", 95)), warnings };
    }
  }

  const normalizedNameMatches = existingCompanies.filter((company) => normalizeCompanyName(company.companyName) === normalizedName && normalizedName);
  if (normalizedNameMatches.length === 1) {
    const match = normalizedNameMatches[0];
    const hasSupport = Boolean(
      (emailDomain(source.email) && emailDomain(match.email) === emailDomain(source.email)) ||
      (normalizePhone(source.phone) && normalizePhone(match.phone) === normalizePhone(source.phone)) ||
      (source.postalCode && source.postalCode === (match.billingPostalCode || match.shippingPostalCode))
    );
    return {
      status: "matched",
      selectedId: match.id,
      candidates: [candidate(match.id, hasSupport ? "strong" : "review", hasSupport ? "Normalized name with supporting evidence" : "Exact normalized company name", hasSupport ? 90 : 82)],
      warnings,
    };
  }
  if (normalizedNameMatches.length > 1) {
    warnings.push("Multiple existing companies share the normalized name; manual review required.");
    return { status: "ambiguous", candidates: normalizedNameMatches.map((company) => candidate(company.id, "review", "Ambiguous normalized company name", 82)), warnings };
  }

  const sourceDomain = emailDomain(source.email);
  const sourcePhone = normalizePhone(source.phone);
  const strongCandidates = existingCompanies
    .map((company) => {
      let score = 0;
      const reasons: string[] = [];
      if (normalizedName && normalizeCompanyName(company.companyName) === normalizedName) {
        score += 50;
        reasons.push("normalized name");
      }
      if (sourceDomain && emailDomain(company.email) === sourceDomain) {
        score += 15;
        reasons.push("email domain");
      }
      if (sourcePhone && normalizePhone(company.phone) === sourcePhone) {
        score += 15;
        reasons.push("phone");
      }
      const sourceAddress = [source.street1, source.city, source.state, source.postalCode].map((v) => String(v ?? "").toLowerCase().trim()).join("|");
      const billingAddress = [company.billingStreet1, company.billingCity, company.billingState, company.billingPostalCode].map((v) => String(v ?? "").toLowerCase().trim()).join("|");
      const shippingAddress = [company.shippingStreet1, company.shippingCity, company.shippingState, company.shippingPostalCode].map((v) => String(v ?? "").toLowerCase().trim()).join("|");
      if (sourceAddress !== "|||" && (sourceAddress === billingAddress || sourceAddress === shippingAddress)) {
        score += 20;
        reasons.push("address");
      }
      return score >= 65 ? candidate(company.id, "strong", `Strong multi-field match: ${reasons.join(", ")}`, score) : null;
    })
    .filter((row): row is MatchCandidate => Boolean(row));

  const top = onlyOneTopCandidate(strongCandidates);
  if (top) return { status: "matched", selectedId: top.id, candidates: strongCandidates, warnings };
  if (strongCandidates.length > 0) return { status: "ambiguous", candidates: strongCandidates, warnings };

  return { status: "new", candidates: [], warnings };
}

export function matchContact(
  source: NormalizedContactSource,
  existingContacts: ContactLike[],
  externalIdentities: ExternalIdentityLike[] = [],
): MatchResult {
  const warnings: string[] = [];
  const personName = normalizePersonName(source.firstName, source.lastName, source.fullName);
  const email = normalizeEmail(source.email);
  const mobile = normalizePhone(source.mobile);
  const phone = normalizePhone(source.phone);

  if (!personName) {
    return { status: "rejected", candidates: [], warnings: ["Missing, malformed, or system/test contact name."] };
  }

  if (source.sourceRecordId) {
    const exactInfoFlo = externalIdentities.filter((identity) =>
      identity.entityType === "contact" &&
      identity.sourceSystem === "infoflo" &&
      identity.sourceEntityType === "contact" &&
      String(identity.sourceRecordId) === String(source.sourceRecordId)
    );
    if (exactInfoFlo.length === 1) {
      return { status: "matched", selectedId: exactInfoFlo[0].entityId, candidates: [candidate(exactInfoFlo[0].entityId, "exact", "Existing InfoFlo contact Entry ID", 100)], warnings };
    }
    if (exactInfoFlo.length > 1) {
      return { status: "ambiguous", candidates: exactInfoFlo.map((identity) => candidate(identity.entityId, "exact", "Duplicate InfoFlo contact Entry ID", 100)), warnings };
    }
  }

  if (email && !isGenericSharedEmail(email)) {
    const emailMatches = existingContacts.filter((contact) => normalizeEmail(contact.email) === email);
    if (emailMatches.length === 1) {
      return { status: "matched", selectedId: emailMatches[0].id, candidates: [candidate(emailMatches[0].id, "exact", "Exact normalized email", 95)], warnings };
    }
    if (emailMatches.length > 1) {
      return { status: "ambiguous", candidates: emailMatches.map((contact) => candidate(contact.id, "exact", "Ambiguous normalized email", 95)), warnings };
    }
  } else if (email && isGenericSharedEmail(email)) {
    warnings.push("Generic/shared inbox was not used as a unique person identity.");
  }

  if (mobile) {
    const mobileMatches = existingContacts.filter((contact) => normalizePhone(contact.mobile) === mobile);
    if (mobileMatches.length === 1) {
      return { status: "matched", selectedId: mobileMatches[0].id, candidates: [candidate(mobileMatches[0].id, "exact", "Exact mobile phone", 92)], warnings };
    }
    if (mobileMatches.length > 1) {
      return { status: "ambiguous", candidates: mobileMatches.map((contact) => candidate(contact.id, "exact", "Ambiguous mobile phone", 92)), warnings };
    }
  }

  const firstLower = personName.firstName.toLowerCase();
  const lastLower = personName.lastName.toLowerCase();
  const relatedCompanyMatches = existingContacts.filter((contact) =>
    String(contact.firstName ?? "").trim().toLowerCase() === firstLower &&
    String(contact.lastName ?? "").trim().toLowerCase() === lastLower &&
    Boolean(source.relatedCustomerId && contact.linkedCustomerIds?.includes(source.relatedCustomerId))
  );
  if (relatedCompanyMatches.length === 1) {
    return { status: "matched", selectedId: relatedCompanyMatches[0].id, candidates: [candidate(relatedCompanyMatches[0].id, "strong", "First name + last name + related company", 88)], warnings };
  }
  if (relatedCompanyMatches.length > 1) {
    return { status: "ambiguous", candidates: relatedCompanyMatches.map((contact) => candidate(contact.id, "review", "Ambiguous same name at related company", 88)), warnings };
  }

  const composite = existingContacts
    .map((contact) => {
      let score = 0;
      const reasons: string[] = [];
      if (String(contact.firstName ?? "").trim().toLowerCase() === firstLower) {
        score += 20;
        reasons.push("first name");
      }
      if (String(contact.lastName ?? "").trim().toLowerCase() === lastLower) {
        score += 25;
        reasons.push("last name");
      }
      if (email && !isGenericSharedEmail(email) && normalizeEmail(contact.email) === email) {
        score += 35;
        reasons.push("email");
      }
      if (phone && normalizePhone(contact.phone) === phone) {
        score += 10;
        reasons.push("phone");
      }
      if (mobile && normalizePhone(contact.mobile) === mobile) {
        score += 15;
        reasons.push("mobile");
      }
      if (source.relatedCustomerId && contact.linkedCustomerIds?.includes(source.relatedCustomerId)) {
        score += 10;
        reasons.push("relationship");
      }
      return score >= 70 ? candidate(contact.id, "strong", `Strong composite match: ${reasons.join(", ")}`, score) : null;
    })
    .filter((row): row is MatchCandidate => Boolean(row));

  const top = onlyOneTopCandidate(composite);
  if (top) return { status: "matched", selectedId: top.id, candidates: composite, warnings };
  if (composite.length > 0) return { status: "ambiguous", candidates: composite, warnings };

  return { status: "new", candidates: [], warnings };
}

export function relationshipFlagsFromInfoFloType(type: unknown): { isPrimary: boolean } {
  return { isPrimary: String(type ?? "").trim().toLowerCase() === "main contact" };
}
