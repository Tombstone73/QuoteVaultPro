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
  AiProviderResponseError,
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

type ParsedDimension = {
  width: number;
  height: number;
  unit: "in" | "ft";
  sourceText: string;
  index: number;
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

function combinedInboundEvidence(record: InboundOrderRecord): Array<Record<string, unknown>> {
  const normalized = record.normalizedPayloadJson && typeof record.normalizedPayloadJson === "object" && !Array.isArray(record.normalizedPayloadJson)
    ? record.normalizedPayloadJson as Record<string, unknown>
    : {};
  const sources = normalized.combinedSources;
  if (!Array.isArray(sources)) return [];
  return sources.filter((source): source is Record<string, unknown> => (
    Boolean(source) && typeof source === "object" && !Array.isArray(source)
  ));
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

const STRUCTURED_PRODUCT_ALIASES: Array<{ productName: string; materialText?: string; pattern: RegExp; confidence: number }> = [
  { productName: "Coroplast", materialText: "Coroplast", pattern: /\b(?:coroplast|corrugated\s+plastic|yard\s+signs?|lawn\s+signs?)\b/i, confidence: 88 },
  { productName: "Banner", pattern: /\b(?:vinyl\s+)?banners?\b/i, confidence: 86 },
  { productName: "Foam Board", materialText: "Foam Core", pattern: /\b(?:foam\s*core|foam\s*board)\b/i, confidence: 84 },
  { productName: "Magnet", pattern: /\bmagnet(?:s|ic)?\b/i, confidence: 82 },
  { productName: "Decal", pattern: /\bdecals?\b/i, confidence: 82 },
  { productName: "Sticker", pattern: /\bstickers?\b/i, confidence: 82 },
  { productName: "Poster", pattern: /\bposters?\b/i, confidence: 80 },
];

const STRUCTURED_OPTION_PATTERNS: Array<{ text: string; pattern: RegExp; finishing?: boolean }> = [
  { text: "pole pocket", pattern: /\bpole\s+pockets?\b/i, finishing: true },
  { text: "3 inch pole pocket", pattern: /\b3\s*(?:"|in|inch|inches)?\s*pole\s+pockets?\b/i, finishing: true },
  { text: "top and bottom pole pockets", pattern: /\bpole\s+pockets?\b[\s\S]{0,60}\btop\s+(?:and|&)\s+bottom\b|\btop\s+(?:and|&)\s+bottom\b[\s\S]{0,60}\bpole\s+pockets?\b/i, finishing: true },
  { text: "grommets", pattern: /\bgrommet(?:s|ed)?\b/i, finishing: true },
  { text: "hems", pattern: /\bhem(?:s|med)?\b/i, finishing: true },
  { text: "rounded corners", pattern: /\brounded\s+corners?\b/i, finishing: true },
  { text: "contour cut", pattern: /\b(?:contour|die)\s+cut\b/i, finishing: true },
  { text: "lamination", pattern: /\blaminat(?:e|ed|ion)\b/i, finishing: true },
  { text: "h-stakes", pattern: /\bh[-\s]?stakes?\b/i, finishing: true },
  { text: "drill holes", pattern: /\bdrill(?:ed)?\s+holes?\b/i, finishing: true },
  { text: "mounting hardware", pattern: /\bmounting\s+hardware\b/i, finishing: true },
  { text: "white ink", pattern: /\bwhite\s+ink\b/i },
];

const ARTWORK_FILENAME_PATTERN = /\b[\w .#()'-]{1,120}\.(?:ai|eps|pdf|psd|indd|jpg|jpeg|png|tif|tiff|svg)\b/gi;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function warning(code: string, message: string, severity: InboundOrderParseWarning["severity"] = "warning", fieldPath?: string): InboundOrderParseWarning {
  return { code, message, severity, fieldPath: fieldPath ?? null };
}

function toError(message: string, code = "parse_failed") {
  return { code, message };
}

type InboundParseStage =
  | "evidence_collection"
  | "prompt_construction"
  | "provider_resolution"
  | "provider_request"
  | "response_validation"
  | "candidate_resolution";

function parseStageFailureMessage(stage: InboundParseStage, error: unknown): string {
  if (error instanceof AiProviderUnavailableError) return "AI provider is not configured for order parsing.";
  if (error instanceof AiProviderTimeoutError) return error.message;
  if (error instanceof AiProviderResponseError) {
    if (error.kind === "authentication_failure") return "AI provider authentication failed for order parsing.";
    if (error.kind === "rate_limit") return "AI provider rate limit prevented this parse. Retry later.";
    if (error.kind === "truncated_output") return "AI provider response was truncated before the order draft could be validated.";
    if (error.kind === "malformed_response" || error.kind === "empty_response") return "AI provider returned an unusable order-parse response.";
    return "AI provider request failed for order parsing.";
  }
  if (stage === "evidence_collection") return "Inbound evidence preparation failed. Source evidence remains available for retry.";
  if (stage === "prompt_construction") return "Inbound parse prompt preparation failed. Source evidence remains available for retry.";
  if (stage === "candidate_resolution") return "Inbound candidate resolution failed. Source evidence remains available for retry.";
  if (stage === "response_validation") return "AI response could not be validated as an inbound order draft.";
  return "AI parsing failed. Source evidence remains available for retry.";
}

function parseStageFailureCode(stage: InboundParseStage, error: unknown): string {
  if (error instanceof AiProviderTimeoutError) return "timeout";
  if (error instanceof AiProviderUnavailableError) return "provider_unavailable";
  if (error instanceof AiProviderResponseError) return `provider_${error.kind}`;
  return `${stage}_failed`;
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

function parseWarningsForStorage(draft: InboundOrderParsedDraft): InboundOrderParseWarning[] {
  return [
    ...draft.globalWarnings,
    ...draft.customer.warnings,
    ...draft.order.warnings,
    ...draft.lineItems.flatMap((lineItem) => lineItem.warnings),
    ...draft.artwork.flatMap((artwork) => artwork.warnings),
  ];
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

function lineItemTemplate(): InboundOrderParsedDraft["lineItems"][number] {
  return {
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
}

function missingDecision(field: string, label: string, reason: string, severity: "warning" | "blocking" = "warning") {
  return { field, label, reason, severity };
}

function parseResultSummary(draft: unknown): Record<string, unknown> {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return {
      extractedCustomer: null,
      extractedContact: null,
      extractedLineItemCount: 0,
      extractedAttachmentCount: 0,
      poCandidateCount: 0,
      missingDecisionCount: 0,
      reviewDraftPersisted: false,
    };
  }
  const parsedDraft = draft as Partial<InboundOrderParsedDraft>;
  const evidenceItems = parsedDraft.evidence?.items ?? [];
  return {
    extractedCustomer: parsedDraft.customer?.companyName ?? parsedDraft.customer?.sourceName ?? null,
    extractedContact: parsedDraft.customer?.sourceEmail ?? null,
    extractedLineItemCount: parsedDraft.lineItems?.length ?? 0,
    extractedAttachmentCount: parsedDraft.artwork?.length ?? 0,
    poCandidateCount: evidenceItems.filter((item) => item.type === "PDF_ATTACHMENT" && item.documentType === "purchase_order").length,
    missingDecisionCount: parsedDraft.missingDecisions?.length ?? 0,
    reviewDraftPersisted: false,
  };
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

    let rawPromptHash: string | null = null;
    let stage: InboundParseStage = "evidence_collection";
    try {
      const evidenceBundle = await this.buildEvidenceBundle(args.organizationId, record);
      stage = "prompt_construction";
      const prompt = await this.buildInboundOrderParsePrompt(args.organizationId, record, evidenceBundle);
      rawPromptHash = createHash("sha256").update(prompt.system).update("\n").update(prompt.user).digest("hex");
      stage = "provider_resolution";
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

      stage = "provider_request";
      const response = await provider.generateJson({
        orgId: args.organizationId,
        feature: "order_parsing",
        system: prompt.system,
        user: prompt.user,
        promptVersion: INBOUND_ORDER_PARSE_PROMPT_VERSION,
        timeoutMs: resolveAiProviderTimeoutMs(),
        timeoutUseCase: "inbound_order_parsing",
      });

      stage = "response_validation";
      const rawObject = parseAiJsonObject(response.rawText);
      const validation = this.validateInboundOrderParseResult(rawObject);
      const repaired = validation.success
        ? { draft: validation.draft, repairedResponse: null, repaired: false, warnings: [] as InboundOrderParseWarning[] }
        : this.repairInboundOrderParseResult(rawObject, record);
      const refinedDraft = this.refineParsedDraft(record, repaired.draft, evidenceBundle);
      stage = "candidate_resolution";
      const draftWithCandidates = await this.addCandidateMatches(args.organizationId, refinedDraft);
      const draftWithCustomerIntelligence = await this.attachCustomerIntelligence(args.organizationId, draftWithCandidates);
      const draftWithPromptWarnings = prompt.warnings.length > 0
        ? {
          ...draftWithCustomerIntelligence,
          globalWarnings: [...draftWithCustomerIntelligence.globalWarnings, ...prompt.warnings],
        }
        : draftWithCustomerIntelligence;
      const score = this.scoreInboundOrderParseResult(draftWithPromptWarnings);
      const finalWarnings = [
        ...parseWarningsForStorage(draftWithPromptWarnings),
        ...repaired.warnings,
      ];
      const finalStatus = this.resolveParsedRecordStatus(draftWithPromptWarnings, score);
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
          parsedDraft: draftWithPromptWarnings,
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
      const providerError = parseStageFailureMessage(stage, error);
      const attempt = await this.storeAttemptAndUpdateRecord({
        organizationId: args.organizationId,
        inboundRecordId: args.inboundRecordId,
        actorUserId: args.actorUserId,
        previousStatus: "waiting_on_customer",
        attempt: {
          organizationId: args.organizationId,
          inboundOrderRecordId: args.inboundRecordId,
          status: "failed",
          provider: error instanceof AiProviderTimeoutError || error instanceof AiProviderResponseError ? error.provider : null,
          model: error instanceof AiProviderTimeoutError || error instanceof AiProviderResponseError ? error.model : null,
          rawPromptHash,
          rawResponse: error instanceof AiProviderResponseError
            ? {
              provider: error.provider,
              model: error.model,
              requestMetadata: error.responseMetadata ?? {},
              providerRequestId: error.providerRequestId,
            }
            : null,
          repairedResponse: null,
          parsedDraft: null,
          confidence: 0,
          warnings: [],
          errors: [toError(providerError, parseStageFailureCode(stage, error))],
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
    const listChildren = (this.repository as Partial<InboundOrdersRepository>).listCombinedChildRecords;
    const childRecords = typeof listChildren === "function"
      ? await listChildren.call(this.repository, organizationId, inboundRecordId)
      : [];
    const snapshots = (await Promise.all([inboundRecordId, ...childRecords.map((record) => record.id)].map((recordId) => (
      listReviewSnapshots.call(this.repository, organizationId, recordId)
    )))).flat();
    const parsedDrafts = snapshots
      .filter((candidate) => {
        const payload = candidate.payloadJson && typeof candidate.payloadJson === "object" && !Array.isArray(candidate.payloadJson)
          ? candidate.payloadJson as Record<string, unknown>
          : null;
        const metadata = payload?.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
          ? payload.metadata as Record<string, unknown>
          : null;
        return stringValue(metadata?.snapshotKind) === EDITABLE_REVIEW_DRAFT_KIND;
      })
      .map((snapshot) => inboundOrderReviewDraftPayloadSchema.safeParse(snapshot.payloadJson))
      .filter((parsed): parsed is { success: true; data: import("@shared/inboundOrdersApi").InboundOrderReviewDraftPayload } => parsed.success)
      .map((parsed) => parsed.data);
    const links = parsedDrafts.flatMap((draft) => [
      ...draft.reviewedArtworkJson.unassignedAttachments,
      ...draft.reviewedLineItemsJson.flatMap((lineItem) => lineItem.artworkLinks),
    ]);
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
  ): Promise<{ system: string; user: string; warnings: InboundOrderParseWarning[] }> {
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
      combinedMessages: combinedInboundEvidence(record).map((source) => {
        const sourceEvidence = source.evidence && typeof source.evidence === "object" && !Array.isArray(source.evidence)
          ? source.evidence as Record<string, unknown>
          : {};
        return {
          recordId: stringValue(source.recordId),
          receivedAt: stringValue(source.receivedAt),
          senderName: stringValue(sourceEvidence.senderName),
          senderEmail: stringValue(sourceEvidence.senderEmail),
          subject: stringValue(sourceEvidence.subject),
          bodyText: stringValue(sourceEvidence.bodyText),
          notes: stringValue(sourceEvidence.notes),
        };
      }),
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
    let customerIntelligence = null;
    const promptWarnings: InboundOrderParseWarning[] = [];
    try {
      customerIntelligence = await this.customerIntelligence.buildSummaryForSourceEvidence({
        organizationId,
        senderEmail: evidence.senderEmail,
        senderName: evidence.senderName,
        companyName: evidence.senderName,
      });
    } catch (error) {
      // Customer history is advisory. A history-query failure must never block
      // a review-first parse that can be completed from the actual email/PO.
      console.warn("[INBOUND_ORDER_PARSE] Customer intelligence was unavailable; continuing with source evidence.", {
        organizationId,
        inboundRecordId: record.id,
        errorName: error instanceof Error ? error.name : "unknown",
      });
      promptWarnings.push(warning(
        "customer_intelligence_unavailable",
        "Customer history context was unavailable; parsing used the source evidence only.",
        "info",
      ));
    }

    return {
      warnings: promptWarnings,
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
    const signatureRefined = this.removeSignatureOnlyLineItems(record, draft);
    const evidenceRefined = evidenceBundle ? this.applyReconciledEvidence(this.applyAttachmentEvidencePriority(signatureRefined, evidenceBundle), evidenceBundle) : signatureRefined;
    const hasPurchaseOrderDueDate = Boolean(
      evidenceBundle?.items.some((item) => item.documentType === "purchase_order" && item.poSummary?.dueDate),
    );
    const dateRefined = hasPurchaseOrderDueDate ? evidenceRefined : this.applyDateInference(record, evidenceRefined);
    const quantityRefined = this.applyQuantityWordInference(record, dateRefined);
    // Segment before field extraction.  Structured extraction is deliberately
    // candidate-scoped below; enriching a single AI line item from the entire
    // message was allowing a later banner (or artwork) to overwrite a sign.
    const segmentedDraft = this.applyLineItemSegmentation(record, quantityRefined, evidenceBundle);
    const structuredRefined = this.applyStructuredLineItemInference(record, segmentedDraft, evidenceBundle);
    const decisionsRefined = this.applyMissingDecisionDetection(structuredRefined);
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

  applyStructuredLineItemInference(
    record: InboundOrderRecord,
    draft: InboundOrderParsedDraft,
    evidenceBundle?: InboundOrderEvidenceBundle,
  ): InboundOrderParsedDraft {
    const evidenceText = this.structuredEvidenceText(record, draft, evidenceBundle);
    if (!evidenceText.trim()) return draft;

    const baseLineItems = draft.lineItems.length > 0 ? draft.lineItems : [lineItemTemplate()];
    let changed = draft.lineItems.length === 0;
    const lineItems = baseLineItems.map((lineItem, index) => {
      // Once segmentation has found more than one item, only the source range
      // for this candidate may supply product, quantity, dimensions, finishing,
      // or artwork.  Shared email evidence is safe only for one-item requests.
      const text = baseLineItems.length > 1
        ? (lineItem.sourceText ?? "")
        : [lineItem.sourceText, evidenceText].filter(Boolean).join("\n");
      const inferredProduct = this.inferStructuredProduct(text);
      const dimensions = this.extractDistinctDimensions(text);
      const inferredQuantity = lineItem.quantity ? null : this.inferStructuredQuantity(lineItem, text);
      const printSpecs = this.extractPrintSideSpecs(text);
      const options = this.extractStructuredOptions(text);
      const artworkRefs = this.extractArtworkReferences(text);
      const dimension = !lineItem.width || !lineItem.height ? dimensions[0] ?? null : null;
      const sourceParts = [
        lineItem.sourceText,
        lineItem.productName ? null : inferredProduct?.sourceText,
        dimension?.sourceText,
        lineItem.quantity ? null : inferredQuantity?.sourceText,
        ...printSpecs,
        ...options.optionTexts,
        ...artworkRefs,
      ].filter(Boolean) as string[];
      const nextSourceText = this.mergeSourceText(sourceParts);
      const warnings = [...lineItem.warnings];

      if (inferredQuantity && !lineItem.quantity) {
        warnings.push(warning(
          "quantity_inferred_from_structured_phrase",
          `Quantity ${inferredQuantity.quantity} inferred from source phrase "${inferredQuantity.sourceText}".`,
          "info",
          `lineItems.${index}.quantity`,
        ));
      }
      if (dimension && (!lineItem.width || !lineItem.height)) {
        warnings.push(warning(
          dimension.unit === "ft" ? "dimensions_inferred_as_feet" : "dimensions_inferred_from_source",
          dimension.unit === "ft"
            ? `Size ${dimension.sourceText} was inferred as feet from banner context.`
            : `Size inferred from source phrase "${dimension.sourceText}".`,
          "info",
          `lineItems.${index}.dimensions`,
        ));
      }
      if (printSpecs.length > 0) {
        warnings.push(warning(
          "print_sides_inferred_from_source",
          `Print side specification inferred: ${printSpecs.join(", ")}.`,
          "info",
          `lineItems.${index}.optionTexts`,
        ));
      }

      const nextLineItem = {
        ...lineItem,
        sourceText: nextSourceText || lineItem.sourceText,
        productName: lineItem.productName ?? inferredProduct?.productName ?? null,
        materialText: lineItem.materialText ?? inferredProduct?.materialText ?? null,
        quantity: lineItem.quantity ?? inferredQuantity?.quantity ?? null,
        width: lineItem.width ?? dimension?.width ?? null,
        height: lineItem.height ?? dimension?.height ?? null,
        dimensionsUnit: lineItem.dimensionsUnit ?? dimension?.unit ?? null,
        optionTexts: this.uniqueTextValues([
          ...lineItem.optionTexts,
          ...printSpecs,
          ...options.optionTexts,
        ]),
        finishingTexts: this.uniqueTextValues([
          ...lineItem.finishingTexts,
          ...options.finishingTexts,
        ]),
        artworkRefs: this.uniqueTextValues([
          ...lineItem.artworkRefs,
          ...artworkRefs,
        ]),
        confidence: Math.max(
          lineItem.confidence,
          inferredProduct?.confidence ?? 0,
          dimension ? 84 : 0,
          inferredQuantity ? 84 : 0,
          printSpecs.length || options.optionTexts.length || artworkRefs.length ? 80 : 0,
        ),
        warnings,
      };

      if (JSON.stringify(nextLineItem) !== JSON.stringify(lineItem)) changed = true;
      return nextLineItem;
    });

    const withLineItems = changed ? { ...draft, lineItems } : draft;
    return this.addStructuredOptionMissingDecisions(withLineItems);
  }

  private structuredEvidenceText(
    record: InboundOrderRecord,
    draft: InboundOrderParsedDraft,
    evidenceBundle?: InboundOrderEvidenceBundle,
  ): string {
    const manual = getManualInboundEvidence(record);
    const rawPayload = record.rawPayloadJson && typeof record.rawPayloadJson === "object" && !Array.isArray(record.rawPayloadJson)
      ? record.rawPayloadJson as Record<string, unknown>
      : {};
    const rawAttachments = Array.isArray(rawPayload.attachments) ? rawPayload.attachments : [];
    const rawAttachmentText = rawAttachments.map((attachment) => {
      if (typeof attachment === "string") return attachment;
      if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) return null;
      const row = attachment as Record<string, unknown>;
      return [row.fileName, row.filename, row.name, row.sourceFilename].filter((value): value is string => typeof value === "string").join(" ");
    }).filter(Boolean);
    const combinedMessageText = combinedInboundEvidence(record).flatMap((source) => {
      const sourceEvidence = source.evidence && typeof source.evidence === "object" && !Array.isArray(source.evidence)
        ? source.evidence as Record<string, unknown>
        : {};
      return [sourceEvidence.subject, sourceEvidence.bodyText, sourceEvidence.notes, sourceEvidence.reference]
        .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
    });

    return [
      manual.subject,
      manual.bodyText,
      manual.notes,
      manual.reference,
      draft.order.notes,
      ...draft.lineItems.map(combinedLineItemText),
      ...draft.artwork.map((item) => [item.filename, item.sourceReference].filter(Boolean).join(" ")),
      ...(evidenceBundle?.items.flatMap((item) => [
        item.label,
        item.fileName,
        item.rawText,
        item.documentType,
      ]).filter(Boolean) ?? []),
      ...rawAttachmentText,
      ...combinedMessageText,
    ].filter(Boolean).join("\n");
  }

  private inferStructuredProduct(text: string): { productName: string; materialText: string | null; sourceText: string; confidence: number } | null {
    for (const alias of STRUCTURED_PRODUCT_ALIASES) {
      const match = text.match(alias.pattern);
      if (!match) continue;
      return {
        productName: alias.productName,
        materialText: alias.materialText ?? null,
        sourceText: match[0].replace(/\s+/g, " ").trim(),
        confidence: alias.confidence,
      };
    }
    return null;
  }

  private inferStructuredQuantity(
    lineItem: InboundOrderParsedDraft["lineItems"][number],
    text: string,
  ): { quantity: number; sourceText: string } | null {
    const numericPatterns = [
      /\b(?:qty|qnty|quantity|count)\s*[:#-]?\s*(\d{1,5})\b/i,
      /\b(\d{1,5})\s+(?:[\w/-]+\s+){0,3}(?:prints?|copies|pcs|pieces|signs?|banners?|decals?|stickers?|posters?)(?:\s+(?:total|needed|required|please))?\b/i,
      /\b(?:need|needs|make|print|produce|order)\s+(\d{1,5})\s+(?:prints?|copies|pcs|pieces|signs?|banners?|decals?|stickers?|posters?)\b/i,
    ];
    for (const pattern of numericPatterns) {
      const match = text.match(pattern);
      if (!match?.[1]) continue;
      const quantity = Number(match[1]);
      if (quantity && Number.isInteger(quantity) && quantity > 0) {
        const matchText = match[0] ?? "";
        const quantityOffset = matchText.indexOf(match[1]);
        const quantityIndex = (match.index ?? 0) + (quantityOffset >= 0 ? quantityOffset : 0);
        const previousChar = text[quantityIndex - 1] ?? "";
        const precedingText = text.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0);
        if (/\b\d+(?:\.\d+)?\s*(?:x|by|\u00d7)\s*$/i.test(precedingText)) continue;
        if (/x|X|\u00d7|Ã—/.test(previousChar)) continue;
        return { quantity, sourceText: matchText.replace(/\s+/g, " ").trim() };
      }
    }

    const wordInference = this.inferQuantityWordForLineItem(lineItem, text);
    if (wordInference) return wordInference;

    const quantityWords = Object.keys(QUANTITY_WORD_VALUES).join("|");
    const wordPattern = new RegExp(`\\b(?:need|needs|make|print|produce|order)\\s+(${quantityWords})\\s+(?:prints?|copies|pcs|pieces|signs?|banners?|decals?|stickers?|posters?)\\b`, "i");
    const wordMatch = text.match(wordPattern);
    if (!wordMatch?.[1]) return null;
    const quantity = QUANTITY_WORD_VALUES[wordMatch[1].toLowerCase()];
    return quantity ? { quantity, sourceText: wordMatch[0].replace(/\s+/g, " ").trim() } : null;
  }

  private extractPrintSideSpecs(text: string): string[] {
    const specs: string[] = [];
    if (/\b(?:double[-\s]?sided|two[-\s]?sided|2[-\s]?sided|front\s+(?:and|&)\s+back)\b/i.test(text)) specs.push("double-sided");
    if (/\b(?:single[-\s]?sided|one[-\s]?sided|1[-\s]?sided|front\s+only)\b/i.test(text)) specs.push("single-sided");
    return specs;
  }

  private extractStructuredOptions(text: string): { optionTexts: string[]; finishingTexts: string[] } {
    const optionTexts: string[] = [];
    const finishingTexts: string[] = [];
    for (const option of STRUCTURED_OPTION_PATTERNS) {
      if (!option.pattern.test(text)) continue;
      optionTexts.push(option.text);
      if (option.finishing) finishingTexts.push(option.text);
    }
    return {
      optionTexts: this.uniqueTextValues(optionTexts),
      finishingTexts: this.uniqueTextValues(finishingTexts),
    };
  }

  private extractArtworkReferences(text: string): string[] {
    const refs = new Set<string>();
    let match: RegExpExecArray | null;
    ARTWORK_FILENAME_PATTERN.lastIndex = 0;
    while ((match = ARTWORK_FILENAME_PATTERN.exec(text)) !== null) {
      const filename = match[0]
        .replace(/\s+/g, " ")
        .replace(/^.*?\b(?:use|see|attached|file|artwork|reference)\s+/i, "")
        .trim();
      if (
        filename
        && !/^\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?$/i.test(filename)
        && !/\b(?:po|p\.o\.|purchase\s+order|invoice|quote)\b/i.test(filename)
      ) {
        refs.add(filename);
      }
    }
    return Array.from(refs);
  }

  private addStructuredOptionMissingDecisions(draft: InboundOrderParsedDraft): InboundOrderParsedDraft {
    const existingFields = new Set(draft.missingDecisions.map((decision) => decision.field));
    const generated: InboundOrderParsedDraft["missingDecisions"] = [];
    draft.lineItems.forEach((lineItem, index) => {
      const optionText = [...lineItem.optionTexts, ...lineItem.finishingTexts, lineItem.sourceText ?? ""].join(" ");
      if (!/\bpole\s+pockets?\b/i.test(optionText)) return;
      const hasSize = /\b\d+(?:\.\d+)?\s*(?:"|in|inch|inches)\b[\s\S]{0,40}\bpole\s+pockets?\b|\bpole\s+pockets?\b[\s\S]{0,40}\b\d+(?:\.\d+)?\s*(?:"|in|inch|inches)\b/i.test(optionText);
      const hasLocation = /\b(?:top|bottom|left|right|side|sides)\b/i.test(optionText);
      if (hasSize && hasLocation) return;
      const field = `lineItems.${index}.polePocketDetails`;
      if (existingFields.has(field)) return;
      generated.push(missingDecision(
        field,
        "What pole pocket size and location are needed?",
        "A pole pocket was requested, but size or placement was not clear in the source evidence.",
        "warning",
      ));
      existingFields.add(field);
    });
    return generated.length ? { ...draft, missingDecisions: [...draft.missingDecisions, ...generated] } : draft;
  }

  private mergeSourceText(parts: string[]): string | null {
    const unique = this.uniqueTextValues(parts).filter(Boolean);
    const merged = unique.join(" ").replace(/\s+/g, " ").trim();
    return merged || null;
  }

  private uniqueTextValues(values: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const value of values) {
      const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(normalized);
    }
    return unique;
  }

  applyLineItemSegmentation(
    record: InboundOrderRecord,
    draft: InboundOrderParsedDraft,
    evidenceBundle?: InboundOrderEvidenceBundle,
  ): InboundOrderParsedDraft {
    if (draft.lineItems.length !== 1) return draft;
    const baseLine = draft.lineItems[0] ?? lineItemTemplate();
    const evidence = getManualInboundEvidence(record);
    const evidenceText = [
      evidence.bodyText,
      evidence.notes,
      ...(evidenceBundle?.items.map((item) => item.rawText).filter(Boolean) ?? []),
    ].filter(Boolean).join("\n");
    const reconciliation = evidenceBundle?.reconciliation;
    const hasConfirmedReconciledCore = Boolean(
      reconciliation
      && typeof reconciliation.product.value === "string"
      && reconciliation.product.status !== "missing"
      && reconciliation.product.status !== "conflict"
      && typeof reconciliation.quantity.value === "number"
      && reconciliation.quantity.status !== "missing"
      && reconciliation.quantity.status !== "conflict"
      && typeof reconciliation.dimensions.value === "string"
      && reconciliation.dimensions.status !== "missing"
      && reconciliation.dimensions.status !== "conflict",
    );
    if (
      hasConfirmedReconciledCore
      && baseLine.quantity
      && baseLine.width
      && baseLine.height
      && this.extractDistinctDimensions(evidenceText).length <= 1
    ) {
      return draft;
    }

    const fragments = this.extractLineItemFragments(evidenceText);
    if (fragments.length > 1) {
      return {
        ...draft,
        lineItems: fragments.map((fragment, index) => this.lineItemFromFragment(baseLine, fragment, index)),
        globalWarnings: [
          ...draft.globalWarnings,
          warning(
            "line_item_segmentation_review",
            `${fragments.length} distinct requested items were detected from ${this.uniqueTextValues(fragments.flatMap((fragment) => fragment.reasons)).join(", ")}. Review line-item separation.`,
            "info",
            "lineItems",
          ),
        ],
      };
    }

    const dimensions = this.extractDistinctDimensions(evidenceText);
    if (dimensions.length < 2) return draft;
    const productName = baseLine.productName ?? this.inferSegmentProductName(evidenceText);
    const sharedOptions = this.extractSharedOptionTexts(evidenceText);
    const quantityEach = /\b(?:just\s+)?one\s+each\b/i.test(evidenceText)
      || /\bone\b[\s\S]{0,80}\b(?:the\s+)?other\b/i.test(evidenceText)
      || /\b(?:the\s+)?other\b[\s\S]{0,80}\bone\b/i.test(evidenceText);
    const collapsedQuantity = baseLine.quantity != null && baseLine.quantity === dimensions.length;
    const shouldSplit = quantityEach || collapsedQuantity || !baseLine.width || !baseLine.height;
    if (!shouldSplit) return draft;

    const lineItems = dimensions.map((dimension, index): InboundOrderParsedDraft["lineItems"][number] => {
      const sourceText = this.sourceSnippetForDimension(evidenceText, dimension);
      return {
        ...baseLine,
        sourceText: sourceText || dimension.sourceText,
        productName,
        candidateProductIds: [],
        productCandidates: [],
        quantity: quantityEach || collapsedQuantity ? 1 : baseLine.quantity,
        width: dimension.width,
        height: dimension.height,
        dimensionsUnit: dimension.unit,
        optionTexts: Array.from(new Set([
          ...baseLine.optionTexts,
          ...sharedOptions,
        ])),
        finishingTexts: Array.from(new Set([
          ...baseLine.finishingTexts,
          ...sharedOptions,
        ])),
        artworkRefs: this.artworkRefsForSegment(baseLine.artworkRefs, index),
        confidence: Math.max(baseLine.confidence, 84),
        warnings: [
          ...baseLine.warnings,
          warning(
            "line_item_split_from_multiple_sizes",
            `Line item ${index + 1} was split from source evidence because ${dimensions.length} different sizes were found.`,
            "info",
            `lineItems.${index}.dimensions`,
          ),
        ],
      };
    });

    return {
      ...draft,
      lineItems,
      globalWarnings: [
        ...draft.globalWarnings,
        warning(
          "line_item_segmentation_review",
          `${dimensions.length} different sizes were found. Review line-item separation.`,
          "info",
          "lineItems",
        ),
      ],
    };
  }

  private extractLineItemFragments(text: string): Array<{ sourceText: string; reasons: string[] }> {
    const lines = text
      .split(/\r?\n+/)
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const fragments: Array<{ sourceText: string; reasons: string[] }> = [];
    const add = (sourceText: string, reasons: string[]) => {
      const normalized = sourceText.replace(/\s+/g, " ").trim();
      if (!normalized) return;
      const normalizedKey = normalized.toLowerCase();
      const relatedIndex = fragments.findIndex((item) => {
        const itemKey = item.sourceText.toLowerCase();
        return itemKey === normalizedKey || itemKey.includes(normalizedKey) || normalizedKey.includes(itemKey);
      });
      if (relatedIndex >= 0) {
        if (fragments[relatedIndex].sourceText.length < normalized.length) {
          fragments[relatedIndex] = { sourceText: normalized, reasons };
        }
        return;
      }
      fragments.push({ sourceText: normalized, reasons });
    };

    // Explicit quantity subgroups are one requested item group even when they
    // are written in a single paragraph rather than a list.
    const subsetAfterTotal = /\b\d{1,5}\s+(?:signs?|banners?|decals?|stickers?|posters?)\s+total\s*:\s*(\d{1,5})\s+([^.;\n]{0,90}?(?:signs?|banners?|decals?|stickers?|posters?))\b\s*(?:and\s+)?(?:the\s+)?other\s+(\d{1,5})\s+([^.;\n]{0,90}?(?:signs?|banners?|decals?|stickers?|posters?))\b/i.exec(text);
    if (subsetAfterTotal) {
      add(`${subsetAfterTotal[1]} ${subsetAfterTotal[2]}`, ["quantity subset", "different specifications"]);
      add(`${subsetAfterTotal[3]} ${subsetAfterTotal[4]}`, ["quantity subset", "different specifications"]);
      return fragments;
    }
    const subset = /\b(\d{1,5})\s+([^.;\n]{0,90}?(?:signs?|banners?|decals?|stickers?|posters?))\b\s*(?:and\s+)?(?:the\s+)?other\s+(\d{1,5})\s+([^.;\n]{0,90}?(?:signs?|banners?|decals?|stickers?|posters?))\b/i.exec(text);
    if (subset) {
      add(`${subset[1]} ${subset[2]}`, ["quantity subset", "different specifications"]);
      add(`${subset[3]} ${subset[4]}`, ["quantity subset", "different specifications"]);
      return fragments;
    }

    for (const line of lines) {
      if (this.isSignatureOrCompanyIdentityText(line)) continue;
      const itemStarts = Array.from(line.matchAll(/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:[\w/-]+\s+){0,3}(?:coroplast\s+)?(?:signs?|banners?|decals?|stickers?|posters?|magnets?)\b/gi));
      if (itemStarts.length > 1) {
        itemStarts.forEach((match, index) => {
          const start = match.index ?? 0;
          const end = index + 1 < itemStarts.length ? itemStarts[index + 1].index ?? line.length : line.length;
          add(line.slice(start, end).replace(/^[,;\s]+|[,;\s]+$/g, ""), ["different product or quantity"]);
        });
        continue;
      }
      const hasProduct = /\b(?:coroplast|corrugated\s+plastic|yard\s+sign|lawn\s+sign|signs?|banners?|decals?|stickers?|posters?|magnets?)\b/i.test(line);
      const hasQuantity = /\b(?:qty|qnty|quantity|count)\s*[:#-]?\s*\d+\b|\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:[\w/-]+\s+){0,3}(?:signs?|banners?|decals?|stickers?|posters?|magnets?)\b/i.test(line);
      const hasDimension = this.extractDistinctDimensions(line).length > 0;
      if (!(hasProduct && (hasQuantity || hasDimension)) && !(hasQuantity && hasDimension)) continue;
      const reasons: string[] = [];
      if (hasProduct) reasons.push("different product");
      if (hasQuantity) reasons.push("different quantity");
      if (hasDimension) reasons.push("different size");
      if (/^(?:[-*•]|\d+[.)])/.test(line)) reasons.push("separate bullet");
      add(line, reasons);
    }

    // A prose request commonly puts two item clauses in one sentence.
    if (fragments.length < 2) {
      const clauses = text.split(/(?=\b(?:also|another|one\s+large|second\s+item|additionally)\b)|(?<=\.)\s+/i);
      for (const clause of clauses) {
        const cleaned = clause.replace(/\s+/g, " ").trim();
        if (!this.isSignatureOrCompanyIdentityText(cleaned)
          && /\b(?:coroplast|signs?|banners?|decals?|stickers?|posters?|magnets?)\b/i.test(cleaned)
          && (/\b\d+\b/.test(cleaned) || this.extractDistinctDimensions(cleaned).length > 0)) {
          add(cleaned, ["separate request phrase"]);
        }
      }
    }
    return fragments.length > 1 ? fragments : [];
  }

  private removeSignatureOnlyLineItems(record: InboundOrderRecord, draft: InboundOrderParsedDraft): InboundOrderParsedDraft {
    if (draft.lineItems.length < 2) return draft;
    const evidence = getManualInboundEvidence(record);
    const knownIdentityValues = [
      evidence.senderName,
      draft.customer.sourceName,
      draft.customer.companyName,
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => value.replace(/\s+/g, " ").trim().toLowerCase());
    const retainedIndexes: number[] = [];
    draft.lineItems.forEach((lineItem, index) => {
      const text = combinedLineItemText(lineItem).replace(/\s+/g, " ").trim();
      const identityCandidates = [lineItem.sourceText, lineItem.productName, text]
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.replace(/\s+/g, " ").trim());
      const hasOperationalDetail = Boolean(
        lineItem.quantity
        || hasDimensionSignal(lineItem)
        || lineItem.materialText
        || lineItem.optionTexts.length
        || lineItem.finishingTexts.length
        || lineItem.artworkRefs.length,
      );
      const matchesKnownIdentity = identityCandidates.some((candidate) => {
        const normalizedCandidate = candidate.toLowerCase();
        return knownIdentityValues.some((value) => (
          normalizedCandidate === value || normalizedCandidate === `${value}, inc.` || normalizedCandidate === `${value} inc.`
        ));
      });
      const looksLikeCompanyIdentity = identityCandidates.some((candidate) => (
        this.isSignatureOrCompanyIdentityText(candidate)
      ));
      const looksLikeContactBlock = identityCandidates.some((candidate) => (
        /(?:\b(?:phone|tel|fax|mobile|email|www\.)\b|@|\b(?:president|owner|manager|sales|estimator)\b)/i.test(candidate)
      ));
      if (hasOperationalDetail || (!matchesKnownIdentity && !looksLikeCompanyIdentity && !looksLikeContactBlock)) {
        retainedIndexes.push(index);
      }
    });
    if (retainedIndexes.length === 0 || retainedIndexes.length === draft.lineItems.length) return draft;

    const newIndexByOldIndex = new Map(retainedIndexes.map((oldIndex, newIndex) => [oldIndex, newIndex]));
    const missingDecisions = draft.missingDecisions.flatMap((decision) => {
      const match = /^lineItems\.(\d+)(\..+)?$/.exec(decision.field);
      if (!match) return [decision];
      const nextIndex = newIndexByOldIndex.get(Number(match[1]));
      return nextIndex == null ? [] : [{ ...decision, field: `lineItems.${nextIndex}${match[2] ?? ""}` }];
    });
    return {
      ...draft,
      lineItems: retainedIndexes.map((index) => draft.lineItems[index]),
      missingDecisions,
      globalWarnings: [
        ...draft.globalWarnings,
        warning(
          "signature_line_item_removed",
          `${draft.lineItems.length - retainedIndexes.length} signature or company identity ${draft.lineItems.length - retainedIndexes.length === 1 ? "block was" : "blocks were"} excluded from product line items.`,
          "info",
          "lineItems",
        ),
      ],
    };
  }

  private isSignatureOrCompanyIdentityText(value: string): boolean {
    const text = value.replace(/\s+/g, " ").trim();
    if (!text) return false;
    return /^[a-z0-9&.' -]{2,80},?\s+(?:inc\.?|llc\.?|ltd\.?|corp\.?|corporation|company|co\.?)$/i.test(text)
      || /^(?:phone|tel|fax|mobile|email)\s*[:#-]/i.test(text)
      || /^(?:www\.|https?:\/\/)[^\s]+$/i.test(text);
  }

  private lineItemFromFragment(
    baseLine: InboundOrderParsedDraft["lineItems"][number],
    fragment: { sourceText: string; reasons: string[] },
    index: number,
  ): InboundOrderParsedDraft["lineItems"][number] {
    const product = this.inferStructuredProduct(fragment.sourceText);
    const dimensions = this.extractDistinctDimensions(fragment.sourceText)[0] ?? null;
    const quantity = this.inferStructuredQuantity(baseLine, fragment.sourceText);
    const options = this.extractStructuredOptions(fragment.sourceText);
    return {
      ...lineItemTemplate(),
      sourceText: fragment.sourceText,
      productName: product?.productName ?? this.inferSegmentProductName(fragment.sourceText),
      materialText: product?.materialText ?? null,
      quantity: quantity?.quantity ?? null,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      dimensionsUnit: dimensions?.unit ?? null,
      optionTexts: options.optionTexts,
      finishingTexts: options.finishingTexts,
      artworkRefs: this.extractArtworkReferences(fragment.sourceText),
      confidence: Math.max(baseLine.confidence, product?.confidence ?? 0, dimensions ? 84 : 0, quantity ? 84 : 0),
      warnings: [
        warning(
          "line_item_segmented_from_source",
          `Line item ${index + 1} was separated because ${fragment.reasons.join(", ")}.`,
          "info",
          `lineItems.${index}`,
        ),
      ],
    };
  }

  private extractDistinctDimensions(text: string): ParsedDimension[] {
    const normalizedText = text.replace(/\u00d7/g, "x");
    const pattern = /(\d+(?:\.\d+)?)\s*("|'|in|inch|inches|ft|feet|foot)?\s*(?:x|X|by|×)\s*(\d+(?:\.\d+)?)\s*("|'|in|inch|inches|ft|feet|foot)?/gi;
    const dimensions: ParsedDimension[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalizedText)) !== null) {
      const parsed = this.normalizeDimensionMatch(match, normalizedText);
      if (!parsed) continue;
      const key = `${parsed.width}x${parsed.height}:${parsed.unit}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dimensions.push(parsed);
    }
    return dimensions;
  }

  private normalizeDimensionMatch(match: RegExpExecArray, fullText: string): ParsedDimension | null {
    const width = Number(match[1]);
    const height = Number(match[3]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const sourceText = match[0].replace(/\s+/g, " ").trim();
    const unit1 = this.normalizeDimensionUnit(match[2] ?? null);
    const unit2 = this.normalizeDimensionUnit(match[4] ?? null);
    if (!unit1 && !unit2 && this.shouldInferDimensionAsFeet(width, height, fullText, sourceText)) {
      return {
        width,
        height,
        unit: "ft",
        sourceText,
        index: match.index,
      };
    }
    const unit = unit2 ?? unit1 ?? "in";
    const widthUnit = unit1 ?? unit;
    const heightUnit = unit2 ?? unit;
    return {
      width: this.convertDimensionToInches(width, widthUnit),
      height: this.convertDimensionToInches(height, heightUnit),
      unit: "in",
      sourceText,
      index: match.index,
    };
  }

  private shouldInferDimensionAsFeet(width: number, height: number, fullText: string, sourceText: string): boolean {
    if (width > 12 || height > 12) return false;
    const sourceIndex = Math.max(0, fullText.toLowerCase().indexOf(sourceText.toLowerCase()));
    const start = Math.max(0, sourceIndex - 120);
    const end = Math.min(fullText.length, sourceIndex + sourceText.length + 120);
    const context = fullText.slice(start, end);
    return /\bbanners?\b/i.test(context) && !/\b(?:coroplast|yard\s+sign|lawn\s+sign|poster|decal|sticker)\b/i.test(context);
  }

  private normalizeDimensionUnit(value: string | null): "in" | "ft" | null {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (normalized === "\"" || /^in(?:ch|ches)?$/.test(normalized)) return "in";
    if (normalized === "'" || /^(?:ft|feet|foot)$/.test(normalized)) return "ft";
    return null;
  }

  private convertDimensionToInches(value: number, unit: "in" | "ft"): number {
    const converted = unit === "ft" ? value * 12 : value;
    return Number.isInteger(converted) ? converted : Number(converted.toFixed(3));
  }

  private inferSegmentProductName(text: string): string | null {
    if (/\bbanners?\b/i.test(text)) return "Banner";
    if (/\bmagnet(?:s|ic)?\b/i.test(text)) return "Magnet";
    if (/\b(?:yard\s+)?signs?\b/i.test(text)) return "Sign";
    if (/\bdecals?\b/i.test(text)) return "Decal";
    if (/\bstickers?\b/i.test(text)) return "Sticker";
    return null;
  }

  private extractSharedOptionTexts(text: string): string[] {
    const options: string[] = [];
    if (/\bhem(?:s|med)?\b/i.test(text)) options.push("hems");
    if (/\bgrommet(?:s|ed)?\b/i.test(text)) options.push("grommets");
    return options;
  }

  private sourceSnippetForDimension(text: string, dimension: ParsedDimension): string {
    const start = Math.max(0, dimension.index - 120);
    const end = Math.min(text.length, dimension.index + dimension.sourceText.length + 120);
    const snippet = text.slice(start, end)
      .split(/\n+/)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return snippet || dimension.sourceText;
  }

  private artworkRefsForSegment(artworkRefs: string[], index: number): string[] {
    if (artworkRefs.length <= 1) return [...artworkRefs];
    return [artworkRefs[index] ?? artworkRefs[0]].filter(Boolean);
  }

  applyReconciledEvidence(draft: InboundOrderParsedDraft, evidenceBundle: InboundOrderEvidenceBundle): InboundOrderParsedDraft {
    const reconciliation = evidenceBundle.reconciliation;
    if (!reconciliation) return draft;
    const firstLine = draft.lineItems[0] ?? lineItemTemplate();
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
    const firstLine = draft.lineItems[0] ?? lineItemTemplate();
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
    const parsed = this.extractDistinctDimensions(value)[0];
    return parsed
      ? { width: parsed.width, height: parsed.height, unit: parsed.unit }
      : { width: null, height: null, unit: null };
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
    warnings: InboundOrderParseWarning[];
  }> {
    const warnings: InboundOrderParseWarning[] = [];
    let customerCandidates: InboundCandidateResult[] = [];
    let contactCandidates: InboundCandidateResult[] = [];

    try {
      const candidates = await this.repository.searchCustomerCandidates({
        organizationId,
        email: result.customer.sourceEmail,
        name: result.customer.companyName ?? result.customer.sourceName,
        limit: 5,
      });
      if (!Array.isArray(candidates)) throw new Error("Customer candidate lookup returned an invalid result.");
      customerCandidates = candidates.filter((candidate): candidate is InboundCandidateResult => Boolean(candidate) && typeof candidate === "object");
    } catch (error) {
      console.warn("[INBOUND_ORDER_PARSE] Customer candidate lookup unavailable.", {
        organizationId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      warnings.push(warning(
        "customer_candidates_unavailable",
        "Customer suggestions are temporarily unavailable. Confirm the customer during review.",
        "warning",
        "customer",
      ));
    }

    try {
      const candidates = await this.repository.searchContactCandidates({
        organizationId,
        email: result.customer.sourceEmail,
        name: result.customer.sourceName,
        limit: 5,
      });
      if (!Array.isArray(candidates)) throw new Error("Contact candidate lookup returned an invalid result.");
      contactCandidates = candidates.filter((candidate): candidate is InboundCandidateResult => Boolean(candidate) && typeof candidate === "object");
    } catch (error) {
      console.warn("[INBOUND_ORDER_PARSE] Contact candidate lookup unavailable.", {
        organizationId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      warnings.push(warning(
        "contact_candidates_unavailable",
        "Contact suggestions are temporarily unavailable. Confirm the contact during review.",
        "warning",
        "customer",
      ));
    }

    return { customerCandidates, contactCandidates, warnings };
  }

  async matchInboundProductCandidates(organizationId: string, result: InboundOrderParsedDraft): Promise<InboundOrderParsedDraft["lineItems"]> {
    const lineItems = [];
    for (let index = 0; index < result.lineItems.length; index += 1) {
      const lineItem = result.lineItems[index];
      try {
        const candidates = await this.repository.searchProductCandidates({
          organizationId,
          sourceText: lineItem.sourceText,
          productName: lineItem.productName,
          materialText: lineItem.materialText,
          optionTexts: lineItem.optionTexts,
          finishingTexts: lineItem.finishingTexts,
          limit: 5,
        });
        if (!Array.isArray(candidates)) throw new Error("Product candidate lookup returned an invalid result.");
        const validCandidates = candidates.filter((candidate): candidate is InboundCandidateResult => Boolean(candidate) && typeof candidate === "object");
        lineItems.push({
          ...lineItem,
          productCandidates: validCandidates.map(candidateDto),
          candidateProductIds: uniqueIds(validCandidates),
        });
      } catch (error) {
        console.warn("[INBOUND_ORDER_PARSE] Product candidate lookup unavailable.", {
          organizationId,
          lineItemIndex: index,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        lineItems.push({
          ...lineItem,
          productCandidates: [],
          candidateProductIds: [],
          warnings: [
            ...lineItem.warnings,
            warning(
              "product_candidates_unavailable",
              "Product suggestions are temporarily unavailable. Select a product during review.",
              "warning",
              `lineItems.${index}.product`,
            ),
          ],
        });
      }
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
    const { customerCandidates, contactCandidates, warnings } = await this.matchInboundCustomerCandidates(organizationId, draft);
    const lineItems = await this.matchInboundProductCandidates(organizationId, draft);
    const missingDecisions = [...draft.missingDecisions];
    const existingFields = new Set(missingDecisions.map((decision) => decision.field));
    if (warnings.length > 0 && !existingFields.has("customer")) {
      missingDecisions.push(missingDecision(
        "customer",
        "Confirm the customer and contact before creating a quote or order.",
        "Candidate lookup was unavailable, so the source sender details must be reviewed.",
        "warning",
      ));
      existingFields.add("customer");
    }
    lineItems.forEach((lineItem, index) => {
      const field = `lineItems.${index}.product`;
      if (lineItem.candidateProductIds.length === 0 && !existingFields.has(field)) {
        missingDecisions.push(missingDecision(
          field,
          "Select the product for this line item.",
          "No product candidate was resolved from the source evidence.",
          "warning",
        ));
        existingFields.add(field);
      }
    });
    return {
      ...draft,
      customer: {
        ...draft.customer,
        customerCandidates: customerCandidates.map(candidateDto),
        contactCandidates: contactCandidates.map(candidateDto),
        candidateCustomerIds: uniqueIds(customerCandidates),
        candidateContactIds: uniqueIds(contactCandidates),
        warnings: [...draft.customer.warnings, ...warnings],
      },
      lineItems,
      missingDecisions,
    };
  }

  private async attachCustomerIntelligence(organizationId: string, draft: InboundOrderParsedDraft): Promise<InboundOrderParsedDraft> {
    if (draft.customerIntelligence) return draft;
    try {
      const summary = await this.customerIntelligence.buildSummaryForParsedDraft({ organizationId, draft });
      return summary ? { ...draft, customerIntelligence: summary } : draft;
    } catch (error) {
      console.warn("[INBOUND_ORDER_PARSE] Customer intelligence unavailable after candidate resolution.", {
        organizationId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return {
        ...draft,
        globalWarnings: [
          ...draft.globalWarnings,
          warning(
            "customer_intelligence_unavailable",
            "Customer history suggestions are temporarily unavailable. Source evidence remains available for review.",
            "info",
          ),
        ],
      };
    }
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
    const currentRecord = args.attempt.parsedDraft
      ? await this.repository.getRecord(args.organizationId, args.inboundRecordId)
      : null;
    const currentNormalizedPayload = currentRecord?.normalizedPayloadJson
      && typeof currentRecord.normalizedPayloadJson === "object"
      && !Array.isArray(currentRecord.normalizedPayloadJson)
      ? currentRecord.normalizedPayloadJson as Record<string, unknown>
      : null;
    await this.repository.updateRecordWithEvent({
      organizationId: args.organizationId,
      inboundRecordId: args.inboundRecordId,
      patch: {
        status: args.finalStatus,
        ...(args.attempt.parsedDraft ? { parsedAt: new Date() } : {}),
        ...(currentNormalizedPayload?.reparseRecommended
          ? {
            normalizedPayloadJson: {
              ...currentNormalizedPayload,
              reparseRecommended: false,
              reparsedAt: new Date().toISOString(),
            },
          }
          : {}),
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
          failureCodes: Array.isArray(attempt.errors)
            ? attempt.errors
              .map((error) => error && typeof error === "object" && !Array.isArray(error)
                ? stringValue((error as Record<string, unknown>).code)
                : null)
              .filter((code): code is string => Boolean(code))
            : [],
          warningCodes: Array.isArray(attempt.warnings)
            ? attempt.warnings
              .map((item) => item && typeof item === "object" && !Array.isArray(item)
                ? stringValue((item as Record<string, unknown>).code)
                : null)
              .filter((code): code is string => Boolean(code))
            : [],
          parseResultSummary: parseResultSummary(args.attempt.parsedDraft),
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
