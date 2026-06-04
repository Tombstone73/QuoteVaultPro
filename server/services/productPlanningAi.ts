export type ProductPlanningAiSuggestionType =
  | "priority"
  | "business_value"
  | "complexity"
  | "phase"
  | "module"
  | "work_item_type"
  | "parent_epic"
  | "duplicate_candidate"
  | "release_recommendation"
  | "implementation_notes";

export type ProductPlanningAiSuggestionDraft = {
  workItemId?: string | null;
  suggestionType: ProductPlanningAiSuggestionType;
  currentValue: unknown;
  suggestedValue: unknown;
  confidence: number;
  reasoning: string;
};

export type WorkItemForAi = {
  id: string;
  reference: string;
  title: string;
  description?: string | null;
  notes?: string | null;
  workItemType: string;
  planningStatus?: string | null;
  priority: string;
  businessValue?: string | null;
  complexity?: string | null;
  phase?: string | null;
  module?: string | null;
  tags?: string[] | null;
  parentId?: string | null;
  ownerUserId?: string | null;
  releaseId?: string | null;
  releaseTarget?: string | null;
  dependencyCount?: number;
  blockedByCount?: number;
};

export type ProductPlanningBacklogAnalysis = {
  counts: {
    totalItems: number;
    missingModules: number;
    missingPhases: number;
    missingOwners: number;
    missingReleases: number;
    missingDescriptions: number;
    potentialDuplicates: number;
    potentialEpicGroups: number;
  };
  healthScore: number;
  issues: Array<{ label: string; count: number; severity: "low" | "medium" | "high" }>;
  nextActions: string[];
  goLiveReadiness: {
    blockers: WorkItemForAi[];
    highValueFeatures: WorkItemForAi[];
    quickWins: WorkItemForAi[];
    futureItems: WorkItemForAi[];
    reasoning: string;
  };
  epicGroups: Array<{ epicName: string; module: string; relatedItems: WorkItemForAi[]; confidence: number; reasoning: string }>;
  suggestions: ProductPlanningAiSuggestionDraft[];
};

type ImportReviewRow = {
  rowNumber: number;
  title: string;
  module: string | null;
  priority: string;
  planningStatus: string;
  phase: string | null;
  warnings: string[];
  errors: string[];
};

const MODULE_KEYWORDS: Array<{ module: string; words: string[] }> = [
  { module: "Customer Portal", words: ["portal", "customer", "login", "file upload", "approval"] },
  { module: "Quotes", words: ["quote", "estimate", "pricing", "line item"] },
  { module: "Orders", words: ["order", "job", "workflow", "status"] },
  { module: "Invoices", words: ["invoice", "payment", "billing", "stripe", "eps"] },
  { module: "Production", words: ["production", "station", "printer", "fulfillment"] },
  { module: "Prepress", words: ["prepress", "proof", "design", "artwork"] },
  { module: "Inventory", words: ["inventory", "material", "stock", "vendor"] },
  { module: "Product Planning", words: ["roadmap", "backlog", "kanban", "planning"] },
  { module: "Bug Reports", words: ["bug report", "feedback", "screenshot", "triage"] },
  { module: "AI", words: ["ai", "suggestion", "summary", "classification"] },
];

