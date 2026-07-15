import { eq, sql } from "drizzle-orm";

import { organizations } from "@shared/schema";
import { db } from "../db";

export const DEFAULT_PRODUCTION_STATIONS = [
  { key: "design", name: "Design", sort: 10, steps: [{ key: "queued", label: "Queued", sortOrder: 0 }, { key: "design", label: "Design", sortOrder: 10 }] },
  { key: "proofing", name: "Proofing", sort: 20, steps: [{ key: "queued", label: "Queued", sortOrder: 0 }, { key: "proofing", label: "Proofing", sortOrder: 10 }] },
  { key: "prepress", name: "Prepress", sort: 30, steps: [{ key: "queued", label: "Queued", sortOrder: 0 }, { key: "prepress", label: "Prepress", sortOrder: 10 }] },
  { key: "print", name: "Print", sort: 40, steps: [{ key: "queued", label: "Queued", sortOrder: 0 }, { key: "print", label: "Print", sortOrder: 10 }] },
  { key: "flatbed", name: "Flatbed", sort: 50, steps: [{ key: "queued", label: "Queued", sortOrder: 0 }, { key: "prepress", label: "Prepress", sortOrder: 10 }, { key: "print", label: "Print", sortOrder: 20 }] },
  { key: "roll", name: "Roll", sort: 60, steps: [{ key: "queued", label: "Queued", sortOrder: 0 }, { key: "prepress", label: "Prepress", sortOrder: 10 }, { key: "print", label: "Print", sortOrder: 20 }] },
  { key: "cutting", name: "Cutting", sort: 70, steps: [{ key: "queued", label: "Queued", sortOrder: 0 }, { key: "cutting", label: "Cutting", sortOrder: 10 }] },
  { key: "finishing", name: "Finishing", sort: 80, steps: [{ key: "queued", label: "Queued", sortOrder: 0 }, { key: "finishing", label: "Finishing", sortOrder: 10 }] },
  { key: "fulfillment", name: "Fulfillment", sort: 90, steps: [{ key: "queued", label: "Queued", sortOrder: 0 }, { key: "fulfillment", label: "Fulfillment", sortOrder: 10 }] },
  { key: "done", name: "Done", sort: 100, steps: [{ key: "queued", label: "Queued", sortOrder: 0 }, { key: "complete", label: "Complete", sortOrder: 10 }] },
] as const;

export const DEFAULT_PRODUCTION_ROUTING_RULES = [
  { id: "prepress", label: "Sent to Prepress", color: "blue", sendToProduction: true, stationKey: "flatbed", stepKey: "prepress", sortOrder: 10 },
  { id: "print", label: "Sent to Print", color: "purple", sendToProduction: true, stationKey: "flatbed", stepKey: "print", sortOrder: 20 },
  { id: "done", label: "Done", color: "green", sendToProduction: false, stationKey: null, stepKey: null, sortOrder: 90 },
] as const;

export type ProductionMapRepairReport = {
  organizationId: string;
  createdStations: string[];
  reactivatedStations: string[];
  existingStations: string[];
  createdSteps: string[];
  reactivatedSteps: string[];
  existingSteps: string[];
  createdRules: string[];
  existingRules: string[];
  invalidRules: string[];
  failed: string[];
};

// The transaction client has the same operations used below but is not exposed
// as the exact same TypeScript type as `db` by Drizzle.
type DbExecutor = any;

function ruleId(rule: any): string {
  return String(rule?.id ?? rule?.key ?? "").trim();
}

/**
 * Ensures the system-owned production map exists without deleting or changing
 * tenant-specific stations, steps, or routing rules. System-required records
 * are activated so production can never route to a missing station identity.
 */
