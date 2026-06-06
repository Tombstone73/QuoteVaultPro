import { createHash } from "crypto";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  productIntakeAnswers,
  productIntakeAiDiagnostics,
  productIntakeQuestions,
  productIntakeSessions,
  type ProductIntakeAnswerRow,
  type ProductIntakeQuestionRow,
  type ProductIntakeSessionRow,
} from "@shared/schema";
import {
  productIntakeAnswerSchema,
  productIntakeQuestionSchema,
  productIntakeReadinessSchema,
  productIntakeSessionSchema,
  type ProductIntakeAnswer,
  type ProductIntakeAnswerPatchItem,
  type ProductIntakeBrief,
  type ProductIntakeQuestion,
  type ProductIntakeQuestionType,
  type ProductIntakeReadiness,
  type ProductIntakeSession,
  type ProductIntakeSessionDetail,
  type ProductIntakeSessionStatus,
  type ProductIntakeWizardAnalyzeRequest,
} from "@shared/productIntakeWizardSchemas";
import type { CatalogMigrationLabAnalyzerResult } from "@shared/catalogMigrationLabSchemas";
import { db as defaultDb } from "../../db";

type NewQuestion = Omit<ProductIntakeQuestion, "id" | "organizationId" | "sessionId" | "createdAt">;

export type CreateProductIntakeSessionInput = {
  organizationId: string;
  userId: string | null;
  request: ProductIntakeWizardAnalyzeRequest;
  analyzer: CatalogMigrationLabAnalyzerResult | null;
  brief: ProductIntakeBrief;
};

export type ProductIntakeSessionListFilters = {
  status?: ProductIntakeSessionStatus;
  sourceType?: ProductIntakeSession["sourceType"];
  search?: string;
  createdFrom?: string;
  createdTo?: string;
};

export type ProductIntakeSessionDeleteResult = {
  sessions: number;
  questions: number;
  answers: number;
  diagnostics: number;
};

export type ProductIntakeSessionDeleteFilters = {
  sessionIds?: string[];
  status?: Extract<ProductIntakeSessionStatus, "abandoned">;
  briefSource?: "rule_based_fallback";
};

export interface ProductIntakeSessionStore {
  createFromAnalysis(input: CreateProductIntakeSessionInput): Promise<ProductIntakeSessionDetail>;
  listSessions(organizationId: string, filters?: ProductIntakeSessionListFilters): Promise<ProductIntakeSession[]>;
  getSessionDetail(organizationId: string, sessionId: string): Promise<ProductIntakeSessionDetail | null>;
  upsertAnswers(args: {
    organizationId: string;
    sessionId: string;
    userId: string | null;
    answers: ProductIntakeAnswerPatchItem[];
  }): Promise<ProductIntakeSessionDetail | null>;
  abandonSession(args: {
    organizationId: string;
    sessionId: string;
    userId: string | null;
  }): Promise<ProductIntakeSessionDetail | null>;
  deleteSessions(args: {
    organizationId: string;
    filters: ProductIntakeSessionDeleteFilters;
  }): Promise<ProductIntakeSessionDeleteResult>;
}

export class ProductIntakeSessionError extends Error {
  statusCode: number;
  errorCode: string;

