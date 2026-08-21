import React, { useEffect, useRef, useState } from "react";
import type { CustomerCatalogItem } from "./api";
import { useCustomerLookup } from "./quoteFormQueries";

const customerName = (customer: CustomerCatalogItem): string => customer.displayName || customer.companyName;

export type CustomerLookupKeyAction = Readonly<{
  open: boolean;
  activeIndex: number;
  selectActive?: boolean;
  close?: boolean;
}>;

/** Keeps keyboard behavior deterministic for the shared Quote and Order picker. */
export const customerLookupKeyAction = (
  key: string,
  open: boolean,
  activeIndex: number,
  resultCount: number,
): CustomerLookupKeyAction | undefined => {
  if (key === "ArrowDown") return { open: true, activeIndex: open && resultCount ? Math.min(activeIndex + 1, resultCount - 1) : 0 };
  if (key === "ArrowUp") return { open: true, activeIndex: open && resultCount ? Math.max(activeIndex - 1, 0) : 0 };
  if (key === "Enter" && open && resultCount) return { open, activeIndex, selectActive: true };
  if (key === "Escape") return { open: false, activeIndex: 0, close: true };
  return undefined;
};

/**
 * A CRM-backed combobox for Sales entry. It intentionally never treats a
 * first page of Customers as the whole tenant catalog.
 */
export const CustomerLookup = ({
  organizationId,
  sessionScope,
  customerId,
  onChange,
}: Readonly<{
  organizationId: string;
  sessionScope: string;
  customerId: string;
  onChange: (customer: CustomerCatalogItem | undefined) => void;
}>) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedName, setSelectedName] = useState("");
  const blurTimer = useRef<ReturnType<typeof setTimeout>>();
  const input = useRef<HTMLInputElement>(null);
  const results = useCustomerLookup(sessionScope, organizationId, query, open);
  const customers = results.data?.items ?? [];

  useEffect(() => {
    if (!customerId) setSelectedName("");
  }, [customerId]);
  useEffect(() => setActiveIndex(0), [query, customers.length]);
  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  const select = (customer: CustomerCatalogItem) => {
    setSelectedName(customerName(customer));
    setQuery("");
    setOpen(false);
    onChange(customer);
  };
  const clear = (value: string) => {
    setOpen(true);
    setQuery(value);
    setSelectedName("");
    if (customerId) onChange(undefined);
  };
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const value = open ? query : selectedName;
  const activeOptionId = customers[activeIndex]
    ? `v2-sales-customer-option-${customers[activeIndex]!.customerId}`
    : undefined;
  return <label className="field v2-sales-customer-lookup">
    Customer
    <input
      ref={input}
      aria-label="Customer"
      aria-autocomplete="list"
      aria-controls="v2-sales-customer-results"
      aria-activedescendant={open ? activeOptionId : undefined}
      aria-expanded={open}
      aria-haspopup="listbox"
      autoComplete="off"
      role="combobox"
      value={value}
      placeholder="Search or browse customers"
      onFocus={() => { if (blurTimer.current) clearTimeout(blurTimer.current); setOpen(true); }}
      onClick={() => { if (blurTimer.current) clearTimeout(blurTimer.current); setOpen(true); }}
      onBlur={() => { blurTimer.current = setTimeout(close, 120); }}
      onChange={(event) => clear(event.currentTarget.value)}
      onKeyDown={(event) => {
        const action = customerLookupKeyAction(event.key, open, activeIndex, customers.length);
        if (!action) return;
        event.preventDefault();
        setOpen(action.open);
        setActiveIndex(action.activeIndex);
        if (action.selectActive && customers[activeIndex]) select(customers[activeIndex]!);
        if (action.close) { setQuery(""); input.current?.blur(); }
      }}
    />
    {open && <div id="v2-sales-customer-results" className="v2-sales-customer-results" role="listbox" aria-label="Customer results">
      {results.isLoading && <span>{query.trim() ? "Searching Customers…" : "Loading Customers…"}</span>}
      {results.isError && <span>Customers are unavailable. Try again.</span>}
      {results.isSuccess && !customers.length && <span>{query.trim() ? "No Customers match this search." : "No Customers are available."}</span>}
      {customers.map((customer, index) => <button
        key={customer.customerId}
        id={`v2-sales-customer-option-${customer.customerId}`}
        type="button"
        role="option"
        aria-selected={index === activeIndex}
        className={index === activeIndex ? "active" : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => select(customer)}
      >{customerName(customer)}</button>)}
    </div>}
  </label>;
};
