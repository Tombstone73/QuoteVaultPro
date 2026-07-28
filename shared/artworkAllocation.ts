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

export function defaultSingleArtworkAllocation(lineQuantity: unknown, artworkCount: number): number | null {
  return artworkCount === 1 ? finiteInteger(lineQuantity) : null;
}
