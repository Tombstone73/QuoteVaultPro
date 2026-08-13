import { canonicalCapabilityRegistry, type CanonicalCapabilityDescriptor } from "./canonicalCapabilityRegistry";
import { productParityInventory } from "./capabilityInventory";

export const finalMigrationClassificationValues = [
  "shared_canonical", "compatibility_only", "ui_only_reviewed", "hard_denied", "underlying_model_unsupported",
] as const;
export type FinalMigrationClassification = (typeof finalMigrationClassificationValues)[number];

function classificationFor(capability: CanonicalCapabilityDescriptor): FinalMigrationClassification {
  if (capability.aiEligibility === "hard_denied") return "hard_denied";
  if (capability.aiEligibility === "ineligible") return "ui_only_reviewed";
  if (capability.migrationStatus === "compatibility_only" || capability.migrationStatus === "wrapped_existing" || capability.parityStatus === "ai_specific") return "compatibility_only";
  return "shared_canonical";
}

export function finalMigrationInventoryRows() {
  const capabilityRows = canonicalCapabilityRegistry.map((capability) => ({
    id: capability.id,
    domain: capability.domain,
    classification: classificationFor(capability),
    ui: capability.uiSurfaceReference,
    ai: capability.aiExposure,
    operation: capability.canonicalOperationReference,
    adapter: capability.sourceId ?? "—",
    authority: capability.requiredGrant ?? "—",
    go: capability.confirmation,
    lifecycle: capability.lifecycleValidationReference,
  }));
  const unsupportedRows = productParityInventory
    .filter((item) => item.classification === "underlying_support_not_demonstrated")
    .map((item) => ({ id: `product.${item.id}`, domain: "products", classification: "underlying_model_unsupported" as const, ui: typeof item.uiSource === "string" ? item.uiSource : item.uiSource.file, ai: "not_exposed", operation: "not_applicable", adapter: "—", authority: "—", go: "not_applicable", lifecycle: item.notes }));
  return [...capabilityRows, ...unsupportedRows];
}

export function renderFinalMigrationInventoryMarkdown(): string {
  const rows = finalMigrationInventoryRows();
  const classifications = finalMigrationClassificationValues.map((classification) => `- ${classification}: ${rows.filter((row) => row.classification === classification).length}`).join("\n");
  const domainNames = [...new Set(rows.map((row) => row.domain))].sort();
  const domains = domainNames.map((domain) => {
    const domainRows = rows.filter((row) => row.domain === domain)
      .map((row) => `| ${row.id} | ${row.classification} | ${row.ui} | ${row.ai} | ${row.operation} | ${row.adapter} | ${row.authority} | ${row.go} | ${row.lifecycle} |`).join("\n");
    return `## ${domain}\n\n| Capability | Classification | UI exposure | AI exposure | Canonical operation | Adapter/tool | Authority | GO | Lifecycle/state owner |\n|---|---|---|---|---|---|---|---|---|\n${domainRows}`;
  }).join("\n\n");
  return `# Final AI Operator migration inventory\n\n> Generated from canonical registry metadata and the reviewed Product unsupported fixture. This is a developer-facing classification report, not an execution surface.\n\n## Counts\n\n${classifications}\n\n${domains}\n`;
}
