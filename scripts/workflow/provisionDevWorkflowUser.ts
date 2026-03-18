import "dotenv/config";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db } from "../../server/db";
import { authIdentities, userOrganizations, users } from "../../shared/schema";

const DEFAULT_ORG_ID = "org_titan_001";

async function main() {
  const [emailArg, passwordArg] = process.argv.slice(2);
  if (!emailArg || !passwordArg) {
    throw new Error("Usage: npx tsx scripts/workflow/provisionDevWorkflowUser.ts <email> <password>");
  }

  const email = emailArg.trim().toLowerCase();
  const password = passwordArg.trim();
  const passwordHash = await bcrypt.hash(password, 12);

  const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  const user = existingUser
    ? (
        await db
          .update(users)
          .set({
            role: "owner",
            isAdmin: true,
            mustSetPassword: false,
            lastActiveOrgId: DEFAULT_ORG_ID,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existingUser.id))
          .returning()
      )[0]
    : (
        await db
          .insert(users)
          .values({
            email,
            firstName: "QA",
            lastName: "Workflow",
            role: "owner",
            isAdmin: true,
            mustSetPassword: false,
            lastActiveOrgId: DEFAULT_ORG_ID,
          })
          .returning()
      )[0];

  await db
    .insert(authIdentities)
    .values({
      userId: user.id,
      provider: "password",
      passwordHash,
      passwordSetAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [authIdentities.userId, authIdentities.provider],
      set: {
        passwordHash,
        passwordSetAt: new Date(),
        updatedAt: new Date(),
      },
    });

  const [membership] = await db
    .select()
    .from(userOrganizations)
    .where(and(eq(userOrganizations.userId, user.id), eq(userOrganizations.organizationId, DEFAULT_ORG_ID)))
    .limit(1);

  if (!membership) {
    await db.insert(userOrganizations).values({
      userId: user.id,
      organizationId: DEFAULT_ORG_ID,
      role: "owner",
      isDefault: true,
    });
  } else {
    await db
      .update(userOrganizations)
      .set({ role: "owner", isDefault: true, updatedAt: new Date() })
      .where(and(eq(userOrganizations.userId, user.id), eq(userOrganizations.organizationId, DEFAULT_ORG_ID)));
  }

  console.log(
    JSON.stringify(
      {
        email,
        userId: user.id,
        organizationId: DEFAULT_ORG_ID,
        role: "owner",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});