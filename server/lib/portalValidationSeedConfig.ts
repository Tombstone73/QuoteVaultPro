import { detectDatabaseRuntime, type DatabaseRuntimeKind } from "./runtimeEnvironment";

export const DEFAULT_PORTAL_TEST_EMAIL = "portal.validation@titanos.dev";
export const DEFAULT_PORTAL_TEST_CUSTOMER_NAME = "Portal Test Customer";
export const DEFAULT_PORTAL_TEST_ORG_ID = "org_titan_001";
export const DEFAULT_PORTAL_TEST_INVOICE_AMOUNT_CENTS = 12_500;
export const DEFAULT_PORTAL_TEST_INVOICE_NUMBER_BASE = 910_100;

export type PortalValidationSeedConfig = {
  allowSeed: boolean;
  nodeEnv: string;
  databaseRuntime: DatabaseRuntimeKind;
  databaseLabel: string;
  email: string;
  password: string;
  customerName: string;
  invoiceAmountCents: number;
  organizationId: string;
  invoiceNumberBase: number;
  seedKey: string;
  userId: string;
  customerId: string;
  productId: string;
  invoiceIds: {
    payable: string;
    paid: string;
    draft: string;
    void: string;
    stripeConfirmFirst: string;
    stripeWebhookFirst: string;
    stripeFailed: string;
  };
  invoiceNumbers: {
    payable: number;
    paid: number;
    draft: number;
    void: number;
    stripeConfirmFirst: number;
    stripeWebhookFirst: number;
    stripeFailed: number;
  };
  paymentIds: {
    paid: string;
  };
};

function normalize(value: string | undefined | null): string {
  return (value ?? "").trim();
}

function normalizeLower(value: string | undefined | null): string {
  return normalize(value).toLowerCase();
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(normalize(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function compactSeedPart(value: string): string {
  const compact = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return compact || "portal-validation";
}

function hashText(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function buildPortalValidationSeedKey(email: string): string {
  const normalizedEmail = normalizeLower(email || DEFAULT_PORTAL_TEST_EMAIL);
  return `${compactSeedPart(normalizedEmail)}-${hashText(normalizedEmail)}`;
}

export function parsePortalValidationSeedConfig(
  env: Record<string, string | undefined> = process.env,
): PortalValidationSeedConfig {
  const email = normalizeLower(env.PORTAL_TEST_EMAIL) || DEFAULT_PORTAL_TEST_EMAIL;
  const seedKey = buildPortalValidationSeedKey(email);
  const invoiceNumberBase = parsePositiveInt(env.PORTAL_TEST_INVOICE_NUMBER_BASE, DEFAULT_PORTAL_TEST_INVOICE_NUMBER_BASE);
  const database = detectDatabaseRuntime(env.DATABASE_URL, env);

  return {
    allowSeed: normalize(env.ALLOW_DEV_PORTAL_SEED) === "1",
    nodeEnv: normalizeLower(env.NODE_ENV) || "development",
    databaseRuntime: database.databaseRuntime,
    databaseLabel: database.databaseLabel,
    email,
    password: normalize(env.PORTAL_TEST_PASSWORD),
    customerName: normalize(env.PORTAL_TEST_CUSTOMER_NAME) || DEFAULT_PORTAL_TEST_CUSTOMER_NAME,
    invoiceAmountCents: parsePositiveInt(env.PORTAL_TEST_INVOICE_AMOUNT, DEFAULT_PORTAL_TEST_INVOICE_AMOUNT_CENTS),
    organizationId: normalize(env.PORTAL_TEST_ORG_ID) || DEFAULT_PORTAL_TEST_ORG_ID,
    invoiceNumberBase,
    seedKey,
    userId: `portal-validation-user-${seedKey}`,
    customerId: `portal-validation-customer-${seedKey}`,
    productId: `portal-validation-product-${seedKey}`,
    invoiceIds: {
      payable: `portal-validation-invoice-payable-${seedKey}`,
      paid: `portal-validation-invoice-paid-${seedKey}`,
      draft: `portal-validation-invoice-draft-${seedKey}`,
      void: `portal-validation-invoice-void-${seedKey}`,
      stripeConfirmFirst: `portal-validation-invoice-stripe-confirm-first-${seedKey}`,
      stripeWebhookFirst: `portal-validation-invoice-stripe-webhook-first-${seedKey}`,
      stripeFailed: `portal-validation-invoice-stripe-failed-${seedKey}`,
    },
    invoiceNumbers: {
      payable: invoiceNumberBase,
      paid: invoiceNumberBase + 1,
      draft: invoiceNumberBase + 2,
      void: invoiceNumberBase + 3,
      stripeConfirmFirst: invoiceNumberBase + 10,
      stripeWebhookFirst: invoiceNumberBase + 11,
      stripeFailed: invoiceNumberBase + 12,
    },
    paymentIds: {
      paid: `portal-validation-payment-paid-${seedKey}`,
    },
  };
}

export function getPortalValidationSeedSafetyErrors(config: PortalValidationSeedConfig): string[] {
  const errors: string[] = [];
  if (!config.allowSeed) {
    errors.push("ALLOW_DEV_PORTAL_SEED=1 is required.");
  }
  if (config.nodeEnv === "production") {
    errors.push("Refusing to run when NODE_ENV=production.");
  }
  if (config.databaseRuntime === "production-cloud") {
    errors.push("Refusing to run against a production-cloud database.");
  }
  if (!config.email.includes("@")) {
    errors.push("PORTAL_TEST_EMAIL must be a valid email-like value.");
  }
  if (!config.password) {
    errors.push("PORTAL_TEST_PASSWORD is required.");
  }
  if (!config.organizationId) {
    errors.push("PORTAL_TEST_ORG_ID is required.");
  }
  return errors;
}
