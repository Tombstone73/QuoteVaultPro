import { describe, expect, test } from "@jest/globals";
import express, { NextFunction, Response } from "express";
import request from "supertest";
import crypto from "crypto";

type ScheduleFn = (args: {
  organizationId: string;
  orderId: string;
  lineItemIds?: string[];
  traceId?: string;
}) => Promise<any>;

function createScheduleApp(scheduleFn: ScheduleFn) {
  const app = express();
  app.use(express.json());

  app.use((req: any, _res: Response, next: NextFunction) => {
    req.user = { id: "test-user", role: "admin" };
    req.isAuthenticated = () => true;
    req.organizationId = "org_trace_test";
    next();
  });

  const isAuthenticated = (req: any, res: Response, next: NextFunction) => {
    if (req.isAuthenticated?.()) return next();
    return res.status(401).json({ error: "Unauthorized" });
  };

  const tenantContext = (req: any, _res: Response, next: NextFunction) => {
    req.headers["x-organization-id"] = req.organizationId;
    next();
  };

  const assertInternalUser = (_req: any, _res: Response) => true;

  app.post(
    "/api/orders/:orderId/production/schedule",
    isAuthenticated,
    tenantContext,
    async (req: any, res: Response) => {
      const traceId = crypto.randomUUID();
      try {
        if (!assertInternalUser(req, res)) return;
        const organizationId = req.organizationId as string;
        if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

        const orderId = String(req.params.orderId);
        const lineItemIds = Array.isArray(req.body.lineItemIds)
          ? req.body.lineItemIds.filter((id: any) => typeof id === "string" && id.length > 0)
          : undefined;

        if (Array.isArray(req.body.lineItemIds) && lineItemIds && lineItemIds.length === 0) {
          return res.status(400).json({
            success: false,
            message: "No line items to schedule",
            traceId,
          });
        }

        const result = await scheduleFn({
          organizationId,
          orderId,
          lineItemIds,
          traceId,
        });

        res.json(result);
      } catch (_error: any) {
        res.status(500).json({
          success: false,
          error: "Scheduling failed",
          traceId,
        });
      }
    },
  );

  return app;
}

describe("production schedule traceId responses", () => {
  test("empty lineItemIds returns 400 with traceId", async () => {
    const app = createScheduleApp(async () => ({ success: true }));

    const res = await request(app)
      .post("/api/orders/order_1/production/schedule")
      .send({ lineItemIds: [] })
      .expect(400);

    expect(res.body?.success).toBe(false);
    expect(res.body?.message).toBe("No line items to schedule");
    expect(typeof res.body?.traceId).toBe("string");
    expect(res.body?.traceId?.length).toBeGreaterThan(0);
  });

  test("500 response includes traceId", async () => {
    const app = createScheduleApp(async () => {
      throw new Error("boom");
    });

    const res = await request(app)
      .post("/api/orders/order_1/production/schedule")
      .send({ lineItemIds: ["li_1"] })
      .expect(500);

    expect(res.body?.success).toBe(false);
    expect(res.body?.error).toBe("Scheduling failed");
    expect(typeof res.body?.traceId).toBe("string");
    expect(res.body?.traceId?.length).toBeGreaterThan(0);
  });
});
