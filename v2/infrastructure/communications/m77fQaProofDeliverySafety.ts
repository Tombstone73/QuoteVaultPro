/**
 * M7.7F-B exposes a single provider-free Proof delivery result only for the
 * isolated DEV QA organization.  This guard belongs at the V2 delivery
 * boundary, never in an HTTP handler: issuance, durable job creation and
 * immutable Proof evidence remain canonical.
 */
export const M77F_QA_ORGANIZATION_ID = "b6f969b2-dda3-4133-9d75-c417dabb8f3a";
const DEV_NEON_HOST = "ep-wandering-band-aebq1qcx-pooler.c-2.us-east-2.aws.neon.tech";

type Environment = Readonly<Record<string, string | undefined>>;

const databaseIsVerifiedDev = (environment: Environment): boolean => {
  try {
    return new URL(environment.DATABASE_URL ?? "").hostname.toLowerCase() === DEV_NEON_HOST;
  } catch {
    return false;
  }
};

/**
 * The one exact deployment/tenant identity that is allowed to use M7.7F QA
 * seams.  Keep this predicate small and reusable so every seam proves the
 * same database target rather than relying on deployment labels alone.
 */
export const isM77fQaDevTarget = (
  organizationId: string,
  environment: Environment = process.env,
): boolean =>
  organizationId === M77F_QA_ORGANIZATION_ID &&
  environment.NODE_ENV === "production" &&
  environment.APP_ENV?.toLowerCase() === "development" &&
  environment.RAILWAY_PROJECT_NAME === "PrintersHero-DEV" &&
  environment.RAILWAY_ENVIRONMENT_NAME === "Development" &&
  databaseIsVerifiedDev(environment);

/** Fail closed for local, PROD, unknown Railway targets, and every non-QA org. */
export const shouldSuppressM77fQaProofDelivery = (
  organizationId: string,
  environment: Environment = process.env,
): boolean => isM77fQaDevTarget(organizationId, environment);

/** The Portal setup seam shares the exact deployment and tenant boundary as
 * the Proof delivery seam.  It is intentionally a predicate only: the Team
 * Access route still enforces staff capability, CSRF, customer/contact
 * ownership, idempotency and canonical invite-token creation. */
export const shouldCaptureM77fQaPortalSetup = (
  organizationId: string,
  environment: Environment = process.env,
): boolean => shouldSuppressM77fQaProofDelivery(organizationId, environment);
