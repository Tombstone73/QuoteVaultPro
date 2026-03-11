import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import express, { NextFunction, Response } from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { tenantContext, getRequestOrganizationId } from "../tenantContext";

const productionLineItemStatusRuleSchema = z
  .object({
    id: z.string().optional().nullable(),
    key: z.string().optional().nullable(),
    label: z.string().min(1),
    color: z.string().optional().nullable(),
    sendToProduction: z.boolean().optional().default(false),
    stationKey: z.string().optional().nullable(),
    stepKey: z.string().optional().nullable(),
    defaultStepKey: z.string().optional().nullable(),
    sortOrder: z.number().int().optional().nullable(),
  })
  .strict();

const productionLineItemStatusRulesSchema = z.array(productionLineItemStatusRuleSchema);

const normalizeProductionStepKey = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-");

function createTestApp() {
  const app = express();
  app.use(express.json());

  app.use((req: any, _res: Response, next: NextFunction) => {
    const userId = req.headers["x-test-user-id"];
    const role = req.headers["x-test-user-role"] || "employee";
    const orgId = req.headers["x-test-org-id"];

    if (orgId) {
      req.headers["x-organization-id"] = orgId;
    }

    if (userId) {
      req.user = { id: userId, role };
      req.isAuthenticated = () => true;
    } else {
      req.isAuthenticated = () => false;
    }

    next();
  });

  const isAuthenticated = (req: any, res: Response, next: NextFunction) => {
    if (req.isAuthenticated && req.isAuthenticated()) return next();
    return res.status(401).json({ error: "Unauthorized" });
  };

  const isAdminOrOwner = (req: any, res: Response, next: NextFunction) => {
    const role = String(req.user?.role ?? "").toLowerCase();
    if (role === "owner" || role === "admin") return next();
    return res.status(403).json({ error: "Access denied" });
  };

  const assertInternalUser = (req: any, res: Response) => {
    const role = req.user?.role || "";
    if (role === "customer") {
      res.status(403).json({ error: "Access denied" });
      return false;
    }
    return true;
  };

  const ensureActiveStationExists = async (organizationId: string, stationKey: string) => {
    const result = await db.execute(sql`
      select 1
      from stations
      where organization_id = ${organizationId}
        and key = ${stationKey}
        and active = true
      limit 1
    `);

    return (result.rows ?? []).length > 0;
  };

  const getProductionStationStepState = async (organizationId: string, stationKey: string, stepKey: string) => {
    const normalizedStationKey = String(stationKey ?? "").trim();
    const normalizedStepKey = normalizeProductionStepKey(stepKey);
    if (!normalizedStationKey || !normalizedStepKey) return "missing" as const;

    const result = await db.execute(sql`
      select active
      from production_station_steps
      where organization_id = ${organizationId}
        and station_key = ${normalizedStationKey}
        and key = ${normalizedStepKey}
      limit 1
    `);

    const row = result.rows?.[0] as { active?: boolean } | undefined;
    if (!row) {
      return normalizedStepKey === "queued" ? "fallback" as const : "missing" as const;
    }

    return row.active === false ? "inactive" as const : "active" as const;
  };

  app.put(
    "/api/production/settings/line-item-statuses",
    isAuthenticated,
    tenantContext,
    isAdminOrOwner,
    async (req: any, res: Response) => {
      try {
        if (!assertInternalUser(req, res)) return;
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

        const parsed = productionLineItemStatusRulesSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "Invalid rules" });

        const rules = parsed.data;
        const keys = new Set<string>();
        for (const r of rules) {
          const id = String((r as any).id ?? (r as any).key ?? "").trim();
          if (!id) return res.status(400).json({ error: "Invalid id" });
          if (keys.has(id)) return res.status(400).json({ error: `Duplicate id: ${id}` });
          keys.add(id);

          if ((r as any).sendToProduction === true) {
            const stationKey = String((r as any).stationKey ?? "").trim();
            if (!stationKey) {
              return res.status(400).json({ error: `Status '${id}' routes to production but has no station.` });
            }

            if (!(await ensureActiveStationExists(organizationId, stationKey))) {
              return res.status(400).json({ error: `Status '${id}' references inactive or missing station '${stationKey}'.` });
            }

            const stepKey = String((r as any).stepKey ?? (r as any).defaultStepKey ?? "").trim();
            if (stepKey) {
              const stepState = await getProductionStationStepState(organizationId, stationKey, stepKey);
              if (stepState === "missing") {
                return res.status(400).json({ error: `Status '${id}' references missing step '${stepKey}' for station '${stationKey}'.` });
              }
              if (stepState === "inactive") {
                return res.status(400).json({ error: `Status '${id}' references inactive step '${stepKey}' for station '${stationKey}'.` });
              }
            }
          }
        }

        return res.json({ success: true, data: rules });
      } catch (error: any) {
        return res.status(500).json({ error: error?.message || "Failed" });
      }
    },
  );

  return app;
}

