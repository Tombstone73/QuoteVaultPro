import "dotenv/config";
import { previewHistoricalCloseJobProductionRepair, applyHistoricalCloseJobProductionRepair } from "../server/services/historicalCloseJobProductionRepairService";

async function main() {
  const organizationId = process.env.ORGANIZATION_ID?.trim();
  const orderId = process.env.ORDER_ID?.trim();
  const apply = process.argv.includes("--apply");
  if (!organizationId || !orderId) throw new Error("ORGANIZATION_ID and ORDER_ID (UUID) are required. Public order numbers are not accepted.");
  const result = apply
    ? await applyHistoricalCloseJobProductionRepair({ organizationId, orderId })
    : await previewHistoricalCloseJobProductionRepair({ organizationId, orderId });
  console.log(JSON.stringify({ mode: apply ? "apply" : "preview", result }, null, 2));
}

main().catch((error) => { console.error("[historical-close-job-production-repair]", error); process.exit(1); });
