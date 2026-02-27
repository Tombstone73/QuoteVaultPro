import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import express, { NextFunction, Response } from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { organizations } from "../../shared/schema";
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

  const getProductionStationStepsForOrganization = async (organizationId: string) => {
    const rows = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    const settings = (rows[0]?.settings as any) ?? {};
    const raw = settings?.preferences?.production?.stationSteps;
    return (raw && typeof raw === "object" ? raw : {}) as Record<
      string,
      Array<{ key: string; label: string; active: boolean }>
    >;
  };

  const getActiveProductionStationsForOrganization = async (organizationId: string) => {
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

    return (result.rows ?? [])
      .map((row: any) => ({
        key: String(row.key ?? "").trim(),
        name: String(row.name ?? row.key ?? "").trim(),
        sort: Number(row.sort ?? 0),
      }))
      .filter((row: any) => row.key.length > 0);
  };

  app.get("/api/production/steps", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res: Response) => {
    try {
      if (!assertInternalUser(req, res)) return;
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const stationSteps = await getProductionStationStepsForOrganization(organizationId);
      const activeStations = await getActiveProductionStationsForOrganization(organizationId);

      const data: Record<string, Array<{ key: string; label: string; active: boolean }>> = {
        ...stationSteps,
      };

      for (const station of activeStations) {
        const existing = data[station.key];
        if (Array.isArray(existing) && existing.length > 0) continue;
        data[station.key] = [{ key: "queued", label: "Queued", active: true }];
      }

      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Failed" });
    }
  });

  return app;
}

describe("/api/production/steps computed defaults", () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const orgA = `org_steps_a_${suffix}`;
  const orgB = `org_steps_b_${suffix}`;
  const userId = `user_steps_${suffix}`;

  const app = createTestApp();

  beforeAll(async () => {
    await db.execute(sql`
      insert into organizations (id, name, slug)
      values
        (${orgA}, ${`Steps Org A ${suffix}`}, ${`steps-org-a-${suffix}`}),
        (${orgB}, ${`Steps Org B ${suffix}`}, ${`steps-org-b-${suffix}`})
      on conflict (id) do nothing
    `);

    await db.execute(sql`
      insert into users (id, email, role, is_admin, is_platform_admin)
      values (${userId}, ${`steps-${suffix}@example.com`}, ${"employee"}, ${false}, ${false})
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

    const orgASettings = {
      preferences: {
        production: {
          stationSteps: {
            offline: [{ key: "ready", label: "Ready", active: true }],
          },
        },
      },
    };

    const orgBSettings = {
      preferences: {
        production: {
          stationSteps: {
            roll: [{ key: "print", label: "Print", active: true }],
          },
        },
      },
    };

    await db
      .update(organizations)
      .set({ settings: orgASettings as any })
      .where(eq(organizations.id, orgA));

    await db
      .update(organizations)
      .set({ settings: orgBSettings as any })
      .where(eq(organizations.id, orgB));
  });

  afterAll(async () => {
    await db.execute(sql`delete from stations where organization_id in (${orgA}, ${orgB})`);
    await db.execute(sql`delete from user_organizations where user_id = ${userId}`);
    await db.execute(sql`delete from users where id = ${userId}`);
    await db.execute(sql`delete from organizations where id in (${orgA}, ${orgB})`);
  });

  test("returns queued defaults for active stations with missing managed steps and keeps extras", async () => {
    const beforeRows = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, orgA))
      .limit(1);
    const beforeSettings = beforeRows[0]?.settings as any;

    const res = await request(app)
      .get("/api/production/steps")
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgA)
      .expect(200);

    expect(res.body?.success).toBe(true);
    expect(res.body?.data?.prepress).toEqual([{ key: "queued", label: "Queued", active: true }]);
    expect(res.body?.data?.flatbed).toEqual([{ key: "queued", label: "Queued", active: true }]);
    expect(res.body?.data?.offline).toEqual([{ key: "ready", label: "Ready", active: true }]);
    expect(res.body?.data?.hidden).toBeUndefined();

    const afterRows = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, orgA))
      .limit(1);
    const afterSettings = afterRows[0]?.settings as any;

    expect(afterSettings).toEqual(beforeSettings);
  });

  test("keeps tenant context and ignores query param org override", async () => {
    const res = await request(app)
      .get(`/api/production/steps?organizationId=${encodeURIComponent(orgB)}`)
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgA)
      .expect(200);

    expect(res.body?.success).toBe(true);
    expect(res.body?.data?.prepress).toEqual([{ key: "queued", label: "Queued", active: true }]);
    expect(res.body?.data?.flatbed).toEqual([{ key: "queued", label: "Queued", active: true }]);
    expect(res.body?.data?.roll).toBeUndefined();
  });

  test("returns persisted managed steps when station has saved entries", async () => {
    const res = await request(app)
      .get("/api/production/steps")
      .set("x-test-user-id", userId)
      .set("x-test-user-role", "admin")
      .set("x-test-org-id", orgB)
      .expect(200);

    expect(res.body?.success).toBe(true);
    expect(res.body?.data?.roll).toEqual([{ key: "print", label: "Print", active: true }]);
  });
});
