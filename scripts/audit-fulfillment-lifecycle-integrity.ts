import "dotenv/config";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../shared/schema";
import { FulfillmentDashboardRepo } from "../server/services/fulfillment/repository";
import { buildFulfillmentIntegrityTargetSummary } from "../server/services/fulfillment/integrityAuditDiagnostics";

async function main() {
  const organizationId = process.env.ORGANIZATION_ID?.trim();
  const orderNumber = process.env.ORDER_NUMBER?.trim();
  const apply = process.argv.includes("--apply");
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for this read-only audit.");
  if (!organizationId) throw new Error("ORGANIZATION_ID is required for this read-only audit.");

  // Railway shell audits use the native pg transport. Do not import server/db
  // here: its serverless WebSocket client previously produced a different read
  // view than the runtime's native pg connection, yielding false zero audits.
  const pool = new Pool({ connectionString: databaseUrl });
  const auditDb = drizzle({ client: pool, schema });
  try {
    const [scope] = await auditDb.select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      slug: schema.organizations.slug,
    }).from(schema.organizations).where(eq(schema.organizations.id, organizationId)).limit(1);
    if (!scope) throw new Error(`Organization ${organizationId} was not found in the configured database.`);

    const repository = new FulfillmentDashboardRepo(auditDb as unknown as typeof import("../server/db").db);
    const [audit, diagnostic] = await Promise.all([
      repository.auditFulfillmentLifecycleIntegrity(organizationId),
      orderNumber ? repository.getFulfillmentLifecycleDiagnostic(organizationId, orderNumber) : Promise.resolve(null),
    ]);
    const target = orderNumber
      ? buildFulfillmentIntegrityTargetSummary({ requestedOrderNumber: orderNumber, diagnostic, audit })
      : null;
    const candidates = target?.found
      ? audit.legacyCloseJobOverrideCandidates.filter((candidate) => candidate.order.id === target.orderId)
      : audit.legacyCloseJobOverrideCandidates;

    // Preview is the default and performs reads only. Apply mode is deliberately
    // explicit and only considers candidates proven by the paired legacy event
    // and audit record; a rerun sees 0212 evidence and becomes a no-op.
    const applied = apply
      ? await Promise.all(candidates.map((candidate) => repository.backfillProvenLegacyCloseJobOverride(organizationId, candidate.order.id)))
      : [];
    console.log(JSON.stringify({
      mode: apply ? "apply" : "preview",
      scope: {
        organizationId: scope.id,
        organizationName: scope.name,
        organizationSlug: scope.slug,
        tenantId: null,
        companyId: null,
      },
      counts: {
        baseOrders: audit.baseOrderCount,
        distinctActiveFulfillmentOrders: audit.distinctActiveFulfillmentOrders,
        underlyingActiveProjectionRows: audit.underlyingActiveRows,
        terminalWithRemaining: audit.terminalWithRemaining.length,
        terminalReturnedByActiveFulfillment: audit.terminalReturnedByActiveFulfillment.length,
        administrativeClosureWithRemaining: audit.administrativeClosureWithRemaining.length,
        provenLegacyCloseJobCandidates: audit.legacyCloseJobOverrideCandidates.length,
        manualReviewCandidates: audit.manualReviewCandidates.length,
        duplicateActiveOrderIds: audit.duplicateActiveOrderIds.length,
      },
      target,
      audit,
      proposedLegacyBackfill: candidates,
      applied,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[audit-fulfillment-lifecycle-integrity]", error);
  process.exit(1);
});
