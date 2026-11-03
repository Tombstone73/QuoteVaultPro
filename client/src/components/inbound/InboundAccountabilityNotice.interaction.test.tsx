import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { InboundAccountabilityNotice } from "./InboundAccountabilityNotice";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => localStorage.clear());
test("linked evidence preserves disclosure preference and does not reopen for changed evidence", async () => {
  const host = document.createElement('div'); document.body.append(host);
  let root = createRoot(host);
  const record = { status: 'submitted', createdOrderId: 'order/1' };
  const toggle = () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  const details = () => document.getElementById(toggle().getAttribute('aria-controls')!)!;
  try {
    await act(async () => root.render(<InboundAccountabilityNotice record={record} />));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(details().hidden).toBe(true);
    await act(async () => toggle().click());
    expect(details().className).toContain('max-h-48');
    expect(details().className).toContain('overflow-y-auto');
    expect(localStorage.getItem('titanos.inboundOrders.linkedEvidenceExpanded')).toBe('true');
    await act(async () => root.unmount()); root = createRoot(host);
    await act(async () => root.render(<InboundAccountabilityNotice record={record} />));
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    await act(async () => toggle().click());
    await act(async () => root.render(<InboundAccountabilityNotice record={{...record, normalizedPayloadJson: {unresolvedEvidenceFingerprint:'new'}}} />));
    expect(toggle().textContent).toContain('linked Order requires review');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(details().hidden).toBe(true);
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/orders/order%2F1');
    expect(localStorage.getItem('titanos.inboundOrders.emailImportExpanded')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
