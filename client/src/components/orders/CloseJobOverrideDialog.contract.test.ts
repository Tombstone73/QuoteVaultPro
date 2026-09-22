import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const source = fs.readFileSync(path.join(process.cwd(), 'client/src/components/orders/CloseJobOverrideDialog.tsx'), 'utf8');

test('Close Job Override uses the canonical preview before deciding whether production must run', () => {
  expect(source).toContain('if (!previewQuery.data?.productionComplete)');
  expect(source).toContain('/complete-production');
  expect(source).toContain('/reconcile-historical-fulfillment');
});

test('Close Job Override actions render only from the backend canonical eligibility projection', () => {
  expect(source).toContain('useCloseJobOverrideEligibility');
  expect(source).toContain('isCloseJobOverrideEligible(previewQuery.data)');
  expect(source).toContain('canCloseJobOverride: boolean');
});

test('Close Job Override requires a live bootstrap acknowledgement when any remaining line has no owner', () => {
  expect(source).toContain('productionStarted: boolean');
  expect(source).toContain('activeProductionJobCount: number');
  expect(source).toContain('requiresProductionBootstrap: boolean');
  expect(source).toContain('productionBootstrapLineCount?: number');
  expect(source).toContain('confirmProductionBootstrap: true');
  expect(source).toContain('closeJobOverride: true');
  expect(source).toContain('requiresParentProductionRecovery');
  expect(source).toContain('reconciliationReason: reason');
  expect(source).toContain('I understand production will be started and completed by this override.');
  expect(source).toContain('previewQuery.data?.requiresProductionBootstrap && !productionBootstrapAcknowledged');
});

test('Close Job Override turns structured backend failures into an operator-safe message', () => {
  expect(source).toContain('function overrideErrorDescription');
  expect(source).toContain('one or more physical line items still need production completion');
  expect(source).toContain('description: overrideErrorDescription(error)');
});

test('closed Orders display Closed ahead of their terminal fulfillment history', () => {
  expect(source).toContain('orderState || "").toLowerCase() === "closed") return "Closed"');
  expect(source.indexOf('return "Closed"')).toBeLessThan(source.indexOf('return "Fulfillment Complete"'));
});
