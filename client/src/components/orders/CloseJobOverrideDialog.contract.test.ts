import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const source = fs.readFileSync(path.join(process.cwd(), 'client/src/components/orders/CloseJobOverrideDialog.tsx'), 'utf8');

test('Close Job Override uses the canonical preview before deciding whether production must run', () => {
  expect(source).toContain('if (!previewQuery.data?.productionComplete)');
  expect(source).toContain('/complete-production');
  expect(source).toContain('/reconcile-historical-fulfillment');
});

test('Close Job Override turns structured backend failures into an operator-safe message', () => {
  expect(source).toContain('function overrideErrorDescription');
  expect(source).toContain('one or more physical line items still need production completion');
  expect(source).toContain('description: overrideErrorDescription(error)');
});
