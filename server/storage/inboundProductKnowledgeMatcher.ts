export type ProductKnowledgeMatchInput = {
  sourceText?: string | null;
  productName?: string | null;
  materialText?: string | null;
  optionTexts?: string[];
  finishingTexts?: string[];
};

export type ProductKnowledgeCandidateInput = {
  id: string;
  name: string;
  description: string | null;
  aiParsingDescription?: string | null;
  category: string | null;
  materialName?: string | null;
  materialCategory?: string | null;
  materialAiParsingDescription?: string | null;
  metadataText?: string | null;
  isService?: boolean | null;
};

export type ProductKnowledgeMatch = {
  id: string;
  label: string;
  confidence: number;
  reason: string;
  metadata: {
    category: string | null;
    description: string | null;
    materialName: string | null;
    matchReasons: string[];
    matchBreakdown: {
      nameScore: number;
      keywordScore: number;
      aiParsingScore: number;
      descriptionScore: number;
      categoryScore: number;
      materialScore: number;
      materialAiParsingScore: number;
      metadataScore: number;
      positiveEvidenceBoost: number;
      accessoryPenalty: number;
      negativeEvidencePenalty: number;
      combinedConfidence: number;
    };
  };
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "by",
  "for",
  "full",
  "color",
  "imprint",
  "need",
  "needed",
  "of",
  "on",
  "please",
  "print",
  "the",
  "to",
  "with",
]);

const GENERIC_RANKING_TERMS = new Set([
  "board",
  "boards",
  "display",
  "displays",
  "graphic",
  "graphics",
  "print",
  "printed",
  "quote",
  "quotes",
  "sign",
  "signage",
  "signs",
]);

const SEMANTIC_EXPANSIONS: Array<{ patterns: RegExp[]; terms: string[]; label: string }> = [
  {
    patterns: [/\byard\s+signs?\b/i, /\blawn\s+signs?\b/i, /\bpolitical\s+signs?\b/i, /\brealtor\s+signs?\b/i],
    terms: ["yard sign", "yard signs", "lawn sign", "political sign", "realtor sign", "event sign", "outdoor sign", "coroplast", "corrugated plastic", "signage"],
    label: "yard sign language",
  },
  {
    patterns: [/\bcar\s+magnets?\b/i, /\bvehicle\s+magnets?\b/i],
    terms: ["car magnet", "vehicle magnet", "magnetic", "magnet", ".030 magnetic"],
    label: "magnet language",
  },
  {
    patterns: [/\bwindow\s+perf\b/i, /\bperforated\s+window\b/i, /\bone\s+way\s+vision\b/i],
    terms: ["window perf", "perforated window", "perforated vinyl", "one way vision", "one-way vision"],
    label: "window perf language",
  },
  {
    patterns: [/\bposters?\b/i],
    terms: ["poster", "posters", "poster paper", "paper"],
    label: "poster language",
  },
  {
    patterns: [/\bbanners?\b/i],
    terms: ["banner", "banners", "vinyl banner", "hem", "grommet"],
    label: "banner language",
  },
  {
    patterns: [/\bstickers?\b/i, /\bdecals?\b/i, /\blabels?\b/i],
    terms: ["sticker", "stickers", "decal", "decals", "label", "labels", "vinyl"],
    label: "sticker language",
  },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.]+/g, " ").replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalize(value)).filter(Boolean)));
}

function tokens(value: string): string[] {
  return unique(value.split(/\s+/).filter((token) => token.length > 2 && !STOP_WORDS.has(token)));
}

function isGenericRankingTerm(value: string): boolean {
  return GENERIC_RANKING_TERMS.has(normalize(value));
}

function phraseSpecificity(phrase: string): "generic" | "specific" {
  const phraseTokens = normalize(phrase).split(/\s+/).filter(Boolean);
  if (phraseTokens.length === 0) return "generic";
  return phraseTokens.every((token) => isGenericRankingTerm(token)) ? "generic" : "specific";
}

