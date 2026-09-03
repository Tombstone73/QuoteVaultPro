import { eq } from "drizzle-orm";
import { db } from "../db";
import { organizations } from "@shared/schema";
import { validOrganizationTimezone } from "../lib/orderDueDate";

export * from "../lib/orderDueDate";

/** Database lookup is kept outside the pure date contract for isolated tests. */
export async function getOrganizationTimezone(organizationId: string): Promise<string> {
  const [organization] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const settings = organization?.settings as Record<string, unknown> | null | undefined;
  const preferences = settings?.preferences as Record<string, unknown> | null | undefined;
  return validOrganizationTimezone(settings?.timezone ?? preferences?.timezone);
}
