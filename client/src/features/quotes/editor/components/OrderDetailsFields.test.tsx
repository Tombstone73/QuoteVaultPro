import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { OrderDueDateField } from './OrderDetailsFields';
import { dateOnlyDeadline, type OrderDeadline } from '@shared/orderDeadline';
jest.mock('@/lib/queryClient', () => ({ apiFetch: jest.fn(async () => ({ ok: true, json: async () => ({ timezone: 'America/New_York' }) })) }));
let host: HTMLDivElement, root: Root;
function Editor() {
    const [date, setDate] = useState('2026-11-10');
    const [deadline, setDeadline] = useState<OrderDeadline | null>(dateOnlyDeadline(date));
    return <><OrderDueDateField id="due" value={date} onChange={setDate} deadline={deadline} onDeadlineChange={setDeadline}/><output>{JSON.stringify(deadline)}</output></>;
}
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
test('shared Order/inbound control retains EOD and specific time until explicitly changed', async () => {
    await act(async () => root.render(<Editor />));
    const type = host.querySelector('select')!;
    await act(async () => Simulate.change(type, { target: { value: 'eod' } } as any));
    expect(host.querySelector('output')!.textContent).toContain('"kind":"eod"');
    expect(host.querySelector('input[type=time]')).toBeNull();
    expect(host.textContent).toContain('America/New_York');
    await act(async () => Simulate.change(type, { target: { value: 'time' } } as any));
    expect(host.querySelector('[role=alert]')!.textContent).toContain('Enter a specific');
    await act(async () => Simulate.change(host.querySelector('input[type=time]')!, { target: { value: '16:45' } } as any));
    expect(host.querySelector('output')!.textContent).toContain('"localTime":"16:45"');
    expect(host.querySelector('[role=alert]')).toBeNull();
    await act(async () => root.render(<Editor />));
    expect((host.querySelector('input[type=time]') as HTMLInputElement).value).toBe('16:45');
    await act(async () => Simulate.change(type, { target: { value: 'date_only' } } as any));
    expect(host.querySelector('output')!.textContent).toContain('"localTime":null');
    await act(async () => Simulate.change(host.querySelector('input[type=date]')!, { target: { value: '' } } as any));
    expect(type.disabled).toBe(true);
    expect(host.querySelector('output')!.textContent).toBe('null');
});
test('legacy caller stays date-only and read-only disables semantic changes', () => {
    act(() => root.render(<OrderDueDateField id="legacy" value="2020-01-02" onChange={() => { }} readOnly/>));
    expect(host.querySelector('select')).toBeNull();
    expect((host.querySelector('input') as HTMLInputElement).readOnly).toBe(true);
    act(() => root.render(<OrderDueDateField id="legacy" value="2020-01-02" onChange={() => { }} onDeadlineChange={() => { }} readOnly/>));
    expect(host.querySelector('select')!.disabled).toBe(true);
});