function scoreField(field: string, phrases: string[], queryTokens: string[]): { score: number; reasons: string[] } {
  const normalizedField = normalize(field);
  if (!normalizedField) return { score: 0, reasons: [] };

  let score = 0;
  const reasons: string[] = [];
  for (const phrase of phrases) {
    if (phrase.length > 2 && normalizedField.includes(phrase)) {
      const specificity = phraseSpecificity(phrase);
      score = Math.max(score, specificity === "specific" ? (phrase.includes(" ") ? 92 : 72) : 24);
      reasons.push(`matched "${phrase}"`);
    }
  }

  const specificQueryTokens = queryTokens.filter((token) => !isGenericRankingTerm(token));
  const matchedSpecificTokens = specificQueryTokens.filter((token) => normalizedField.includes(token));
  if (matchedSpecificTokens.length > 0) {
    const ratio = matchedSpecificTokens.length / Math.max(1, specificQueryTokens.length);
    score = Math.max(score, Math.round(45 + ratio * 40));
    reasons.push(`matched ${matchedSpecificTokens.slice(0, 4).map((token) => `"${token}"`).join(", ")}`);
  }

  const matchedGenericTokens = queryTokens
    .filter((token) => isGenericRankingTerm(token) && normalizedField.includes(token));
  if (matchedGenericTokens.length > 0) {
    score = Math.max(score, Math.min(28, 12 + matchedGenericTokens.length * 4));
    reasons.push(`matched generic ${matchedGenericTokens.slice(0, 4).map((token) => `"${token}"`).join(", ")}`);
  }

  return { score: Math.min(100, score), reasons: Array.from(new Set(reasons)) };
}

type NegativeEvidenceResult = {
  penalty: number;
  cap: number;
  reasons: string[];
};