export async function ensureProductionMapForOrg(
  organizationId: string,
  executor: DbExecutor = db,
): Promise<ProductionMapRepairReport> {
  const report: ProductionMapRepairReport = {
    organizationId,
    createdStations: [], reactivatedStations: [], existingStations: [],
    createdSteps: [], reactivatedSteps: [], existingSteps: [],
    createdRules: [], existingRules: [], invalidRules: [], failed: [],
  };

  try {
  const [organization] = await executor
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) {
    report.failed.push("Organization not found.");
    return report;
  }

  for (const station of DEFAULT_PRODUCTION_STATIONS) {
    const stationKey = station.key;
    const existingStation = await executor.execute(sql`
      select active from stations
      where organization_id = ${organizationId} and key = ${stationKey}
      limit 1
    `);
    const stationRow = existingStation.rows?.[0] as { active?: boolean } | undefined;
    if (!stationRow) {
      await executor.execute(sql`
        insert into stations (organization_id, key, name, sort, active)
        values (${organizationId}, ${station.key}, ${station.name}, ${station.sort}, true)
        on conflict (organization_id, key) do nothing
      `);
      report.createdStations.push(stationKey);
    } else if (stationRow.active === false) {
      await executor.execute(sql`
        update stations set active = true
        where organization_id = ${organizationId} and key = ${stationKey}
      `);
      report.reactivatedStations.push(stationKey);
    } else {
      report.existingStations.push(stationKey);
    }

    for (const step of station.steps) {
      const existingStep = await executor.execute(sql`
        select active from production_station_steps
        where organization_id = ${organizationId}
          and station_key = ${stationKey}
          and key = ${step.key}
        limit 1
      `);
      const stepRow = existingStep.rows?.[0] as { active?: boolean } | undefined;
      const ref = `${stationKey}:${step.key}`;
      if (!stepRow) {
        await executor.execute(sql`
          insert into production_station_steps (organization_id, station_key, key, label, sort_order, active, triggers)
          values (${organizationId}, ${stationKey}, ${step.key}, ${step.label}, ${step.sortOrder}, true, '[]'::jsonb)
          on conflict (organization_id, station_key, key) do nothing
        `);
        report.createdSteps.push(ref);
      } else if (stepRow.active === false) {
        await executor.execute(sql`
          update production_station_steps set active = true, updated_at = now()
          where organization_id = ${organizationId} and station_key = ${stationKey} and key = ${step.key}
        `);
        report.reactivatedSteps.push(ref);
      } else {
        report.existingSteps.push(ref);
      }
    }
  }

  const settings = (organization.settings as any) ?? {};
  const rawRules = settings?.preferences?.production?.lineItemStatuses;
  const existingRules = Array.isArray(rawRules) ? rawRules.filter((rule) => rule && typeof rule === "object") : [];
  const rulesById = new Map(existingRules.map((rule) => [ruleId(rule), rule]).filter(([id]) => id));
  const mergedRules = [...existingRules];
  for (const defaultRule of DEFAULT_PRODUCTION_ROUTING_RULES) {
    if (rulesById.has(defaultRule.id)) {
      report.existingRules.push(defaultRule.id);
    } else {
      mergedRules.push({ ...defaultRule });
      report.createdRules.push(defaultRule.id);
    }
  }

  const activeStationRows = await executor.execute(sql`
    select key from stations where organization_id = ${organizationId} and active = true
  `);
  const activeStationKeys = new Set((activeStationRows.rows ?? []).map((row: any) => String(row.key)));
  for (const rule of mergedRules) {
    if (rule?.sendToProduction !== true) continue;
    const id = ruleId(rule) || "(missing id)";
    const stationKey = String(rule.stationKey ?? "").trim();
    const stepKey = String(rule.stepKey ?? rule.defaultStepKey ?? "").trim();
    if (!stationKey || !activeStationKeys.has(stationKey)) {
      report.invalidRules.push(`Status '${id}' references inactive or missing station '${stationKey || "(missing)"}'.`);
      continue;
    }
    if (stepKey) {
      const step = await executor.execute(sql`
        select active from production_station_steps
        where organization_id = ${organizationId} and station_key = ${stationKey} and key = ${stepKey}
        limit 1
      `);
      const row = step.rows?.[0] as { active?: boolean } | undefined;
      if (!row || row.active === false) report.invalidRules.push(`Status '${id}' references inactive or missing step '${stepKey}' for station '${stationKey}'.`);
    }
  }

  if (rawRules == null || !Array.isArray(rawRules) || report.createdRules.length > 0) {
    const nextSettings = {
      ...settings,
      preferences: {
        ...(settings.preferences ?? {}),
        production: {
          ...(settings.preferences?.production ?? {}),
          lineItemStatuses: mergedRules,
        },
      },
    };
    await executor.update(organizations).set({ settings: nextSettings, updatedAt: new Date() }).where(eq(organizations.id, organizationId));
  }

  return report;
  } catch (error: any) {
    report.failed.push(error?.message || "Unable to repair the production map.");
    return report;
  }
}

/** Throw when a required bootstrap/repair operation was not completed. */
export function assertProductionMapReady(report: ProductionMapRepairReport): void {
  if (report.failed.length > 0) {
    throw new Error(`Production map setup failed: ${report.failed.join(" ")}`);
  }
}
