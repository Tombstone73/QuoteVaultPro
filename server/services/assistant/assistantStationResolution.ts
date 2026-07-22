import type {
  AssistantProductionReportingRepository,
  AssistantProductionStationRecord,
} from "../../storage/assistantProductionReporting.repo";

/**
 * The assistant deliberately resolves a person-facing station reference only
 * from the organization-scoped station list.  It never accepts a station ID
 * and it never falls back to whichever production board happens to be open.
 */
export type AssistantStationResolution =
  | { kind: "unique"; query: string; station: AssistantProductionStationRecord }
  | { kind: "ambiguous"; query: string; candidates: AssistantProductionStationRecord[] }
  | { kind: "inactive"; query: string; candidates: AssistantProductionStationRecord[] }
  | { kind: "no_match"; query: string };

export type AssistantStationResolutionRepository = Pick<AssistantProductionReportingRepository, "getStations">;

const STATION_ALIASES: Record<string, string> = {
  flatbed: "flatbed",
  flat_bed: "flatbed",
  flatbed_printing: "flatbed",
  flat_bed_printing: "flatbed",
  roll: "roll",
  roll_printing: "roll",
  wide_roll: "roll",
  wide_format: "roll",
  wideformat: "roll",
  prepress: "prepress",
  pre_press: "prepress",
  finishing: "finishing",
  finish: "finishing",
  fulfillment: "fulfillment",
  fulfilment: "fulfillment",
  design: "design",
};

function normalized(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function stationAlias(value: unknown): string | null {
  return STATION_ALIASES[normalized(value)] ?? null;
}

function distinctStations(stations: AssistantProductionStationRecord[]): AssistantProductionStationRecord[] {
  const ids = new Set<string>();
  return stations.filter((station) => {
    if (ids.has(station.id)) return false;
    ids.add(station.id);
    return true;
  });
}

function ordered(stations: AssistantProductionStationRecord[]): AssistantProductionStationRecord[] {
  return [...stations].sort((left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key));
}

/**
 * Resolve a single station phrase against a trusted, already organization-
 * scoped station list.  An empty phrase is intentionally a no-match: callers
 * handling all-stations or comparison requests must bypass this function.
 */
export function resolveAssistantStationReference(
  stationQuery: unknown,
  organizationStations: AssistantProductionStationRecord[],
): AssistantStationResolution {
  const query = String(stationQuery ?? "").trim();
  const queryKey = normalized(query);
  if (!queryKey) return { kind: "no_match", query };

  // Exact trusted key/label matches take precedence over an alias family. This
  // permits a tenant to intentionally name a custom station "Finishing".
  const exact = distinctStations(organizationStations.filter((station) =>
    normalized(station.key) === queryKey || normalized(station.name) === queryKey,
  ));
  const alias = stationAlias(query);
  const candidates = exact.length > 0
    ? exact
    : alias
      ? distinctStations(organizationStations.filter((station) =>
        stationAlias(station.key) === alias || stationAlias(station.name) === alias,
      ))
      : [];

  if (candidates.length === 0) return { kind: "no_match", query };

  const active = ordered(candidates.filter((station) => station.active));
  if (active.length === 1) return { kind: "unique", query, station: active[0] };
  if (active.length > 1) return { kind: "ambiguous", query, candidates: active };

  // An explicit inactive station must not quietly become a zero-count active
  // station or resolve to a different station in the same alias family.
  return { kind: "inactive", query, candidates: ordered(candidates) };
}

export class AssistantStationResolutionService {
  constructor(private readonly repository: AssistantStationResolutionRepository) {}

  async resolve(organizationId: string, stationQuery: unknown): Promise<AssistantStationResolution> {
    const stations = await this.repository.getStations(organizationId);
    return resolveAssistantStationReference(stationQuery, stations);
  }
}