const MATERIAL_SEPARATION_RULES: Array<{
  key: string;
  evidence: RegExp;
  strictEvidence?: RegExp;
  compatible: RegExp;
  conflicts: Array<{ label: string; pattern: RegExp; penalty: number; cap: number; strictCap?: number; strictPenalty?: number }>;
}> = [
  {
    key: "ACM/aluminum",
    evidence: /\b(acm|aluminum|aluminium|dibond|di\s*bond|polymetal|poly\s*metal|max\s*metal|maxmetal|aluminum\s+composite)\b/i,
    strictEvidence: /\b(acm|dibond|di\s*bond|polymetal|poly\s*metal|max\s*metal|maxmetal|aluminum\s+composite)\b/i,
    compatible: /\b(acm|aluminum|aluminium|dibond|di\s*bond|polymetal|poly\s*metal|max\s*metal|maxmetal|aluminum\s+composite)\b/i,
    conflicts: [
      { label: "PVC", pattern: /\b(pvc|sintra|expanded\s+pvc|palight|foam\s*pvc)\b/i, penalty: 58, cap: 35, strictPenalty: 75, strictCap: 15 },
      { label: "vinyl", pattern: /\b(vinyl|decal|sticker|adhesive)\b/i, penalty: 70, cap: 20, strictPenalty: 88, strictCap: 5 },
      { label: "foam board", pattern: /\b(foam\s*board|gator\s*board|ultra\s*board)\b/i, penalty: 52, cap: 35, strictPenalty: 68, strictCap: 20 },
      { label: "coroplast", pattern: /\b(coroplast|corrugated\s+plastic|coro)\b/i, penalty: 58, cap: 30, strictPenalty: 72, strictCap: 15 },
      { label: "accessory hardware", pattern: /\b(stake|stakes|hardware|accessor(?:y|ies))\b/i, penalty: 72, cap: 10, strictPenalty: 82, strictCap: 5 },
    ],
  },
  {
    key: "PVC/Sintra",
    evidence: /\b(pvc|sintra|expanded\s+pvc|palight|foam\s*pvc)\b/i,
    strictEvidence: /\b(sintra|expanded\s+pvc|palight|foam\s*pvc)\b/i,
    compatible: /\b(pvc|sintra|expanded\s+pvc|palight|foam\s*pvc)\b/i,
    conflicts: [
      { label: "ACM/aluminum", pattern: /\b(acm|aluminum|aluminium|dibond|di\s*bond|polymetal|poly\s*metal|max\s*metal|maxmetal|aluminum\s+composite)\b/i, penalty: 70, cap: 25, strictPenalty: 76, strictCap: 20 },
      { label: "vinyl", pattern: /\b(vinyl|decal|sticker|adhesive)\b/i, penalty: 78, cap: 15, strictPenalty: 84, strictCap: 10 },
      { label: "foam board", pattern: /\b(foam\s*board|gator\s*board|ultra\s*board)\b/i, penalty: 42, cap: 45, strictPenalty: 52, strictCap: 40 },
      { label: "coroplast", pattern: /\b(coroplast|corrugated\s+plastic|coro)\b/i, penalty: 54, cap: 35, strictPenalty: 62, strictCap: 30 },
      { label: "accessory hardware", pattern: /\b(stake|stakes|hardware|accessor(?:y|ies))\b/i, penalty: 74, cap: 10, strictPenalty: 82, strictCap: 5 },
    ],
  },
  {
    key: "foam board",
    evidence: /\b(foam\s*board|gator\s*board|ultra\s*board)\b/i,
    compatible: /\b(foam\s*board|gator\s*board|ultra\s*board)\b/i,
    conflicts: [
      { label: "ACM/aluminum", pattern: /\b(acm|aluminum|aluminium|dibond|di\s*bond|polymetal|poly\s*metal|max\s*metal|maxmetal|aluminum\s+composite)\b/i, penalty: 58, cap: 35 },
      { label: "PVC", pattern: /\b(pvc|sintra|expanded\s+pvc|palight|foam\s*pvc)\b/i, penalty: 44, cap: 45 },
      { label: "vinyl", pattern: /\b(vinyl|decal|sticker|adhesive)\b/i, penalty: 70, cap: 20 },
    ],
  },
  {
    key: "coroplast",
    evidence: /\b(coroplast|corrugated\s+plastic|coro|yard\s+signs?|lawn\s+signs?)\b/i,
    compatible: /\b(coroplast|corrugated\s+plastic|coro|yard\s+signs?|lawn\s+signs?)\b/i,
    conflicts: [
      { label: "ACM/aluminum", pattern: /\b(acm|aluminum|aluminium|dibond|di\s*bond|polymetal|poly\s*metal|max\s*metal|maxmetal|aluminum\s+composite)\b/i, penalty: 58, cap: 35 },
      { label: "PVC", pattern: /\b(pvc|sintra|expanded\s+pvc|palight|foam\s*pvc)\b/i, penalty: 48, cap: 40 },
      { label: "vinyl", pattern: /\b(vinyl|decal|sticker|adhesive)\b/i, penalty: 68, cap: 20 },
    ],
  },
];

function negativeEvidencePenalty(source: string, candidateText: string, candidateIdentityText: string): NegativeEvidenceResult {
  const reasons: string[] = [];
  let penalty = 0;
  let cap = 100;

  for (const rule of MATERIAL_SEPARATION_RULES) {
    if (!rule.evidence.test(source)) continue;
    if (rule.compatible.test(candidateIdentityText)) continue;
    const strict = rule.strictEvidence?.test(source) ?? false;
    for (const conflict of rule.conflicts) {
      if (!conflict.pattern.test(candidateText)) continue;
      const nextPenalty = strict ? conflict.strictPenalty ?? conflict.penalty : conflict.penalty;
      const nextCap = strict ? conflict.strictCap ?? conflict.cap : conflict.cap;
      penalty = Math.max(penalty, nextPenalty);
      cap = Math.min(cap, nextCap);
      reasons.push(`penalized ${conflict.label} because source evidence indicates ${rule.key}`);
    }
  }

  return { penalty, cap, reasons };
}

