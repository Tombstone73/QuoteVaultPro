import { matchQuickBooksPayment, quickBooksPaymentReconciliationRequired, type QuickBooksPaymentRecoveryContext } from "./quickBooksPaymentRecovery.js";
import type { QuickBooksPaymentReadPort } from "./quickBooksPaymentReadTransport.js";

/** Complete read evidence gates a single V2 pinned-realm attempt. Its durable
 * marker is committed before invocation; unknown outcomes never authorize replay. */
export const exportOrRecoverQuickBooksPayment = async (
  reader: QuickBooksPaymentReadPort,
  context: QuickBooksPaymentRecoveryContext,
  input: Readonly<{ externalId?: string; allowCreate: boolean; occurredAt: string; beforeCreate: () => Promise<void> }>,
): Promise<string> => {
  const connection = await reader.connection(context.organizationId);
  if (connection.realmId !== context.realmId || connection.environment !== context.environment) throw quickBooksPaymentReconciliationRequired("durable request realm differs from the active connection");
  const lookup = async (externalId?: string) => matchQuickBooksPayment(context, await reader.payments(connection, context.reference), externalId);
  const initial = await lookup(input.externalId);
  if (initial.state === "matched") {
    const byId = matchQuickBooksPayment(context, await reader.payments(connection, context.reference, initial.providerId), initial.providerId);
    if (byId.state !== "matched") throw quickBooksPaymentReconciliationRequired(`external ID read is ${byId.state}`);
    return initial.providerId;
  }
  if (initial.state !== "missing" || input.externalId || !input.allowCreate) throw quickBooksPaymentReconciliationRequired(`original request lookup is ${initial.state}`);
  if (!reader.createPayment || !reader.assertCreationReferences) throw quickBooksPaymentReconciliationRequired("pinned-realm Payment creation with verified references is unavailable");
  await reader.assertCreationReferences(connection,context);
  await input.beforeCreate();
  let returnedId: string | undefined;
  try { returnedId = (await reader.createPayment(connection, context, input.occurredAt)).qbPaymentId; }
  catch { /* A lost response is reconciled by the same durable identity, never by another write. */ }
  const resolved = await lookup(returnedId);
  if (resolved.state !== "matched") throw quickBooksPaymentReconciliationRequired(`post-attempt lookup is ${resolved.state}`);
  const byId = matchQuickBooksPayment(context, await reader.payments(connection, context.reference, resolved.providerId), resolved.providerId);
  if (byId.state !== "matched") throw quickBooksPaymentReconciliationRequired(`post-attempt external ID read is ${byId.state}`);
  return resolved.providerId;
};
