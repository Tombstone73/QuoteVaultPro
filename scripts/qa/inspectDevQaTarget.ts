import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { databaseIdentityFingerprint, isApprovedDevQaOrigin } from '../../server/lib/devQaProvisioningGuard';
import { organizations, users, userOrganizations } from '../../shared/schema';

async function inspect() {
  const env = process.env;
  if (env.APP_ENV?.toLowerCase() !== 'development' || env.NODE_ENV?.toLowerCase() !== 'production' ||
      !['dev', 'development'].includes(env.RAILWAY_ENVIRONMENT_NAME?.toLowerCase() ?? '') ||
      !env.RAILWAY_ENVIRONMENT_ID || !isApprovedDevQaOrigin(env.APP_PUBLIC_WEB_ORIGIN)) {
    throw new Error('DEV QA inspection requires the deployed Railway DEV environment and approved DEV origin.');
  }
  const fingerprint = databaseIdentityFingerprint(env.DATABASE_URL);
  if (!fingerprint) throw new Error('DEV QA inspection could not identify the PostgreSQL connection.');

  const { db, pool } = await import('../../server/db');
  try {
    const connectedIdentity = await db.execute(sql`select current_database() as database_name, current_user as database_user`);
    const configured = new URL(env.DATABASE_URL!);
    if (connectedIdentity.rows.length !== 1 ||
        connectedIdentity.rows[0].database_name !== decodeURIComponent(configured.pathname.slice(1)) ||
        connectedIdentity.rows[0].database_user !== decodeURIComponent(configured.username)) {
      throw new Error('DEV QA inspection found a database identity mismatch.');
    }
    const orgs = await db.select({ id: organizations.id, slug: organizations.slug, type: organizations.type, status: organizations.status, isArchived: organizations.isArchived, deleteState: organizations.deleteState }).from(organizations);
    const activeOrgs = orgs.filter((org) => org.status === 'active' && !org.isArchived && org.deleteState === 'active')
      .map(({ id, slug, type }) => ({ id, slug, type }));

    let qaIdentityExists: boolean | null = null;
    let qaMemberships: string[] | null = null;
    const email = env.PRINTERSHERO_DEV_QA_EMAIL?.trim().toLowerCase();
    if (email) {
      const matches = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(2);
      qaIdentityExists = matches.length > 0;
      qaMemberships = matches.length === 1
        ? (await db.select({ organizationId: userOrganizations.organizationId }).from(userOrganizations).where(eq(userOrganizations.userId, matches[0].id))).map((row) => row.organizationId)
        : null;
    }
    console.log(JSON.stringify({ railwayEnvironmentId: env.RAILWAY_ENVIRONMENT_ID, databaseIdentity: fingerprint, activeOrgs, qaIdentityExists, qaMemberships }));
  } finally {
    await pool.end();
  }
}

inspect().catch(() => {
  // Driver exceptions can contain connection details; never print them here.
  console.error('DEV QA target inspection failed; check protected Railway diagnostics.');
  process.exitCode = 1;
});