function textFor(item: WorkItemForAi): string {
  return [item.title, item.description, item.notes, item.module, ...(item.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function tokenize(value: string): Set<string> {
  const words = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2);
  return new Set(words);
}

function similarityScore(a: string, b: string): number {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const word of Array.from(left)) {
    if (right.has(word)) intersection++;
  }
  const union = new Set([...Array.from(left), ...Array.from(right)]).size;
  return Math.round((intersection / union) * 100);
}

function guessModule(item: WorkItemForAi): { value: string; confidence: number; reason: string } | null {
  const text = textFor(item);
  let best: { module: string; score: number; matched: string[] } | null = null;
  for (const candidate of MODULE_KEYWORDS) {
    const matched = candidate.words.filter((word) => text.includes(word));
    if (matched.length === 0) continue;
    const score = matched.length;
    if (!best || score > best.score) best = { module: candidate.module, score, matched };
  }
  if (!best) return null;
  return {
    value: best.module,
    confidence: Math.min(92, 62 + best.score * 10),
    reason: `Matched module language: ${best.matched.join(", ")}.`,
  };
}

function guessPriority(item: WorkItemForAi): { value: string; confidence: number; reason: string } | null {
  const text = textFor(item);
  if (/\b(blocker|blocked|down|cannot|broken|production|security|payment|critical)\b/.test(text)) {
    return { value: "critical", confidence: 84, reason: "The item uses blocker, production, payment, or critical-impact language." };
  }
  if (/\b(customer|portal|deadline|go live|urgent|revenue|invoice|billing|many users)\b/.test(text)) {
    return { value: "high", confidence: 76, reason: "The item appears customer-facing, go-live related, revenue-related, or urgent." };
  }
  if (/\b(cleanup|polish|minor|nice to have|future)\b/.test(text)) {
    return { value: "low", confidence: 65, reason: "The item reads like cleanup, polish, or a future/nice-to-have improvement." };
  }
  return null;
}

function guessWorkItemType(item: WorkItemForAi): { value: string; confidence: number; reason: string } | null {
  const text = textFor(item);
  if (/\b(error|bug|broken|fails|crash|incorrect|not working)\b/.test(text)) {
    return { value: "bug", confidence: 82, reason: "The item describes broken or incorrect behavior." };
  }
  if (/\b(epic|initiative|program|umbrella)\b/.test(text)) {
    return { value: "epic", confidence: 74, reason: "The item is phrased as an umbrella initiative." };
  }
  if (/\b(refactor|cleanup|debt|legacy|hardening)\b/.test(text)) {
    return { value: "technical_debt", confidence: 76, reason: "The item is mainly about refactor, hardening, cleanup, or legacy debt." };
  }
  if (/\b(research|r&d|investigate|spike|explore)\b/.test(text)) {
    return { value: "research", confidence: 78, reason: "The item asks for investigation or research." };
  }
  if (/\b(add|create|build|support|allow)\b/.test(text)) {
    return { value: "feature", confidence: 66, reason: "The item is framed as new capability." };
  }
  return null;
}

function guessBusinessValue(item: WorkItemForAi): { value: string; confidence: number; reason: string } | null {
  const text = textFor(item);
  if (/\b(payment|billing|invoice|revenue|customer portal|go live|customer-facing)\b/.test(text)) {
    return { value: "very_high", confidence: 78, reason: "The item touches revenue, billing, go-live, or customer-facing workflows." };
  }
  if (/\b(operator|production|workflow|automation|staff|time saving)\b/.test(text)) {
    return { value: "high", confidence: 70, reason: "The item could materially improve internal workflow or automation." };
  }
  return null;
}

function guessComplexity(item: WorkItemForAi): { value: string; confidence: number; reason: string } {
  const text = textFor(item);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (/\b(integration|migration|architecture|dependency|permissions|payment|ai|sync)\b/.test(text) || wordCount > 90) {
    return { value: "large", confidence: 70, reason: "The item references integration, migration, permissions, payment, AI, sync, or has a broad description." };
  }
  if (wordCount > 35 || /\b(import|dashboard|report|settings|workflow)\b/.test(text)) {
    return { value: "medium", confidence: 68, reason: "The item appears to span a moderate workflow or UI surface." };
  }
  return { value: "small", confidence: 62, reason: "The item appears narrow and self-contained." };
}

function guessPhase(item: WorkItemForAi): { value: string; confidence: number; reason: string } | null {
  const text = textFor(item);
  if (item.workItemType === "research" || /\b(research|r&d|investigate|spike)\b/.test(text)) {
    return { value: "research", confidence: 78, reason: "The item is discovery-oriented." };
  }
  if (item.priority === "critical" || /\b(go live|blocker|blocking launch|must ship)\b/.test(text)) {
    return { value: "go_live", confidence: 76, reason: "The item appears launch-blocking or critical." };
  }
  if (item.priority === "high" || item.businessValue === "very_high" || item.businessValue === "high") {
    return { value: "v1_1", confidence: 68, reason: "The item has high priority or business value but is not clearly go-live blocking." };
  }
  if (item.complexity === "large" || item.complexity === "massive") {
    return { value: "future", confidence: 62, reason: "The item looks larger and may need later planning." };
  }
  return null;
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}

function itemWeight(item: WorkItemForAi): number {
  const priorityWeight: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const valueWeight: Record<string, number> = { very_high: 4, high: 3, medium: 2, low: 1 };
  const complexityWeight: Record<string, number> = { small: 3, medium: 2, large: 1, massive: 0 };
  return (priorityWeight[item.priority] ?? 1)
    + (valueWeight[item.businessValue ?? ""] ?? 0)
    + (complexityWeight[item.complexity ?? ""] ?? 1)
    + (item.phase === "go_live" ? 2 : 0)
    + (item.blockedByCount ?? 0);
}

function groupItemsByPlanningTheme(items: WorkItemForAi[]) {
  const groups = new Map<string, WorkItemForAi[]>();
  for (const item of items) {
    const key = item.module || guessModule(item)?.value || "Unassigned Planning";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return Array.from(groups.entries())
    .filter(([, grouped]) => grouped.length >= 3)
    .map(([module, relatedItems]) => ({
      epicName: module.includes("&") || module.includes("Automation") ? module : `${module} Improvements`,
      module,
      relatedItems: relatedItems.slice(0, 20),
      confidence: Math.min(92, 58 + relatedItems.length * 4),
      reasoning: `${relatedItems.length} active backlog item(s) share the ${module} planning theme.`,
    }))
    .sort((a, b) => b.relatedItems.length - a.relatedItems.length)
    .slice(0, 8);
}

function backlogDuplicateSuggestions(items: WorkItemForAi[], limit = 12): ProductPlanningAiSuggestionDraft[] {
  const suggestions: ProductPlanningAiSuggestionDraft[] = [];
  const seenPairs = new Set<string>();
  for (const item of items) {
    for (const duplicate of findSimilarProductPlanningItems(item, items, 3)) {
      const pairKey = [item.id, duplicate.item.id].sort().join(":");
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      suggestions.push({
        workItemId: item.id,
        suggestionType: "duplicate_candidate",
        currentValue: { id: item.id, reference: item.reference, title: item.title },
        suggestedValue: {
          id: duplicate.item.id,
          reference: duplicate.item.reference,
          title: duplicate.item.title,
          similarity: duplicate.similarity,
        },
        confidence: duplicate.similarity,
        reasoning: duplicate.reasoning,
      });
      if (suggestions.length >= limit) return suggestions;
    }
  }
  return suggestions;
}

function pushIfDifferent(
  suggestions: ProductPlanningAiSuggestionDraft[],
  item: WorkItemForAi,
  suggestionType: ProductPlanningAiSuggestionType,
  currentValue: unknown,
  suggestedValue: unknown,
  confidence: number,
  reasoning: string,
) {
  if (JSON.stringify(currentValue ?? null) === JSON.stringify(suggestedValue ?? null)) return;
  suggestions.push({
    workItemId: item.id,
    suggestionType,
    currentValue: currentValue ?? null,
    suggestedValue,
    confidence,
    reasoning,
  });
}

export function findSimilarProductPlanningItems(
  item: WorkItemForAi,
  candidates: WorkItemForAi[],
  limit = 5,
): Array<{ item: WorkItemForAi; similarity: number; reasoning: string }> {
  const source = [item.title, item.description, item.notes, item.module, ...(item.tags ?? [])].filter(Boolean).join(" ");
  return candidates
    .filter((candidate) => candidate.id !== item.id)
    .map((candidate) => {
      const candidateText = [candidate.title, candidate.description, candidate.notes, candidate.module, ...(candidate.tags ?? [])].filter(Boolean).join(" ");
      let similarity = similarityScore(source, candidateText);
      if (item.module && candidate.module && item.module.toLowerCase() === candidate.module.toLowerCase()) similarity += 8;
      if (item.workItemType === candidate.workItemType) similarity += 5;
      similarity = Math.min(99, similarity);
      return {
        item: candidate,
        similarity,
        reasoning: `Matched title, description, notes, module, and tag terms with ${similarity}% similarity.`,
      };
    })
    .filter((candidate) => candidate.similarity >= 45)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export function generateProductPlanningAiReviewSuggestions(
  item: WorkItemForAi,
  candidates: WorkItemForAi[],
): ProductPlanningAiSuggestionDraft[] {
  const suggestions: ProductPlanningAiSuggestionDraft[] = [];

  const priority = guessPriority(item);
  if (priority) pushIfDifferent(suggestions, item, "priority", item.priority, priority.value, priority.confidence, priority.reason);

  const businessValue = guessBusinessValue(item);
  if (businessValue) pushIfDifferent(suggestions, item, "business_value", item.businessValue ?? null, businessValue.value, businessValue.confidence, businessValue.reason);

  const complexity = guessComplexity(item);
  pushIfDifferent(suggestions, item, "complexity", item.complexity ?? null, complexity.value, complexity.confidence, complexity.reason);

  const moduleGuess = guessModule(item);
  if (moduleGuess) pushIfDifferent(suggestions, item, "module", item.module ?? null, moduleGuess.value, moduleGuess.confidence, moduleGuess.reason);

  const type = guessWorkItemType(item);
  if (type) pushIfDifferent(suggestions, item, "work_item_type", item.workItemType, type.value, type.confidence, type.reason);

  const phase = guessPhase({ ...item, complexity: item.complexity ?? complexity.value });
  if (phase) pushIfDifferent(suggestions, item, "phase", item.phase ?? null, phase.value, phase.confidence, phase.reason);

  const parentEpic = candidates.find((candidate) =>
    candidate.id !== item.id &&
    candidate.workItemType === "epic" &&
    candidate.module &&
    item.module &&
    candidate.module.toLowerCase() === item.module.toLowerCase());
  if (parentEpic && item.parentId !== parentEpic.id) {
    pushIfDifferent(suggestions, item, "parent_epic", item.parentId ?? null, {
      id: parentEpic.id,
      reference: parentEpic.reference,
      title: parentEpic.title,
    }, 72, `Found an epic in the same module: ${parentEpic.reference}.`);
  }

  for (const duplicate of findSimilarProductPlanningItems(item, candidates, 3)) {
    suggestions.push({
      workItemId: item.id,
      suggestionType: "duplicate_candidate",
      currentValue: { id: item.id, reference: item.reference, title: item.title },
      suggestedValue: {
        id: duplicate.item.id,
        reference: duplicate.item.reference,
        title: duplicate.item.title,
        similarity: duplicate.similarity,
      },
      confidence: duplicate.similarity,
      reasoning: duplicate.reasoning,
    });
  }

  if (!hasText(item.description)) {
    suggestions.push({
      workItemId: item.id,
      suggestionType: "implementation_notes",
      currentValue: item.description ?? null,
      suggestedValue: {
        action: "add_missing_description",
        field: "description",
        prompt: "Add the problem, user impact, expected outcome, and validation notes before implementation.",
      },
      confidence: 74,
      reasoning: "This item has no description, which makes planning and prioritization harder.",
    });
  }

  if (!item.releaseId && !hasText(item.releaseTarget)) {
    suggestions.push({
      workItemId: item.id,
      suggestionType: "release_recommendation",
      currentValue: null,
      suggestedValue: {
        releaseTarget: item.phase === "go_live" ? "Go Live" : item.phase ? item.phase : "Review release target",
      },
      confidence: item.phase ? 70 : 58,
      reasoning: "This item has no assigned release. Review whether it belongs in the current roadmap or should stay in backlog.",
    });
  }

  if ((item.blockedByCount ?? 0) > 0) {
    suggestions.push({
      workItemId: item.id,
      suggestionType: "implementation_notes",
      currentValue: null,
      suggestedValue: {
        action: "review_blockers",
        blockedByCount: item.blockedByCount,
      },
      confidence: 76,
      reasoning: `${item.blockedByCount} item(s) depend on this work item. Review blockers before sequencing implementation.`,
    });
  }

  suggestions.push(generateImplementationNotesSuggestion(item));

  return suggestions;
}

export function generateImplementationNotesSuggestion(item: WorkItemForAi): ProductPlanningAiSuggestionDraft {
  const risks = [];
  const text = textFor(item);
  if (/\b(payment|billing|invoice)\b/.test(text)) risks.push("Validate billing/payment side effects carefully.");
  if (/\b(permission|admin|customer|portal)\b/.test(text)) risks.push("Confirm authorization and tenant scoping on backend routes.");
  if (/\b(import|csv|migration)\b/.test(text)) risks.push("Check malformed input, duplicates, and partial failure handling.");
  if (risks.length === 0) risks.push("Confirm nearby workflow behavior remains unchanged.");

  const checklist = [
    "Backend route/service behavior covered where applicable.",
    "UI empty/loading/error states checked.",
    "Tenant/org scoping verified.",
    "Regression path smoke-tested.",
  ];

  const notes = [
    `Suggested approach: Break ${item.reference} into a small implementation slice, preserve existing ${item.module ?? "module"} conventions, and verify the primary user workflow before expanding scope.`,
    "",
    "Risks:",
    ...risks.map((risk) => `- ${risk}`),
    "",
    "Validation checklist:",
    ...checklist.map((entry) => `- ${entry}`),
  ].join("\n");

  return {
    workItemId: item.id,
    suggestionType: "implementation_notes",
    currentValue: item.notes ?? null,
    suggestedValue: { notes },
    confidence: 72,
    reasoning: "Generated implementation notes from the item type, module, description, notes, and risk keywords.",
  };
}

export function generateRoadmapGroupingSuggestions(items: WorkItemForAi[]): ProductPlanningAiSuggestionDraft[] {
  return items
    .map((item) => {
      const complexity = item.complexity ? null : guessComplexity(item);
      const phase = guessPhase({ ...item, complexity: item.complexity ?? complexity?.value ?? null });
      if (!phase || item.phase === phase.value) return null;
      return {
        workItemId: item.id,
        suggestionType: "phase" as const,
        currentValue: item.phase ?? null,
        suggestedValue: phase.value,
        confidence: phase.confidence,
        reasoning: phase.reason,
      };
    })
    .filter(Boolean) as ProductPlanningAiSuggestionDraft[];
}

export function generateImportCleanupSuggestions(input: {
  mappedRows: ImportReviewRow[];
  duplicateWarnings: Array<{ rowNumber: number; message: string; existingReference?: string }>;
}): ProductPlanningAiSuggestionDraft[] {
  const duplicateByRow = new Map(input.duplicateWarnings.map((warning) => [warning.rowNumber, warning]));
  const suggestions: ProductPlanningAiSuggestionDraft[] = [];

  for (const row of input.mappedRows) {
    const duplicate = duplicateByRow.get(row.rowNumber);
    if (duplicate) {
      suggestions.push({
        workItemId: null,
        suggestionType: "duplicate_candidate",
        currentValue: { rowNumber: row.rowNumber, title: row.title },
        suggestedValue: { action: "review_duplicate", existingReference: duplicate.existingReference ?? null },
        confidence: 86,
        reasoning: duplicate.message,
      });
    }
    if (!row.module) {
      const moduleGuess = guessModule({
        id: `row-${row.rowNumber}`,
        reference: `CSV row ${row.rowNumber}`,
        title: row.title,
        workItemType: "feature",
        priority: row.priority,
        phase: row.phase,
        module: row.module,
      });
      if (moduleGuess) {
        suggestions.push({
          workItemId: null,
          suggestionType: "module",
          currentValue: { rowNumber: row.rowNumber, field: "module", value: null },
          suggestedValue: { field: "module", value: moduleGuess.value },
          confidence: moduleGuess.confidence,
          reasoning: moduleGuess.reason,
        });
      }
    }
    if (!row.phase && (row.priority === "critical" || row.priority === "high")) {
      suggestions.push({
        workItemId: null,
        suggestionType: "phase",
        currentValue: { rowNumber: row.rowNumber, field: "phase", value: null },
        suggestedValue: { field: "phase", value: row.priority === "critical" ? "go_live" : "v1_1" },
        confidence: 68,
        reasoning: "High-priority imported rows should be reviewed for near-term roadmap placement.",
      });
    }
  }

  return suggestions;
}

export function generateBacklogAnalysis(items: WorkItemForAi[]): ProductPlanningBacklogAnalysis {
  const activeItems = items.filter((item) => item.planningStatus !== "archived");
  const duplicateSuggestions = backlogDuplicateSuggestions(activeItems);
  const epicGroups = groupItemsByPlanningTheme(activeItems);
  const suggestions: ProductPlanningAiSuggestionDraft[] = [...duplicateSuggestions];

  for (const item of activeItems) {
    if (!hasText(item.module)) {
      const moduleGuess = guessModule(item);
      if (moduleGuess) {
        suggestions.push({
          workItemId: item.id,
          suggestionType: "module",
          currentValue: item.module ?? null,
          suggestedValue: moduleGuess.value,
          confidence: moduleGuess.confidence,
          reasoning: moduleGuess.reason,
        });
      }
    }
    if (!item.phase) {
      const complexity = item.complexity ? null : guessComplexity(item);
      const phase = guessPhase({ ...item, complexity: item.complexity ?? complexity?.value ?? null });
      if (phase) {
        suggestions.push({
          workItemId: item.id,
          suggestionType: "phase",
          currentValue: null,
          suggestedValue: phase.value,
          confidence: phase.confidence,
          reasoning: phase.reason,
        });
      }
    }
    if (!hasText(item.description)) {
      suggestions.push({
        workItemId: item.id,
        suggestionType: "implementation_notes",
        currentValue: null,
        suggestedValue: { action: "add_missing_description", reference: item.reference },
        confidence: 68,
        reasoning: "Missing description found during backlog analysis.",
      });
    }
    if (!item.releaseId && !hasText(item.releaseTarget) && (item.priority === "critical" || item.priority === "high" || item.phase === "go_live")) {
      suggestions.push({
        workItemId: item.id,
        suggestionType: "release_recommendation",
        currentValue: null,
        suggestedValue: { releaseTarget: item.phase === "go_live" ? "Go Live" : "Review release target" },
        confidence: 66,
        reasoning: "High-priority or go-live item has no release assignment.",
      });
    }
  }

  for (const group of epicGroups) {
    suggestions.push({
      workItemId: null,
      suggestionType: "parent_epic",
      currentValue: null,
      suggestedValue: {
        epicName: group.epicName,
        module: group.module,
        relatedItems: group.relatedItems.map((item) => ({ id: item.id, reference: item.reference, title: item.title })),
      },
      confidence: group.confidence,
      reasoning: group.reasoning,
    });
  }

  const counts = {
    totalItems: activeItems.length,
    missingModules: activeItems.filter((item) => !hasText(item.module)).length,
    missingPhases: activeItems.filter((item) => !item.phase).length,
    missingOwners: activeItems.filter((item) => !hasText(item.ownerUserId)).length,
    missingReleases: activeItems.filter((item) => !item.releaseId && !hasText(item.releaseTarget)).length,
    missingDescriptions: activeItems.filter((item) => !hasText(item.description)).length,
    potentialDuplicates: duplicateSuggestions.length,
    potentialEpicGroups: epicGroups.length,
  };
  const issueCount = counts.missingModules
    + counts.missingPhases
    + counts.missingOwners
    + counts.missingReleases
    + counts.missingDescriptions
    + counts.potentialDuplicates
    + counts.potentialEpicGroups;
  const healthScore = activeItems.length === 0
    ? 100
    : Math.max(0, Math.min(100, 100 - Math.round((issueCount / Math.max(1, activeItems.length * 3)) * 100)));
  const issues = [
    { label: "Missing modules", count: counts.missingModules, severity: "high" as const },
    { label: "Missing phases", count: counts.missingPhases, severity: "high" as const },
    { label: "Missing owners", count: counts.missingOwners, severity: "medium" as const },
    { label: "Missing releases", count: counts.missingReleases, severity: "medium" as const },
    { label: "Missing descriptions", count: counts.missingDescriptions, severity: "medium" as const },
    { label: "Potential duplicates", count: counts.potentialDuplicates, severity: "medium" as const },
    { label: "Potential epic groups", count: counts.potentialEpicGroups, severity: "low" as const },
  ].filter((issue) => issue.count > 0);

  const blockers = activeItems
    .filter((item) => item.phase === "go_live" || item.priority === "critical" || item.workItemType === "bug")
    .sort((a, b) => itemWeight(b) - itemWeight(a))
    .slice(0, 10);
  const highValueFeatures = activeItems
    .filter((item) => item.workItemType !== "bug" && (item.businessValue === "very_high" || item.businessValue === "high" || item.priority === "high"))
    .sort((a, b) => itemWeight(b) - itemWeight(a))
    .slice(0, 10);
  const quickWins = activeItems
    .filter((item) => item.complexity === "small" && (item.priority === "high" || item.businessValue === "high" || item.businessValue === "very_high"))
    .sort((a, b) => itemWeight(b) - itemWeight(a))
    .slice(0, 10);
  const futureItems = activeItems
    .filter((item) => item.phase === "future" || item.priority === "low" || item.complexity === "massive")
    .sort((a, b) => itemWeight(b) - itemWeight(a))
    .slice(0, 10);

  const nextActions = [
    counts.potentialEpicGroups > 0 ? `Review ${counts.potentialEpicGroups} possible epic grouping(s).` : null,
    counts.missingModules > 0 ? `Assign modules to ${counts.missingModules} item(s).` : null,
    counts.potentialDuplicates > 0 ? `Review ${counts.potentialDuplicates} duplicate candidate(s).` : null,
    counts.missingReleases > 0 ? `Review ${counts.missingReleases} unassigned release target(s).` : null,
    blockers.length > 0 ? `Review ${blockers.length} go-live blocker candidate(s).` : null,
  ].filter(Boolean) as string[];

  return {
    counts,
    healthScore,
    issues,
    nextActions,
    goLiveReadiness: {
      blockers,
      highValueFeatures,
      quickWins,
      futureItems,
      reasoning: "Ranked by priority, business value, complexity, go-live phase, bug status, and blocker signals.",
    },
    epicGroups,
    suggestions: suggestions.slice(0, 100),
  };
}

export function generateEpicDiscoverySuggestions(items: WorkItemForAi[]): ProductPlanningAiSuggestionDraft[] {
  return groupItemsByPlanningTheme(items).map((group) => ({
    workItemId: null,
    suggestionType: "parent_epic",
    currentValue: null,
    suggestedValue: {
      epicName: group.epicName,
      module: group.module,
      relatedItems: group.relatedItems.map((item) => ({ id: item.id, reference: item.reference, title: item.title })),
    },
    confidence: group.confidence,
    reasoning: group.reasoning,
  }));
}

export function generateRoadmapAnalysis(items: WorkItemForAi[]) {
  const byPhase = new Map<string, WorkItemForAi[]>();
  for (const item of items) {
    const phase = item.phase || "unassigned";
    if (!byPhase.has(phase)) byPhase.set(phase, []);
    byPhase.get(phase)!.push(item);
  }
  const recommendations = Array.from(byPhase.entries()).map(([phase, phaseItems]) => {
    const highWeight = phaseItems.filter((item) => item.priority === "critical" || item.priority === "high").length;
    const lowWeight = phaseItems.filter((item) => item.priority === "low" || item.complexity === "massive").length;
    const action = phaseItems.length > 12
      ? "Overloaded"
      : phaseItems.length < 2
        ? "Under-populated"
        : lowWeight > highWeight && phase !== "future"
          ? "Review for Future"
          : highWeight > 0 && phase === "future"
            ? "Review for Go Live"
            : "Balanced";
    return {
      phase,
      action,
      count: phaseItems.length,
      reasoning: `${phaseItems.length} item(s), ${highWeight} high-priority item(s), ${lowWeight} low-priority or massive item(s).`,
    };
  });
  const suggestions = generateRoadmapGroupingSuggestions(items);
  return { recommendations, suggestions };
}

export function generateBugPlanningSummary(bugReport: {
  referenceNumber: string | null;
  title: string;
  description: string;
  severity: string;
  url?: string | null;
  createdByEmail?: string | null;
}) {
  const syntheticItem: WorkItemForAi = {
    id: "bug-summary",
    reference: bugReport.referenceNumber ?? "Bug report",
    title: bugReport.title,
    description: bugReport.description,
    workItemType: "bug",
    priority: bugReport.severity === "critical" ? "critical" : bugReport.severity === "high" ? "high" : bugReport.severity === "low" ? "low" : "medium",
    module: null,
  };
  const moduleGuess = guessModule(syntheticItem);
  return {
    title: bugReport.title,
    description: [
      `Problem: ${bugReport.description}`,
      "",
      `Impact: ${bugReport.severity === "critical" || bugReport.severity === "high" ? "Potentially high operational or customer impact." : "Needs product review for scope and impact."}`,
      bugReport.url ? `Source page: ${bugReport.url}` : "",
    ].filter(Boolean).join("\n"),
    workItemType: "bug",
    priority: syntheticItem.priority,
    module: moduleGuess?.value ?? null,
    reasoning: moduleGuess
      ? `Suggested module from bug report language. ${moduleGuess.reason}`
      : "Generated a planning-ready summary from the bug title, description, severity, and source URL.",
  };
}
