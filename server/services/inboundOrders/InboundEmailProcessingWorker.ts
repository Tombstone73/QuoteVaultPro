import { eligibleForAutomaticInboundDraft, INBOUND_EMAIL_LEASE_MS } from "@shared/inboundEmailProcessing";
import { inboundEmailProcessingRepository, type InboundEmailProcessingJob } from "../../storage/inboundEmailProcessing.repo";
import { inboundOrdersRepository } from "../../storage/inboundOrders.repo";
import { inboundOrderParsingService } from "./InboundOrderParsingService";
import { inboundOrderService } from "./InboundOrderService";
import { evidenceFingerprintFromAttempt, evidenceFingerprintFromSnapshot, InboundEvidenceConflictError } from "./inboundEmailEvidenceFingerprint";
import { isInboundEmailProcessingEnabled } from "./inboundEmailProcessingConfig";
import { inboundEmailIntakeSettingsService } from "../inboundEmailIntakeSettingsService";

/** At-least-once technical work, idempotent draft initialization. No Order,
 * quote, acknowledgement, label/read change, or refresh operation is exposed. */
export class InboundEmailProcessingWorker {
  private running = false;
  constructor(
    private readonly queue = inboundEmailProcessingRepository,
    private readonly records = inboundOrdersRepository,
    private readonly parser = inboundOrderParsingService,
    private readonly reviews = inboundOrderService,
    private readonly settings = inboundEmailIntakeSettingsService,
  ) {}

  async runOnce(limit = 3): Promise<{ processed: number }> {
    if (this.running || !isInboundEmailProcessingEnabled()) return { processed: 0 };
    this.running = true;
    let processed = 0;
    try {
      for (; processed < Math.max(1, Math.min(limit, 10)); processed++) {
        if (!isInboundEmailProcessingEnabled()) break;
        const job = await this.queue.claim();
        if (!job) break;
        await this.process(job);
      }
      return { processed };
    } finally { this.running = false; }
  }

  private async process(job: InboundEmailProcessingJob) {
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      void this.queue.heartbeat(job).then(owned => { if (!owned) leaseLost = true; }).catch(() => { leaseLost = true; });
    }, Math.floor(INBOUND_EMAIL_LEASE_MS / 3));
    heartbeat.unref?.();
    const identity = { organizationId: job.organizationId, inboundRecordId: job.inboundRecordId };
    const automaticProcessing = { jobId: job.id, claimToken: job.claimToken!, evidenceFingerprint: job.evidenceFingerprint };
    try {
      if (!isInboundEmailProcessingEnabled(job.organizationId)) return;
      if (!(await this.settings.getSettings(job.organizationId)).inboundEmailIntakeEnabled) { await this.queue.fail(job, "INBOUND_INTAKE_DISABLED"); return; }
      const state = await this.records.getEvidenceState(job.organizationId, job.inboundRecordId);
      if (!eligibleForAutomaticInboundDraft(state.record) || state.fingerprint !== job.evidenceFingerprint) {
        await this.queue.finish(job, "superseded"); return;
      }
      const existing = (await this.records.listReviewSnapshots(job.organizationId, job.inboundRecordId))
        .find(snapshot => (snapshot.payloadJson as any)?.metadata?.snapshotKind === "editable_review_draft");
      if (existing) {
        const current = evidenceFingerprintFromSnapshot(existing) === state.fingerprint;
        await this.queue.finish(job, current ? "review_ready" : "needs_attention", current ? null : "STAFF_REFRESH_REQUIRED",
          current ? "Existing editable draft retained for staff review." : "Evidence changed. Staff edits are retained; deliberately refresh/reconcile the existing draft.");
        return;
      }
      if (!job.actorUserId) { await this.queue.fail(job, "IMPORT_ACTOR_UNAVAILABLE"); return; }
      // A crash between tracked parse persistence and draft initialization
      // does not require another AI call for the same evidence.
      const previous = await this.parser.getDraftPreview(identity);
      const reusable = previous.draft && evidenceFingerprintFromAttempt(previous.latestAttempt) === state.fingerprint;
      const result = reusable ? previous : await this.parser.parseInboundOrderRecord({ ...identity, actorUserId: job.actorUserId, automaticProcessing });
      if (!result.draft || !result.latestAttempt) {
        const codes = result.latestAttempt?.errors?.map(error => String(error.code ?? "")) ?? [];
        await this.queue.fail(job, codes.includes("provider_unavailable") ? "AI_PROVIDER_UNAVAILABLE" : "AI_PARSE_FAILED"); return;
      }
      if (leaseLost || !isInboundEmailProcessingEnabled(job.organizationId)) return;
      const review = await this.reviews.getReviewDraft({ ...identity, actorUserId: job.actorUserId, sourceParseAttemptId: result.latestAttempt.id, automaticProcessing });
      const needsAttention = review.evidenceReviewRequired || review.validationErrors.length > 0 || result.draft.missingDecisions.length > 0
        || result.draft.globalWarnings.length > 0 || result.draft.lineItems.length === 0;
      await this.queue.finish(job, needsAttention ? "needs_attention" : "review_ready", needsAttention ? "STAFF_REVIEW_REQUIRED" : null,
        needsAttention ? "An editable draft is available. Review uncertainty, missing information, duplicate/revision warnings and source evidence before approval." : "Editable draft prepared. Staff approval is still required; no Order has been created.");
    } catch (error) {
      if (error instanceof InboundEvidenceConflictError) {
        await this.queue.finish(job, "needs_attention", "EVIDENCE_OR_DRAFT_CHANGED", "Evidence, draft, or work ownership changed. Staff edits and current evidence are retained; review before retrying.");
      } else {
        await this.queue.fail(job);
        console.warn("[InboundEmailDraftWorker] Preparation failed", { organizationId: job.organizationId, jobId: job.id, code: "AI_DRAFT_PREPARATION_FAILED" });
      }
    } finally { clearInterval(heartbeat); }
  }
}
export const inboundEmailProcessingWorker = new InboundEmailProcessingWorker();
