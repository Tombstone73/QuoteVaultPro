import {
  assertSalesLineSnapshot,
  type CommercialTerms,
  type QuoteCheckpoint,
  type SalesLineSnapshot,
  type SellingPriceDecision,
} from "./contracts.js";
import type { PricingResult, ResolvedProductConfiguration } from "../pricing/contracts.js";
import {
  canonicalJson,
  type CurrencyCode,
  type Money,
  type OrganizationId,
  type QuoteCheckpointId,
  type QuoteId,
  type SalesLineId,
} from "../shared/commercialValues.js";
import type { CustomerContactReference } from "../customers/contracts.js";

/** The only Sales document kinds. Lifecycle remains in the corresponding subtype. */
export type SalesDocumentKind = "quote" | "order";
export type SalesDocumentRevision = number;

export type SalesDocumentNumber = Readonly<{
  kind: SalesDocumentKind;
  core: bigint;
  display: string;
}>;

export type PersistedSalesDocumentCurrentState = Readonly<{
  organizationId: OrganizationId;
  kind: SalesDocumentKind;
  number: SalesDocumentNumber;
  revision: SalesDocumentRevision;
  customerContact: CustomerContactReference;
  purchaseOrderNumber?: string;
  requestedDueDate?: string;
  currency: CurrencyCode;
  /** Only termsCode lives in terms_json; context, rep, and notes have scalar owners below. */
  termsCode?: string;
  taxContextReference?: string;
  salesRepresentativeId?: string;
  commercialNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export type SalesDocumentTermsPersistence = Readonly<{
  termsJson: Readonly<{ termsCode?: string }>;
  taxContextReference?: string;
  salesRepresentativeId?: string;
  commercialNotes?: string;
}>;

/** Prevents terms_json from becoming a second mutable copy of scalar header facts. */
export const toSalesDocumentTermsPersistence = (terms: CommercialTerms): SalesDocumentTermsPersistence => Object.freeze({
  termsJson: terms.termsCode === undefined ? Object.freeze({}) : Object.freeze({ termsCode: terms.termsCode }),
  taxContextReference: terms.taxContextReference,
  salesRepresentativeId: terms.salesRepresentativeId,
  commercialNotes: terms.commercialNotes,
});

/**
 * The compact persistence envelope for one Sales line. The two amounts are
 * deliberately queryable projections; the complete immutable explanation is
 * frozen in PricingResult and SellingPriceDecision JSON.
 */
export type SalesLinePersistenceEnvelope = Readonly<{
  lineId: SalesLineId;
  productId: string;
  productTypeId?: string;
  description: string;
  quantity: number;
  currency: CurrencyCode;
  calculatedUnitAmount: Money;
  calculatedLineAmount: Money;
  sellingUnitAmount: Money;
  sellingLineAmount: Money;
  resolvedConfiguration: ResolvedProductConfiguration;
  pricingResult: PricingResult;
  sellingPriceDecision: SellingPriceDecision;
  taxability: Readonly<{ taxable: boolean; source: "product" | "legacy_compatibility" }>;
  /** Canonical text lets an eventual repository hash/fingerprint payloads without JSON key-order drift. */
  canonicalResolvedConfiguration: string;
  canonicalPricingResult: string;
  canonicalSellingPriceDecision: string;
}>;

export const toSalesLinePersistenceEnvelope = (line: SalesLineSnapshot): SalesLinePersistenceEnvelope => {
  assertSalesLineSnapshot(line);
  const decision = line.sellingPriceDecision;
  return Object.freeze({
    lineId: line.lineId,
    productId: line.productId,
    productTypeId: line.productTypeId,
    description: line.description,
    quantity: line.quantity,
    currency: line.pricingResult.currency,
    calculatedUnitAmount: line.pricingResult.calculatedUnitAmount,
    calculatedLineAmount: line.calculatedLineAmount,
    sellingUnitAmount: decision.resultingUnitAmount,
    sellingLineAmount: line.sellingLineAmount,
    resolvedConfiguration: line.resolvedConfiguration,
    pricingResult: line.pricingResult,
    sellingPriceDecision: decision,
    taxability: line.taxability ?? { taxable: true, source: "legacy_compatibility" as const },
    canonicalResolvedConfiguration: canonicalJson(line.resolvedConfiguration),
    canonicalPricingResult: canonicalJson(line.pricingResult),
    canonicalSellingPriceDecision: canonicalJson(decision),
  });
};

export type QuoteCheckpointPersistenceEnvelope = Readonly<{
  checkpointId: QuoteCheckpointId;
  quoteId: QuoteId;
  checkpointKind: QuoteCheckpoint["kind"];
  occurredAt: string;
  schemaVersion: 1;
  evidenceFingerprint: string;
  sourceCheckpointId?: QuoteCheckpointId;
  canonicalPayload: string;
}>;

/** Checkpoints are copied once into append-only storage; this is not a current-state serializer. */
export const toQuoteCheckpointPersistenceEnvelope = (checkpoint: QuoteCheckpoint): QuoteCheckpointPersistenceEnvelope => Object.freeze({
  checkpointId: checkpoint.checkpointId,
  quoteId: checkpoint.sourceDocument.quoteId,
  checkpointKind: checkpoint.kind,
  occurredAt: checkpoint.occurredAt,
  schemaVersion: checkpoint.schemaVersion,
  evidenceFingerprint: checkpoint.evidenceFingerprint,
  sourceCheckpointId: checkpoint.sourceCheckpointId,
  canonicalPayload: canonicalJson(checkpoint),
});

/** An optimistic edit can change a Sales document only from this exact revision. */
export const assertExpectedSalesDocumentRevision = (expected: string, actual: SalesDocumentRevision): void => {
  if (!/^[1-9]\d*$/u.test(expected) || BigInt(expected) !== BigInt(actual)) {
    throw new Error("STALE_STATE: the Sales document revision no longer matches.");
  }
};
