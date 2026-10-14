import { eq } from "drizzle-orm";
import { organizations } from "@shared/schema";
import { filePrefixToolsEnabledFromSettings } from "@shared/filePrefixTools";
import { db } from "../db";

/** Read the active organization's current authority for each request. */
export async function isFilePrefixToolsEnabled(organizationId: string): Promise<boolean> {
  const [org] = await db.select({ settings: organizations.settings }).from(organizations)
    .where(eq(organizations.id, organizationId)).limit(1);
  return filePrefixToolsEnabledFromSettings(org?.settings);
}