  constructor(statusCode: number, message: string, errorCode: string) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date().toISOString();
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function nullableIso(value: unknown): string | null {
  if (!value) return null;
  return toIso(value);
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "question";
}

function firstEvidencePath(evidence: Array<{ sourcePath: string }> | undefined): string | null {
  return evidence?.find((item) => item.sourcePath)?.sourcePath ?? null;
}

function option(label: string, value: string = normalizeKey(label)) {
  return { label, value };
}

function questionForMissingDecision(brief: ProductIntakeBrief, decision: ProductIntakeBrief["missingDecisions"][number], sortOrder: number): NewQuestion | null {
  if (decision.severity === "info") return null;
  const sourcePath = firstEvidencePath(decision.evidence);
  const base = {
    questionKey: normalizeKey(decision.id),
    label: decision.question,
    helpText: decision.reason,
    required: decision.severity === "blocker" || decision.severity === "review",
    sourcePath,
    confidence: null,
    sortOrder,
  };

  if (decision.id === "select-material") {
    const materialOptions = brief.materialAnalysis.likelyMaterialMatches
      .filter((match) => match.materialId || match.name)
      .slice(0, 12)
      .map((match) => ({
        label: `${match.name}${match.sku ? ` (${match.sku})` : ""} - ${match.confidence}%`,
        value: match.materialId ?? match.name,
      }));
    if (materialOptions.length > 0) {
      return {
        ...base,
        questionType: "select",
        label: "Which material should this product use?",
        helpText: "Candidate TitanOS materials were found. Select the closest match or review the material library if none apply.",
        options: materialOptions,
        defaultValue: materialOptions[0]?.value ?? null,
      };
    }
    return {
      ...base,
      questionType: "text",
      label: "Which material should this product use?",
      helpText: "No confident material match was found. Enter the intended material or internal material name.",
      options: null,
      defaultValue: null,
    };
  }
  if (decision.id === "choose-pricing-model") {
    return {
      ...base,
      questionType: "select",
      label: "Which pricing model should this product use?",
      options: [
        option("Square foot", "square_foot"),
        option("Flat price", "flat"),
        option("Quantity tiers", "quantity_tiers"),
        option("Matrix or tiered", "matrix_or_tiered"),
        option("Formula", "formula"),
        option("Manual quote", "manual_quote"),
      ],
      defaultValue: null,
    };
  }
  if (decision.id === "confirm-category") {
    return {
      ...base,
      questionType: "text",
      label: "Which TitanOS product category should this use?",
      options: null,
      defaultValue: null,
    };
  }

  return {
    ...base,
    questionType: "text",
    options: null,
    defaultValue: null,
  };
}

function behaviorQuestion(args: {
  key: string;
  label: string;
  behavior: ProductIntakeBrief["sizeBehavior"];
  options: Array<{ label: string; value: string }>;
  sortOrder: number;
}): NewQuestion | null {
  if (args.behavior.behavior !== "unknown" && args.behavior.confidence >= 50) return null;
  return {
    questionKey: args.key,
    questionType: "select",
    label: args.label,
    helpText: "The analyzer could not determine this behavior confidently.",
    required: true,
    options: args.options,
    defaultValue: null,
    sourcePath: firstEvidencePath(args.behavior.evidence),
    confidence: args.behavior.confidence,
    sortOrder: args.sortOrder,
  };
}

export function generateProductIntakeQuestions(brief: ProductIntakeBrief): NewQuestion[] {
  const questions: NewQuestion[] = [];
  const seen = new Set<string>();
  const push = (question: NewQuestion | null) => {
    if (!question || seen.has(question.questionKey)) return;
    seen.add(question.questionKey);
    questions.push(question);
  };

  brief.missingDecisions.forEach((decision, index) => push(questionForMissingDecision(brief, decision, index + 1)));
  push(behaviorQuestion({
    key: "confirm-size-behavior",
    label: "How should size be captured?",
    behavior: brief.sizeBehavior,
    options: [option("Fixed sizes", "fixed_size"), option("Custom width and height", "custom_size"), option("No size input", "none")],
    sortOrder: 40,
  }));
  push(behaviorQuestion({
    key: "confirm-quantity-behavior",
    label: "How should quantity be captured?",
    behavior: brief.quantityBehavior,
    options: [option("Per piece", "per_piece"), option("Quantity tiers", "quantity_tiers"), option("No customer quantity input", "none")],
    sortOrder: 41,
  }));

  for (const optionGroup of [...brief.requiredOptions, ...brief.optionalOptions]) {
    if (optionGroup.confidence < 65) {
      push({
        questionKey: `confirm-option-required-${normalizeKey(optionGroup.normalizedGroup)}`,
        questionType: "boolean",
        label: `Should ${optionGroup.normalizedGroup} be required?`,
        helpText: "The source was unclear about whether this option should be required or optional.",
        required: true,
        options: null,
        defaultValue: optionGroup.required,
        sourcePath: optionGroup.sourcePaths[0] ?? firstEvidencePath(optionGroup.evidence),
        confidence: optionGroup.confidence,
        sortOrder: 70 + questions.length,
      });
    }

    for (const match of optionGroup.templateMatches) {
      if (match.recommendation !== "review_required") continue;
      push({
        questionKey: `review-template-${normalizeKey(optionGroup.normalizedGroup)}-${normalizeKey(match.templateId)}`,
        questionType: "select",
        label: `Reuse template "${match.name}" for ${optionGroup.normalizedGroup}?`,
        helpText: "The template match was below the automatic reuse threshold and needs human review.",
        required: false,
        options: [option("Reuse existing template", "reuse"), option("Create a new mapping later", "new_later"), option("Not applicable", "not_applicable")],
        defaultValue: "reuse",
        sourcePath: firstEvidencePath(match.evidence) ?? optionGroup.sourcePaths[0] ?? null,
        confidence: Math.round(match.score * 100),
        sortOrder: 90 + questions.length,
      });
    }
  }

  if (brief.draftWarnings.some((warning) => /routing|prepress|proof/i.test(`${warning.code} ${warning.message}`))) {
    push({
      questionKey: "confirm-routing-proof-prepress",
      questionType: "text",
      label: "Any routing, proofing, or prepress requirements to preserve?",
      helpText: "The analyzer found workflow-related uncertainty worth capturing before draft generation.",
      required: false,
      options: null,
      defaultValue: null,
      sourcePath: firstEvidencePath(brief.draftWarnings.flatMap((warning) => warning.evidence)),
      confidence: null,
      sortOrder: 120,
    });
  }

  return questions.sort((a, b) => a.sortOrder - b.sortOrder || a.questionKey.localeCompare(b.questionKey));
}

function hasAnswerValue(question: ProductIntakeQuestion, value: unknown): boolean {
  if (value == null) return false;
  if (question.questionType === "boolean") return typeof value === "boolean";
  if (question.questionType === "number") return typeof value === "number" && Number.isFinite(value);
  if (question.questionType === "multiselect") return Array.isArray(value) && value.length > 0;
  if (question.questionType === "select") return typeof value === "string" ? value.trim().length > 0 : true;
  return typeof value === "string" && value.trim().length > 0;
}

function validateAnswerValue(question: ProductIntakeQuestion, value: unknown) {
  if (value == null) return;
  if (question.questionType === "boolean" && typeof value !== "boolean") {
    throw new ProductIntakeSessionError(400, `Answer for "${question.label}" must be true or false.`, "INVALID_ANSWER");
  }
  if (question.questionType === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new ProductIntakeSessionError(400, `Answer for "${question.label}" must be a number.`, "INVALID_ANSWER");
  }
  if (question.questionType === "multiselect" && !Array.isArray(value)) {
    throw new ProductIntakeSessionError(400, `Answer for "${question.label}" must be an array.`, "INVALID_ANSWER");
  }
  if ((question.questionType === "select" || question.questionType === "text") && typeof value !== "string") {
    throw new ProductIntakeSessionError(400, `Answer for "${question.label}" must be text.`, "INVALID_ANSWER");
  }
}

export function computeProductIntakeReadiness(args: {
  session: ProductIntakeSession;
  questions: ProductIntakeQuestion[];
  answers: ProductIntakeAnswer[];
}): ProductIntakeReadiness {
  const answerByKey = new Map(args.answers.map((answer) => [answer.questionKey, answer]));
  const unansweredRequiredCount = args.questions.filter((question) =>
    question.required && !hasAnswerValue(question, answerByKey.get(question.questionKey)?.answer),
  ).length;
  const answeredCount = args.questions.filter((question) => hasAnswerValue(question, answerByKey.get(question.questionKey)?.answer)).length;
  const status = args.session.status === "abandoned"
    ? "abandoned"
    : unansweredRequiredCount > 0
      ? "needs_answers"
      : "ready_for_draft";
  return productIntakeReadinessSchema.parse({
    unansweredRequiredCount,
    answeredCount,
    canCreateDraft: false,
    status,
  });
}

export function resolveProductIntakeSessionStatus(brief: ProductIntakeBrief, questions: Array<Pick<NewQuestion, "required">>): ProductIntakeSessionStatus {
  if (questions.some((question) => question.required)) return "needs_answers";
  return brief.overallConfidence >= 75 ? "ready_for_draft" : "analyzed";
}

function sourceTypeForRequest(request: ProductIntakeWizardAnalyzeRequest): ProductIntakeSession["sourceType"] {
  if (request.sourceType === "text_description") return "text_description";
  return request.sourceType === "uploaded_json" ? "json_upload" : "json_paste";
}

function parseSourceJson(request: ProductIntakeWizardAnalyzeRequest): unknown | null {
  if (request.sourceType === "text_description") return null;
  if (request.sourceJson !== undefined) return request.sourceJson;
  if (request.analyzerRequest?.sourceJson !== undefined) return request.analyzerRequest.sourceJson;
  const jsonText = request.jsonText ?? request.analyzerRequest?.jsonText;
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function sourceTextForRequest(request: ProductIntakeWizardAnalyzeRequest): string | null {
  if (request.sourceType === "text_description") return request.description ?? null;
  return request.jsonText ?? request.analyzerRequest?.jsonText ?? request.description ?? null;
}

export function fingerprintProductIntakeRequest(request: ProductIntakeWizardAnalyzeRequest, analyzer: CatalogMigrationLabAnalyzerResult | null): string | null {
  if (analyzer?.source.fingerprint) return analyzer.source.fingerprint;
  const text = sourceTextForRequest(request);
  if (!text) return null;
  return createHash("sha256").update(text).digest("hex");
}

function confidenceNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function recalculateProductIntakeConfidence(args: {
  session: ProductIntakeSession;
  questions: ProductIntakeQuestion[];
  answers: ProductIntakeAnswer[];
}) {
  const existing = args.session.confidence ?? {};
  const originalConfidence = confidenceNumber(existing.originalConfidence) ?? confidenceNumber(existing.overallConfidence) ?? args.session.brief.overallConfidence;
  const answerByKey = new Map(args.answers.map((answer) => [answer.questionKey, answer]));
  const answeredKeys = args.questions
    .filter((question) => hasAnswerValue(question, answerByKey.get(question.questionKey)?.answer))
    .map((question) => question.questionKey);
  let lift = 0;
  for (const key of answeredKeys) {
    if (key === "select-material") lift += 15;
    else if (key === "choose-pricing-model") lift += 12;
    else if (key === "confirm-size-behavior") lift += 10;
    else if (key === "confirm-quantity-behavior") lift += 8;
    else if (key.startsWith("confirm-option-required-")) lift += 4;
    else if (key.startsWith("review-template-")) lift += 2;
    else lift += 3;
  }
  return {
    ...existing,
    originalConfidence,
    currentConfidence: clampConfidence(originalConfidence + lift),
    answeredQuestionKeys: answeredKeys,
    answeredQuestionCount: answeredKeys.length,
    recalculatedAt: new Date().toISOString(),
  };
}

function mapSession(row: ProductIntakeSessionRow): ProductIntakeSession {
  return productIntakeSessionSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    sourceType: row.sourceType,
    sourceFingerprint: row.sourceFingerprint,
    brief: row.aiBriefJson,
    confidence: row.confidenceJson ?? null,
    missingDecisions: Array.isArray(row.missingDecisionsJson) ? row.missingDecisionsJson : null,
    status: row.status,
    createdProductId: row.createdProductId,
    createdPbv2TreeVersionId: row.createdPbv2TreeVersionId,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    abandonedAt: nullableIso(row.abandonedAt),
  });
}

