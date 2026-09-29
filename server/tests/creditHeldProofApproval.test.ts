import { beforeAll, beforeEach, expect, jest, test } from '@jest/globals';
const transition = jest.fn<any>();
const credit = jest.fn<any>();
jest.unstable_mockModule('../services/lineItemWorkflowService', () => ({ transitionLineItemWorkflowState: transition, getInitialWorkflowState: jest.fn(), completeLineItemDesign: jest.fn(), returnLineItemToPrepressForProductionRecovery: jest.fn(), workflowStateRequiresActiveOwner: jest.fn(), workflowStateIsIntentionallyOwnerless: jest.fn(), NON_TERMINAL_WORKFLOW_STATES: [], TERMINAL_WORKFLOW_STATES: [], OWNERSHIP_REQUIRED_WORKFLOW_STATES: [], OWNERLESS_WORKFLOW_STATES: [] }));
jest.unstable_mockModule('../services/orderCreditHoldService', () => ({ getOrderCreditHold: credit, assertProductionCredit: jest.fn() }));
jest.unstable_mockModule('../services/proofGateService', () => ({ resolveLineItemProofReleaseGate: async () => ({ allowed: true }) }));
let reconcile: typeof import('../services/proofingService').reconcileLineItemProofGateRelease;
const line = { lineItemId: 'line', orderId: 'order', workflowState: 'awaiting_proof_approval', lifecycleStatus: 'new', requiresPrepress: false };
const q: any = { from: () => q, innerJoin: () => q, where: () => q, limit: async () => [line] };
const tx = { select: () => q };
beforeAll(async () => { reconcile = (await import('../services/proofingService')).reconcileLineItemProofGateRelease; });
beforeEach(() => { jest.clearAllMocks(); transition.mockImplementation(async (_tx: any, args: any) => args); });
test('accepted proof remains approved and moves to preparatory ownership during a hold', async () => {
  credit.mockResolvedValue({ creditHold: { held: true } });
  await expect(reconcile(tx, { organizationId: 'org', lineItemId: 'line', source: 'proof_approval' })).resolves.toMatchObject({ toState: 'ready_for_prepress' });
  expect(transition).toHaveBeenCalledWith(tx, expect.objectContaining({ metadata: { source: 'proof_approval', proofGateAllowed: true } }));
});
test('approved proof can release normally when financially eligible', async () => {
  credit.mockResolvedValue({ creditHold: { held: false } });
  await expect(reconcile(tx, { organizationId: 'org', lineItemId: 'line', source: 'proof_approval' })).resolves.toMatchObject({ toState: 'ready_for_production' });
});
