import React, { useEffect, useState } from "react";

export type CurrencyEditParse =
  | Readonly<{ kind: "empty" | "incomplete" | "invalid" }>
  | Readonly<{ kind: "valid"; cents: number }>;

/** Formats the canonical integer-cent value only when the input is not being
 * actively edited. The editor itself keeps the user's dollar text intact. */
export function formatCentsForEdit(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

/** Parses decimal dollars without floating-point conversion. Incomplete values
 * remain in local edit state until blur, rather than being reformatted while a
 * user is still placing the decimal fraction. */
export function parseCurrencyEdit(raw: string): CurrencyEditParse {
  if (raw === "") return { kind: "empty" };
  if (!/^\d*(?:\.\d{0,2})?$/.test(raw)) return { kind: "invalid" };
  if (raw === "." || raw.endsWith(".")) return { kind: "incomplete" };
  const [wholeText = "0", fractionText = ""] = raw.split(".");
  const whole = Number(wholeText || "0");
  if (!Number.isSafeInteger(whole) || whole > Math.floor(Number.MAX_SAFE_INTEGER / 100)) return { kind: "invalid" };
  const fraction = Number(`${fractionText}00`.slice(0, 2));
  return { kind: "valid", cents: whole * 100 + fraction };
}

/** The blur boundary intentionally accepts unfinished decimal input such as
 * `7.` as $7.00, but rejects malformed values rather than changing the
 * canonical amount behind the user's back. */
export function normalizeCurrencyOnBlur(raw: string): string | null {
  const parsed = parseCurrencyEdit(raw);
  if (parsed.kind === "empty") return "";
  if (parsed.kind === "invalid") return null;
  if (parsed.kind === "incomplete") {
    const whole = raw === "." ? "0" : raw.slice(0, -1) || "0";
    return formatCentsForEdit(Number(whole) * 100);
  }
  if (parsed.kind === "valid") return formatCentsForEdit(parsed.cents);
  return null;
}

export function ProductBuilderMoneyInput({
  value,
  onChange,
  disabled,
  className = "",
  placeholder,
  ariaLabel,
}: Readonly<{
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
}>) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => formatCentsForEdit(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!editing) {
      setText(formatCentsForEdit(value));
      setInvalid(false);
    }
  }, [editing, value]);

  const commit = (raw: string) => {
    const parsed = parseCurrencyEdit(raw);
    if (parsed.kind === "empty") onChange(null);
    else if (parsed.kind === "valid") onChange(parsed.cents);
    else if (parsed.kind === "incomplete") {
      const normalized = normalizeCurrencyOnBlur(raw);
      if (normalized !== null) {
        const normalizedParsed = parseCurrencyEdit(normalized);
        if (normalizedParsed.kind === "valid") onChange(normalizedParsed.cents);
      }
    }
  };

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[0.75rem] text-muted-foreground">$</span>
      <input
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={`num h-8 pl-5 text-[0.8125rem] ${className}`}
        disabled={disabled}
        inputMode="decimal"
        placeholder={placeholder}
        type="text"
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(event) => {
          const next = event.target.value;
          const parsed = parseCurrencyEdit(next);
          if (parsed.kind === "invalid") {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          setText(next);
          if (parsed.kind === "empty") onChange(null);
          else if (parsed.kind === "valid") onChange(parsed.cents);
        }}
        onBlur={() => {
          const normalized = normalizeCurrencyOnBlur(text);
          if (normalized === null) {
            setText(formatCentsForEdit(value));
            setInvalid(false);
          } else {
            commit(text);
            setText(normalized);
            setInvalid(false);
          }
          setEditing(false);
        }}
      />
    </div>
  );
}
