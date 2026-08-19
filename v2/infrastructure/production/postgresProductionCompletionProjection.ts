import type { PoolClient } from "pg";
import { productionCompletion, type ProductionCompletionReadPort } from "../../src/modules/production/productionCompletion.js";
import type { OrderLineId, OrganizationId } from "../../src/modules/shared/commercialValues.js";

/** PostgreSQL implementation stays in Production: completed output from completed attempts is authoritative. */
export class PostgresProductionCompletionProjection implements ProductionCompletionReadPort {
  constructor(private readonly client: Pick<PoolClient, "query">) {}
  async readCompletion(organizationId: OrganizationId, orderLineId: OrderLineId) {
    const result=await this.client.query<{required_count:string;opened_count:string;completed_count:string}>(`
      WITH required AS (
        SELECT requirement_key FROM v2_sales_line_production_requirements
        WHERE organization_id=$1 AND order_line_id=$2
      ), works AS (
        SELECT w.requirement_key,
          COALESCE(SUM(a.good_quantity) FILTER (WHERE a.completed_at IS NOT NULL),0) >= MAX(w.ordered_quantity) satisfied
        FROM v2_production_works w
        LEFT JOIN v2_production_attempts a ON a.organization_id=w.organization_id AND a.production_work_id=w.id
        WHERE w.organization_id=$1 AND w.order_line_id=$2
        GROUP BY w.requirement_key
      )
      SELECT (SELECT count(*) FROM required)::text required_count,
        (SELECT count(*) FROM works)::text opened_count,
        (SELECT count(*) FROM required r JOIN works w ON w.requirement_key=r.requirement_key WHERE w.satisfied)::text completed_count`,[organizationId,orderLineId]);
    const row=result.rows[0]??{required_count:"0",opened_count:"0",completed_count:"0"};
    return productionCompletion({requiredUnitCount:Number(row.required_count),openedUnitCount:Number(row.opened_count),completedUnitCount:Number(row.completed_count)});
  }
}
