import { z } from "zod";
import {
  applyProductDraftIntentPatch,
  productDraftIntentFingerprint,
  productDraftIntentPatchSchema,
  productDraftIntentSchema,
  type ProductDraftIntent,
} from "@shared/productDraftIntent";

export const productIntentSessionStateSchema = z.enum([
  "compiling", "needs_resolution", "needs_answers", "ready_for_review",
  "awaiting_confirmation", "executed", "expired", "abandoned",
]);
export type ProductIntentSessionState = z.infer<typeof productIntentSessionStateSchema>;

const revisionSchema = z.object({
  revision: z.number().int().nonnegative(),
  intent: productDraftIntentSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
  reason: z.enum(["compiled", "answer", "correction", "server_resolution"]),
}).strict();

/** JSON-persistable envelope intended for existing session/proposal JSON columns.
 * It is append-only at the revision level; volatile timestamps are not part of
 * the fingerprint. */
export const productIntentSessionEnvelopeSchema = z.object({
  kind: z.literal("product_draft_intent_session"),
  version: z.literal(1),
  organizationId: z.string().min(1),
  sessionId: z.string().min(1),
  state: productIntentSessionStateSchema,
  currentRevision: z.number().int().nonnegative(),
  revisions: z.array(revisionSchema).min(1),
  confirmationRevision: z.number().int().nonnegative().nullable(),
  executedRevision: z.number().int().nonnegative().nullable(),
}).strict().superRefine((value, context) => {
  const current = value.revisions.at(-1);
  if (!current || current.revision !== value.currentRevision) context.addIssue({ code: z.ZodIssueCode.custom, message: "currentRevision must match the latest immutable revision", path: ["currentRevision"] });
  if (value.state === "executed" && value.executedRevision !== value.currentRevision) context.addIssue({ code: z.ZodIssueCode.custom, message: "executed sessions bind the current revision", path: ["executedRevision"] });
});
export type ProductIntentSessionEnvelope = z.infer<typeof productIntentSessionEnvelopeSchema>;

function deriveState(intent: ProductDraftIntent): ProductIntentSessionState { return intent.state; }

export function createProductIntentSession(input: { organizationId: string; sessionId: string; intent: ProductDraftIntent; now?: Date }): ProductIntentSessionEnvelope {
  const intent = productDraftIntentSchema.parse(input.intent);
  const createdAt = (input.now ?? new Date()).toISOString();
  return productIntentSessionEnvelopeSchema.parse({
    kind: "product_draft_intent_session", version: 1, organizationId: input.organizationId, sessionId: input.sessionId,
    state: deriveState(intent), currentRevision: intent.revision,
    revisions: [{ revision: intent.revision, intent, fingerprint: productDraftIntentFingerprint(intent), createdAt, reason: "compiled" }],
    confirmationRevision: null, executedRevision: null,
  });
}

export function currentProductIntent(envelope: ProductIntentSessionEnvelope): ProductDraftIntent {
  return envelope.revisions.at(-1)!.intent;
}

/** Applies an optimistic-concurrency patch and invalidates any older GO token by
 * clearing confirmationRevision. Executed sessions are immutable. */
export function applyProductIntentSessionPatch(input: { envelope: ProductIntentSessionEnvelope; patch: unknown; reason: "answer" | "correction" | "server_resolution"; now?: Date }): ProductIntentSessionEnvelope {
  const envelope = productIntentSessionEnvelopeSchema.parse(input.envelope);
  if (envelope.state === "executed") throw new Error("PRODUCT_INTENT_SESSION_EXECUTED");
  const patch = productDraftIntentPatchSchema.parse(input.patch);
  if (patch.baseRevision !== envelope.currentRevision) throw new Error("PRODUCT_INTENT_STALE_REVISION");
  const intent = applyProductDraftIntentPatch(currentProductIntent(envelope), patch);
  const revision = { revision: intent.revision, intent, fingerprint: productDraftIntentFingerprint(intent), createdAt: (input.now ?? new Date()).toISOString(), reason: input.reason } as const;
  return productIntentSessionEnvelopeSchema.parse({ ...envelope, state: deriveState(intent), currentRevision: intent.revision, revisions: [...envelope.revisions, revision], confirmationRevision: null });
}

export function bindProductIntentConfirmation(envelope: ProductIntentSessionEnvelope, expectedFingerprint: string): ProductIntentSessionEnvelope {
  const parsed = productIntentSessionEnvelopeSchema.parse(envelope);
  const current = parsed.revisions.at(-1)!;
  if (parsed.state !== "ready_for_review" || current.fingerprint !== expectedFingerprint) throw new Error("PRODUCT_INTENT_CONFIRMATION_STALE");
  return productIntentSessionEnvelopeSchema.parse({ ...parsed, state: "awaiting_confirmation", confirmationRevision: current.revision });
}

export function markProductIntentExecuted(envelope: ProductIntentSessionEnvelope, revision: number): ProductIntentSessionEnvelope {
  const parsed = productIntentSessionEnvelopeSchema.parse(envelope);
  if (parsed.state !== "awaiting_confirmation" || parsed.confirmationRevision !== revision || parsed.currentRevision !== revision) throw new Error("PRODUCT_INTENT_EXECUTION_STALE");
  return productIntentSessionEnvelopeSchema.parse({ ...parsed, state: "executed", executedRevision: revision });
}
