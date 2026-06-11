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
      accessoryPenalty: number;
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

function scoreField(field: string, phrases: string[], queryTokens: string[]): { score: number; reasons: string[] } {
  const normalizedField = normalize(field);
  if (!normalizedField) return { score: 0, reasons: [] };

  let score = 0;
  const reasons: string[] = [];
  for (const phrase of phrases) {
    if (phrase.length > 2 && normalizedField.includes(phrase)) {
      score = Math.max(score, phrase.includes(" ") ? 92 : 72);
      reasons.push(`matched "${phrase}"`);
    }
  }

  const matchedTokens = queryTokens.filter((token) => normalizedField.includes(token));
  if (matchedTokens.length > 0) {
    const ratio = matchedTokens.length / Math.max(1, queryTokens.length);
    score = Math.max(score, Math.round(45 + ratio * 40));
    reasons.push(`matched ${matchedTokens.slice(0, 4).map((token) => `"${token}"`).join(", ")}`);
  }

  return { score: Math.min(100, score), reasons: Array.from(new Set(reasons)) };
}

function priorityWeightedConfidence(args: {
  nameScore: number;
  aiParsingScore: number;
  materialScore: number;
  categoryScore: number;
  descriptionScore: number;
  metadataScore: number;
  accessoryPenalty: number;
}): number {
  const weighted = Math.round(
    args.nameScore * 0.34
    + args.aiParsingScore * 0.28
    + args.categoryScore * 0.14
    + args.materialScore * 0.12
    + args.metadataScore * 0.08
    + args.descriptionScore * 0.04,
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
  );
  return Math.max(0, Math.min(100, Math.max(weighted, priorityFloor) - args.accessoryPenalty));
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

  return candidates
    .map((candidate) => {
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
      const combinedConfidence = priorityWeightedConfidence({
        nameScore: name.score,
        aiParsingScore,
        materialScore: material.score,
        categoryScore: category.score,
        descriptionScore: description.score,
        metadataScore: metadata.score,
        accessoryPenalty,
      });
      const reasons = [
        ...name.reasons.map((reason) => `name ${reason}`),
        ...aiParsing.reasons.map((reason) => `AI parsing description ${reason}`),
        ...category.reasons.map((reason) => `category ${reason}`),
        ...material.reasons.map((reason) => `material ${reason}`),
        ...materialAiParsing.reasons.map((reason) => `material AI parsing description ${reason}`),
        ...metadata.reasons.map((reason) => `metadata ${reason}`),
        ...description.reasons.map((reason) => `customer-facing description ${reason}`),
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
            accessoryPenalty,
            combinedConfidence,
          },
        },
      };
    })
    .filter((candidate) => candidate.confidence >= 30)
    .sort((left, right) => right.confidence - left.confidence || left.label.localeCompare(right.label))
    .slice(0, limit);
}