function mapQuestion(row: ProductIntakeQuestionRow): ProductIntakeQuestion {
  return productIntakeQuestionSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    sessionId: row.sessionId,
    questionKey: row.questionKey,
    questionType: row.questionType,
    label: row.label,
    helpText: row.helpText,
    required: row.required,
    options: Array.isArray(row.optionsJson) ? row.optionsJson : null,
    defaultValue: row.defaultValueJson ?? null,
    sourcePath: row.sourcePath,
    confidence: row.confidence == null ? null : Number(row.confidence),
    sortOrder: row.sortOrder,
    createdAt: toIso(row.createdAt),
  });
}

function mapAnswer(row: ProductIntakeAnswerRow): ProductIntakeAnswer {
  return productIntakeAnswerSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    sessionId: row.sessionId,
    questionId: row.questionId,
    questionKey: row.questionKey,
    answer: row.answerJson ?? null,
    answeredByUserId: row.answeredByUserId,
    answeredAt: nullableIso(row.answeredAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

export function createDbProductIntakeSessionStore(database: any = defaultDb): ProductIntakeSessionStore {
  const zeroDeleteResult = (): ProductIntakeSessionDeleteResult => ({ sessions: 0, questions: 0, answers: 0, diagnostics: 0 });

  const resolveDeleteSessionIds = async (organizationId: string, filters: ProductIntakeSessionDeleteFilters): Promise<string[]> => {
    const conditions = [eq(productIntakeSessions.organizationId, organizationId)];
    if (filters.sessionIds?.length) conditions.push(inArray(productIntakeSessions.id, filters.sessionIds));
    if (filters.status) conditions.push(eq(productIntakeSessions.status, filters.status));
    if (filters.briefSource) conditions.push(sql`${productIntakeSessions.aiBriefJson}->>'source' = ${filters.briefSource}` as any);
    const rows = await database
      .select({ id: productIntakeSessions.id })
      .from(productIntakeSessions)
      .where(and(...conditions))
      .limit(500);
    return rows.map((row: { id: string }) => row.id);
  };

  const getDetail = async (organizationId: string, sessionId: string): Promise<ProductIntakeSessionDetail | null> => {
    const [sessionRow] = await database
      .select()
      .from(productIntakeSessions)
      .where(and(eq(productIntakeSessions.id, sessionId), eq(productIntakeSessions.organizationId, organizationId)))
      .limit(1);
    if (!sessionRow) return null;

    const questionRows = await database
      .select()
      .from(productIntakeQuestions)
      .where(and(eq(productIntakeQuestions.sessionId, sessionId), eq(productIntakeQuestions.organizationId, organizationId)))
      .orderBy(productIntakeQuestions.sortOrder);
    const answerRows = await database
      .select()
      .from(productIntakeAnswers)
      .where(and(eq(productIntakeAnswers.sessionId, sessionId), eq(productIntakeAnswers.organizationId, organizationId)));

    const session = mapSession(sessionRow);
    const questions = questionRows.map(mapQuestion);
    const answers = answerRows.map(mapAnswer);
    const readiness = computeProductIntakeReadiness({ session, questions, answers });
    return { session, brief: session.brief, questions, answers, readiness };
  };

  return {
    async createFromAnalysis(input) {
      const generatedQuestions = generateProductIntakeQuestions(input.brief);
      const status = resolveProductIntakeSessionStatus(input.brief, generatedQuestions);
      const [sessionRow] = await database.insert(productIntakeSessions).values({
        organizationId: input.organizationId,
        sourceType: sourceTypeForRequest(input.request),
        sourceJson: parseSourceJson(input.request) as any,
        sourceText: sourceTextForRequest(input.request),
        sourceFingerprint: fingerprintProductIntakeRequest(input.request, input.analyzer),
        aiBriefJson: input.brief as any,
        confidenceJson: {
          originalConfidence: input.brief.overallConfidence,
          currentConfidence: input.brief.overallConfidence,
          overallConfidence: input.brief.overallConfidence,
          source: input.brief.source,
          workflowState: input.brief.workflowState,
        },
        missingDecisionsJson: input.brief.missingDecisions as any,
        status,
        createdByUserId: input.userId,
        updatedByUserId: input.userId,
      }).returning();

      if (generatedQuestions.length > 0) {
        await database.insert(productIntakeQuestions).values(generatedQuestions.map((question) => ({
          organizationId: input.organizationId,
          sessionId: sessionRow.id,
          questionKey: question.questionKey,
          questionType: question.questionType,
          label: question.label,
          helpText: question.helpText,
          required: question.required,
          optionsJson: question.options as any,
          defaultValueJson: question.defaultValue as any,
          sourcePath: question.sourcePath,
          confidence: question.confidence == null ? null : String(question.confidence),
          sortOrder: question.sortOrder,
        })));
      }

      const detail = await getDetail(input.organizationId, sessionRow.id);
      if (!detail) throw new ProductIntakeSessionError(500, "Created session could not be reloaded.", "SESSION_RELOAD_FAILED");
      return detail;
    },

    async listSessions(organizationId, filters = {}) {
      const conditions = [eq(productIntakeSessions.organizationId, organizationId)];
      if (filters.status) conditions.push(eq(productIntakeSessions.status, filters.status));
      if (filters.sourceType) conditions.push(eq(productIntakeSessions.sourceType, filters.sourceType));
      if (filters.createdFrom) conditions.push(gte(productIntakeSessions.createdAt, new Date(filters.createdFrom)));
      if (filters.createdTo) conditions.push(lte(productIntakeSessions.createdAt, new Date(filters.createdTo)));
      if (filters.search?.trim()) {
        const pattern = `%${filters.search.trim()}%`;
        conditions.push(sql`${productIntakeSessions.aiBriefJson}->'productIdentity'->'likelyProductName'->>'value' ILIKE ${pattern}` as any);
      }

      const rows = await database
        .select()
        .from(productIntakeSessions)
        .where(and(...conditions))
        .orderBy(desc(productIntakeSessions.createdAt))
        .limit(50);
      return rows.map(mapSession);
    },

    getSessionDetail: getDetail,

    async upsertAnswers(args) {
      const detail = await getDetail(args.organizationId, args.sessionId);
      if (!detail) return null;
      if (detail.session.status === "abandoned") {
        throw new ProductIntakeSessionError(409, "Abandoned intake sessions cannot be answered.", "SESSION_ABANDONED");
      }

      const questionsById = new Map(detail.questions.map((question) => [question.id, question]));
      const questionsByKey = new Map(detail.questions.map((question) => [question.questionKey, question]));
      const now = new Date();
      for (const answer of args.answers) {
        const question = answer.questionId ? questionsById.get(answer.questionId) : questionsByKey.get(answer.questionKey ?? "");
        if (!question) {
          throw new ProductIntakeSessionError(404, "Question not found for this intake session.", "QUESTION_NOT_FOUND");
        }
        validateAnswerValue(question, answer.answer);
        if (question.required && !hasAnswerValue(question, answer.answer)) {
          throw new ProductIntakeSessionError(400, `Answer for "${question.label}" is required.`, "REQUIRED_ANSWER_MISSING");
        }

        await database.insert(productIntakeAnswers).values({
          organizationId: args.organizationId,
          sessionId: args.sessionId,
          questionId: question.id,
          questionKey: question.questionKey,
          answerJson: answer.answer as any,
          answeredByUserId: args.userId,
          answeredAt: hasAnswerValue(question, answer.answer) ? now : null,
        }).onConflictDoUpdate({
          target: [productIntakeAnswers.sessionId, productIntakeAnswers.questionKey],
          set: {
            questionId: question.id,
            answerJson: answer.answer as any,
            answeredByUserId: args.userId,
            answeredAt: hasAnswerValue(question, answer.answer) ? now : null,
            updatedAt: now,
          },
        });
      }

      const nextDetail = await getDetail(args.organizationId, args.sessionId);
      if (!nextDetail) return null;
      const nextStatus = nextDetail.readiness.status;
      const confidenceJson = recalculateProductIntakeConfidence(nextDetail);
      const [updatedSession] = await database.update(productIntakeSessions)
        .set({ status: nextStatus, confidenceJson, updatedByUserId: args.userId, updatedAt: new Date() })
        .where(and(eq(productIntakeSessions.id, args.sessionId), eq(productIntakeSessions.organizationId, args.organizationId)))
        .returning();
      return updatedSession ? await getDetail(args.organizationId, args.sessionId) : null;
    },

    async abandonSession(args) {
      const [updated] = await database.update(productIntakeSessions)
        .set({
          status: "abandoned",
          abandonedAt: new Date(),
          updatedAt: new Date(),
          updatedByUserId: args.userId,
        })
        .where(and(eq(productIntakeSessions.id, args.sessionId), eq(productIntakeSessions.organizationId, args.organizationId)))
        .returning();
      if (!updated) return null;
      return getDetail(args.organizationId, args.sessionId);
    },

    async deleteSessions(args) {
      const sessionIds = await resolveDeleteSessionIds(args.organizationId, args.filters);
      if (sessionIds.length === 0) return zeroDeleteResult();

      const result = zeroDeleteResult();
      try {
        const diagnosticRows = await database.delete(productIntakeAiDiagnostics)
          .where(and(eq(productIntakeAiDiagnostics.organizationId, args.organizationId), inArray(productIntakeAiDiagnostics.sessionId, sessionIds)))
          .returning({ id: productIntakeAiDiagnostics.id });
        result.diagnostics = diagnosticRows.length;
      } catch (diagnosticError) {
        console.warn("[ProductIntakeWizard] Failed to delete AI diagnostics during intake cleanup:", diagnosticError);
      }

      const answerRows = await database.delete(productIntakeAnswers)
        .where(and(eq(productIntakeAnswers.organizationId, args.organizationId), inArray(productIntakeAnswers.sessionId, sessionIds)))
        .returning({ id: productIntakeAnswers.id });
      result.answers = answerRows.length;

      const questionRows = await database.delete(productIntakeQuestions)
        .where(and(eq(productIntakeQuestions.organizationId, args.organizationId), inArray(productIntakeQuestions.sessionId, sessionIds)))
        .returning({ id: productIntakeQuestions.id });
      result.questions = questionRows.length;

      const sessionRows = await database.delete(productIntakeSessions)
        .where(and(eq(productIntakeSessions.organizationId, args.organizationId), inArray(productIntakeSessions.id, sessionIds)))
        .returning({ id: productIntakeSessions.id });
      result.sessions = sessionRows.length;
      return result;
    },
  };
}
