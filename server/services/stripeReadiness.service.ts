import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { integrationConnections } from "../../shared/schema";
import { assertStripeServerConfig, getStripeClient, type StripeMode } from "../lib/stripe";

type StripeAccountSnapshot = {
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  livemode?: boolean;
  capabilities?: { card_payments?: string | null } | null;
};

export type StripeReadiness = {
  serverConfigured: boolean;
  serverMode: StripeMode;
  storedConnectionMode: StripeMode | null;
  stripeAccountId: string | null;
  accountExistsInServerMode: boolean;
  accountModeMatchesServer: boolean;
  connected: boolean;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  cardPaymentsCapability: string | null;
  modeMismatch: boolean;
  readyForTestPayments: boolean;
  readyForProductionPayments: boolean;
  readyForPayments: boolean;
  status: string;
  code: string | null;
  lastError: string | null;
};

type ConnectionSnapshot = {
  externalAccountId?: string | null;
  mode?: string | null;
  status?: string | null;
  lastError?: string | null;
};

function normalizeMode(value: unknown): StripeMode | null {
  const mode = String(value || "").trim().toLowerCase();
  return mode === "test" || mode === "live" ? mode : null;
}

export function evaluateStripeReadiness(params: {
  serverConfigured: boolean;
  serverMode: StripeMode;
  connection?: ConnectionSnapshot | null;
  account?: StripeAccountSnapshot | null;
  accountLookupFailed?: boolean;
}): StripeReadiness {
  const connection = params.connection ?? null;
  const stripeAccountId = connection?.externalAccountId ? String(connection.externalAccountId) : null;
  const storedConnectionMode = normalizeMode(connection?.mode);
  const connectionStatus = String(connection?.status || "connected").toLowerCase();
  const disconnected = connectionStatus === "disconnected" || connectionStatus === "error";
  // A legacy connection without a persisted mode is not safe to reuse after a
  // server-key change either. Require an intentional disconnect/reconnect.
  const modeMismatch = Boolean(stripeAccountId && (!storedConnectionMode || params.serverMode !== storedConnectionMode));
  const account = params.account ?? null;
  const accountExistsInServerMode = Boolean(stripeAccountId && account && !params.accountLookupFailed && !modeMismatch);
  const accountModeMatchesServer = accountExistsInServerMode && (
    typeof account?.livemode !== "boolean" || (account.livemode ? "live" : "test") === params.serverMode
  );
  const detailsSubmitted = Boolean(account?.details_submitted);
  const chargesEnabled = Boolean(account?.charges_enabled);
  const payoutsEnabled = Boolean(account?.payouts_enabled);
  const cardPaymentsCapability = typeof account?.capabilities?.card_payments === "string"
    ? account.capabilities.card_payments
    : null;
  const cardPaymentsReady = cardPaymentsCapability === "active";
  const connected = Boolean(params.serverConfigured && stripeAccountId && !disconnected && accountExistsInServerMode && accountModeMatchesServer);
  const readyForTestPayments = Boolean(connected && params.serverMode === "test" && detailsSubmitted && chargesEnabled && cardPaymentsReady);
  const readyForProductionPayments = Boolean(connected && params.serverMode === "live" && detailsSubmitted && chargesEnabled && payoutsEnabled && cardPaymentsReady);
  const readyForPayments = params.serverMode === "live" ? readyForProductionPayments : readyForTestPayments;

  let status = "disconnected";
  let code: string | null = null;
  let lastError = connection?.lastError ? String(connection.lastError) : null;
  if (!params.serverConfigured) {
    status = "not_configured";
    code = "STRIPE_NOT_CONFIGURED";
  } else if (params.serverMode === "unknown") {
    status = "mode_unknown";
    code = "STRIPE_MODE_UNKNOWN";
  } else if (modeMismatch) {
    status = "mode_mismatch";
    code = "STRIPE_MODE_MISMATCH";
    lastError = `Stored Stripe connection is ${storedConnectionMode || "unknown"}; server is ${params.serverMode}. Disconnect the obsolete connection before reconnecting.`;
  } else if (stripeAccountId && (!accountExistsInServerMode || !accountModeMatchesServer)) {
    status = "account_unavailable";
    code = "STRIPE_ACCOUNT_UNAVAILABLE";
    lastError = "The connected Stripe account could not be verified in the current server mode.";
  } else if (stripeAccountId && !detailsSubmitted) {
    status = "onboarding_incomplete";
    code = "STRIPE_ONBOARDING_INCOMPLETE";
  } else if (stripeAccountId && !chargesEnabled) {
    status = "charges_disabled";
    code = "STRIPE_CHARGES_DISABLED";
  } else if (stripeAccountId && !cardPaymentsReady) {
    status = "card_payments_unavailable";
    code = "STRIPE_CARD_PAYMENTS_UNAVAILABLE";
  } else if (stripeAccountId && params.serverMode === "live" && !payoutsEnabled) {
    status = "payouts_disabled";
    code = "STRIPE_PAYOUTS_DISABLED";
  } else if (readyForProductionPayments) {
    status = "ready_live";
  } else if (readyForTestPayments) {
    status = "ready_test";
  }

  return {
    serverConfigured: params.serverConfigured,
    serverMode: params.serverMode,
    storedConnectionMode,
    stripeAccountId,
    accountExistsInServerMode,
    accountModeMatchesServer,
    connected,
    detailsSubmitted,
    chargesEnabled,
    payoutsEnabled,
    cardPaymentsCapability,
    modeMismatch,
    readyForTestPayments,
    readyForProductionPayments,
    readyForPayments,
    status,
    code,
    lastError,
  };
}

export async function resolveStripeReadiness(organizationId: string): Promise<StripeReadiness> {
  const config = assertStripeServerConfig();
  const [connection] = await db.select().from(integrationConnections).where(and(
    eq(integrationConnections.organizationId, organizationId),
    eq(integrationConnections.provider, "stripe"),
  )).limit(1);

  const base = { serverConfigured: config.ok, serverMode: config.mode, connection };
  const storedMode = normalizeMode(connection?.mode);
  const accountId = connection?.externalAccountId ? String(connection.externalAccountId) : null;
  if (!config.ok || config.mode === "unknown" || !accountId || !storedMode || storedMode !== config.mode) {
    return evaluateStripeReadiness(base);
  }

  try {
    const account = await getStripeClient().accounts.retrieve(accountId);
    return evaluateStripeReadiness({ ...base, account: account as StripeAccountSnapshot });
  } catch {
    return evaluateStripeReadiness({ ...base, accountLookupFailed: true });
  }
}

export class StripeReadinessError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export async function requireStripePaymentReadiness(organizationId: string): Promise<StripeReadiness> {
  const readiness = await resolveStripeReadiness(organizationId);
  if (!readiness.readyForPayments || !readiness.stripeAccountId) {
    throw new StripeReadinessError(
      readiness.code || "STRIPE_NOT_READY",
      readiness.lastError || "Stripe is not ready to accept payments for this organization.",
    );
  }
  return readiness;
}
