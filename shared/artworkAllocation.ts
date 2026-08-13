/**
 * Production quantities live on the line-item/file relationship.  A group is
 * one finished variant; front and back members of the same group therefore
 * share a quantity instead of being counted twice.
 */
export type ArtworkAllocationMember = {
  id: string;
  role?: string | null;
  side?: string | null;
  productionQuantity?: number | null;
  productionGroupId?: string | null;
  active?: boolean;
};

export type ArtworkAllocationStatus = {
  allocatedTotal: number;
  requiredQuantity: number | null;
  valid: boolean;
  issue: string | null;
  groups: Array<{ id: string; quantity: number; memberIds: string[] }>;
};

/**
 * A production group is an Artwork Set: one finished output and every file
 * required to make it.  The production quantity remains denormalized on each
 * member for compatibility with existing artwork/file projections, but the
 * finished quantity is counted once per set.
 */
export type ArtworkOutputSet = {
  id: string;
  explicit: boolean;
  quantity: number | null;
  memberIds: string[];
};

const productionRoles = new Set(["artwork", "output", "final"]);
export const DEFAULT_PRODUCTION_ARTWORK_ALLOCATION = 1;

function finiteInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

export function buildArtworkOutputSets(members: ArtworkAllocationMember[]): ArtworkOutputSet[] {
  const grouped = new Map<string, ArtworkOutputSet>();
  for (const member of members) {
    if (member.active === false || !productionRoles.has(String(member.role ?? "artwork").toLowerCase())) continue;
    const explicitId = member.productionGroupId?.trim() || null;
    const id = explicitId ?? member.id;
    const quantity = member.productionQuantity == null ? null : finiteInteger(member.productionQuantity);
    const current = grouped.get(id);
    if (!current) {
      grouped.set(id, { id, explicit: Boolean(explicitId), quantity, memberIds: [member.id] });
      continue;
    }
    current.memberIds.push(member.id);
    if (current.quantity !== quantity) current.quantity = null;
  }
  return Array.from(grouped.values());
}

export function buildArtworkAllocationStatus(args: {
  lineQuantity: unknown;
  members: ArtworkAllocationMember[];
}): ArtworkAllocationStatus {
  const requiredQuantity = finiteInteger(args.lineQuantity);
  const outputSets = buildArtworkOutputSets(args.members);
  const groups = outputSets.map((group) => ({
    id: group.id,
    quantity: group.quantity ?? 0,
    memberIds: group.memberIds,
  }));
  const hasMissing = outputSets.some((group) => group.quantity == null);
  const allocatedTotal = groups.reduce((sum, group) => sum + group.quantity, 0);
  let issue: string | null = null;
  if (hasMissing) issue = "Production artwork is present but one or more allocations are missing or inconsistent within an output group.";
  else if (requiredQuantity == null) issue = "Line-item quantity must be a positive whole number before artwork allocation can be validated.";
  else if (allocatedTotal < requiredQuantity) issue = `Allocated ${allocatedTotal} of ${requiredQuantity}. Assign ${requiredQuantity - allocatedTotal} more before production.`;
  else if (allocatedTotal > requiredQuantity) issue = `Allocated ${allocatedTotal} of ${requiredQuantity}. Reduce artwork allocation before production.`;

  return { allocatedTotal, requiredQuantity, valid: !issue, issue, groups };
}

export function summarizeArtworkAllocationIssue(status: Pick<ArtworkAllocationStatus, "issue" | "allocatedTotal" | "requiredQuantity"> | null | undefined): string {
  const issue = status?.issue?.trim();
  if (!issue) return "Quantity allocation unresolved.";
  if (/missing or inconsistent within an output group/i.test(issue)) return "Quantity allocation unresolved.";
  if (/Allocated \d+ of \d+\. Assign/i.test(issue)) return issue.replace("before production.", "before creating a combined run.");
  if (/Allocated \d+ of \d+\. Reduce/i.test(issue)) return issue.replace("before production.", "before creating a combined run.");
  return issue;
}

