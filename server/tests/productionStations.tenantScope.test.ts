import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import express, { NextFunction, Response } from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { tenantContext, getRequestOrganizationId } from "../tenantContext";

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

  app.get("/api/production/stations", isAuthenticated, tenantContext, async (req: any, res: Response) => {
    try {
      const role = req.user?.role || "";
      if (role === "customer") return res.status(403).json({ error: "Access denied" });

      const organizationId = getRequestOrganizationId(req);
      const result = await db.execute(sql`
        select
          key as "key",
          name as "name",
          sort as "sort"
        from stations
        where organization_id = ${organizationId}
          and active = true
        order by sort asc, name asc
      `);

      const data = (result.rows ?? [])
        .map((row: any) => ({
          key: String(row.key ?? "").trim(),
          name: String(row.name ?? row.key ?? "").trim(),
          sort: Number(row.sort ?? 0),
        }))
        .filter((row: any) => row.key.length > 0);

      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed" });
    }
  });

  return app;
}

describe("/api/production/stations tenant scope", () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const orgA = `org_station_a_${suffix}`;
  const orgB = `org_station_b_${suffix}`;
  const userId = `user_station_${suffix}`;

  const app = createTestApp();

  beforeAll(async () => {
    await db.execute(sql`
      insert into organizations (id, name, slug)
      values
        (${orgA}, ${`Stations Org A ${suffix}`}, ${`stations-org-a-${suffix}`}),
        (${orgB}, ${`Stations Org B ${suffix}`}, ${`stations-org-b-${suffix}`})
      on conflict (id) do nothing
    `);

    await db.execute(sql`
      insert into users (id, email, role, is_admin, is_platform_admin)
      values (${userId}, ${`stations-${suffix}@example.com`}, ${"employee"}, ${false}, ${false})
      on conflict (id) do nothing
    `);

    await db.execute(sql`
      insert into user_organizations (user_id, organization_id, role, is_default)
      values
        (${userId}, ${orgA}, ${"admin"}, ${true}),
        (${userId}, ${orgB}, ${"admin"}, ${false})
      on conflict (user_id, organization_id) do nothing
    `);

    await db.execute(sql`
      insert into stations (organization_id, key, name, sort, active)
      values
        (${orgA}, ${"prepress"}, ${"Prepress"}, ${10}, ${true}),
        (${orgA}, ${"flatbed"}, ${"Flatbed"}, ${20}, ${true}),
        (${orgA}, ${"hidden"}, ${"Hidden"}, ${99}, ${false}),
        (${orgB}, ${"roll"}, ${"Roll"}, ${10}, ${true})
      on conflict (organization_id, key) do update
      set name = excluded.name,
          sort = excluded.sort,
          active = excluded.active
    `);
  });

  afterAll(async () => {
    await db.execute(sql`delete from stations where organization_id in (${orgA}, ${orgB})`);
    await db.execute(sql`delete from user_organizations where user_id = ${userId}`);
    await db.execute(sql`delete from users where id = ${userId}`);
    await db.execute(sql`delete from organizations where id in (${orgA}, ${orgB})`);
  });

  test("returns only active stations for request tenant", async () => {
    const res = await request(app)
      .get("/api/production/stations")
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgA)
      .expect(200);

    expect(res.body?.success).toBe(true);
    const keys = (res.body?.data ?? []).map((s: any) => s.key);
    expect(keys).toEqual(["prepress", "flatbed"]);
    expect(keys).not.toContain("hidden");
    expect(keys).not.toContain("roll");
  });

  test("ignores query param org override and keeps tenantContext org", async () => {
    const res = await request(app)
      .get(`/api/production/stations?organizationId=${encodeURIComponent(orgB)}`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgA)
      .expect(200);

    expect(res.body?.success).toBe(true);
    const keys = (res.body?.data ?? []).map((s: any) => s.key);
    expect(keys).toEqual(["prepress", "flatbed"]);
    expect(keys).not.toContain("roll");
  });
});
