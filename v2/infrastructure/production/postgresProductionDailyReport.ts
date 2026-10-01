import type { Pool, PoolClient } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import {
  normalizeProductionDailyReportRequest, productionDueCategory, summarizeProductionDailyReport, validateProductionCalendar,
  type ProductionCalendar, type ProductionDailyReport, type ProductionDailyReportAttention, type ProductionDailyReportBlockedWork, type ProductionDailyReportReadPort,
  type ProductionDailyReportRequest, type ProductionDailyReportRow, type ProductionDailyReportScope,
} from "../../src/modules/production/productionDailyReport.js";
import { brandedId, type OrganizationId } from "../../src/modules/shared/commercialValues.js";
import { PostgresProductionTransaction } from "./postgresProductionTransaction.js";

export type ProductionDailyReportReadDependencies = Readonly<{
  readReportingCalendar(client: Pick<PoolClient, "query">, organizationId: OrganizationId): Promise<ProductionCalendar>;
  /** Return exactly one identity-matching decision per supplied, lineage-resolved
   * work. Completion is operational, never contingent on payment settlement.
   * blocked requires a nonempty, staff-facing safe reason; do not infer succession
   * or copy whole-Order attention onto completed lines/independent replacements.
   * Both reads use this client/snapshot; no nested transaction, pool, or writes.
   */
  readOperationalAttention(client: Pick<PoolClient, "query">, organizationId: OrganizationId, scopes: readonly ProductionDailyReportScope[]): Promise<readonly ProductionDailyReportAttention[]>;
}>;
export const productionDailyReportCandidateLimit = 1_000;
type CandidateRow = {
  id: string; order_document_id: string; order_line_id: string; requirement_key: string;
  replacement_obligation_id: string | null; predecessor_production_work_id: string | null; rework_cycle_id: string | null;
  destination: "flatbed" | "roll" | null; due_date: string | null; order_number: string | null;
  customer_name: string | null; purchase_order_number: string | null; job_label: string | null; line_description: string | null;
  requested_fulfillment_method: "pickup" | "shipping" | "local_delivery" | null; active_attempt_id: string | null; lineage_blocked: boolean; station_conflict: boolean;
};
/** Same per-work usable-output predicate as the station queue. Frozen rework
 * and active execution stations outrank a mutable plan; new work follows the
 * destination precedence enforced by canonical startAttempt.
 * Original completion is scoped by the injected owner projection, not applied to
 * independent replacement works through the parent Order's commercial state.
 * Correlated reads cannot multiply works through attempts, Runs, or allocations.
 */
