import { createHash } from "crypto";
import type { InboundOrderParseAttempt, InboundOrderRecord, InboundOrderRecordStatus } from "@shared/schema";
import {
  getManualInboundEvidence,
  inboundOrderParsedDraftSchema,
  inboundOrderReviewDraftPayloadSchema,
  type InboundOrderArtworkLink,
  type InboundOrderCandidate,
  type InboundOrderParsedDraft,
  type InboundOrderParseWarning,
} from "@shared/inboundOrdersApi";
import type { InboundAttachmentClassification } from "@shared/inboundAttachmentClassification";
import { parseAiJsonObject } from "../ai/bugReviewValidator";
import { createConfiguredAiProvider, resolveAiProviderTimeoutMs } from "../ai/providers/configuredProvider";
import {
  AiProviderTimeoutError,
  AiProviderUnavailableError,
  type AiProviderAdapter,
  type AiProviderResponse,
} from "../ai/providers/AiProviderAdapter";
import {
  inboundOrdersRepository,
  type CreateInboundOrderParseAttemptValues,
  type InboundCandidateResult,
  type InboundOrdersRepository,
} from "../../storage/inboundOrders.repo";
import { InboundOrderTransitionError } from "./InboundOrderService";
import {
  inboundOrderEvidenceService,
  type InboundOrderEvidenceBundle,
  type ManualAttachmentClassificationEvidence,
} from "./InboundOrderEvidenceService";
import { inferInboundRequestedDate } from "./inboundOrderDateInference";
import { CustomerIntelligenceService } from "./CustomerIntelligenceService";

const INBOUND_ORDER_PARSE_PROMPT_VERSION = "inbound-order-parse-v1";
const EDITABLE_REVIEW_DRAFT_KIND = "editable_review_draft";

export type InboundOrderParseResult = {
  draft: InboundOrderParsedDraft | null;
  latestAttempt: InboundOrderParseAttempt;
  record: InboundOrderRecord;
};

function clampConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

const QUANTITY_WORD_VALUES: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  dozen: 12,
};

const PRINT_ITEM_WORDS = [
  "banner",
  "banners",
  "decal",
  "decals",
  "magnet",
  "magnets",
  "poster",
  "posters",
  "print",
  "prints",
  "sign",
  "signs",
  "sticker",
  "stickers",
  "wrap",
  "wraps",
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function warning(code: string, message: string, severity: InboundOrderParseWarning["severity"] = "warning", fieldPath?: string): InboundOrderParseWarning {
  return { code, message, severity, fieldPath: fieldPath ?? null };
}

function toError(message: string, code = "parse_failed") {
  return { code, message };
}

function uniqueIds(candidates: InboundCandidateResult[]): string[] {
  return Array.from(new Set(candidates.map((candidate) => candidate.id)));
}

function candidateDto(candidate: InboundCandidateResult): InboundOrderCandidate {
  return {
    id: candidate.id,
    label: candidate.label,
    confidence: clampConfidence(candidate.confidence),
    reason: candidate.reason,
    metadata: candidate.metadata ?? {},
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter((item): item is string => Boolean(item));
}

function normalizeWarnings(value: unknown): InboundOrderParseWarning[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return warning("ai_warning", item, "warning");
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const message = stringValue(record.message) ?? stringValue(record.reason);
    if (!message) return null;
    const severityRaw = stringValue(record.severity);
    const severity = severityRaw === "blocking" || severityRaw === "info" ? severityRaw : "warning";
    return warning(
      stringValue(record.code) ?? "ai_warning",
      message,
      severity,
      stringValue(record.fieldPath) ?? undefined,
    );
  }).filter((item): item is InboundOrderParseWarning => Boolean(item));
}

function normalizeMissingDecisions(value: unknown): InboundOrderParsedDraft["missingDecisions"] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (typeof item === "string" && item.trim()) {
      return {
        field: `missing_${index + 1}`,
        label: item.trim(),
        reason: item.trim(),
        severity: "warning" as const,
      };
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const label = stringValue(record.label) ?? stringValue(record.field) ?? `Missing decision ${index + 1}`;
    return {
      field: stringValue(record.field) ?? label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      label,
      reason: stringValue(record.reason) ?? label,
      severity: stringValue(record.severity) === "blocking" ? "blocking" : "warning",
    };
  }).filter((item): item is InboundOrderParsedDraft["missingDecisions"][number] => Boolean(item));
}

function combinedLineItemText(lineItem: InboundOrderParsedDraft["lineItems"][number]): string {
  return [
    lineItem.sourceText,
    lineItem.productName,
    lineItem.materialText,
    ...lineItem.optionTexts,
    ...lineItem.finishingTexts,
    ...lineItem.artworkRefs,
  ].filter(Boolean).join(" ");
}

function hasDimensionSignal(lineItem: InboundOrderParsedDraft["lineItems"][number]): boolean {
  if (lineItem.width && lineItem.height) return true;
  const text = combinedLineItemText(lineItem);
  return /\b\d+(?:\.\d+)?\s*(?:in|inch|inches|ft|feet|foot|mm|cm)?\s*(?:x|by|×)\s*\d+(?:\.\d+)?\b/i.test(text)
    || /\b\d+(?:\.\d+)?\s*(?:in|inch|inches|ft|feet|foot|mm|cm)\b/i.test(text);
}

