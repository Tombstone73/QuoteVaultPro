import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lt, lte, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import { inboundEmailProcessingJobs, organizations, type InboundOrderRecord, type InboundOrderReviewSnapshot } from "@shared/schema";
import { resolveInboundEmailIntakeSettingsFromPreferences } from "@shared/inboundEmailIntakeSettings";
import { eligibleForAutomaticInboundDraft, INBOUND_EMAIL_LEASE_MS, INBOUND_EMAIL_MAX_ATTEMPTS, inboundEmailRetryDelayMs, type InboundEmailProcessingClaim, type InboundEmailProcessingView } from "@shared/inboundEmailProcessing";
import { evidenceFingerprintFromSnapshot, InboundEvidenceConflictError } from "../services/inboundOrders/inboundEmailEvidenceFingerprint";
import { inboundEmailProcessingOrganizations, isInboundEmailProcessingEnabled } from "../services/inboundOrders/inboundEmailProcessingConfig";

export type InboundEmailProcessingJob = typeof inboundEmailProcessingJobs.$inferSelect;
const active = ["waiting", "processing"] as const;

/** Called ONLY with the existing tenant evidence lock held. Import completion
 * and evidence changes commit their durable outbox work in the same transaction.
 * A prior job is the durable opt-in marker; this never scans/backfills mailboxes. */
export async function synchronizeInboundEmailProcessing(tx: any, args: {
  record: InboundOrderRecord; fingerprint: string; draft: InboundOrderReviewSnapshot | null;
  importedByUserId?: string;
}) {
  const { record, fingerprint, draft } = args;
  if (record.sourceType !== "email") return;
  const scope = and(eq(inboundEmailProcessingJobs.organizationId, record.organizationId), eq(inboundEmailProcessingJobs.inboundRecordId, record.id));
  const [prior] = await tx.select().from(inboundEmailProcessingJobs).where(scope).limit(1);
  if (!prior && !args.importedByUserId) return;
  const eligible = eligibleForAutomaticInboundDraft(record);
  await tx.update(inboundEmailProcessingJobs).set({ status: "superseded", claimToken: null, claimExpiresAt: null, updatedAt: new Date() }).where(and(
    scope, inArray(inboundEmailProcessingJobs.status, [...active]),
    ...(eligible ? [ne(inboundEmailProcessingJobs.evidenceFingerprint, fingerprint)] : []),
  ));
  if (!eligible) return;
  const status = draft ? evidenceFingerprintFromSnapshot(draft) === fingerprint ? "review_ready" : "needs_attention" : "waiting";
  const values = { organizationId: record.organizationId, inboundRecordId: record.id, evidenceFingerprint: fingerprint,
    actorUserId: args.importedByUserId ?? prior?.actorUserId ?? null, status,
    errorCode: draft && status === "needs_attention" ? "STAFF_REFRESH_REQUIRED" : null,
    message: draft && status === "needs_attention" ? "Evidence changed. Staff edits are preserved; parse and deliberately refresh/reconcile the existing draft." : null };
  await tx.insert(inboundEmailProcessingJobs).values(values).onConflictDoNothing({ target: [inboundEmailProcessingJobs.organizationId, inboundEmailProcessingJobs.inboundRecordId, inboundEmailProcessingJobs.evidenceFingerprint] });
  // Returning to an earlier evidence identity must not strand its superseded job.
  await tx.update(inboundEmailProcessingJobs).set({ ...values, attempts: 0, nextAttemptAt: new Date(), updatedAt: new Date() }).where(and(scope,
    eq(inboundEmailProcessingJobs.evidenceFingerprint, fingerprint), eq(inboundEmailProcessingJobs.status, "superseded")));
  // A worker can die after the canonical draft committed but before its job
  // completion did. Never offer a destructive retry over that existing draft.
  if (draft) await tx.update(inboundEmailProcessingJobs).set({ status: "needs_attention", errorCode: "EXISTING_DRAFT_RETAINED",
    message: "An editable draft is already available. Continue with the existing review controls; staff edits are retained.", updatedAt: new Date() }).where(and(scope,
    eq(inboundEmailProcessingJobs.evidenceFingerprint, fingerprint), eq(inboundEmailProcessingJobs.status, "failed")));
}

/** Fences late/abandoned workers at the SAME transaction boundary as evidence
 * and review writes. Lease heartbeats and claim SQL alone are not sufficient. */
export async function assertInboundEmailProcessingClaim(tx: any, organizationId: string, inboundRecordId: string, claim: InboundEmailProcessingClaim) {
  if (!isInboundEmailProcessingEnabled(organizationId)) throw new InboundEvidenceConflictError("Automatic draft preparation is paused.");
  const [organization] = await tx.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization || !resolveInboundEmailIntakeSettingsFromPreferences((organization.settings as any)?.preferences).inboundEmailIntakeEnabled) throw new InboundEvidenceConflictError("Inbound email intake is disabled for this organization.");
  const [job] = await tx.select().from(inboundEmailProcessingJobs).where(and(
    eq(inboundEmailProcessingJobs.id, claim.jobId), eq(inboundEmailProcessingJobs.organizationId, organizationId),
    eq(inboundEmailProcessingJobs.inboundRecordId, inboundRecordId), eq(inboundEmailProcessingJobs.evidenceFingerprint, claim.evidenceFingerprint),
    eq(inboundEmailProcessingJobs.status, "processing"), eq(inboundEmailProcessingJobs.claimToken, claim.claimToken),
    sql`${inboundEmailProcessingJobs.claimExpiresAt} > now()`,
  )).for("update").limit(1);
  if (!job) throw new InboundEvidenceConflictError("Automatic processing claim expired or was superseded. Current evidence and staff edits are retained.");
}

export class InboundEmailProcessingRepository {
  constructor(private readonly database = db) {}

