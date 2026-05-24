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
  otherCustomerId: string;
  productId: string;
  storageProviderConfigId: string;
  fileIds: {
    orderVisible: string;
    orderStaffOnly: string;
    otherOrderVisible: string;
    proofActionable: string;
    proofApproved: string;
    proofSuperseded: string;
    otherProof: string;
    quoteVisible: string;
    quoteStaffOnly: string;
    otherQuoteVisible: string;
  };
  orderIds: {
    portalStatus: string;
    otherCustomer: string;
  };
  orderLineItemIds: {
    portalStatusProof: string;
    portalStatusProduction: string;
    portalStatusApprovedProof: string;
    portalStatusSupersededProof: string;
    otherCustomerProof: string;
    otherCustomer: string;
  };
  proofVersionIds: {
    actionable: string;
    approved: string;
    superseded: string;
    otherCustomer: string;
  };
  proofApprovalIds: {
    approved: string;
  };
  proofTokenRaw: string;
  proofTokenId: string;
  quoteIds: {
    active: string;
    expired: string;
    draft: string;
    canceled: string;
    decline: string;
    revision: string;
    otherCustomer: string;
  };
  quoteLineItemIds: {
    active: string;
    expired: string;
    draft: string;
    canceled: string;
    decline: string;
    revision: string;
    otherCustomer: string;
  };
  quoteNumbers: {
    active: number;
    expired: number;
    draft: number;
    canceled: number;
    decline: number;
    revision: number;
    otherCustomer: number;
  };
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
    otherCustomerId: `portal-validation-other-customer-${seedKey}`,
    productId: `portal-validation-product-${seedKey}`,
    storageProviderConfigId: `portal-validation-local-storage-${seedKey}`,
    fileIds: {
      orderVisible: `portal-validation-file-order-visible-${seedKey}`,
      orderStaffOnly: `portal-validation-file-order-staff-only-${seedKey}`,
      otherOrderVisible: `portal-validation-file-order-other-visible-${seedKey}`,
      proofActionable: `portal-validation-file-proof-actionable-${seedKey}`,
      proofApproved: `portal-validation-file-proof-approved-${seedKey}`,
      proofSuperseded: `portal-validation-file-proof-superseded-${seedKey}`,
      otherProof: `portal-validation-file-proof-other-${seedKey}`,
      quoteVisible: `portal-validation-file-quote-visible-${seedKey}`,
      quoteStaffOnly: `portal-validation-file-quote-staff-only-${seedKey}`,
      otherQuoteVisible: `portal-validation-file-quote-other-visible-${seedKey}`,
    },
    orderIds: {
      portalStatus: `portal-validation-order-status-${seedKey}`,
      otherCustomer: `portal-validation-order-other-${seedKey}`,
    },
    orderLineItemIds: {
      portalStatusProof: `portal-validation-order-line-proof-${seedKey}`,
      portalStatusProduction: `portal-validation-order-line-production-${seedKey}`,
      portalStatusApprovedProof: `portal-validation-order-line-proof-approved-${seedKey}`,
      portalStatusSupersededProof: `portal-validation-order-line-proof-superseded-${seedKey}`,
      otherCustomerProof: `portal-validation-order-line-proof-other-${seedKey}`,
      otherCustomer: `portal-validation-order-line-other-${seedKey}`,
    },
    proofVersionIds: {
      actionable: `portal-validation-proof-actionable-${seedKey}`,
      approved: `portal-validation-proof-approved-${seedKey}`,
      superseded: `portal-validation-proof-superseded-${seedKey}`,
      otherCustomer: `portal-validation-proof-other-${seedKey}`,
    },
    proofApprovalIds: {
      approved: `portal-validation-proof-approval-approved-${seedKey}`,
    },
    proofTokenRaw: `portal-validation-token-${seedKey}`,
    proofTokenId: `portal-validation-proof-token-${seedKey}`,
    quoteIds: {
      active: `portal-validation-quote-active-${seedKey}`,
      expired: `portal-validation-quote-expired-${seedKey}`,
      draft: `portal-validation-quote-draft-${seedKey}`,
      canceled: `portal-validation-quote-canceled-${seedKey}`,
      decline: `portal-validation-quote-decline-${seedKey}`,
      revision: `portal-validation-quote-revision-${seedKey}`,
      otherCustomer: `portal-validation-quote-other-${seedKey}`,
    },
    quoteLineItemIds: {
      active: `portal-validation-quote-line-active-${seedKey}`,
      expired: `portal-validation-quote-line-expired-${seedKey}`,
      draft: `portal-validation-quote-line-draft-${seedKey}`,
      canceled: `portal-validation-quote-line-canceled-${seedKey}`,
      decline: `portal-validation-quote-line-decline-${seedKey}`,
      revision: `portal-validation-quote-line-revision-${seedKey}`,
      otherCustomer: `portal-validation-quote-line-other-${seedKey}`,
    },
    quoteNumbers: {
      active: invoiceNumberBase + 200,
      expired: invoiceNumberBase + 201,
      draft: invoiceNumberBase + 202,
      canceled: invoiceNumberBase + 203,
      decline: invoiceNumberBase + 204,
      revision: invoiceNumberBase + 205,
      otherCustomer: invoiceNumberBase + 206,
    },
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