export function defaultNewProductionArtworkAllocation(role: unknown = "artwork"): number | null {
  return productionRoles.has(String(role ?? "artwork").toLowerCase())
    ? DEFAULT_PRODUCTION_ARTWORK_ALLOCATION
    : null;
}

export function defaultProductionArtworkAllocationForLine(args: {
  role?: unknown;
  lineQuantity?: unknown;
  existingProductionArtworkCount?: unknown;
}): number | null {
  if (!productionRoles.has(String(args.role ?? "artwork").toLowerCase())) return null;

  const lineQuantity = finiteInteger(args.lineQuantity);
  if (lineQuantity == null) return null;

  const existingCount = Number(args.existingProductionArtworkCount);
  const existingProductionArtworkCount = Number.isInteger(existingCount) && existingCount >= 0 ? existingCount : 0;
  const resultingArtworkCount = existingProductionArtworkCount + 1;

  if (resultingArtworkCount === 1) return lineQuantity;
  if (lineQuantity === resultingArtworkCount) return DEFAULT_PRODUCTION_ARTWORK_ALLOCATION;
  return null;
}

export type SafeArtworkAllocationDefault = {
  id: string;
  productionQuantity: number;
};

/**
 * Provides narrow repair defaults for historical final-production rows.  It
 * deliberately requires every relevant value to be unresolved so it never
 * redistributes a staff-entered allocation.
 */
export function getSafeArtworkAllocationDefaults(args: {
  lineQuantity: unknown;
  members: ArtworkAllocationMember[];
}): SafeArtworkAllocationDefault[] {
  const lineQuantity = finiteInteger(args.lineQuantity);
  if (lineQuantity == null) return [];

  const members = args.members.filter((member) =>
    member.active !== false && productionRoles.has(String(member.role ?? "final").toLowerCase()),
  );
  if (members.length === 0 || members.some((member) => member.productionQuantity != null)) {
    return [];
  }

  const groups = new Map<string, ArtworkAllocationMember[]>();
  for (const member of members) {
    const groupId = member.productionGroupId?.trim() || member.id;
    groups.set(groupId, [...(groups.get(groupId) ?? []), member]);
  }

  // A single output group may be represented by one file or an explicit
  // Front/Back pair. Both members carry the same produced quantity.
  if (groups.size === 1) {
    return members.map((member) => ({ id: member.id, productionQuantity: lineQuantity }));
  }

  // Multiple ungrouped sides are ambiguous. Only default one-per-file when
  // every file is a standalone design rather than a Front/Back output pair.
  const areSeparateDesigns =
    groups.size === lineQuantity &&
    Array.from(groups.values()).every((group) => group.length === 1) &&
    members.every((member) => member.side !== "front" && member.side !== "back");
  if (!areSeparateDesigns) return [];

  return members.map((member) => ({ id: member.id, productionQuantity: DEFAULT_PRODUCTION_ARTWORK_ALLOCATION }));
}

export type StagedArtworkAllocation = {
  productionQuantity?: number | null;
  productionGroupId?: string | null;
  allocationSource?: "automatic" | "manual";
};

/**
 * Keep draft-only artwork allocations predictable before a line item has a
 * permanent file relationship.  Manual values are deliberately never moved.
 */
export function reconcileStagedArtworkAllocations<T extends StagedArtworkAllocation>(args: {
  lineQuantity: unknown;
  attachments: T[];
}): T[] {
  const lineQuantity = finiteInteger(args.lineQuantity);
  const count = args.attachments.length;
  const automaticQuantity = lineQuantity == null
    ? null
    : count === 1
      ? lineQuantity
      : count === lineQuantity
        ? DEFAULT_PRODUCTION_ARTWORK_ALLOCATION
        : null;

  let changed = false;
  const next = args.attachments.map((attachment) => {
    if (attachment.allocationSource === "manual") return attachment;
    const currentQuantity = attachment.productionQuantity ?? null;
    if (attachment.allocationSource === "automatic" && currentQuantity === automaticQuantity) return attachment;
    changed = true;
    return {
      ...attachment,
      productionQuantity: automaticQuantity,
      allocationSource: "automatic" as const,
    };
  });

  return changed ? next : args.attachments;
}