  async claim(): Promise<InboundEmailProcessingJob | null> {
    const organizations = inboundEmailProcessingOrganizations();
    if (!isInboundEmailProcessingEnabled() || !organizations.length) return null;
    return this.database.transaction(async tx => {
      const permitted = inArray(inboundEmailProcessingJobs.organizationId, organizations);
      await tx.update(inboundEmailProcessingJobs).set({ status: "failed", claimToken: null, claimExpiresAt: null,
        errorCode: "ABANDONED_CLAIM_LIMIT", message: "Worker stopped repeatedly. Review the record and retry draft preparation.", updatedAt: new Date() }).where(and(
        permitted, eq(inboundEmailProcessingJobs.status, "processing"), lte(inboundEmailProcessingJobs.claimExpiresAt, sql`now()`),
        sql`${inboundEmailProcessingJobs.attempts} >= ${INBOUND_EMAIL_MAX_ATTEMPTS}`,
      ));
      const [job] = await tx.select().from(inboundEmailProcessingJobs).where(and(permitted,
        lt(inboundEmailProcessingJobs.attempts, INBOUND_EMAIL_MAX_ATTEMPTS),
        or(and(eq(inboundEmailProcessingJobs.status, "waiting"), lte(inboundEmailProcessingJobs.nextAttemptAt, sql`now()`)),
          and(eq(inboundEmailProcessingJobs.status, "processing"), lte(inboundEmailProcessingJobs.claimExpiresAt, sql`now()`))),
      )).orderBy(asc(inboundEmailProcessingJobs.nextAttemptAt), asc(inboundEmailProcessingJobs.id)).for("update", { skipLocked: true }).limit(1);
      if (!job) return null;
      const [claimed] = await tx.update(inboundEmailProcessingJobs).set({ status: "processing", attempts: job.attempts + 1,
        claimToken: randomUUID(), claimExpiresAt: sql`now() + ${INBOUND_EMAIL_LEASE_MS} * interval '1 millisecond'`, updatedAt: new Date(),
      }).where(and(eq(inboundEmailProcessingJobs.id, job.id), permitted)).returning();
      return claimed ?? null;
    });
  }

  private owned(job: InboundEmailProcessingJob) {
    return and(eq(inboundEmailProcessingJobs.organizationId, job.organizationId), eq(inboundEmailProcessingJobs.id, job.id),
      eq(inboundEmailProcessingJobs.status, "processing"), eq(inboundEmailProcessingJobs.claimToken, job.claimToken!), sql`${inboundEmailProcessingJobs.claimExpiresAt} > now()`);
  }
  async heartbeat(job: InboundEmailProcessingJob): Promise<boolean> {
    if (!isInboundEmailProcessingEnabled(job.organizationId)) return false;
    const changed = await this.database.update(inboundEmailProcessingJobs).set({ claimExpiresAt: sql`now() + ${INBOUND_EMAIL_LEASE_MS} * interval '1 millisecond'`, updatedAt: new Date() }).where(this.owned(job)).returning({ id: inboundEmailProcessingJobs.id });
    return changed.length > 0;
  }
  async finish(job: InboundEmailProcessingJob, status: "review_ready" | "needs_attention" | "superseded", errorCode: string | null = null, message: string | null = null) {
    return this.database.update(inboundEmailProcessingJobs).set({ status, claimToken: null, claimExpiresAt: null, errorCode, message, updatedAt: new Date() }).where(this.owned(job)).returning({ id: inboundEmailProcessingJobs.id });
  }
  async fail(job: InboundEmailProcessingJob, code = "AI_DRAFT_PREPARATION_FAILED") {
    const terminal = job.attempts >= INBOUND_EMAIL_MAX_ATTEMPTS;
    const reason: Record<string, string> = {
      AI_PROVIDER_UNAVAILABLE: "No AI provider is configured for this tenant. Check AI settings.",
      AI_PARSE_FAILED: "AI did not produce a usable draft. Review the existing parse diagnostics and source evidence.",
      IMPORT_ACTOR_UNAVAILABLE: "The importing staff account is unavailable. Retry as an authorized employee.",
      INBOUND_INTAKE_DISABLED: "Inbound email intake is disabled for this organization. Enable it before retrying.",
    };
    const message = reason[code] ?? "Draft preparation or persistence could not complete. Source evidence is retained.";
    return this.database.update(inboundEmailProcessingJobs).set({ status: terminal ? "failed" : "waiting", claimToken: null, claimExpiresAt: null,
      nextAttemptAt: sql`now() + ${inboundEmailRetryDelayMs(job.attempts)} * interval '1 millisecond'`, errorCode: code,
      message: `${message} ${terminal ? "Automatic retries stopped after three attempts. Review and retry when resolved." : "A bounded retry is scheduled."}`, updatedAt: new Date(),
    }).where(this.owned(job)).returning({ id: inboundEmailProcessingJobs.id });
  }
  async view(organizationId: string, inboundRecordId: string, fingerprint: string): Promise<InboundEmailProcessingView> {
    const [job] = await this.database.select().from(inboundEmailProcessingJobs).where(and(eq(inboundEmailProcessingJobs.organizationId, organizationId),
      eq(inboundEmailProcessingJobs.inboundRecordId, inboundRecordId), eq(inboundEmailProcessingJobs.evidenceFingerprint, fingerprint))).limit(1);
    return { enabled: isInboundEmailProcessingEnabled(organizationId), job: job ? { id: job.id, status: job.status, attempts: job.attempts,
      nextAttemptAt: job.nextAttemptAt.toISOString(), errorCode: job.errorCode, message: job.message, canRetry: job.status === "failed" } : null };
  }
}
export const inboundEmailProcessingRepository = new InboundEmailProcessingRepository();