export const productionDailyReportCandidatesSql = `
  SELECT w.id,w.order_document_id,w.order_line_id,w.requirement_key,w.replacement_obligation_id,
    w.predecessor_production_work_id,w.rework_cycle_id,
    COALESCE(cycle.destination_station_key,active.station_key,step.production_destination_station_key,e.production_destination,origin_attempt.station_key) destination,
    to_char(d.requested_due_date,'YYYY-MM-DD') due_date,d.display_number order_number,
    COALESCE(NULLIF(btrim(c.display_name),''),NULLIF(btrim(c.company_name),'')) customer_name,
    d.purchase_order_number,to_jsonb(d)->>'job_label' job_label,l.description line_description,
    o.requested_fulfillment_method,lineage.lineage_blocked,
    active.id active_attempt_id,
    (cycle.destination_station_key IS NOT NULL AND active.station_key IS NOT NULL AND cycle.destination_station_key<>active.station_key) station_conflict
  FROM v2_production_works w
  JOIN v2_sales_order_details o ON o.organization_id=w.organization_id AND o.document_id=w.order_document_id AND o.commercial_state IN ('open','completed') AND o.archived_at IS NULL
  JOIN v2_sales_documents d ON d.organization_id=w.organization_id AND d.id=w.order_document_id AND d.document_kind='order'
  JOIN v2_sales_document_lines l ON l.organization_id=w.organization_id AND l.id=w.order_line_id AND l.document_id=w.order_document_id
  LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id
  LEFT JOIN v2_production_rework_cycles cycle ON cycle.organization_id=w.organization_id AND cycle.id=w.rework_cycle_id
  LEFT JOIN v2_production_attempts active ON active.organization_id=w.organization_id AND active.production_work_id=w.id AND active.completed_at IS NULL
  LEFT JOIN v2_sales_line_workflow_exceptions e ON e.organization_id=w.organization_id AND e.order_line_id=w.order_line_id
  LEFT JOIN v2_route_instances ri ON ri.organization_id=w.organization_id AND ri.order_document_id=w.order_document_id AND ri.order_line_id=w.order_line_id
  LEFT JOIN v2_route_instance_steps step ON step.organization_id=ri.organization_id AND step.route_instance_id=ri.id AND step.id=ri.current_step_id AND step.step_kind='production'
  LEFT JOIN LATERAL (SELECT a.station_key FROM v2_production_attempts a WHERE a.organization_id=w.organization_id AND a.production_work_id=w.replacement_origin_production_work_id ORDER BY a.completed_at DESC NULLS LAST,a.sequence DESC LIMIT 1) origin_attempt ON TRUE
  LEFT JOIN LATERAL (
    WITH RECURSIVE ancestors AS (
      SELECT w.id,w.predecessor_production_work_id,w.replacement_obligation_id,ARRAY[w.id] path,0 depth WHERE w.rework_cycle_id IS NOT NULL
      UNION ALL
      SELECT predecessor.id,predecessor.predecessor_production_work_id,predecessor.replacement_obligation_id,ancestors.path||predecessor.id,ancestors.depth+1
      FROM ancestors JOIN v2_production_works predecessor ON predecessor.organization_id=w.organization_id AND predecessor.id=ancestors.predecessor_production_work_id
      WHERE ancestors.depth<64 AND NOT predecessor.id=ANY(ancestors.path)
    )
    SELECT COALESCE(bool_or(replacement_obligation_id IS NOT NULL AND replacement_obligation_id IS DISTINCT FROM w.replacement_obligation_id),false)
      OR COALESCE(bool_or(depth=64 OR predecessor_production_work_id=ANY(path)),false) lineage_blocked FROM ancestors
  ) lineage ON TRUE
  WHERE w.organization_id=$1 AND v2_usable_production_good_quantity(w.organization_id,w.id)<w.ordered_quantity
  ORDER BY d.requested_due_date ASC NULLS LAST,w.order_document_id,w.order_line_id,w.requirement_key,w.id
  LIMIT $2`;
const scopeKey = (scope: ProductionDailyReportScope) => JSON.stringify([scope.productionWorkId, scope.orderId, scope.orderLineId, scope.requirementKey, scope.replacementObligationId ?? null]);

