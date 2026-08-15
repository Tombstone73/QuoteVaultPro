import React from "react";
import type { Selection } from "./api";

export const SelectionField = ({
  label,
  value,
  options,
  identity,
  emptyLabel,
  disabled = false,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  options: readonly Selection[];
  identity: "customerId" | "contactId" | "productId";
  emptyLabel: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}>) => (
  <label className="field">
    {label}
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{emptyLabel}</option>
      {options.map((option) => {
        const id = option[identity];
        return id ? (
          <option key={id} value={id}>
            {option.displayName}
          </option>
        ) : null;
      })}
    </select>
  </label>
);