describe("production status rule validation", () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const orgId = `org_status_rules_${suffix}`;
  const userId = `user_status_rules_${suffix}`;
  const app = createTestApp();

  beforeAll(async () => {
    await db.execute(sql`
      insert into organizations (id, name, slug)
      values (${orgId}, ${`Status Rules Org ${suffix}`}, ${`status-rules-org-${suffix}`})
      on conflict (id) do nothing
    `);

    await db.execute(sql`
      insert into users (id, email, role, is_admin, is_platform_admin)
      values (${userId}, ${`status-rules-${suffix}@example.com`}, ${"employee"}, ${false}, ${false})
      on conflict (id) do nothing
    `);

    await db.execute(sql`
      insert into user_organizations (user_id, organization_id, role, is_default)
      values (${userId}, ${orgId}, ${"admin"}, ${true})
      on conflict (user_id, organization_id) do nothing
    `);

    await db.execute(sql`
      insert into stations (organization_id, key, name, sort, active)
      values (${orgId}, ${"flatbed"}, ${"Flatbed"}, ${10}, ${true})
      on conflict (organization_id, key) do update
      set name = excluded.name,
          sort = excluded.sort,
          active = excluded.active
    `);

    await db.execute(sql`
      insert into production_station_steps (organization_id, station_key, key, label, sort_order, active, triggers)
      values
        (${orgId}, ${"flatbed"}, ${"queued"}, ${"Queued"}, ${10}, ${true}, '[]'::jsonb),
        (${orgId}, ${"flatbed"}, ${"inactive_step"}, ${"Inactive Step"}, ${20}, ${false}, '[]'::jsonb)
      on conflict (organization_id, station_key, key) do update
      set label = excluded.label,
          sort_order = excluded.sort_order,
          active = excluded.active,
          triggers = excluded.triggers
    `);
  });

  afterAll(async () => {
    await db.execute(sql`delete from production_station_steps where organization_id = ${orgId}`);
    await db.execute(sql`delete from stations where organization_id = ${orgId}`);
    await db.execute(sql`delete from user_organizations where user_id = ${userId}`);
    await db.execute(sql`delete from users where id = ${userId}`);
    await db.execute(sql`delete from organizations where id = ${orgId}`);
  });

  test.each([
    ["missing", "missing_step", "Status 'print' references missing step 'missing_step' for station 'flatbed'."],
    ["inactive", "inactive_step", "Status 'print' references inactive step 'inactive_step' for station 'flatbed'."],
  ])("rejects %s step references in status rule payloads", async (_caseName, stepKey, message) => {
    const res = await request(app)
      .put("/api/production/settings/line-item-statuses")
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgId)
      .send([
        {
          id: "print",
          label: "Sent to Print",
          color: "purple",
          sendToProduction: true,
          stationKey: "flatbed",
          stepKey,
          sortOrder: 10,
        },
      ])
      .expect(400);

    expect(res.body?.error).toBe(message);
  });
});