function positiveEvidenceBoost(source: string, candidateIdentityText: string): number {
  let boost = 0;
  for (const rule of MATERIAL_SEPARATION_RULES) {
    if (!rule.evidence.test(source) || !rule.compatible.test(candidateIdentityText)) continue;
    const strict = rule.strictEvidence?.test(source) ?? false;
    boost = Math.max(boost, strict ? 98 : 94);
  }
  return boost;
}

function priorityWeightedConfidence(args: {
  nameScore: number;
  aiParsingScore: number;
  materialScore: number;
  categoryScore: number;
  descriptionScore: number;
  metadataScore: number;
  positiveEvidenceBoost: number;
  accessoryPenalty: number;
  negativeEvidencePenalty: number;
  negativeEvidenceCap: number;
}): number {
  const weighted = Math.round(
    args.nameScore * 0.22
    + args.aiParsingScore * 0.30
    + args.materialScore * 0.22
    + args.categoryScore * 0.12
    + args.metadataScore * 0.08
    + args.descriptionScore * 0.06,
  );
  const priorityFloor = Math.max(
    args.nameScore >= 90 ? 98 : 0,
    args.nameScore >= 72 ? 88 : 0,
    args.aiParsingScore >= 90 ? 94 : 0,
    args.aiParsingScore >= 72 ? 82 : 0,
    args.categoryScore >= 90 ? 80 : 0,
    args.categoryScore >= 72 ? 72 : 0,
    args.materialScore >= 90 ? 76 : 0,
    args.materialScore >= 72 ? 68 : 0,
    args.metadataScore >= 90 ? 64 : 0,
    args.metadataScore >= 72 ? 58 : 0,
    args.descriptionScore >= 90 ? 54 : 0,
    args.descriptionScore >= 72 ? 46 : 0,
    args.positiveEvidenceBoost,
  );
  const penalized = Math.max(weighted, priorityFloor) - args.accessoryPenalty - args.negativeEvidencePenalty;
  return Math.max(0, Math.min(100, args.negativeEvidenceCap, penalized));
}

export function resolveAiParsingDescription(args: {
  aiParsingDescription?: string | null;
  aiParsingDescriptionLinkedToDescription?: boolean | null;
  description?: string | null;
}): string | null {
  const explicit = String(args.aiParsingDescription ?? "").trim();
  if (explicit) return explicit;
  if (args.aiParsingDescriptionLinkedToDescription) {
    const linked = String(args.description ?? "").trim();
    return linked || null;
  }
  return null;
}

export function buildProductKnowledgeSearchTerms(input: ProductKnowledgeMatchInput): string[] {
  const source = [
    input.sourceText,
    input.productName,
    input.materialText,
    ...(input.optionTexts ?? []),
    ...(input.finishingTexts ?? []),
  ].filter(Boolean).join(" ");
  const normalizedSource = normalize(source);
  const phrases = unique([
    input.productName ?? "",
    input.materialText ?? "",
    input.sourceText ?? "",
    ...SEMANTIC_EXPANSIONS.flatMap((expansion) => (
      expansion.patterns.some((pattern) => pattern.test(source)) ? expansion.terms : []
    )),
  ]);
  return unique([...phrases, ...tokens(normalizedSource)]).slice(0, 40);
}

