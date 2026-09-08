import type { AiCommandHandler } from "../../src/modules/ai/assistantApplication.js";
import type { AiExecutionContext, AiPreparedCommand } from "../../src/modules/ai/contracts.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { ArtworkApplicationService } from "../../src/modules/artwork/artworkApplication.js";

type ArtworkPurpose = "customer_supplied" | "production" | "proof" | "reference";
type ArtworkSide = "front" | "back";

/**
 * This command deliberately accepts only canonical identifiers and assignment
 * metadata.  It never accepts bytes, storage keys, URLs, object references,
 * filenames, or a generated-file payload.
 */
type AssignExistingArtworkInput = Readonly<{
  artworkFileId: string;
  orderId: string;
  orderLineId: string;
  purpose: ArtworkPurpose;
  side?: ArtworkSide;
  sourcePageIndex?: number;
  layerKey?: string;
  layerOrder?: number;
}>;

const text = (value: unknown, maximum: number): string | undefined =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum
    ? value.trim()
    : undefined;

const parse = (raw: unknown): AssignExistingArtworkInput => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new V2ApplicationError("VALIDATION_ERROR", "An exact existing Artwork file and Order line are required.");

  const value = raw as Record<string, unknown>;
  const supported = new Set(["artworkFileId", "orderId", "orderLineId", "purpose", "side", "sourcePageIndex", "layerKey", "layerOrder"]);
  if (Object.keys(value).some((key) => !supported.has(key)))
    throw new V2ApplicationError("VALIDATION_ERROR", "Artwork assignment accepts identifiers and assignment metadata only.");

  const artworkFileId = text(value.artworkFileId, 128);
  const orderId = text(value.orderId, 128);
  const orderLineId = text(value.orderLineId, 128);
  const purpose = ["customer_supplied", "production", "proof", "reference"].includes(String(value.purpose))
    ? value.purpose as ArtworkPurpose
    : undefined;
  const side = value.side === undefined ? undefined : value.side === "front" || value.side === "back" ? value.side : undefined;
  const sourcePageIndex = typeof value.sourcePageIndex === "number" ? value.sourcePageIndex : undefined;
  const layerKey = value.layerKey === undefined ? undefined : text(value.layerKey, 128);
  const layerOrder = typeof value.layerOrder === "number" ? value.layerOrder : undefined;

  if (!artworkFileId || !orderId || !orderLineId || !purpose || (value.side !== undefined && !side)
    || (sourcePageIndex !== undefined && (!Number.isInteger(sourcePageIndex) || sourcePageIndex < 0))
    || (value.layerKey !== undefined && !layerKey)
    || (layerOrder !== undefined && (!Number.isInteger(layerOrder) || layerOrder < 0))
    || (layerKey === undefined) !== (layerOrder === undefined))
    throw new V2ApplicationError("VALIDATION_ERROR", "Artwork assignment identifiers or metadata are invalid.");

  return Object.freeze({ artworkFileId, orderId, orderLineId, purpose, ...(side ? { side } : {}), ...(sourcePageIndex !== undefined ? { sourcePageIndex } : {}), ...(layerKey !== undefined ? { layerKey, layerOrder: layerOrder! } : {}) });
};

const preparationContext = (context: AiExecutionContext) => ({
  principal: context.user,
  organizationId: context.organizationId,
  operationId: `ai:prepare:artwork.assign:${context.requestId}`,
});

const executionContext = (context: Parameters<AiCommandHandler["execute"]>[0]) => ({
  principal: context.delegatedPrincipal,
  organizationId: context.organizationId,
  operationId: `ai:artwork.assign:${context.businessRequestId}`,
  businessRequest: { id: context.businessRequestId, payloadFingerprint: "ai:artwork.assign:canonical-request" },
});

const proposal = (input: AssignExistingArtworkInput, filename: string): string =>
  `Assign existing Artwork\n\nArtwork: ${filename}\nArtwork file: ${input.artworkFileId}\nOrder: ${input.orderId}\nLine: ${input.orderLineId}\nPurpose: ${input.purpose}${input.side ? `\nSide: ${input.side}` : ""}${input.sourcePageIndex !== undefined ? `\nSource page: ${input.sourcePageIndex}` : ""}${input.layerKey ? `\nLayer: ${input.layerKey} (${input.layerOrder})` : ""}\n\nNo changes have been made yet.`;

/**
 * Binds the assistant only to the existing Artwork assignment service.  The
 * service owns tenant scope, Order/line integrity, idempotent operation
 * reservation, immutable assignment identity, attribution, and audit.
 */
export const artworkAssignExistingAiCommand = (artwork: ArtworkApplicationService): AiCommandHandler => ({
  name: "artwork.assign_existing",
  capability: "artwork.assign",
  prepare: async (context, raw): Promise<AiPreparedCommand> => {
    const input = parse(raw);
    const file = await artwork.readFile(preparationContext(context), input.artworkFileId as never);
    if (!file.ok) throw file.error;

    return {
      commandName: "artwork.assign_existing",
      capability: "artwork.assign",
      normalizedInput: input,
      proposal: proposal(input, file.value.displayFilename),
      expectedEntityReferences: [
        { type: "artwork_file", id: input.artworkFileId },
        { type: "order", id: input.orderId },
        { type: "order_line", id: input.orderLineId },
      ],
      expiresAt: new Date(Date.now() + 5 * 60_000),
    };
  },
  execute: async (context, raw) => {
    const input = parse(raw);
    const saved = await artwork.assign(executionContext(context), {
      ...input,
      businessRequestId: context.businessRequestId,
    } as never);
    if (!saved.ok) throw saved.error;
    return saved.value;
  },
});
