import React, { useEffect, useRef, useState } from "react";
import type { CustomerCatalogItem } from "./api";
import { useCustomerLookup } from "./quoteFormQueries";

const customerName = (customer: CustomerCatalogItem): string => customer.displayName || customer.companyName;

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
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedName, setSelectedName] = useState("");
  const blurTimer = useRef<ReturnType<typeof setTimeout>>();
  const input = useRef<HTMLInputElement>(null);
  const results = useCustomerLookup(sessionScope, organizationId, query, focused);
  const customers = results.data?.items ?? [];

  useEffect(() => input.current?.focus(), []);
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
    setFocused(false);
    onChange(customer);
  };
  const clear = (value: string) => {
    setFocused(true);
    setQuery(value);
    setSelectedName("");
    if (customerId) onChange(undefined);
  };
  const visible = focused && query.trim().length > 0;
  const value = focused ? query : selectedName;
  return <label className="field v2-sales-customer-lookup">
    Customer
    <input
      ref={input}
      aria-label="Customer"
      aria-autocomplete="list"
      aria-controls="v2-sales-customer-results"
      aria-expanded={visible}
      autoComplete="off"
      role="combobox"
      value={value}
      placeholder="Search customers"
      onFocus={() => { if (blurTimer.current) clearTimeout(blurTimer.current); setFocused(true); }}
      onBlur={() => { blurTimer.current = setTimeout(() => setFocused(false), 120); }}
      onChange={(event) => clear(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" && customers.length) { event.preventDefault(); setActiveIndex((current) => Math.min(current + 1, customers.length - 1)); }
        else if (event.key === "ArrowUp" && customers.length) { event.preventDefault(); setActiveIndex((current) => Math.max(current - 1, 0)); }
        else if (event.key === "Enter" && customers[activeIndex]) { event.preventDefault(); select(customers[activeIndex]!); }
        else if (event.key === "Escape") { setFocused(false); input.current?.blur(); }
      }}
    />
    {visible && <div id="v2-sales-customer-results" className="v2-sales-customer-results" role="listbox">
      {results.isLoading && <span>Searching Customers…</span>}
      {results.isError && <span>Customers are unavailable. Try again.</span>}
      {results.isSuccess && !customers.length && <span>No Customers match this search.</span>}
      {customers.map((customer, index) => <button
        key={customer.customerId}
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
