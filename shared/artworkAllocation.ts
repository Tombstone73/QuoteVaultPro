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

const productionRoles = new Set(["artwork", "output", "final"]);
export const DEFAULT_PRODUCTION_ARTWORK_ALLOCATION = 1;

function finiteInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

export function buildArtworkAllocationStatus(args: {
  lineQuantity: unknown;
  members: ArtworkAllocationMember[];
}): ArtworkAllocationStatus {
  const requiredQuantity = finiteInteger(args.lineQuantity);
  const grouped = new Map<string, { quantity: number | null; memberIds: string[] }>();

  for (const member of args.members) {
    if (member.active === false || !productionRoles.has(String(member.role ?? "artwork").toLowerCase())) continue;
    const quantity = member.productionQuantity == null ? null : finiteInteger(member.productionQuantity);
    // A stable group is explicit when supplied. An individual file is its own
    // group otherwise; callers can report an incomplete Front/Back grouping.
    const groupId = member.productionGroupId?.trim() || member.id;
    const current = grouped.get(groupId);
    if (!current) {
      grouped.set(groupId, { quantity, memberIds: [member.id] });
    } else {
      current.memberIds.push(member.id);
      if (current.quantity !== quantity) current.quantity = null;
    }
  }

  const groups = Array.from(grouped.entries()).map(([id, group]) => ({
    id,
    quantity: group.quantity ?? 0,
    memberIds: group.memberIds,
  }));
  const hasMissing = Array.from(grouped.values()).some((group) => group.quantity == null);
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