export function scoreProductKnowledgeCandidates(
  input: ProductKnowledgeMatchInput,
  candidates: ProductKnowledgeCandidateInput[],
  limit: number,
): ProductKnowledgeMatch[] {
  const source = [
    input.sourceText,
    input.productName,
    input.materialText,
    ...(input.optionTexts ?? []),
    ...(input.finishingTexts ?? []),
  ].filter(Boolean).join(" ");
  const phrases = buildProductKnowledgeSearchTerms(input);
  const queryTokens = tokens(source);
  const normalizedSource = normalize(source);

  return candidates
    .map((candidate) => {
      const candidateText = normalize([
        candidate.name,
        candidate.aiParsingDescription,
        candidate.description,
        candidate.category,
        candidate.materialName,
        candidate.materialCategory,
        candidate.materialAiParsingDescription,
        candidate.metadataText,
      ].filter(Boolean).join(" "));
      const candidateIdentityText = normalize([
        candidate.name,
        candidate.aiParsingDescription,
        candidate.materialName,
        candidate.materialCategory,
        candidate.materialAiParsingDescription,
        candidate.metadataText,
      ].filter(Boolean).join(" "));
      const name = scoreField(candidate.name, phrases, queryTokens);
      const aiParsing = scoreField(candidate.aiParsingDescription ?? "", phrases, queryTokens);
      const description = scoreField(candidate.description ?? "", phrases, queryTokens);
      const category = scoreField(candidate.category ?? "", phrases, queryTokens);
      const material = scoreField([candidate.materialName, candidate.materialCategory].filter(Boolean).join(" "), phrases, queryTokens);
      const materialAiParsing = scoreField(candidate.materialAiParsingDescription ?? "", phrases, queryTokens);
      const metadata = scoreField(candidate.metadataText ?? "", phrases, queryTokens);
      const aiParsingScore = Math.max(aiParsing.score, materialAiParsing.score);
      const accessoryPenalty = candidate.isService
        || /\b(accessor(?:y|ies)|hardware|stake|stakes|grommet|fee|setup|install|installation|design)\b/i.test(`${candidate.name} ${candidate.category ?? ""}`)
        ? 18
        : 0;
      const negativeEvidence = negativeEvidencePenalty(normalizedSource, candidateText, candidateIdentityText);
      const positiveBoost = positiveEvidenceBoost(normalizedSource, candidateIdentityText);
      const combinedConfidence = priorityWeightedConfidence({
        nameScore: name.score,
        aiParsingScore,
        materialScore: material.score,
        categoryScore: category.score,
        descriptionScore: description.score,
        metadataScore: metadata.score,
        positiveEvidenceBoost: positiveBoost,
        accessoryPenalty,
        negativeEvidencePenalty: negativeEvidence.penalty,
        negativeEvidenceCap: negativeEvidence.cap,
      });
      const reasons = [
        ...name.reasons.map((reason) => `name ${reason}`),
        ...aiParsing.reasons.map((reason) => `AI parsing description ${reason}`),
        ...category.reasons.map((reason) => `category ${reason}`),
        ...material.reasons.map((reason) => `material ${reason}`),
        ...materialAiParsing.reasons.map((reason) => `material AI parsing description ${reason}`),
        ...metadata.reasons.map((reason) => `metadata ${reason}`),
        ...description.reasons.map((reason) => `customer-facing description ${reason}`),
        ...negativeEvidence.reasons,
      ];

      return {
        id: candidate.id,
        label: candidate.name,
        confidence: combinedConfidence,
        reason: reasons.slice(0, 3).join("; ") || "No strong product knowledge match.",
        metadata: {
          category: candidate.category,
          description: candidate.description,
          materialName: candidate.materialName ?? null,
          matchReasons: reasons,
          matchBreakdown: {
            nameScore: name.score,
            keywordScore: name.score,
            aiParsingScore,
            descriptionScore: description.score,
            categoryScore: category.score,
            materialScore: material.score,
            materialAiParsingScore: materialAiParsing.score,
            metadataScore: metadata.score,
            positiveEvidenceBoost: positiveBoost,
            accessoryPenalty,
            negativeEvidencePenalty: negativeEvidence.penalty,
            combinedConfidence,
          },
        },
      };
    })
    .filter((candidate) => candidate.confidence >= 30)
    .sort((left, right) => right.confidence - left.confidence || left.label.localeCompare(right.label))
    .slice(0, limit);
}