function lineItemIntent(lineItem: InboundOrderParsedDraft["lineItems"][number]): "yard_sign" | "banner" | "sticker" | "custom_size" | null {
  const text = combinedLineItemText(lineItem).toLowerCase();
  if (/\b(yard|lawn|political|realtor|event)\s+signs?\b/.test(text) || /\bcoroplast\b/.test(text)) return "yard_sign";
  if (/\bbanners?\b/.test(text)) return "banner";
  if (/\b(stickers?|decals?|labels?)\b/.test(text)) return "sticker";
  if (/\bcustom\s+size\b/.test(text)) return "custom_size";
  return null;
}

function missingDecision(field: string, label: string, reason: string, severity: "warning" | "blocking" = "warning") {
  return { field, label, reason, severity };
}

export class InboundOrderParsingService {
  constructor(
    private readonly repository = inboundOrdersRepository,
    private readonly providerFactory: () => AiProviderAdapter | null = createConfiguredAiProvider,
    private readonly evidenceService = inboundOrderEvidenceService,
    private readonly customerIntelligence = new CustomerIntelligenceService(repository as any),
  ) {}

  async parseInboundOrderRecord(args: {
    organizationId: string;
    inboundRecordId: string;
    actorUserId: string;
  }): Promise<InboundOrderParseResult> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }

    this.assertParseAllowed(record);

    await this.repository.updateRecordWithEvent({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      patch: {
        status: "waiting_on_customer",
        requiresHumanDecision: true,
        reviewRequiredReason: "AI parsing in progress.",
      },
      event: {
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "parse.requested",
        fromStatus: record.status,
        toStatus: "waiting_on_customer",
        message: null,
        metadataJson: {
          phase: "inbound_orders_phase_2",
          reviewOnly: true,
        },
      },
    });

    const evidenceBundle = await this.buildEvidenceBundle(args.organizationId, record);
    const prompt = await this.buildInboundOrderParsePrompt(args.organizationId, record, evidenceBundle);
    const rawPromptHash = createHash("sha256").update(prompt.system).update("\n").update(prompt.user).digest("hex");
    const provider = this.providerFactory();

    if (!provider) {
      const attempt = await this.storeAttemptAndUpdateRecord({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        actorUserId: args.actorUserId,
        previousStatus: "waiting_on_customer",
        attempt: {
          organizationId: args.organizationId,
          inboundOrderRecordId: args.inboundRecordId,
          status: "failed",
          provider: null,
          model: null,
          rawPromptHash,
          rawResponse: null,
          repairedResponse: null,
          parsedDraft: null,
          confidence: 0,
          warnings: [],
          errors: [toError("AI provider is not configured.", "provider_unavailable")],
        },
        finalStatus: "needs_review",
        reviewRequiredReason: "AI provider is not configured. Source evidence remains available for retry.",
      });
      return this.resultFromAttempt(args.organizationId, args.inboundRecordId, attempt);
    }

    try {
      const response = await provider.generateJson({
        orgId: args.organizationId,
        feature: "order_parsing",
        system: prompt.system,
        user: prompt.user,
        promptVersion: INBOUND_ORDER_PARSE_PROMPT_VERSION,
        timeoutMs: resolveAiProviderTimeoutMs(),
        timeoutUseCase: "inbound_order_parsing",
      });

      const rawObject = parseAiJsonObject(response.rawText);
      const validation = this.validateInboundOrderParseResult(rawObject);
      const repaired = validation.success
        ? { draft: validation.draft, repairedResponse: null, repaired: false, warnings: [] as InboundOrderParseWarning[] }
        : this.repairInboundOrderParseResult(rawObject, record);
      const refinedDraft = this.refineParsedDraft(record, repaired.draft, evidenceBundle);
      const draftWithCandidates = await this.addCandidateMatches(args.organizationId, refinedDraft);
      const draftWithCustomerIntelligence = await this.attachCustomerIntelligence(args.organizationId, draftWithCandidates);
      const score = this.scoreInboundOrderParseResult(draftWithCustomerIntelligence);
      const finalWarnings = [
        ...draftWithCustomerIntelligence.globalWarnings,
        ...repaired.warnings,
      ];
      const finalStatus = this.resolveParsedRecordStatus(draftWithCustomerIntelligence, score);
      const attemptStatus = repaired.repaired ? "repaired" : "success";

      const attempt = await this.storeAttemptAndUpdateRecord({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        actorUserId: args.actorUserId,
        previousStatus: "waiting_on_customer",
        attempt: {
          organizationId: args.organizationId,
          inboundOrderRecordId: args.inboundRecordId,
          status: attemptStatus,
          provider: response.provider,
          model: response.model,
          rawPromptHash,
          rawResponse: this.responseForStorage(response, rawObject),
          repairedResponse: repaired.repairedResponse,
          parsedDraft: draftWithCustomerIntelligence,
          confidence: score,
          warnings: finalWarnings,
          errors: [],
        },
        finalStatus,
        reviewRequiredReason: finalStatus === "ready"
          ? null
          : "AI parsing found warnings or missing decisions that need staff review.",
      });

      return this.resultFromAttempt(args.organizationId, args.inboundRecordId, attempt);
    } catch (error: any) {
      const providerError = error instanceof AiProviderUnavailableError
        ? "AI provider is not configured for order parsing."
        : error instanceof AiProviderTimeoutError
          ? error.message
          : error?.message ?? "AI parsing failed.";
      const attempt = await this.storeAttemptAndUpdateRecord({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        actorUserId: args.actorUserId,
        previousStatus: "waiting_on_customer",
        attempt: {
          organizationId: args.organizationId,
          inboundOrderRecordId: args.inboundRecordId,
          status: "failed",
          provider: error instanceof AiProviderTimeoutError ? error.provider : null,
          model: error instanceof AiProviderTimeoutError ? error.model : null,
          rawPromptHash,
          rawResponse: null,
          repairedResponse: null,
          parsedDraft: null,
          confidence: 0,
          warnings: [],
          errors: [toError(
            providerError,
            error instanceof AiProviderTimeoutError
              ? "timeout"
              : error instanceof AiProviderUnavailableError
                ? "provider_unavailable"
                : "provider_failed",
          )],
        },
        finalStatus: "needs_review",
        reviewRequiredReason: `${providerError} Source evidence remains available for retry.`,
      });
      return this.resultFromAttempt(args.organizationId, args.inboundRecordId, attempt);
    }
  }

  async getDraftPreview(args: {
    organizationId: string;
    inboundRecordId: string;
  }): Promise<{ draft: InboundOrderParsedDraft | null; latestAttempt: InboundOrderParseAttempt | null }> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }
    const latestAttempt = await this.repository.getLatestParseAttempt(args.organizationId, args.inboundRecordId);
    return {
      latestAttempt,
      draft: this.parsedDraftFromAttempt(latestAttempt),
    };
  }

  async listParseAttempts(args: {
    organizationId: string;
    inboundRecordId: string;
  }): Promise<InboundOrderParseAttempt[]> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);
    if (!record) {
      throw new InboundOrderTransitionError("Inbound order record not found", 404);
    }
    return this.repository.listParseAttempts(args.organizationId, args.inboundRecordId);
  }

  async buildEvidenceBundle(organizationId: string, record: InboundOrderRecord): Promise<InboundOrderEvidenceBundle> {
    const files = await this.repository.listFiles(organizationId, record.id);
    const manualClassifications = await this.getManualAttachmentClassifications(organizationId, record.id);
    return this.evidenceService.buildEvidenceBundle({
      organizationId,
      record,
      files,
      manualClassifications,
    });
  }

  private async getManualAttachmentClassifications(
    organizationId: string,
    inboundRecordId: string,
  ): Promise<Map<string, ManualAttachmentClassificationEvidence>> {
    const listReviewSnapshots = (this.repository as Partial<InboundOrdersRepository>).listReviewSnapshots;
    if (typeof listReviewSnapshots !== "function") return new Map();
    const snapshots = await listReviewSnapshots.call(this.repository, organizationId, inboundRecordId);
    const snapshot = snapshots.find((candidate) => {
      const payload = candidate.payloadJson && typeof candidate.payloadJson === "object" && !Array.isArray(candidate.payloadJson)
        ? candidate.payloadJson as Record<string, unknown>
        : null;
      const metadata = payload?.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
        ? payload.metadata as Record<string, unknown>
        : null;
      return stringValue(metadata?.snapshotKind) === EDITABLE_REVIEW_DRAFT_KIND;
    });
    const parsed = snapshot ? inboundOrderReviewDraftPayloadSchema.safeParse(snapshot.payloadJson) : null;
    if (!parsed?.success) return new Map();
    const links = [
      ...parsed.data.reviewedArtworkJson.unassignedAttachments,
      ...parsed.data.reviewedLineItemsJson.flatMap((lineItem) => lineItem.artworkLinks),
    ];
    const manual = links.filter((link) => link.manualOverride || link.classificationSource === "manual_override");
    const map = new Map<string, ManualAttachmentClassificationEvidence>();
    for (const link of manual) {
      const classification = this.manualClassificationFromLink(link);
      if (!classification) continue;
      const evidence: ManualAttachmentClassificationEvidence = {
        classification,
        automaticClassification: link.automaticClassification ?? null,
        automaticConfidence: link.automaticClassificationConfidence ?? null,
        automaticReasons: link.automaticClassificationReasons ?? [],
        learningEvidence: link.learningEvidence as Record<string, unknown> | null | undefined,
      };
      map.set(`file:${link.fileId}`, evidence);
      if (link.fileRecordId) map.set(`record:${link.fileRecordId}`, evidence);
    }
    return map;
  }

  private manualClassificationFromLink(link: InboundOrderArtworkLink): InboundAttachmentClassification | null {
    const value = link.classification;
    if (value === "PO" || value === "ARTWORK" || value === "REFERENCE" || value === "IGNORE_INLINE" || value === "OTHER") return value;
    if (link.role === "po") return "PO";
    if (link.role === "artwork") return "ARTWORK";
    if (link.role === "reference") return "REFERENCE";
    if (link.role === "ignore_inline") return "IGNORE_INLINE";
    return null;
  }

  async buildInboundOrderParsePrompt(
    organizationId: string,
    record: InboundOrderRecord,
    evidenceBundle?: InboundOrderEvidenceBundle,
  ): Promise<{ system: string; user: string }> {
    const evidence = getManualInboundEvidence(record);
    const bundle = evidenceBundle ?? await this.buildEvidenceBundle(organizationId, record);
    const sourceEvidence = {
      recordId: record.id,
      sourceType: record.sourceType,
      status: record.status,
      receivedAt: record.receivedAt,
      reference: evidence.reference,
      senderName: evidence.senderName,
      senderEmail: evidence.senderEmail,
      subject: evidence.subject,
      bodyText: evidence.bodyText,
      notes: evidence.notes,
      evidenceItems: bundle.items.map((item) => ({
        type: item.type,
        label: item.label,
        fileName: item.fileName,
        rawText: item.rawText,
        pageCount: item.pageCount,
        documentType: item.documentType,
        documentConfidence: item.documentConfidence,
        manualClassificationUsed: item.manualClassificationUsed,
        automaticClassification: item.automaticClassification,
        manualClassification: item.manualClassification,
        finalClassification: item.finalClassification,
        classificationInfluence: item.classificationInfluence,
        learningEvidence: item.learningEvidence,
        warnings: item.warnings,
        poSummary: item.poSummary,
      })),
      evidenceConflicts: bundle.conflicts,
      evidenceReconciliation: bundle.reconciliation ?? null,
    };
    const customerIntelligence = await this.customerIntelligence.buildSummaryForSourceEvidence({
      organizationId,
      senderEmail: evidence.senderEmail,
      senderName: evidence.senderName,
      companyName: evidence.senderName,
    });

    return {
      system: [
        "You parse inbound print order requests for TitanOS.",
        "Return JSON only: one parsed draft object and no explanation.",
        "This is parsing only. Do not create orders, quotes, customers, contacts, products, artwork, production, fulfillment, invoices, or payments.",
        "Use null for unknown scalar fields, [] for empty arrays, and confidence values from 0 to 100.",
        "Return candidate IDs only when present in provided context; otherwise leave candidate arrays empty.",
        "Interpret dates using receivedAt/email context. If a month/day has no year, use the context year unless it has already passed, then choose the next reasonable future date and add a warning.",
        "Think like a print CSR: flag missing size, quantity, artwork, material, and other decisions that block accurate order entry.",
        "Treat purchase order attachments as highest-priority evidence, then other PDF/text attachment content, then email body, then subject.",
        "Manual attachment classification is authoritative. If an evidence item says Manual attachment classification used, honor that finalClassification with confidence 100.",
        "Manual PO files must be parsed first for PO number, quantities, due dates, ship/bill info, and order notes. Manual Artwork files are artwork candidates. Manual Reference files are supporting evidence only. Manual Junk/Signature files are omitted from evidence.",
        "If email text conflicts with a purchase order attachment, preserve the purchase order value and return a warning.",
        "Customer history context is advisory only. It can explain familiar terminology, but explicit source evidence always wins.",
      ].join(" "),
      user: [
        "Return exactly one JSON object with this shape:",
        JSON.stringify({
          customer: {
            sourceName: null,
            sourceEmail: null,
            sourcePhone: null,
            companyName: null,
            candidateCustomerIds: [],
            candidateContactIds: [],
            confidence: 0,
            warnings: [],
          },
          order: {
            requestedDueDate: null,
            requestedShipMethod: null,
            requestedPickup: null,
            poNumber: null,
            notes: null,
            confidence: 0,
            warnings: [],
          },
          lineItems: [{
            sourceText: null,
            productName: null,
            candidateProductIds: [],
            quantity: null,
            width: null,
            height: null,
            dimensionsUnit: null,
            materialText: null,
            optionTexts: [],
            finishingTexts: [],
            artworkRefs: [],
            confidence: 0,
            warnings: [],
          }],
          artwork: [],
          globalWarnings: [],
          missingDecisions: [],
        }),
        "",
        "Source evidence:",
        JSON.stringify(sourceEvidence),
        "",
        "Customer intelligence summary, if any. This is summarized history, not source evidence:",
        JSON.stringify(customerIntelligence),
      ].join("\n"),
    };
  }

  validateInboundOrderParseResult(result: unknown): { success: true; draft: InboundOrderParsedDraft } | { success: false; errors: string[] } {
    const parsed = inboundOrderParsedDraftSchema.safeParse(result);
    if (!parsed.success) {
      return {
        success: false,
        errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      };
    }
    return { success: true, draft: parsed.data };
  }

  refineParsedDraft(record: InboundOrderRecord, draft: InboundOrderParsedDraft, evidenceBundle?: InboundOrderEvidenceBundle): InboundOrderParsedDraft {
    const evidenceRefined = evidenceBundle ? this.applyReconciledEvidence(this.applyAttachmentEvidencePriority(draft, evidenceBundle), evidenceBundle) : draft;
    const hasPurchaseOrderDueDate = Boolean(
      evidenceBundle?.items.some((item) => item.documentType === "purchase_order" && item.poSummary?.dueDate),
    );
    const dateRefined = hasPurchaseOrderDueDate ? evidenceRefined : this.applyDateInference(record, evidenceRefined);
    const quantityRefined = this.applyQuantityWordInference(record, dateRefined);
    const decisionsRefined = this.applyMissingDecisionDetection(quantityRefined);
    return evidenceBundle
      ? {
        ...decisionsRefined,
        evidence: {
          items: evidenceBundle.items,
          conflicts: evidenceBundle.conflicts,
          reconciliation: evidenceBundle.reconciliation ?? null,
        },
        globalWarnings: [
          ...decisionsRefined.globalWarnings,
          ...evidenceBundle.conflicts,
        ],
      }
      : decisionsRefined;
  }

  applyQuantityWordInference(record: InboundOrderRecord, draft: InboundOrderParsedDraft): InboundOrderParsedDraft {
    if (draft.lineItems.length === 0 || draft.lineItems.every((lineItem) => lineItem.quantity)) return draft;
    const evidence = getManualInboundEvidence(record);
    const sharedEvidenceText = [
      evidence.bodyText,
      evidence.notes,
      evidence.subject,
      draft.order.notes,
    ].filter(Boolean).join("\n");

    let changed = false;
    const lineItems = draft.lineItems.map((lineItem, index) => {
      if (lineItem.quantity) return lineItem;
      const inference = this.inferQuantityWordForLineItem(lineItem, sharedEvidenceText);
      if (!inference) return lineItem;
      changed = true;
      return {
        ...lineItem,
        quantity: inference.quantity,
        sourceText: lineItem.sourceText
          ? lineItem.sourceText.includes(inference.sourceText) ? lineItem.sourceText : `${lineItem.sourceText} ${inference.sourceText}`.trim()
          : inference.sourceText,
        confidence: Math.max(lineItem.confidence, 82),
        warnings: [
          ...lineItem.warnings,
          warning(
            "quantity_inferred_from_number_word",
            `Quantity ${inference.quantity} inferred from email body phrase "${inference.sourceText}".`,
            "info",
            `lineItems.${index}.quantity`,
          ),
        ],
      };
    });

    return changed ? { ...draft, lineItems } : draft;
  }

  private inferQuantityWordForLineItem(
    lineItem: InboundOrderParsedDraft["lineItems"][number],
    evidenceText: string,
  ): { quantity: number; sourceText: string } | null {
    const text = [lineItem.sourceText, evidenceText].filter(Boolean).join("\n");
    if (!text.trim()) return null;

    const productTerms = new Set<string>();
    const addWords = (value: string | null | undefined) => {
      if (!value) return;
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 3)
        .forEach((word) => {
          productTerms.add(word);
          if (!word.endsWith("s")) productTerms.add(`${word}s`);
        });
    };
    addWords(lineItem.productName);
    addWords(lineItem.materialText);
    lineItem.optionTexts.forEach(addWords);
    lineItem.finishingTexts.forEach(addWords);
    PRINT_ITEM_WORDS.forEach((word) => productTerms.add(word));

    const quantityWords = Object.keys(QUANTITY_WORD_VALUES).join("|");
    const productAlternates = Array.from(productTerms).map(escapeRegex).join("|");
    const pattern = new RegExp(`\\b(${quantityWords})\\b\\s+(?:[\\w./#-]+\\s+){0,3}?(${productAlternates})\\b`, "i");
    const match = text.match(pattern);
    if (!match) return null;
    const quantity = QUANTITY_WORD_VALUES[match[1].toLowerCase()];
    if (!quantity) return null;
    return {
      quantity,
      sourceText: match[0].replace(/\s+/g, " ").trim(),
    };
  }

  applyReconciledEvidence(draft: InboundOrderParsedDraft, evidenceBundle: InboundOrderEvidenceBundle): InboundOrderParsedDraft {
    const reconciliation = evidenceBundle.reconciliation;
    if (!reconciliation) return draft;
    const firstLine = draft.lineItems[0] ?? {
      sourceText: null,
      productName: null,
      candidateProductIds: [],
      productCandidates: [],
      quantity: null,
      width: null,
      height: null,
      dimensionsUnit: null,
      materialText: null,
      optionTexts: [],
      finishingTexts: [],
      artworkRefs: [],
      confidence: 0,
      warnings: [],
    };
    const dimensions = typeof reconciliation.dimensions.value === "string"
      ? this.parseDimensionText(reconciliation.dimensions.value)
      : { width: null, height: null, unit: null };
    const shouldUseQuantity = typeof reconciliation.quantity.value === "number"
      && reconciliation.quantity.status !== "missing"
      && reconciliation.quantity.status !== "conflict";
    const shouldUseProduct = typeof reconciliation.product.value === "string"
      && reconciliation.product.status !== "missing"
      && reconciliation.product.status !== "conflict";
    const shouldUseMaterial = typeof reconciliation.material.value === "string"
      && reconciliation.material.status !== "missing"
      && reconciliation.material.status !== "conflict";
    const artworkSupplied = reconciliation.artworkStatus.value === "supplied";
    const enrichedLine = {
      ...firstLine,
      productName: shouldUseProduct ? reconciliation.product.value as string : firstLine.productName,
      quantity: shouldUseQuantity ? reconciliation.quantity.value as number : firstLine.quantity,
      width: dimensions.width ?? firstLine.width,
      height: dimensions.height ?? firstLine.height,
      dimensionsUnit: dimensions.unit ?? firstLine.dimensionsUnit,
      materialText: shouldUseMaterial ? reconciliation.material.value as string : firstLine.materialText,
      artworkRefs: artworkSupplied && firstLine.artworkRefs.length === 0 ? ["Artwork supplied via source evidence"] : firstLine.artworkRefs,
      confidence: Math.max(firstLine.confidence, ...[
        reconciliation.product,
        reconciliation.quantity,
        reconciliation.dimensions,
        reconciliation.material,
        reconciliation.artworkStatus,
      ].flatMap((field) => field.sources.map((source) => source.confidence))),
    };
    const dueDate = typeof reconciliation.dueDate.value === "string" && reconciliation.dueDate.status !== "conflict"
      ? reconciliation.dueDate.value
      : draft.order.requestedDueDate;
    const orderWarnings = reconciliation.rushStatus.value === "rush"
      ? [warning(
        "evidence_reconciliation_rush_priority",
        "Rush request detected in source evidence. Review draft priority should be Rush.",
        "info",
        "reviewedOrderJson.priority",
      )]
      : [];

    return {
      ...draft,
      order: {
        ...draft.order,
        requestedDueDate: dueDate ?? draft.order.requestedDueDate,
        warnings: [
          ...draft.order.warnings,
          ...orderWarnings,
        ],
      },
      lineItems: [
        enrichedLine,
        ...draft.lineItems.slice(1),
      ],
      artwork: artworkSupplied && draft.artwork.length === 0
        ? [{
          filename: null,
          sourceReference: String(reconciliation.artworkStatus.sources[0]?.sourceText ?? reconciliation.artworkStatus.sources[0]?.label ?? "Artwork supplied via source evidence"),
          likelyLineItemIndex: 0,
          purpose: "artwork",
          confidence: Math.max(70, reconciliation.artworkStatus.sources[0]?.confidence ?? 70),
          warnings: [],
        }]
        : draft.artwork,
    };
  }

  applyAttachmentEvidencePriority(draft: InboundOrderParsedDraft, evidenceBundle: InboundOrderEvidenceBundle): InboundOrderParsedDraft {
    const purchaseOrder = evidenceBundle.items
      .filter((item) => item.documentType === "purchase_order" && item.poSummary)
      .sort((left, right) => right.documentConfidence - left.documentConfidence)[0];
    const summary = purchaseOrder?.poSummary;
    if (!summary) return draft;

    const dimensions = this.parseDimensionText(summary.dimensions ?? null);
    const firstLine = draft.lineItems[0] ?? {
      sourceText: null,
      productName: null,
      candidateProductIds: [],
      productCandidates: [],
      quantity: null,
      width: null,
      height: null,
      dimensionsUnit: null,
      materialText: null,
      optionTexts: [],
      finishingTexts: [],
      artworkRefs: [],
      confidence: 0,
      warnings: [],
    };
    const enrichedLine = {
      ...firstLine,
      sourceText: [
        firstLine.sourceText,
        summary.productDescription,
        summary.material,
        summary.dimensions,
        ...summary.printSpecs,
      ].filter(Boolean).join(" ") || firstLine.sourceText,
      productName: summary.productDescription ?? firstLine.productName,
      quantity: summary.quantity ?? firstLine.quantity,
      width: dimensions.width ?? firstLine.width,
      height: dimensions.height ?? firstLine.height,
      dimensionsUnit: dimensions.unit ?? firstLine.dimensionsUnit,
      materialText: summary.material ?? firstLine.materialText,
      optionTexts: Array.from(new Set([...firstLine.optionTexts, ...summary.printSpecs])),
      confidence: Math.max(firstLine.confidence, purchaseOrder.documentConfidence),
    };

    return {
      ...draft,
      order: {
        ...draft.order,
        poNumber: summary.poNumber ?? draft.order.poNumber,
        requestedDueDate: summary.dueDate ?? draft.order.requestedDueDate,
        requestedShipMethod: summary.shippingNotes ?? draft.order.requestedShipMethod,
        confidence: Math.max(draft.order.confidence, purchaseOrder.documentConfidence),
        warnings: [
          ...draft.order.warnings,
          ...purchaseOrder.warnings,
        ],
      },
      lineItems: [
        enrichedLine,
        ...draft.lineItems.slice(1),
      ],
    };
  }

  private parseDimensionText(value: string | null): { width: number | null; height: number | null; unit: string | null } {
    if (!value) return { width: null, height: null, unit: null };
    const match = value.match(/(\d+(?:\.\d+)?)\s*(?:in|inch|inches|ft|feet|mm|cm)?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(in|inch|inches|ft|feet|mm|cm)?/i);
    if (!match) return { width: null, height: null, unit: null };
    const unit = match[3]?.toLowerCase().replace(/^inch(?:es)?$/, "in").replace(/^feet$/, "ft") ?? null;
    return { width: Number(match[1]), height: Number(match[2]), unit };
  }

  applyDateInference(record: InboundOrderRecord, draft: InboundOrderParsedDraft): InboundOrderParsedDraft {
    const evidence = getManualInboundEvidence(record);
    const evidenceDateText = [
      evidence.subject,
      evidence.bodyText,
      evidence.notes,
      draft.order.notes,
    ].filter(Boolean).join("\n");
    const fallbackDateText = [
      draft.order.requestedDueDate,
      draft.order.notes,
    ].filter(Boolean).join("\n");
    const inferred = inferInboundRequestedDate({
      text: evidenceDateText,
      receivedAt: record.receivedAt,
    }) ?? inferInboundRequestedDate({
      text: fallbackDateText,
      receivedAt: record.receivedAt,
    });

    if (!inferred) return draft;

    const dateWarning = inferred.confidence < 80 || inferred.warning
      ? [warning(
        inferred.confidence < 70 ? "date_inference_low_confidence" : "date_inferred_from_context",
        inferred.warning ?? `Requested date inferred from "${inferred.sourceText}".`,
        inferred.confidence < 70 ? "warning" : "info",
        "order.requestedDueDate",
      )]
      : [];

    return {
      ...draft,
      order: {
        ...draft.order,
        requestedDueDate: inferred.parsedDate,
        confidence: Math.max(draft.order.confidence, inferred.confidence),
        warnings: [
          ...draft.order.warnings,
          ...dateWarning,
        ],
      },
    };
  }

  applyMissingDecisionDetection(draft: InboundOrderParsedDraft): InboundOrderParsedDraft {
    const existingFields = new Set(draft.missingDecisions.map((decision) => decision.field));
    const generated: InboundOrderParsedDraft["missingDecisions"] = [];
    const hasArtworkReference = draft.artwork.length > 0 || draft.lineItems.some((lineItem) => lineItem.artworkRefs.length > 0);

    draft.lineItems.forEach((lineItem, index) => {
      const intent = lineItemIntent(lineItem);
      if (!hasDimensionSignal(lineItem)) {
        const field = `lineItems.${index}.dimensions`;
        if (!existingFields.has(field) && intent) {
          const question = intent === "yard_sign"
            ? "What size are the signs?"
            : intent === "banner"
              ? "What size banner is needed?"
              : intent === "sticker"
                ? "What size stickers are needed?"
                : "What custom size is needed?";
          generated.push(missingDecision(
            field,
            question,
            "CSR review detected a product type that requires dimensions, but no size was found in the source evidence.",
            "blocking",
          ));
          existingFields.add(field);
        }
      }

      const quantityField = `lineItems.${index}.quantity`;
      if (!lineItem.quantity && !existingFields.has(quantityField)) {
        generated.push(missingDecision(
          quantityField,
          "What quantity is needed?",
          "No clear quantity was detected for this line item.",
          "blocking",
        ));
        existingFields.add(quantityField);
      }

      const artworkField = `lineItems.${index}.artwork`;
      if (!hasArtworkReference && !existingFields.has(artworkField)) {
        generated.push(missingDecision(
          artworkField,
          "Is artwork supplied for this item?",
          "No artwork file or artwork reference was detected in the source evidence.",
          "warning",
        ));
        existingFields.add(artworkField);
      }
    });

    if (generated.length === 0) return draft;
    return {
      ...draft,
      missingDecisions: [
        ...draft.missingDecisions,
        ...generated,
      ],
    };
  }

  repairInboundOrderParseResult(raw: unknown, record: InboundOrderRecord): {
    draft: InboundOrderParsedDraft;
    repairedResponse: Record<string, unknown>;
    repaired: true;
    warnings: InboundOrderParseWarning[];
  } {
    const source = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const candidate = (source.parsedDraft ?? source.draft ?? source) as Record<string, unknown>;
    const evidence = getManualInboundEvidence(record);
    const rawCustomer = candidate.customer && typeof candidate.customer === "object" ? candidate.customer as Record<string, unknown> : {};
    const rawOrder = candidate.order && typeof candidate.order === "object" ? candidate.order as Record<string, unknown> : {};
    const rawLineItems = Array.isArray(candidate.lineItems) ? candidate.lineItems : [];
    const repaired = {
      customer: {
        sourceName: stringValue(rawCustomer.sourceName) ?? evidence.senderName,
        sourceEmail: stringValue(rawCustomer.sourceEmail) ?? evidence.senderEmail,
        sourcePhone: stringValue(rawCustomer.sourcePhone),
        companyName: stringValue(rawCustomer.companyName) ?? evidence.senderName,
        candidateCustomerIds: normalizeStringArray(rawCustomer.candidateCustomerIds),
        candidateContactIds: normalizeStringArray(rawCustomer.candidateContactIds),
        customerCandidates: [],
        contactCandidates: [],
        confidence: clampConfidence(rawCustomer.confidence),
        warnings: normalizeWarnings(rawCustomer.warnings),
      },
      order: {
        requestedDueDate: stringValue(rawOrder.requestedDueDate),
        requestedShipMethod: stringValue(rawOrder.requestedShipMethod),
        requestedPickup: typeof rawOrder.requestedPickup === "boolean" ? rawOrder.requestedPickup : null,
        poNumber: stringValue(rawOrder.poNumber) ?? evidence.reference,
        notes: stringValue(rawOrder.notes) ?? evidence.bodyText,
        confidence: clampConfidence(rawOrder.confidence),
        warnings: normalizeWarnings(rawOrder.warnings),
      },
      lineItems: rawLineItems.map((item) => {
        const row = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
        return {
          sourceText: stringValue(row.sourceText),
          productName: stringValue(row.productName),
          candidateProductIds: normalizeStringArray(row.candidateProductIds),
          productCandidates: [],
          quantity: numberValue(row.quantity),
          width: numberValue(row.width),
          height: numberValue(row.height),
          dimensionsUnit: stringValue(row.dimensionsUnit),
          materialText: stringValue(row.materialText),
          optionTexts: normalizeStringArray(row.optionTexts),
          finishingTexts: normalizeStringArray(row.finishingTexts),
          artworkRefs: normalizeStringArray(row.artworkRefs),
          confidence: clampConfidence(row.confidence),
          warnings: normalizeWarnings(row.warnings),
        };
      }),
      artwork: Array.isArray(candidate.artwork) ? candidate.artwork.map((item) => {
        const row = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
        const purpose = stringValue(row.purpose);
        return {
          filename: stringValue(row.filename),
          sourceReference: stringValue(row.sourceReference),
          likelyLineItemIndex: Number.isInteger(row.likelyLineItemIndex) ? row.likelyLineItemIndex as number : null,
          purpose: purpose === "artwork" || purpose === "proof" || purpose === "reference" ? purpose : "unknown" as const,
          confidence: clampConfidence(row.confidence),
          warnings: normalizeWarnings(row.warnings),
        };
      }) : [],
      globalWarnings: normalizeWarnings(candidate.globalWarnings),
      missingDecisions: normalizeMissingDecisions(candidate.missingDecisions),
    };

    const parsed = inboundOrderParsedDraftSchema.parse(repaired);
    return {
      draft: parsed,
      repairedResponse: repaired,
      repaired: true,
      warnings: [warning("schema_repaired", "AI response needed schema normalization before review.", "info")],
    };
  }

  scoreInboundOrderParseResult(result: InboundOrderParsedDraft): number {
    const scores = [
      result.customer.confidence,
      result.order.confidence,
      ...result.lineItems.map((lineItem) => lineItem.confidence),
      ...result.artwork.map((artwork) => artwork.confidence),
    ].filter((score) => Number.isFinite(score));
    const average = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
    const penalty = result.missingDecisions.length * 8
      + result.globalWarnings.filter((item) => item.severity === "blocking").length * 15;
    return clampConfidence(average - penalty);
  }

  async matchInboundCustomerCandidates(organizationId: string, result: InboundOrderParsedDraft): Promise<{
    customerCandidates: InboundCandidateResult[];
    contactCandidates: InboundCandidateResult[];
  }> {
    const customerCandidates = await this.repository.searchCustomerCandidates({
      organizationId,
      email: result.customer.sourceEmail,
      name: result.customer.companyName ?? result.customer.sourceName,
      limit: 5,
    });
    const contactCandidates = await this.repository.searchContactCandidates({
      organizationId,
      email: result.customer.sourceEmail,
      name: result.customer.sourceName,
      limit: 5,
    });
    return { customerCandidates, contactCandidates };
  }

  async matchInboundProductCandidates(organizationId: string, result: InboundOrderParsedDraft): Promise<InboundOrderParsedDraft["lineItems"]> {
    const lineItems = [];
    for (const lineItem of result.lineItems) {
      const candidates = await this.repository.searchProductCandidates({
        organizationId,
        sourceText: lineItem.sourceText,
        productName: lineItem.productName,
        materialText: lineItem.materialText,
        optionTexts: lineItem.optionTexts,
        finishingTexts: lineItem.finishingTexts,
        limit: 5,
      });
      lineItems.push({
        ...lineItem,
        productCandidates: candidates.map(candidateDto),
        candidateProductIds: uniqueIds(candidates),
      });
    }
    return lineItems;
  }

  private assertParseAllowed(record: InboundOrderRecord) {
    if (record.createdQuoteId || record.createdOrderId || record.status === "submitted" || record.status === "approved") {
      throw new InboundOrderTransitionError("Converted inbound records cannot be parsed in Phase 2.");
    }
    if (record.status === "terminal" || record.reviewOutcome === "rejected") {
      throw new InboundOrderTransitionError("Rejected inbound records cannot be parsed in Phase 2.");
    }
  }

  private async addCandidateMatches(organizationId: string, draft: InboundOrderParsedDraft): Promise<InboundOrderParsedDraft> {
    const { customerCandidates, contactCandidates } = await this.matchInboundCustomerCandidates(organizationId, draft);
    const lineItems = await this.matchInboundProductCandidates(organizationId, draft);
    return {
      ...draft,
      customer: {
        ...draft.customer,
        customerCandidates: customerCandidates.map(candidateDto),
        contactCandidates: contactCandidates.map(candidateDto),
        candidateCustomerIds: uniqueIds(customerCandidates),
        candidateContactIds: uniqueIds(contactCandidates),
      },
      lineItems,
    };
  }

  private async attachCustomerIntelligence(organizationId: string, draft: InboundOrderParsedDraft): Promise<InboundOrderParsedDraft> {
    if (draft.customerIntelligence) return draft;
    const summary = await this.customerIntelligence.buildSummaryForParsedDraft({ organizationId, draft });
    return summary ? { ...draft, customerIntelligence: summary } : draft;
  }

  private resolveParsedRecordStatus(draft: InboundOrderParsedDraft, score: number): InboundOrderRecordStatus {
    const hasBlocking = [
      ...draft.globalWarnings,
      ...draft.customer.warnings,
      ...draft.order.warnings,
      ...draft.lineItems.flatMap((lineItem) => lineItem.warnings),
      ...draft.artwork.flatMap((artwork) => artwork.warnings),
    ].some((item) => item.severity === "blocking");
    const structurallyComplete = draft.lineItems.length > 0
      && draft.lineItems.every((lineItem) => Boolean(lineItem.productName || lineItem.sourceText) && Boolean(lineItem.quantity));
    if (structurallyComplete && !hasBlocking && draft.missingDecisions.length === 0 && score >= 70) {
      return "ready";
    }
    return "needs_review";
  }

  private async storeAttemptAndUpdateRecord(args: {
    organizationId: string;
    inboundRecordId: string;
    actorUserId: string;
    previousStatus: InboundOrderRecordStatus;
    attempt: CreateInboundOrderParseAttemptValues;
    finalStatus: InboundOrderRecordStatus;
    reviewRequiredReason: string | null;
  }): Promise<InboundOrderParseAttempt> {
    const attempt = await this.repository.createParseAttempt(args.attempt);
    await this.repository.updateRecordWithEvent({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      patch: {
        status: args.finalStatus,
        ...(args.attempt.parsedDraft ? { parsedAt: new Date() } : {}),
        requiresHumanDecision: args.finalStatus !== "ready",
        reviewRequiredReason: args.reviewRequiredReason,
      },
      event: {
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "parse.completed",
        fromStatus: args.previousStatus,
        toStatus: args.finalStatus,
        message: args.reviewRequiredReason,
        metadataJson: {
          parseAttemptId: attempt.id,
          parseStatus: attempt.status,
          confidence: attempt.confidence,
          warningCount: Array.isArray(attempt.warnings) ? attempt.warnings.length : 0,
          errorCount: Array.isArray(attempt.errors) ? attempt.errors.length : 0,
          reviewOnly: true,
        },
      },
    });
    return attempt;
  }

  private async resultFromAttempt(
    organizationId: string,
    inboundRecordId: string,
    latestAttempt: InboundOrderParseAttempt,
  ): Promise<InboundOrderParseResult> {
    const record = await this.repository.getRecord(organizationId, inboundRecordId);
    if (!record) {
      throw new InboundOrderTransitionError("Inbound order record not found after parse", 404);
    }
    return {
      draft: this.parsedDraftFromAttempt(latestAttempt),
      latestAttempt,
      record,
    };
  }

  private parsedDraftFromAttempt(attempt: InboundOrderParseAttempt | null): InboundOrderParsedDraft | null {
    if (!attempt?.parsedDraft) return null;
    const parsed = inboundOrderParsedDraftSchema.safeParse(attempt.parsedDraft);
    return parsed.success ? parsed.data : null;
  }

  private responseForStorage(response: AiProviderResponse, rawObject: unknown): Record<string, unknown> {
    return {
      parsedJson: rawObject,
      provider: response.provider,
      model: response.model,
      requestMetadata: response.requestMetadata,
    };
  }
}

export const inboundOrderParsingService = new InboundOrderParsingService();
