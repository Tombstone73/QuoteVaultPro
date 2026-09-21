import "dotenv/config";

import { db } from "../server/db";
import { FulfillmentDashboardRepo } from "../server/services/fulfillment/repository";

async function main() {
  const organizationId = process.env.ORGANIZATION_ID?.trim();
  const orderNumber = process.env.ORDER_NUMBER?.trim();
  const apply = process.argv.includes("--apply");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for this read-only audit.");
  if (!organizationId) throw new Error("ORGANIZATION_ID is required for this read-only audit.");

  const repository = new FulfillmentDashboardRepo(db);
  const audit = await repository.auditFulfillmentLifecycleIntegrity(organizationId);
  const diagnostic = orderNumber ? await repository.getFulfillmentLifecycleDiagnostic(organizationId, orderNumber) : null;
  const candidates = orderNumber
    ? audit.legacyCloseJobOverrideCandidates.filter((candidate) => String(candidate.order.orderNumber) === orderNumber)
    : audit.legacyCloseJobOverrideCandidates;

  // Preview is the default and performs reads only. Apply mode is deliberately
  // explicit and only considers candidates proven by the paired legacy event
  // and audit record; a rerun sees 0212 evidence and becomes a no-op.
  const applied = apply
    ? await Promise.all(candidates.map((candidate) => repository.backfillProvenLegacyCloseJobOverride(organizationId, candidate.order.id)))
    : [];
  console.log(JSON.stringify({
    mode: apply ? "apply" : "preview",
    audit,
    diagnostic,
    proposedLegacyBackfill: candidates,
    applied,
  }, null, 2));
}

main().catch((error) => {
  console.error("[audit-fulfillment-lifecycle-integrity]", error);
  process.exit(1);
});
