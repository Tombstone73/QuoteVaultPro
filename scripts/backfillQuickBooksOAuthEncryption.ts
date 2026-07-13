import { db } from "../server/db";
import { oauthConnections } from "../shared/schema";
import {
  decryptQuickBooksToken,
  encryptQuickBooksTokenIfConfigured,
  isEncryptedQuickBooksToken,
} from "../server/services/quickbooksCredentialManager";
import { and, eq } from "drizzle-orm";

async function main() {
  const hasKey = Boolean(process.env.QUICKBOOKS_TOKEN_ENCRYPTION_KEY || process.env.QB_TOKEN_ENCRYPTION_KEY);
  if (!hasKey) {
    throw new Error("Set QUICKBOOKS_TOKEN_ENCRYPTION_KEY or QB_TOKEN_ENCRYPTION_KEY before running this backfill.");
  }

  const rows = await db.select().from(oauthConnections).where(eq(oauthConnections.provider, "quickbooks"));
  let scanned = 0;
  let rewritten = 0;

  for (const row of rows) {
    scanned += 1;
    const access = decryptQuickBooksToken(row.accessToken);
    const refresh = decryptQuickBooksToken(row.refreshToken);
    const needsRewrite = !isEncryptedQuickBooksToken(row.accessToken) || !isEncryptedQuickBooksToken(row.refreshToken);
    if (!needsRewrite) continue;

    const metadata = row.metadata && typeof row.metadata === "object" ? { ...(row.metadata as any) } : {};
    await db.update(oauthConnections)
      .set({
        accessToken: encryptQuickBooksTokenIfConfigured(access.value),
        refreshToken: encryptQuickBooksTokenIfConfigured(refresh.value),
        metadata: {
          ...metadata,
          qbCredential: {
            ...(metadata.qbCredential && typeof metadata.qbCredential === "object" ? metadata.qbCredential : {}),
            encrypted: true,
            encryptedAt: new Date().toISOString(),
            plaintextCompatibilityRewriteAt: new Date().toISOString(),
          },
        } as any,
        updatedAt: new Date(),
      })
      .where(and(eq(oauthConnections.id, row.id), eq(oauthConnections.organizationId, row.organizationId)));
    rewritten += 1;
  }

  console.log(JSON.stringify({ provider: "quickbooks", scanned, rewritten }));
}

main().catch((error) => {
  console.error("[QB OAuth Encryption Backfill] Failed", { message: error?.message || String(error) });
  process.exit(1);
});
