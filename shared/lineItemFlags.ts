export type LineItemFlagTone = "neutral" | "warning" | "danger" | "success";
export type LineItemFlagOnClick = "expand_notes" | "expand_artwork" | null;

export type LineItemFlagVM = {
  key: string;
  label: string;
  tone: LineItemFlagTone;
  tooltip?: string;
  onClick?: LineItemFlagOnClick;
};

export type LineItemFlagSuppression = {
  reason: string;
  at: string; // ISO string
  byUserId?: string;
};

type ArtworkPolicy = "not_required" | "required";

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isSuppressed(lineItem: unknown, flagKey: string): boolean {
  const specs = (lineItem as any)?.specsJson;
  const suppressed = specs?.flags?.suppressed;
  if (!suppressed || typeof suppressed !== "object") return false;
  const entry = (suppressed as any)?.[flagKey];
  if (!entry || typeof entry !== "object") return false;
  const reason = safeString((entry as any)?.reason);
  const at = safeString((entry as any)?.at);
  return Boolean(reason && at);
}

function hasGenerationFailure(items: unknown[]): boolean {
  for (const it of items) {
    const thumbStatus = safeString((it as any)?.thumbStatus).toLowerCase();
    const thumbError = safeString((it as any)?.thumbError);
    const previewStatus = safeString((it as any)?.previewStatus).toLowerCase();
    const previewError = safeString((it as any)?.previewError);

    if (thumbStatus === "thumb_failed" || thumbStatus === "failed") return true;
    if (previewStatus === "failed") return true;
    if (thumbError) return true;
    if (previewError) return true;
  }
  return false;
}

export function deriveLineItemFlags(
  lineItem: unknown,
  ctx?: {
    notesText?: string;
    productArtworkPolicy?: ArtworkPolicy | null;
    artwork?: {
      lineItemAttachments?: { associationKnown: boolean; count?: number; items?: unknown[] };
      lineItemAssets?: { associationKnown: boolean; count?: number; items?: unknown[] };
    };
  }
): LineItemFlagVM[] {
  const flags: LineItemFlagVM[] = [];

  const notesText = safeString(ctx?.notesText ?? (lineItem as any)?.specsJson?.lineItemNotes?.descLong ?? "");
  if (notesText.length > 0) {
    flags.push({
      key: "notes",
      label: "NOTES",
      tone: "neutral",
      tooltip: notesText,
      onClick: "expand_notes",
    });
  }

  const artworkPolicy = ctx?.productArtworkPolicy ?? null;
  const attachments = ctx?.artwork?.lineItemAttachments;
  const assets = ctx?.artwork?.lineItemAssets;

  const attachmentsKnown = attachments?.associationKnown === true;
  const assetsKnown = assets?.associationKnown === true;

  if (artworkPolicy === "required") {
    // Only render missing_artwork when we can reliably determine line-item-scoped artwork presence.
    if (attachmentsKnown && assetsKnown) {
      const attachmentCount = Number(attachments?.count ?? (attachments?.items?.length ?? 0)) || 0;
      const assetCount = Number(assets?.count ?? (assets?.items?.length ?? 0)) || 0;
      const hasAnyArtwork = attachmentCount > 0 || assetCount > 0;

      if (!hasAnyArtwork && !isSuppressed(lineItem, "missing_artwork")) {
        flags.unshift({
          key: "missing_artwork",
          label: "Missing artwork",
          tone: "warning",
          tooltip: "Artwork required but none attached",
          onClick: null,
        });
      }
    }
  }

  // generation_failed: only when we can inspect per-line-item artwork items.
  // If the payload doesn't include status/error fields, omit (do not guess).
  if (!isSuppressed(lineItem, "generation_failed")) {
    const attachmentItems = Array.isArray(attachments?.items) ? attachments!.items! : null;
    const assetItems = Array.isArray(assets?.items) ? assets!.items! : null;

    const canInspect = Boolean(attachmentItems?.length || assetItems?.length);
    if (canInspect) {
      const failed =
        (attachmentItems ? hasGenerationFailure(attachmentItems) : false) ||
        (assetItems ? hasGenerationFailure(assetItems) : false);

      if (failed) {
        flags.unshift({
          key: "generation_failed",
          label: "Generation failed",
          tone: "danger",
          tooltip: "Thumbnail generation failed — see artwork list",
          onClick: null,
        });
      }
    }
  }

  return flags;
}