export class PostgresProductionDailyReport implements ProductionDailyReportReadPort {
  constructor(private readonly pool: Pick<Pool, "connect">, private readonly dependencies: ProductionDailyReportReadDependencies) {}
  async readDailyReport(organizationId: OrganizationId, input: Required<ProductionDailyReportRequest>): Promise<ProductionDailyReport> {
    const request = normalizeProductionDailyReportRequest(input);
    if (typeof this.dependencies?.readReportingCalendar !== "function" || typeof this.dependencies?.readOperationalAttention !== "function")
      throw new V2ApplicationError("INTERNAL_ERROR", "Required Production report owner reads are unavailable.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const calendar = await this.dependencies.readReportingCalendar(client, organizationId);
      validateProductionCalendar(calendar);
      const found = await client.query<CandidateRow>(productionDailyReportCandidatesSql, [organizationId, productionDailyReportCandidateLimit + 1]);
      const truncated = found.rows.length > productionDailyReportCandidateLimit;
      const candidates = found.rows.slice(0, productionDailyReportCandidateLimit);
      // Check structural duplication across all candidates, not only resolved work.
      summarizeProductionDailyReport(candidates.map(row => ({ productionWorkId: row.id, orderId: row.order_document_id, destination: row.destination ?? "unknown", dueDate: row.due_date, activeAttemptId: row.active_attempt_id })), calendar);
      const blockedWork: ProductionDailyReportBlockedWork[] = [];
      const resolved = candidates.filter(row => {
        const identity = { productionWorkId: row.id, orderId: row.order_document_id, orderLineId: row.order_line_id, requirementKey: row.requirement_key };
        // Never send a lost replacement descendant as an original scope just
        // because its marker is null. No succession/aggregation policy is chosen.
        if (row.lineage_blocked) {
          blockedWork.push({ ...identity, reasonCode: "unresolved_replacement_rework_lineage", reason: "BDR4: replacement rework lineage is missing, conflicting, or cannot be established safely. Original/replacement classification is withheld." });
          return false;
        }
        if (row.station_conflict) {
          blockedWork.push({ ...identity, reasonCode: "conflicting_frozen_station", reason: "Frozen rework destination and active Production attempt station disagree. Station classification is withheld." });
          return false;
        }
        return true;
      });
      const scopes = new Map<string, ProductionDailyReportScope>();
      const facts = resolved.map(row => {
        const scope = { productionWorkId: row.id, orderId: row.order_document_id, orderLineId: row.order_line_id, requirementKey: row.requirement_key, ...(row.replacement_obligation_id ? { replacementObligationId: row.replacement_obligation_id } : {}) };
        scopes.set(scopeKey(scope), scope);
        return { productionWorkId: row.id, orderId: row.order_document_id, destination: row.destination ?? "unknown" as const, dueDate: row.due_date, activeAttemptId: row.active_attempt_id, scope };
      });
      const attention = scopes.size ? await this.dependencies.readOperationalAttention(client, organizationId, [...scopes.values()]) : [];
      if (!Array.isArray(attention)) throw new V2ApplicationError("CONFLICT", "The operational report projection returned invalid results.");
      const decisions = new Map<string, ProductionDailyReportAttention>();
      for (const decision of attention) {
        const key = scopeKey(decision);
        if (!scopes.has(key) || decisions.has(key)) throw new V2ApplicationError("CONFLICT", "The operational report projection returned inconsistent scopes.");
        decisions.set(key, decision);
      }
      for (const key of scopes.keys()) {
        const decision = decisions.get(key);
        if (!decision || (decision.state !== "requires_attention" && decision.state !== "operationally_complete" && decision.state !== "blocked"))
          throw new V2ApplicationError("CONFLICT", "Operational eligibility is unavailable or invalid for a Production report scope.");
        if (decision.state === "blocked") {
          if (typeof decision.reason !== "string" || !decision.reason.trim()) throw new V2ApplicationError("CONFLICT", "An operational policy blocker has no explicit reason.");
          blockedWork.push({ productionWorkId: decision.productionWorkId, orderId: decision.orderId, orderLineId: decision.orderLineId, requirementKey: decision.requirementKey, reasonCode: "owner_policy_ambiguity", reason: decision.reason.trim() });
        }
      }
      const eligible = resolved.filter((_row, index) => decisions.get(scopeKey(facts[index]!.scope))!.state === "requires_attention");
      const summary = summarizeProductionDailyReport(facts.filter(fact => decisions.get(scopeKey(fact.scope))!.state === "requires_attention"), calendar);
      const pageSize = request.mode === "print" ? productionDailyReportCandidateLimit : request.pageSize;
      const page = request.mode === "print" ? 1 : request.page;
      const selected = eligible.slice((page - 1) * pageSize, page * pageSize);
      const production = new PostgresProductionTransaction(client);
      const workFacts = new Map((await production.readDailyReportWorkFacts(organizationId, selected.map(row => brandedId<"ProductionWorkId">(row.id)))).map(fact => [fact.productionWorkId, fact]));
      const rows: ProductionDailyReportRow[] = [];
      for (const row of selected) {
        const current = workFacts.get(brandedId<"ProductionWorkId">(row.id));
        if (!current || current.unitQuantitySatisfied || current.activeAttemptId !== row.active_attempt_id)
          throw new V2ApplicationError("CONFLICT", "Canonical Production facts disagree with the report population.");
        rows.push({
          productionWorkId: row.id, orderId: row.order_document_id, orderLineId: row.order_line_id, requirementKey: row.requirement_key,
          replacementObligationId: row.replacement_obligation_id, predecessorProductionWorkId: row.predecessor_production_work_id, reworkCycleId: row.rework_cycle_id,
          destination: row.destination ?? "unknown", dueDate: row.due_date, dueCategory: productionDueCategory(row.due_date, calendar),
          orderNumber: row.order_number, customerName: row.customer_name, purchaseOrderNumber: row.purchase_order_number,
          jobLabel: row.job_label, lineDescription: row.line_description, requestedFulfillment: row.requested_fulfillment_method ?? "not_recorded",
          orderedQuantity: current.orderedQuantity, remainingGoodQuantity: current.remainingGoodQuantity,
          activeAttemptId: current.activeAttemptId, state: current.state,
        });
      }
      await client.query("COMMIT");
      return { calendar, summary, rows, blockedWork, pagination: { page, pageSize, totalPages: Math.ceil(summary.totalActive / pageSize), totalCount: summary.totalActive }, coverage: { truncated, countsComplete: !truncated && blockedWork.length === 0, candidateLimit: productionDailyReportCandidateLimit, blockedWorkCount: blockedWork.length }, mode: request.mode };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
