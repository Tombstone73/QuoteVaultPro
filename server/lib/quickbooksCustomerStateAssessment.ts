import { createHash } from 'node:crypto';
import { assessQBCustomerAddress, customerAddressFields, normalizeQBCustomerAddress,
  type AddressSide, type CustomerAddresses, type QBCustomerAddresses } from './quickbooksCustomerAddress';

export type StateAssessmentCustomer = CustomerAddresses & {
  id: string; organizationId: string; externalAccountingId: string | null;
  status?: string | null; mergedIntoCustomerId?: string | null; isActive?: boolean | null;
};
export type StateAssessmentSourceCustomer = QBCustomerAddresses & { Id?: string; Active?: boolean };
export function stableStateEvidence(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStateEvidence).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStateEvidence(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const populated = (value: unknown) => typeof value === 'string' && !!value.trim();
export function hasCustomerAddress(customer: CustomerAddresses, side: AddressSide) {
  return customerAddressFields.some(key => key.startsWith(side) && populated(customer[key]));
}

/** Pure dry-run planner. Only a unique stored QBO ID and matching address can propose a state. */
export function assessQuickBooksCustomerStates(organizationId: string, customers: StateAssessmentCustomer[], source: StateAssessmentSourceCustomer[] | null) {
  if (!organizationId.trim() || customers.some(customer => customer.organizationId !== organizationId)) {
    throw new Error('QB_STATE_ASSESSMENT_TENANT_MISMATCH');
  }
  const linked = customers.filter(customer => populated(customer.externalAccountingId));
  const localIds = new Map<string, number>();
  const sourceIds = new Map<string, StateAssessmentSourceCustomer[]>();
  for (const customer of linked) localIds.set(customer.externalAccountingId!, (localIds.get(customer.externalAccountingId!) ?? 0) + 1);
  for (const customer of source ?? []) {
    if (customer.Id) sourceIds.set(customer.Id, [...(sourceIds.get(customer.Id) ?? []), customer]);
  }
  const counts = {
    totalCustomers: customers.length, unlinkedCustomers: customers.length - linked.length,
    missingBillingState: customers.filter(customer => !populated(customer.billingState)).length,
    missingShippingState: customers.filter(customer => !populated(customer.shippingState)).length,
    missingBothStateFields: customers.filter(customer => !populated(customer.billingState) && !populated(customer.shippingState)).length,
    affectedCustomers: 0, linkedAffectedCustomers: 0, missingBothStatesWithAddress: 0,
    linkedCustomers: linked.length, missingBillingStateWithAddress: 0, missingShippingStateWithAddress: 0,
    linkedWithoutAddress: 0, proposedStateFields: 0, skippedStateFields: 0,
    recoverableCustomers: 0, recoverableBillingStates: 0, recoverableShippingStates: 0,
  };
  const rows: Array<{
    customerId: string; quickBooksCustomerId: string | null; side: AddressSide; field: 'billingState' | 'shippingState';
    decision: string; proposedValue?: string; evidenceHash?: string;
  }> = [];
  for (const customer of customers) {
    const isLinked = populated(customer.externalAccountingId);
    const missingBilling = !populated(customer.billingState) && hasCustomerAddress(customer, 'billing');
    const missingShipping = !populated(customer.shippingState) && hasCustomerAddress(customer, 'shipping');
    if (missingBilling || missingShipping) { counts.affectedCustomers++; if (isLinked) counts.linkedAffectedCustomers++; }
    if (missingBilling && missingShipping) counts.missingBothStatesWithAddress++;
    if (isLinked && !hasCustomerAddress(customer, 'billing') && !hasCustomerAddress(customer, 'shipping')) counts.linkedWithoutAddress++;
    for (const side of ['billing', 'shipping'] as const) {
      const field = `${side}State` as const;
      if (populated(customer[field]) || !hasCustomerAddress(customer, side)) continue;
      if (side === 'billing') counts.missingBillingStateWithAddress++; else counts.missingShippingStateWithAddress++;
      const matches = sourceIds.get(customer.externalAccountingId!) ?? [];
      const qb = matches[0];
      const address = side === 'billing' ? qb?.BillAddr : qb?.ShipAddr;
      let decision: string;
      if (customer.isActive === false || customer.mergedIntoCustomerId || ['archived', 'superseded', 'inactive', 'suspended'].includes(customer.status ?? '')) decision = 'inactive_or_merged';
      else if (!isLinked) decision = 'no_quickbooks_link';
      else if (localIds.get(customer.externalAccountingId!) !== 1) decision = 'duplicate_local_linkage';
      else if (source === null) decision = 'source_not_read';
      else if (matches.length !== 1) decision = matches.length ? 'duplicate_source_id' : 'source_customer_missing';
      else if (qb.Active === false) decision = 'source_inactive';
      else if (!normalizeQBCustomerAddress(address).State) decision = 'source_state_missing';
      else decision = assessQBCustomerAddress(side, address, customer);
      const state = normalizeQBCustomerAddress(address).State;
      if (decision === 'same_address') decision = state ? 'proposed' : 'source_state_missing';
      const proposed = decision === 'proposed';
      const evidence = {
        organizationId, customerId: customer.id, quickBooksCustomerId: customer.externalAccountingId,
        local: Object.fromEntries(customerAddressFields.filter(key => key.startsWith(side)).map(key => [key, customer[key] ?? null])),
        overrides: customer.qbFieldOverrides ?? null, source: address,
      };
      rows.push({ customerId: customer.id, quickBooksCustomerId: customer.externalAccountingId, side, field, decision,
        ...(proposed ? { proposedValue: state, evidenceHash: createHash('sha256').update(stableStateEvidence(evidence)).digest('hex') } : {}),
      });
      if (proposed) counts.proposedStateFields++; else counts.skippedStateFields++;
    }
  }
  const proposed = rows.filter(row => row.decision === 'proposed');
  counts.recoverableCustomers = new Set(proposed.map(row => row.customerId)).size;
  counts.recoverableBillingStates = proposed.filter(row => row.side === 'billing').length;
  counts.recoverableShippingStates = proposed.filter(row => row.side === 'shipping').length;
  const decisions = Object.fromEntries(Array.from(new Set(rows.map(row => row.decision))).sort().map(decision => [decision, rows.filter(row => row.decision === decision).length]));
  return { version: 2 as const, mode: 'DRY_RUN_READ_ONLY' as const, organizationId, sourceRead: source !== null, counts, decisions, rows };
}
