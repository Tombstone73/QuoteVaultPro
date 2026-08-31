import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { stripeSettingsApi, type ApiError } from "./api";

const status = (value: string) => ({
  ready: "Ready", not_connected: "Not connected", onboarding: "Onboarding incomplete",
  requirements_due: "Requirements due", reconnect_required: "Reconnect required",
  disconnected: "Disconnected", platform_not_ready: "Platform configuration required",
  not_configured: "Not configured", webhook_not_ready: "Webhook not ready",
  active: "Active", pending: "Pending activation", inactive: "Inactive", unknown: "Not connected",
  error: "Provider unavailable", action_required: "Action required",
} as Record<string,string>)[value] ?? "Action required";
/** React Query can retain a failed refetch error beside a previously resolved
 * payload. A resolved tenant readiness projection remains authoritative. */
export const showStripeReadinessError = (readiness: unknown, error: unknown): boolean => readiness == null && Boolean(error);

/** Tenant admins connect their own Accounts v2 merchant configuration here. */
export const StripeSettingsWorkspace = ({ organizationId, sessionScope, canConfigure }: Readonly<{ organizationId: string; sessionScope: string; canConfigure: boolean }>) => {
  const client=useQueryClient(); const key=["v2", sessionScope, organizationId, "settings", "payments", "stripe"];
  const query = useQuery({ queryKey: key, queryFn: () => stripeSettingsApi.get(organizationId), enabled: Boolean(organizationId && sessionScope && canConfigure) });
  const connect=useMutation({mutationFn:()=>stripeSettingsApi.connect(organizationId),onSuccess:(result)=>window.location.assign(result.onboardingUrl)});
  const disconnect=useMutation({mutationFn:()=>stripeSettingsApi.disconnect(organizationId),onSuccess:()=>void client.invalidateQueries({queryKey:key})});
  if (!canConfigure) return <main className="lab"><h1>Payments</h1><p>You do not have permission to view Stripe configuration readiness.</p></main>;
  const value = query.data; const connection=value?.connection; const readinessError=query.error as ApiError | null; const actionError=(connect.error ?? disconnect.error) as ApiError | null;
  const connected=connection?.connected ?? false;
  return <main className="lab v2-sales-tax-settings"><header><small>SETTINGS · BILLING &amp; PAYMENTS</small><h1>Payments</h1><p>Each print shop is its own Stripe merchant of record. PrintersHero never exposes Stripe keys or secrets.</p></header>{query.isLoading ? <p>Loading Stripe readiness…</p> : <section className="v2-sales-notes"><h2>Stripe Connect</h2><p><b>Connection:</b> {status(connection?.status ?? "not_connected")}</p><p><b>Mode:</b> {(connection?.mode ?? value?.mode ?? "unknown").toUpperCase()}</p>{connection?.connectedAccountName && <p><b>Connected shop:</b> {connection.connectedAccountName}</p>}<p><b>Card payments:</b> {connected ? status(connection?.cardPayments ?? "unknown") : "Not connected"}</p><p><b>Payouts:</b> {connected ? status(connection?.payouts ?? "unknown") : "Not connected"}</p><p><b>Webhook:</b> {value?.webhook === "ready" ? "Ready" : value?.webhook ?? "Missing"}</p><p><b>Model:</b> Direct charges · Full Stripe Dashboard · Stripe collects processing fees.</p><p>{connection?.actionRequired ?? value?.actionRequired ?? "Stripe readiness is unavailable."}</p>{connection?.status === "ready" ? <button className="v2-quiet-button" disabled={disconnect.isPending} onClick={()=>disconnect.mutate()}>Disconnect Stripe</button> : <button className="v2-invoice-issue" disabled={connect.isPending} onClick={()=>connect.mutate()}>{connect.isPending?"Opening Stripe…":connection?.connected?"Resume Stripe onboarding":"Connect Stripe"}</button>}{showStripeReadinessError(value,readinessError) && <p className="notice error">{readinessError?.message ?? "Stripe readiness is unavailable."} <button className="v2-quiet-button" onClick={()=>void query.refetch()}>Retry readiness</button></p>}{actionError && <p className="notice error">{actionError.message ?? "Stripe configuration could not be completed."}</p>}</section>}</main>;
};
