import type { PoolClient } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { ProductionDailyReportAttention, ProductionDailyReportScope } from "../../src/modules/production/productionDailyReport.js";
import { brandedId, type OrganizationId } from "../../src/modules/shared/commercialValues.js";
import { PostgresProductionReportFulfillmentRead } from "../fulfillment/productionReportFulfillmentRead.js";
import { PostgresProductionCompletionProjection } from "./postgresProductionCompletionProjection.js";
import type { ProductionDailyReportReadDependencies } from "./postgresProductionDailyReport.js";

export type ProductionReportCalendarRead = ProductionDailyReportReadDependencies["readReportingCalendar"];
type WorkContext = {
  id: string; order_document_id: string; order_line_id: string; requirement_key: string;
  replacement_obligation_id: string | null; rework_cycle_id: string | null;
  commercial_state: "open" | "completed" | "cancelled";
  authority_count: number; has_successor: boolean; lineage_blocked: boolean;
};

/** Operational composition, not Sales lifecycle reconciliation. No pool or
 * transaction is opened; all owner reads consume the supplied report snapshot.
 * P0 original-only predicates in BOTH completion projections are a mandatory
 * integration prerequisite; this package deliberately does not duplicate them.
 */
export const readProductionReportOperationalAttention = async (
  client: Pick<PoolClient, "query">,
  organizationId: OrganizationId,
  scopes: readonly ProductionDailyReportScope[],
): Promise<readonly ProductionDailyReportAttention[]> => {
  if (scopes.length > 1_000 || new Set(scopes.map(scope => scope.productionWorkId)).size !== scopes.length)
    throw new V2ApplicationError("CONFLICT", "Production report owner reads require at most 1000 distinct work identities.");
  if (!scopes.length) return [];
  const contexts = await client.query<WorkContext>(`
    SELECT w.id,w.order_document_id,w.order_line_id,w.requirement_key,w.replacement_obligation_id,w.rework_cycle_id,o.commercial_state,
      (SELECT count(*)::integer FROM v2_production_works peer WHERE peer.organization_id=w.organization_id AND peer.order_document_id=w.order_document_id AND peer.order_line_id=w.order_line_id AND peer.requirement_key=w.requirement_key AND peer.replacement_obligation_id IS NOT DISTINCT FROM w.replacement_obligation_id AND (w.replacement_obligation_id IS NOT NULL OR peer.rework_cycle_id IS NULL)) authority_count,
      EXISTS(SELECT 1 FROM v2_production_works successor WHERE successor.organization_id=w.organization_id AND successor.predecessor_production_work_id=w.id) has_successor,
      lineage.lineage_blocked
    FROM v2_production_works w
    JOIN v2_sales_order_details o ON o.organization_id=w.organization_id AND o.document_id=w.order_document_id
    LEFT JOIN LATERAL (
      WITH RECURSIVE ancestors AS (
        SELECT w.id,w.predecessor_production_work_id,w.replacement_obligation_id,ARRAY[w.id] path,0 depth WHERE w.rework_cycle_id IS NOT NULL
        UNION ALL
        SELECT predecessor.id,predecessor.predecessor_production_work_id,predecessor.replacement_obligation_id,ancestors.path||predecessor.id,ancestors.depth+1
        FROM ancestors JOIN v2_production_works predecessor ON predecessor.organization_id=w.organization_id AND predecessor.id=ancestors.predecessor_production_work_id
        WHERE ancestors.depth<64 AND NOT predecessor.id=ANY(ancestors.path)
      )
      SELECT COALESCE(bool_or(replacement_obligation_id IS NOT NULL AND replacement_obligation_id IS DISTINCT FROM w.replacement_obligation_id),false)
        OR COALESCE(bool_or(depth=64 OR predecessor_production_work_id=ANY(path)),false)
        OR (w.rework_cycle_id IS NOT NULL AND w.predecessor_production_work_id IS NULL) lineage_blocked FROM ancestors
    ) lineage ON TRUE
    WHERE w.organization_id=$1 AND w.id=ANY($2::varchar[])`, [organizationId, scopes.map(scope => scope.productionWorkId)]);
  const works = new Map(contexts.rows.map(row => [row.id, row]));
  const production = new PostgresProductionCompletionProjection(client);
  const fulfillment = new PostgresProductionReportFulfillmentRead(client);
  const originalReads = new Map<string, Promise<{ production: Awaited<ReturnType<typeof production.readCompletion>>; fulfillment: Awaited<ReturnType<typeof fulfillment.readOriginalCompletion>> }>>();
  const replacementReads = new Map<string, Promise<Awaited<ReturnType<typeof fulfillment.readReplacementState>>>>();
  const decisions: ProductionDailyReportAttention[] = [];
  for (const scope of scopes) {
    const work = works.get(scope.productionWorkId);
    const blocked = (reason: string): ProductionDailyReportAttention => ({ ...scope, state: "blocked", reason });
    if (!work || work.order_document_id !== scope.orderId || work.order_line_id !== scope.orderLineId || work.requirement_key !== scope.requirementKey || work.replacement_obligation_id !== (scope.replacementObligationId ?? null)) {
      decisions.push(blocked("Production cannot establish the exact work/Order/line/requirement/replacement identity.")); continue;
    }
    if (work.lineage_blocked) { decisions.push(blocked("BDR4: replacement rework lineage is unresolved; no original scope or inherited obligation is inferred.")); continue; }
    if (scope.replacementObligationId) {
      const key = JSON.stringify([scope.orderId, scope.orderLineId, scope.replacementObligationId]);
      if (!replacementReads.has(key)) replacementReads.set(key, fulfillment.readReplacementState(organizationId, { orderId: scope.orderId, orderLineId: scope.orderLineId, replacementObligationId: scope.replacementObligationId }));
      const state = await replacementReads.get(key)!;
      // An exact terminal Fulfillment fact needs no quantity-authority decision.
      // Unresolved lineage was blocked above and cannot acquire this precedence.
      decisions.push(state.state === "blocked" ? blocked(state.reason)
        : state.state === "fulfilled" || state.state === "cancelled" ? { ...scope, state: "operationally_complete" }
        : work.authority_count !== 1 ? blocked("BDR4: multiple or missing Production authorities exist for this scope; duplicate work is not aggregated.")
        : { ...scope, state: "requires_attention" });
      continue;
    }
    if (work.authority_count !== 1) { decisions.push(blocked("BDR4: multiple or missing Production authorities exist for this scope; duplicate work is not aggregated.")); continue; }
    // Consume Sales' terminal fact only for identity/lineage-resolved originals.
    // This is report exclusion, not a fabricated Fulfillment completion/quantity.
    if (work.commercial_state === "completed") { decisions.push({ ...scope, state: "operationally_complete" }); continue; }
    const key = JSON.stringify([scope.orderId, scope.orderLineId]);
    if (!originalReads.has(key)) originalReads.set(key, (async () => ({
      production: await production.readCompletion(organizationId, brandedId<"OrderLineId">(scope.orderLineId)),
      fulfillment: await fulfillment.readOriginalCompletion(organizationId, { orderId: scope.orderId, orderLineId: scope.orderLineId }),
    }))());
    const facts = await originalReads.get(key)!;
    if (facts.production.state === "blocked" || facts.fulfillment.state === "blocked") {
      decisions.push(blocked(facts.production.state === "blocked" ? facts.production.reason ?? "Production completion evidence is unavailable." : facts.fulfillment.reason ?? "Fulfillment completion evidence is unavailable.")); continue;
    }
    if ((work.rework_cycle_id || work.has_successor) && facts.production.state === "in_progress" && facts.production.completedUnitCount > 0) {
      decisions.push(blocked("BDR4: partially complete multi-unit rework has no requirement-specific owner completion evidence; successor aggregation is not inferred.")); continue;
    }
    decisions.push({ ...scope, state: facts.production.state === "complete" && facts.fulfillment.state === "complete" ? "operationally_complete" : "requires_attention" });
  }
  return decisions;
};

/** Parent supplies the reviewed Settings-owned clock after transfer. */
export const createProductionReportDependencies = (readReportingCalendar: ProductionReportCalendarRead): ProductionDailyReportReadDependencies => {
  if (typeof readReportingCalendar !== "function") throw new V2ApplicationError("INTERNAL_ERROR", "The Production report calendar dependency is unavailable.");
  return { readReportingCalendar, readOperationalAttention: readProductionReportOperationalAttention };
};
