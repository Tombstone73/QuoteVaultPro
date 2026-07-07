export const inboundAttachmentClassificationValues = [
  "PO",
  "ARTWORK",
  "REFERENCE",
  "IGNORE_INLINE",
  "OTHER",
] as const;

export type InboundAttachmentClassification = (typeof inboundAttachmentClassificationValues)[number];

export type InboundAttachmentClassificationSource = "automatic" | "manual_override";

export type InboundAttachmentClassificationBreakdown = {
  filename: string[];
  content: string[];
  metadata: string[];
  manual: string[];
  scores: Record<InboundAttachmentClassification, number>;
};

export type InboundAttachmentClassificationResult = {
  classification: InboundAttachmentClassification;
  confidence: number;
  reasons: string[];
  source: InboundAttachmentClassificationSource;
  breakdown: InboundAttachmentClassificationBreakdown;
};

export type InboundAttachmentClassificationInput = {
  filename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  contentDisposition?: string | null;
  contentId?: string | null;
  extractedText?: string | null;
  sourceHint?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  customerAttachmentCount?: number | null;
};

const artworkExtensions = new Set(["ai", "eps", "svg", "jpg", "jpeg", "png", "tif", "tiff", "psd"]);
const strongArtworkExtensions = new Set(["ai", "eps", "svg"]);
const imageExtensions = new Set(["jpg", "jpeg", "png", "tif", "tiff", "psd"]);
const jobProductTermPatterns = [
  /\b(?:art|artwork|final|print|press|production)\b/i,
  /\b(?:banner|banners|sign|signs|decal|decals|sticker|stickers|logo|logos)\b/i,
  /\b(?:wrap|wraps|vinyl|psv|premask|pre[-_\s]?mask)\b/i,
  /\bsenior\s+decals?\b/i,
];
const strongPoFilenamePatterns = [
  /(^|[-_\s.])(?:po|p\.o\.)(?:[-_\s.#]|\d|$)/i,
  /\b(?:po|p\.o\.)\s*(?:no|number|#)\b/i,
  /\border\s*(?:no|number|#)\b/i,
  /\bpurchase\s+order\s*(?:no|number|#)?\b/i,
  /\b(?:purchase[-_\s]?order|order[-_\s]?form|invoice|estimate)\b/i,
];
const strongPoTextPatterns = [
  /\bpurchase\s+order\b/i,
  /\bpo\s*#/i,
  /\bp\.o\./i,
  /\bbill\s+to\b/i,
  /\bship\s+to\b/i,
  /\bvendor\b/i,
  /\binvoice\b/i,
  /\bestimate\b/i,
  /\border\s+form\b/i,
];

function normalize(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function extensionFromFilename(filename: string): string {
  const match = filename.match(/\.([a-z0-9]+)(?:$|[?#])/i);
  return match ? match[1].toLowerCase() : "";
}

function pushReason(target: string[], reason: string): void {
  if (!target.includes(reason)) target.push(reason);
}

function includesAny(text: string, patterns: RegExp[], target: string[], reason: string, score: number): number {
  if (!patterns.some((pattern) => pattern.test(text))) return 0;
  pushReason(target, reason);
  return score;
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function usefulBodyText(text: string, html: string): string {
  const strippedHtml = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return `${text} ${strippedHtml}`
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function baseBreakdown(): InboundAttachmentClassificationBreakdown {
  return {
    filename: [],
    content: [],
    metadata: [],
    manual: [],
    scores: {
      PO: 0,
      ARTWORK: 0,
      REFERENCE: 0,
      IGNORE_INLINE: 0,
      OTHER: 0,
    },
  };
}

export function classifyInboundAttachment(input: InboundAttachmentClassificationInput): InboundAttachmentClassificationResult {
  const filename = normalize(input.filename);
  const mimeType = normalize(input.mimeType);
  const contentDisposition = normalize(input.contentDisposition);
  const contentId = normalize(input.contentId);
  const extractedText = normalize(input.extractedText);
  const sourceHint = normalize(input.sourceHint);
  const subject = normalize(input.subject);
  const bodyText = normalize(input.bodyText);
  const bodyHtml = normalize(input.bodyHtml);
  const extension = extensionFromFilename(filename);
  const sizeBytes = typeof input.sizeBytes === "number" ? input.sizeBytes : null;
  const isPdf = extension === "pdf" || mimeType.includes("pdf");
  const isWord = extension === "doc" || extension === "docx" || mimeType.includes("msword") || mimeType.includes("wordprocessingml.document");
  const isBusinessDocument = isPdf || isWord;
  const isImage = artworkExtensions.has(extension) || /^image\//i.test(mimeType);
  const isInline = contentDisposition.includes("inline") || Boolean(contentId);
  const smallImage = isImage && sizeBytes != null && sizeBytes > 0 && sizeBytes <= 40_000;
  const isDesignOrImageAttachment = isPdf || isImage;
  const attachmentCount = typeof input.customerAttachmentCount === "number" ? input.customerAttachmentCount : null;
  const body = usefulBodyText(bodyText, bodyHtml);
  const bodyHasUsefulText = body.length >= 20;
  const subjectHasJobTerms = hasAny(subject, jobProductTermPatterns);
  const filenameHasJobTerms = hasAny(filename, jobProductTermPatterns);
  const hasStrongPoEvidence = hasAny(filename, strongPoFilenamePatterns) || hasAny(extractedText, strongPoTextPatterns);
  const breakdown = baseBreakdown();
  const scores = breakdown.scores;

  const inlineFilenameScore = includesAny(
    filename,
    [/(^|[-_\s.])(image\d{2,}|logo|signature|sig|spacer|pixel|tracking)([-_\s.]|$)/i, /(?:facebook|linkedin|instagram|twitter|x-icon)/i],
    breakdown.filename,
    "filename suggests an email signature or inline image",
    42,
  );
  scores.IGNORE_INLINE += inlineFilenameScore;
  if (isInline) {
    scores.IGNORE_INLINE += 32;
    pushReason(breakdown.metadata, "attachment is marked inline or has a content-id");
  }
  if (smallImage) {
    scores.IGNORE_INLINE += 24;
    pushReason(breakdown.metadata, "image is small enough to be a signature or tracking image");
  }

  if (strongArtworkExtensions.has(extension)) {
    scores.ARTWORK += 96;
    pushReason(breakdown.filename, `.${extension} is a production artwork file type`);
  } else if (imageExtensions.has(extension) || /^image\//i.test(mimeType)) {
    scores.ARTWORK += 78;
    pushReason(breakdown.metadata, "image file type is normally production artwork");
  }

  scores.ARTWORK += includesAny(
    filename,
    jobProductTermPatterns,
    breakdown.filename,
    "filename contains artwork or production terms",
    isPdf ? 62 : 30,
  );
  scores.ARTWORK += includesAny(
    subject,
    jobProductTermPatterns,
    breakdown.content,
    "subject contains product or job terms",
    24,
  );

  scores.REFERENCE += includesAny(
    filename,
    [/\b(?:proof|mockup|reference|example|layout|spec)\b/i],
    breakdown.filename,
    "filename contains proof, mockup, reference, layout, or spec terms",
    58,
  );

  if (!strongArtworkExtensions.has(extension) && !imageExtensions.has(extension)) {
    scores.PO += includesAny(
      filename,
      strongPoFilenamePatterns,
      breakdown.filename,
      "filename contains purchase-order or business document terms",
      58,
    );
  }

  if (isBusinessDocument) {
    scores.PO += includesAny(
      extractedText,
      [/\bpurchase\s+order\b/i, /\bpo\s*#/i, /\bp\.o\./i],
      breakdown.content,
      isPdf ? "PDF text contains purchase-order language" : "Word document text contains purchase-order language",
      42,
    );
    scores.PO += includesAny(
      extractedText,
      [/\bbill\s+to\b/i, /\bship\s+to\b/i, /\bbuyer\b/i, /\bvendor\b/i],
      breakdown.content,
      isPdf ? "PDF text contains bill-to, ship-to, buyer, or vendor fields" : "Word document text contains bill-to, ship-to, buyer, or vendor fields",
      42,
    );
    if (scores.PO >= 40 && scores.ARTWORK < 60) {
      scores.PO += 12;
      pushReason(breakdown.content, isPdf ? "PDF looks like a small business document or form" : "Word document looks like a small business document or form");
    }
    if (scores.PO > 0 && scores.ARTWORK > 0) {
      scores.REFERENCE += 45;
      pushReason(breakdown.content, isPdf ? "PDF has mixed purchase-order and artwork signals" : "Word document has mixed purchase-order and artwork signals");
    }
    if (scores.PO === 0 && scores.ARTWORK === 0 && scores.REFERENCE === 0) {
      scores.REFERENCE += 38;
      pushReason(breakdown.metadata, isPdf ? "PDF is useful evidence but lacks strong PO or artwork signals" : "Word document is useful evidence but lacks strong PO or artwork signals");
    }
  }

  if (sourceHint && /\b(?:po|purchase\s*order)\b/i.test(sourceHint) && isBusinessDocument && scores.ARTWORK < 80) {
    scores.PO += 18;
    pushReason(breakdown.content, "email body references PO or purchase order");
  }
  if (
    !bodyHasUsefulText
    && attachmentCount === 1
    && isDesignOrImageAttachment
    && subjectHasJobTerms
    && filenameHasJobTerms
    && !hasStrongPoEvidence
  ) {
    scores.ARTWORK += 72;
    pushReason(breakdown.metadata, "single customer attachment with empty body");
    pushReason(breakdown.content, "subject and filename contain product or job terms");
    pushReason(breakdown.content, "no strong PO indicators were found");
  }
  if (
    !bodyHasUsefulText
    && attachmentCount === 1
    && isDesignOrImageAttachment
    && !hasStrongPoEvidence
    && scores.ARTWORK < 55
  ) {
    scores.REFERENCE += 62;
    pushReason(breakdown.metadata, "single customer attachment with empty body needs staff review as reference");
  }

  if (isInline && scores.IGNORE_INLINE >= 50) {
    return finalizeClassification("IGNORE_INLINE", scores.IGNORE_INLINE, "automatic", breakdown);
  }
  if (strongArtworkExtensions.has(extension) || imageExtensions.has(extension) || /^image\//i.test(mimeType)) {
    return finalizeClassification("ARTWORK", scores.ARTWORK, "automatic", breakdown);
  }
  if (hasStrongPoEvidence && scores.PO >= 50 && !strongArtworkExtensions.has(extension) && !imageExtensions.has(extension)) {
    return finalizeClassification("PO", scores.PO, "automatic", breakdown);
  }
  if (isBusinessDocument && scores.PO > 0 && scores.ARTWORK > 0) {
    return finalizeClassification("REFERENCE", Math.max(scores.REFERENCE, 64), "automatic", breakdown);
  }
  if (scores.PO >= 60 && scores.PO >= scores.ARTWORK) {
    return finalizeClassification("PO", scores.PO, "automatic", breakdown);
  }
  if (scores.REFERENCE >= 55 || (isBusinessDocument && scores.PO > 0 && scores.ARTWORK > 0)) {
    return finalizeClassification("REFERENCE", Math.max(scores.REFERENCE, 64), "automatic", breakdown);
  }
  if (scores.ARTWORK >= 55) {
    return finalizeClassification("ARTWORK", scores.ARTWORK, "automatic", breakdown);
  }
  if (scores.PO >= 50) {
    return finalizeClassification("PO", scores.PO, "automatic", breakdown);
  }
  return finalizeClassification("OTHER", Math.max(35, scores.OTHER), "automatic", breakdown);
}

function finalizeClassification(
  classification: InboundAttachmentClassification,
  rawConfidence: number,
  source: InboundAttachmentClassificationSource,
  breakdown: InboundAttachmentClassificationBreakdown,
): InboundAttachmentClassificationResult {
  const confidence = Math.max(0, Math.min(99, Math.round(rawConfidence)));
  const reasons = [
    ...breakdown.manual,
    ...breakdown.filename,
    ...breakdown.content,
    ...breakdown.metadata,
  ].slice(0, 5);
  return {
    classification,
    confidence,
    reasons: reasons.length > 0 ? reasons : ["No strong deterministic classification signals."],
    source,
    breakdown,
  };
}

export function inboundAttachmentClassificationToRole(
  classification: InboundAttachmentClassification,
): "artwork" | "po" | "reference" | "other" {
  if (classification === "ARTWORK") return "artwork";
  if (classification === "PO") return "po";
  if (classification === "REFERENCE") return "reference";
  return "other";
}

export function inboundAttachmentRoleToClassification(role: string | null | undefined): InboundAttachmentClassification {
  if (role === "artwork") return "ARTWORK";
  if (role === "po") return "PO";
  if (role === "reference") return "REFERENCE";
  return "OTHER";
}
