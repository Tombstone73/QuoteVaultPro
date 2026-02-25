import { sql } from "drizzle-orm";
import { db } from "../../db";

type ResolveStationIdArgs = {
  organizationId: string;
  stationKey?: string | null;
};

class StationResolver {
  private readonly cache = new Map<string, Map<string, string>>();
  private readonly missingCache = new Map<string, Set<string>>();

  async resolveStationId({ organizationId, stationKey }: ResolveStationIdArgs): Promise<string | null> {
    const normalizedStationKey = String(stationKey ?? "").trim();
    if (!organizationId || !normalizedStationKey) return null;

    const orgCache = this.cache.get(organizationId);
    if (orgCache?.has(normalizedStationKey)) {
      return orgCache.get(normalizedStationKey) ?? null;
    }

    try {
      const result = await db.execute(sql`
        select id
        from stations
        where organization_id = ${organizationId}
          and station_key = ${normalizedStationKey}
        limit 1
      `);

      const row = result.rows[0] as { id?: string } | undefined;
      const stationId = row?.id ? String(row.id) : null;

      if (!stationId) {
        this.warnMissing(organizationId, normalizedStationKey);
        return null;
      }

      let nextOrgCache = this.cache.get(organizationId);
      if (!nextOrgCache) {
        nextOrgCache = new Map<string, string>();
        this.cache.set(organizationId, nextOrgCache);
      }
      nextOrgCache.set(normalizedStationKey, stationId);

      return stationId;
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[StationResolver] Failed to resolve station_id for org=${organizationId} station_key=${normalizedStationKey}`,
          error,
        );
      }
      return null;
    }
  }

  private warnMissing(organizationId: string, stationKey: string): void {
    let orgMissing = this.missingCache.get(organizationId);
    if (!orgMissing) {
      orgMissing = new Set<string>();
      this.missingCache.set(organizationId, orgMissing);
    }

    if (orgMissing.has(stationKey)) return;
    orgMissing.add(stationKey);

    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[StationResolver] No station_id found for org=${organizationId} station_key=${stationKey} (falling back to station_key)`,
      );
    }
  }
}

export const stationResolver = new StationResolver();
