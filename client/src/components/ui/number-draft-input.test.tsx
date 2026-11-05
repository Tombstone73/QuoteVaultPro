import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { NumberDraftInput, parseDecimalDraft } from './number-draft-input';

jest.mock('@/contexts/WorkspaceContext', () => ({ useWorkspaceFieldProps: (props: unknown) => props }));
let root: Root, host: HTMLDivElement;
const commit = jest.fn<(value: number | null) => void>(), pending = jest.fn<(pending: boolean) => void>();
const input = () => host.querySelector('input')!;
const type = (text: string) => act(() => { input().value = text; Simulate.change(input()); });
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); commit.mockReset(); pending.mockReset();
  act(() => root.render(<NumberDraftInput aria-label="Dimension" value={15} onCommit={commit} onPendingChange={pending}/>));
  act(() => input().focus());
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

test.each(['15.', '0.', '.5', '15.5', '15.25', '100.125', ''])('preserves raw %s until blur and publishes only a number/null', raw => {
  type(raw); expect(input().value).toBe(raw); expect(input().type).toBe('text'); expect(commit).not.toHaveBeenCalled();
  expect(pending).toHaveBeenLastCalledWith(true);
  act(() => input().blur()); expect(input().value).toBe(raw === '' ? '' : String(Number(raw)));
  if (Number(raw) === 15 && raw !== '') expect(commit).not.toHaveBeenCalled();
  else expect(commit).toHaveBeenCalledWith(raw === '' ? null : Number(raw));
  expect(pending).toHaveBeenLastCalledWith(false);
});

test.each(['15..25', '15junk', '1,5', '.', 'Infinity', '0x10', '1e3'])('rejects malformed %s without changing its meaning or publishing it', raw => {
  type(raw); act(() => input().blur());
  expect(input().value).toBe(raw); expect(commit).not.toHaveBeenCalled(); expect(input().validity.valid).toBe(false);
  expect(input().getAttribute('aria-invalid')).toBe('true'); expect(host.querySelector('[role="alert"]')).not.toBeNull();
});

test('preserves caret and draft through parent rerenders and digit deletion/replacement', () => {
  type('15.25'); input().setSelectionRange(2, 2);
  act(() => root.render(<NumberDraftInput aria-label="Dimension" value={15} onCommit={commit} onPendingChange={pending}/>));
  expect(input().value).toBe('15.25'); expect(input().selectionStart).toBe(2);
  type('1.25'); type('19.25'); expect(commit).not.toHaveBeenCalled();
  act(() => input().blur()); expect(commit).toHaveBeenCalledTimes(1); expect(commit).toHaveBeenCalledWith(19.25);
});

test('Enter commits once and unchanged/saved dimensions do not trigger extra commits', () => {
  expect(input().value).toBe('15'); type('15.25');
  act(() => Simulate.keyDown(input(), { key: 'Enter' })); expect(commit).toHaveBeenCalledTimes(1);
  expect(commit).toHaveBeenCalledWith(15.25);
});

test('integer and range constraints reject rather than truncate or clamp', () => {
  act(() => root.render(<NumberDraftInput value={15} onCommit={commit} integerOnly min={1} max={20}/>));
  type('15.25'); act(() => input().blur()); expect(commit).not.toHaveBeenCalled(); expect(host.textContent).toContain('whole number');
  act(() => input().focus()); type('21'); act(() => input().blur()); expect(commit).not.toHaveBeenCalled(); expect(host.textContent).toContain('Maximum 20');
  act(() => input().focus()); type('0'); act(() => input().blur()); expect(commit).not.toHaveBeenCalled(); expect(host.textContent).toContain('Minimum 1');
});

test('existing fractional precision is preserved without introducing fixed rounding', () => {
  expect(parseDecimalDraft('100.125')).toBe(100.125); expect(parseDecimalDraft('.5')).toBe(0.5);
});

test('an explicit external value refresh clears old native validity when the field is not being edited', () => {
  type('bad'); act(() => input().blur()); expect(input().validity.valid).toBe(false);
  act(() => root.render(<NumberDraftInput value={24.125} onCommit={commit} onPendingChange={pending}/>));
  expect(input().value).toBe('24.125'); expect(input().validity.valid).toBe(true); expect(pending).toHaveBeenLastCalledWith(false);
});
