import { useQuery } from "@tanstack/react-query";
import { stripeSettingsApi, type ApiError } from "./api";

const status = (value: string) => value === "ready" ? "Ready" : value === "webhook_not_ready" ? "Webhook not ready" : value === "not_configured" ? "Not configured" : "Action required";

/** Stripe is platform-managed: this surface reports non-secret readiness only. */
export const StripeSettingsWorkspace = ({ organizationId, sessionScope, canConfigure }: Readonly<{ organizationId: string; sessionScope: string; canConfigure: boolean }>) => {
  const query = useQuery({ queryKey: ["v2", sessionScope, organizationId, "settings", "payments", "stripe"], queryFn: () => stripeSettingsApi.get(organizationId), enabled: Boolean(organizationId && sessionScope && canConfigure) });
  if (!canConfigure) return <main className="lab"><h1>Payments</h1><p>You do not have permission to view Stripe configuration readiness.</p></main>;
  const value = query.data; const error = query.error as ApiError | null;
  return <main className="lab v2-sales-tax-settings"><header><small>SETTINGS · BILLING &amp; PAYMENTS</small><h1>Payments</h1><p>Stripe credentials and webhook secrets are platform-managed. This page never exposes key or secret material.</p></header>{query.isLoading ? <p>Loading Stripe readiness…</p> : <section className="v2-sales-notes"><h2>Stripe</h2><p><b>Status:</b> {status(value?.status ?? "not_configured")}</p><p><b>Mode:</b> {(value?.mode ?? "unknown").toUpperCase()}</p><p><b>Payment initiation:</b> {value?.status === "ready" ? "Ready" : "Unavailable"}</p><p><b>Webhook:</b> {value?.webhook === "ready" ? "Ready" : value?.webhook ?? "Missing"}</p><p>{value?.actionRequired ?? "Stripe readiness is unavailable."}</p><p>Configuration owner: platform-managed infrastructure.</p>{error && <p className="notice error">{error.message ?? "Stripe readiness is unavailable."}</p>}</section>}</main>;
};
