import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test } from '@jest/globals';
import { PrintBridgeRecovery, PrintBridgeConnection } from './PrintBridgeRecovery';
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
test('restart explains the authorized local controller and never sends a fictitious restart request', () => {
  act(() => root.render(<PrintBridgeRecovery />));
  act(() => host.querySelector('button')!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('browser cannot control a Windows service');
  expect(dialog.textContent).toContain('manage-agent-task.ps1 -Action restart');
  expect(dialog.textContent).toContain('If the task/controller is missing');
  expect(dialog.textContent).toContain('claimed or completed jobs');
  expect(dialog.querySelector('button')).toBeTruthy();
});
test('connection states have explicit text, heartbeat and safe errors, including old agents and revoked credentials', () => {
  for (const [state, expected] of [['connected', 'Connected'], ['reconnecting', 'Reconnecting'], ['disconnected', 'Disconnected'], ['authentication_required', 'Authentication Required']] as const) {
    act(() => root.render(<PrintBridgeConnection status="active" connectionHealth={{ state, error: 'pairing_required', reportedAt: new Date().toISOString() }} />));
    expect(host.textContent).toContain(expected); expect(host.textContent).toContain('Last heartbeat:'); expect(host.textContent).toContain('setup-agent.cmd');
  }
  act(() => root.render(<PrintBridgeConnection status="active" />)); expect(host.textContent).toContain('not reported');
  act(() => root.render(<PrintBridgeConnection status="revoked" />)); expect(host.textContent).toContain('Authentication Required');
});
