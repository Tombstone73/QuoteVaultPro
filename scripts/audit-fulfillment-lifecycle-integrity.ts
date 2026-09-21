import "dotenv/config";

import { db } from "../server/db";
import { FulfillmentDashboardRepo } from "../server/services/fulfillment/repository";

async function main() {
  const organizationId = process.env.ORGANIZATION_ID?.trim();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for this read-only audit.");
  if (!organizationId) throw new Error("ORGANIZATION_ID is required for this read-only audit.");

  const audit = await new FulfillmentDashboardRepo(db).auditFulfillmentLifecycleIntegrity(organizationId);
  console.log(JSON.stringify(audit, null, 2));
}

main().catch((error) => {
  console.error("[audit-fulfillment-lifecycle-integrity]", error);
  process.exit(1);
});
