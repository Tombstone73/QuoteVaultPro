import { describe, expect, jest, test } from "@jest/globals";
import { routeLineItemToProduction } from "../services/productionRoutingService";

function createRunner(args: {
  executeResults: Array<any[] | Error>;
  selectResults?: any[][];
}) {
  let executeIndex = 0;
  let selectIndex = 0;
  const inserts: any[] = [];

  const runner: any = {
    execute: jest.fn(async () => {
      const result = args.executeResults[executeIndex++] ?? [];
      if (result instanceof Error) throw result;
      return { rows: result };
    }),
    select: jest.fn(() => {
      const rows = args.selectResults?.[selectIndex++] ?? [];
      const chain: any = {
        from: jest.fn(() => chain),
        where: jest.fn(() => chain),
        limit: jest.fn(() => Promise.resolve(rows)),
      };
      chain.then = (resolve: (value: any[]) => any, reject: (reason?: any) => any) => Promise.resolve(rows).then(resolve, reject);
      return chain;
    }),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([])),
      })),
    })),
    insert: jest.fn(() => ({
      values: jest.fn((value: any) => {
        inserts.push(value);
        return Promise.resolve([]);
      }),
    })),
    inserts,
  };

  return runner;
}

describe("routeLineItemToProduction fulfillment idempotency", () => {
  const baseArgs = {
    organizationId: "org-1",
    orderId: "order-1",
    lineItemId: "line-1",
    stationKey: "fulfillment",
    stepKey: "fulfillment",
    trigger: "line_item_status" as const,
    actorUserId: "user-1",
    extraEventPayload: { previousJobId: "roll-job-1" },
  };

  test("auto-bootstraps fulfillment station and reuses existing fulfillment job", async () => {
    const runner = createRunner({
      selectResults: [[{ id: "order-1", state: "open", status: "in_production", canceledAt: null }]],
      executeResults: [
        [],
        [],
        [{ id: "station-fulfillment" }],
        [{
          id: "fulfillment-job-1",
          orderId: "order-1",
          stationKey: "fulfillment",
          stepKey: "fulfillment",
          status: "queued",
        }],
      ],
    });

    const result = await routeLineItemToProduction({ tx: runner, ...baseArgs });

    expect(result).toEqual(expect.objectContaining({
      jobId: "fulfillment-job-1",
      outcome: "existing",
      stationKey: "fulfillment",
      status: "queued",
      reason: "existing_job_for_station_unique_key",
    }));
    expect(runner.execute).toHaveBeenCalledTimes(4);
  });

  test("catches fulfillment unique races and re-queries the existing successor", async () => {
    const conflict: any = new Error("duplicate key value violates unique constraint \"production_jobs_org_line_item_station_unique\"");
    conflict.code = "23505";
    conflict.constraint = "production_jobs_org_line_item_station_unique";

    const runner = createRunner({
      selectResults: [
        [{ id: "order-1", state: "open", status: "in_production", canceledAt: null }],
        [],
        [],
      ],
      executeResults: [
        [],
        [],
        [{ id: "station-fulfillment" }],
        [],
        conflict,
        [{
          id: "fulfillment-job-1",
          orderId: "order-1",
          stationKey: "fulfillment",
          stepKey: "fulfillment",
          status: "queued",
        }],
      ],
    });

    const result = await routeLineItemToProduction({ tx: runner, ...baseArgs });

    expect(result).toEqual(expect.objectContaining({
      jobId: "fulfillment-job-1",
      outcome: "existing",
      reason: "unique_conflict_requery",
    }));
  });
});
