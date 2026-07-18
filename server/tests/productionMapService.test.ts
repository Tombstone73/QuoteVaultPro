import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { eq, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";

import { organizations, orderStatusPills } from "@shared/schema";
import { db } from "../db";
import {
  DEFAULT_PRODUCTION_STATIONS,
  ensureProductionMapForOrg,
} from "../services/productionMapService";
import { resolveInitialProductionRoute } from "../services/productionRoutingResolver";
import { createOrgWithInvite } from "../services/orgOnboardingService";

describe("ensureProductionMapForOrg", () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const organizationId = `production_map_${suffix}`;

  beforeAll(async () => {
    await db.execute(sql`
      insert into organizations (id, name, slug, settings)
      values (${organizationId}, ${`Production Map ${suffix}`}, ${`production-map-${suffix}`}, '{}'::jsonb)
    `);
  });

  afterAll(async () => {
    await db.execute(sql`delete from production_station_steps where organization_id = ${organizationId}`);
    await db.execute(sql`delete from stations where organization_id = ${organizationId}`);
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  });

  test("an empty organization receives the complete canonical station and step map", async () => {
    const report = await ensureProductionMapForOrg(organizationId);

    expect(report.failed).toEqual([]);
    expect(report.createdStations).toEqual(DEFAULT_PRODUCTION_STATIONS.map((station) => station.key));
    expect(report.createdRules).toEqual(["prepress", "print", "done"]);

    const stations = await db.execute(sql`
      select key from stations where organization_id = ${organizationId} and active = true order by sort
    `);
    expect(stations.rows.map((row: any) => row.key)).toEqual(DEFAULT_PRODUCTION_STATIONS.map((station) => station.key));

    const flatbedSteps = await db.execute(sql`
      select key from production_station_steps
      where organization_id = ${organizationId} and station_key = 'flatbed' and active = true
      order by sort_order
    `);
    expect(flatbedSteps.rows.map((row: any) => row.key)).toEqual(["queued", "prepress", "print"]);
  });

  test("repairs missing prepress and print steps without duplicating the map", async () => {
    await db.execute(sql`
      delete from production_station_steps
      where organization_id = ${organizationId}
        and station_key = 'flatbed'
        and key in ('prepress', 'print')
    `);

    const report = await ensureProductionMapForOrg(organizationId);
    expect(report.createdStations).toEqual([]);
    expect(report.createdSteps).toEqual(expect.arrayContaining(["flatbed:prepress", "flatbed:print"]));

    const duplicateRun = await ensureProductionMapForOrg(organizationId);
    expect(duplicateRun.createdStations).toEqual([]);
    expect(duplicateRun.createdSteps).toEqual([]);
  });

  test("a prepress route resolves to a station and managed step that exist after repair", async () => {
    const route = await resolveInitialProductionRoute({
      organizationId,
      lineItemRequiresPrepressSnapshot: true,
    });
    expect(route).toMatchObject({ stationKey: "prepress", stepKey: "queued" });

    const station = await db.execute(sql`
      select id from stations where organization_id = ${organizationId} and key = 'prepress' and active = true
    `);
    const step = await db.execute(sql`
      select key from production_station_steps
      where organization_id = ${organizationId} and station_key = 'prepress' and key = 'prepress' and active = true
    `);
    expect(station.rows).toHaveLength(1);
    expect(step.rows).toHaveLength(1);
  });

  test("reports tenant-specific routing rules that point to missing stations or steps", async () => {
    await db.update(organizations).set({
      settings: {
        preferences: {
          production: {
            lineItemStatuses: [{
              id: "bad-route",
              label: "Bad route",
              sendToProduction: true,
              stationKey: "not-a-station",
              stepKey: "not-a-step",
              sortOrder: 1,
            }],
          },
        },
      },
    } as any).where(eq(organizations.id, organizationId));

    const report = await ensureProductionMapForOrg(organizationId);
    expect(report.invalidRules).toContain("Status 'bad-route' references inactive or missing station 'not-a-station'.");
    expect(report.createdRules).toEqual(expect.arrayContaining(["prepress", "print", "done"]));
  });
});

describe("production-map onboarding and configuration copy", () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const userId = `production_map_user_${suffix}`;
  let sourceOrganizationId = "";

  beforeAll(async () => {
    await db.execute(sql`
      insert into users (id, email, role, is_admin, is_platform_admin)
      values (${userId}, ${`production-map-${suffix}@example.com`}, 'admin', true, false)
    `);
  });

  afterAll(async () => {
    if (sourceOrganizationId) {
      await db.execute(sql`delete from production_station_steps where organization_id = ${sourceOrganizationId}`);
      await db.execute(sql`delete from stations where organization_id = ${sourceOrganizationId}`);
      await db.execute(sql`delete from organizations where id = ${sourceOrganizationId}`);
    }
    await db.execute(sql`delete from users where id = ${userId}`);
  });

  test("organization creation includes the production map", async () => {
    const source = await createOrgWithInvite({
      name: `Production Map Source ${suffix}`,
      slug: `production-map-source-${suffix}`,
      createdByUserId: userId,
      ownerEmail: `production-map-owner-${suffix}@example.com`,
    });
    sourceOrganizationId = source.orgId;

    const sourceStations = await db.execute(sql`
      select key from stations where organization_id = ${sourceOrganizationId} and active = true
    `);
    expect(sourceStations.rows.map((row: any) => row.key)).toEqual(expect.arrayContaining(["prepress", "flatbed", "fulfillment"]));
    const sourcePills = await db.select({ key: orderStatusPills.key })
      .from(orderStatusPills)
      .where(eq(orderStatusPills.organizationId, sourceOrganizationId));
    expect(sourcePills).toHaveLength(21);
  });

  test("configuration copy invokes the same production-map repair after copying source stations and steps", () => {
    const copyServiceSource = readFileSync(new URL("../services/organizationConfigurationCopyService.ts", import.meta.url), "utf8");
    expect(copyServiceSource).toContain("insert into stations (organization_id, key, name, sort, active)");
    expect(copyServiceSource).toContain("lineItemStatuses: sourceRoutingRules");
    expect(copyServiceSource).toContain("await ensureProductionMapForOrg(destinationOrganizationId, tx)");
    expect(copyServiceSource).toContain("await seedDefaultPillsForOrg(destinationOrganizationId, tx)");
  });
});
