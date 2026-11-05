import { forwardRef, useCallback, useEffect, useId, useRef, useState, type ComponentProps } from 'react';
import { Input } from './input';

type NumberDraftInputProps = Omit<ComponentProps<typeof Input>, 'type' | 'value' | 'onChange' | 'min' | 'max'> & {
  value: number | string | null | undefined;
  onCommit: (value: number | null) => void;
  onPendingChange?: (pending: boolean) => void;
  onDraftEdit?: () => void;
  integerOnly?: boolean;
  min?: number;
  max?: number;
};

export function parseDecimalDraft(text: string): number | null {
  const raw = text.trim();
  if (!raw) return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) || !Number.isFinite(Number(raw)))
    throw new Error('Enter a valid decimal number.');
  return Number(raw);
}

/** Keep partial text/caret local; publish a canonical number only on blur/Enter. */
export const NumberDraftInput = forwardRef<HTMLInputElement, NumberDraftInputProps>(function NumberDraftInput({
  value, onCommit, onPendingChange, onDraftEdit, integerOnly = false, min, max,
  onFocus, onBlur, onKeyDown, 'aria-describedby': describedBy, ...props
}, ref) {
  const [draft, setDraft] = useState(String(value ?? ''));
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const assignRef = useCallback((input: HTMLInputElement | null) => {
    inputRef.current = input;
    if (typeof ref === 'function') ref(input); else if (ref) ref.current = input;
  }, [ref]);
  const lastCommitted = useRef(String(value ?? ''));
  const pendingCallback = useRef(onPendingChange); pendingCallback.current = onPendingChange;
  const errorId = useId();
  useEffect(() => {
    if (!focused.current) {
      setDraft(String(value ?? '')); lastCommitted.current = String(value ?? ''); setError(null);
      inputRef.current?.setCustomValidity(''); pendingCallback.current?.(false);
    }
  }, [value]);
  useEffect(() => () => pendingCallback.current?.(false), []);
  const commit = (input: HTMLInputElement) => {
    try {
      const number = parseDecimalDraft(draft);
      if (number !== null && integerOnly && !Number.isInteger(number)) throw new Error('Enter a whole number.');
      if (number !== null && min !== undefined && number < min) throw new Error(`Minimum ${min}.`);
      if (number !== null && max !== undefined && number > max) throw new Error(`Maximum ${max}.`);
      const normalized = number === null ? '' : String(number);
      input.setCustomValidity(''); setError(null); setDraft(normalized);
      pendingCallback.current?.(false);
      if (normalized !== lastCommitted.current) { lastCommitted.current = normalized; onCommit(number); }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Enter a valid number.';
      input.setCustomValidity(message); setError(message); pendingCallback.current?.(true);
    }
  };
  return <>
    <Input {...props} ref={assignRef} type="text" inputMode={integerOnly ? 'numeric' : 'decimal'} value={draft}
      aria-invalid={Boolean(error) || props['aria-invalid']}
      aria-describedby={[describedBy, error ? errorId : null].filter(Boolean).join(' ') || undefined}
      onFocus={event => { focused.current = true; onFocus?.(event); }}
      onChange={event => { setDraft(event.currentTarget.value); setError(null); event.currentTarget.setCustomValidity(''); pendingCallback.current?.(true); onDraftEdit?.(); }}
      onBlur={event => { focused.current = false; commit(event.currentTarget); onBlur?.(event); }}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } onKeyDown?.(event); }}/>
    {error ? <span id={errorId} role="alert" className="text-xs text-destructive">{error}</span> : null}
  </>;
});
