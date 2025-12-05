import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { Customer, CustomerContact } from "@shared/schema";

export type CustomerWithContacts = Customer & {
  contacts?: CustomerContact[];
};

interface CustomerSelectProps {
  value: string | null;
  onChange: (customerId: string | null, customer?: CustomerWithContacts, contactId?: string | null) => void;
  autoFocus?: boolean;
  label?: string;
  placeholder?: string;
  initialCustomer?: CustomerWithContacts;
  disabled?: boolean;
}

export function CustomerSelect({
  value,
  onChange,
  autoFocus = true,
  label = "Customer",
  placeholder = "Search customers...",
  initialCustomer,
  disabled = false,
}: CustomerSelectProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce search input
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 250);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery]);

  // Fetch customers with search
  const { data: customers = [], isLoading } = useQuery<CustomerWithContacts[]>({
    queryKey: ["/api/customers", { search: debouncedSearch }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) {
        params.set("search", debouncedSearch);
      }
      const url = `/api/customers${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch customers");
      return response.json();
    },
    staleTime: 30000,
  });

  // Fetch contacts for selected customer if not already loaded
  const { data: customerDetail } = useQuery<CustomerWithContacts>({
    queryKey: ["/api/customers", value],
    queryFn: async () => {
      if (!value) throw new Error("No customer ID");
      const response = await fetch(`/api/customers/${value}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch customer");
      return response.json();
    },
    enabled: !!value && !initialCustomer?.contacts,
  });

  // Get the selected customer
  const selectedCustomer = initialCustomer || customerDetail || customers.find(c => c.id === value);

  // Update input display when customer is selected
  useEffect(() => {
    if (value && selectedCustomer && !searchQuery) {
      // Input is not being edited, show customer name
    } else if (!value) {
      setSearchQuery("");
    }
  }, [value, selectedCustomer]);

  // Auto-focus when component mounts
  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [autoFocus]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset highlighted index when search changes
  useEffect(() => {
    setHighlightedIndex(0);
  }, [debouncedSearch]);

  // Build display items that include customer and their contacts
  const displayItems: Array<{
    type: 'customer' | 'contact';
    customer: CustomerWithContacts;
    contact?: CustomerContact;
    searchText: string;
  }> = [];

  customers.forEach(customer => {
    displayItems.push({
      type: 'customer',
      customer,
      searchText: customer.companyName,
    });

    if (debouncedSearch && customer.contacts && customer.contacts.length > 0) {
      customer.contacts.forEach(contact => {
        const contactName = `${contact.firstName} ${contact.lastName}`.trim();
        const contactSearch = `${contactName} ${contact.email || ''} ${contact.phone || ''}`.toLowerCase();
        
        if (contactSearch.includes(debouncedSearch.toLowerCase())) {
          displayItems.push({
            type: 'contact',
            customer,
            contact,
            searchText: contactName,
          });
        }
      });
    }
  });

  // Handle customer selection
  const handleSelectCustomer = useCallback((customer: CustomerWithContacts, matchedContactId?: string) => {
    let contactId: string | null = null;
    
    if (matchedContactId) {
      contactId = matchedContactId;
    } else if (customer.contacts && customer.contacts.length > 0) {
      const primaryContact = customer.contacts.find(c => c.isPrimary);
      contactId = primaryContact?.id || customer.contacts[0].id;
    }

    onChange(customer.id, customer, contactId);
    setSearchQuery(customer.companyName);
    setShowDropdown(false);
  }, [onChange]);

  // Clear selection
  const handleClear = useCallback(() => {
    onChange(null, undefined, null);
    setSearchQuery("");
    inputRef.current?.focus();
  }, [onChange]);

  // Handle input focus
  const handleFocus = () => {
    // Only show dropdown if user has typed something or there's a search query
    if (searchQuery.length > 0) {
      setShowDropdown(true);
    }
  };

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setSearchQuery(newValue);
    
    // Show dropdown when user starts typing
    if (newValue.length > 0) {
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
    }
    
    // Clear selection if user is typing and current value doesn't match
    if (value && selectedCustomer && newValue !== selectedCustomer.companyName) {
      onChange(null, undefined, null);
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown && e.key !== 'Escape') {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setShowDropdown(true);
        return;
      }
    }

    if (!showDropdown) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) => 
          prev < displayItems.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case "Enter":
        e.preventDefault();
        if (displayItems[highlightedIndex]) {
          const item = displayItems[highlightedIndex];
          handleSelectCustomer(
            item.customer,
            item.type === 'contact' ? item.contact?.id : undefined
          );
        }
        break;
      case "Escape":
        e.preventDefault();
        setShowDropdown(false);
        break;
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (dropdownRef.current && showDropdown) {
      const highlightedElement = dropdownRef.current.querySelector(
        `[data-index="${highlightedIndex}"]`
      ) as HTMLElement;
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex, showDropdown]);

  // Get display value for input
  const displayValue = searchQuery || (value && selectedCustomer ? selectedCustomer.companyName : "");

  return (
    <div className="space-y-2" ref={containerRef}>
      {label && (
        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          {label}
        </label>
      )}
      
      <div className="relative">
        {/* Single Input Field */}
        <Input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={displayValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className="w-full pr-8"
          autoComplete="off"
        />
        
        {/* Clear button */}
        {value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {/* Dropdown Results */}
        {showDropdown && (displayItems.length > 0 || isLoading) && (
          <div
            ref={dropdownRef}
            className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-[300px] overflow-y-auto"
          >
            {isLoading ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                Loading customers...
              </div>
            ) : displayItems.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                No customers found.
              </div>
            ) : (
              <div className="py-1">
                {displayItems.map((item, index) => {
                  const isSelected = value === item.customer.id;
                  const isHighlighted = index === highlightedIndex;
                  const key = item.type === 'contact' 
                    ? `contact-${item.contact?.id}-${index}` 
                    : `customer-${item.customer.id}`;

                  return (
                    <div
                      key={key}
                      data-index={index}
                      className={cn(
                        "flex items-start px-3 py-2 cursor-pointer transition-colors",
                        item.type === 'contact' && "pl-9",
                        isHighlighted && "bg-accent text-accent-foreground",
                        isSelected && "bg-accent/50",
                        "hover:bg-accent hover:text-accent-foreground"
                      )}
                      onClick={() => handleSelectCustomer(
                        item.customer,
                        item.type === 'contact' ? item.contact?.id : undefined
                      )}
                      onMouseEnter={() => setHighlightedIndex(index)}
                    >
                      {/* Icon */}
                      {item.type === 'customer' ? (
                        <Building2 className="h-4 w-4 mr-2 flex-shrink-0 mt-0.5 text-muted-foreground" />
                      ) : (
                        <User className="h-4 w-4 mr-2 flex-shrink-0 mt-0.5 text-muted-foreground" />
                      )}

                      {/* Content */}
                      <div className="flex flex-col flex-1 min-w-0">
                        {item.type === 'customer' ? (
                          <>
                            <div className="font-medium truncate text-sm">
                              {item.customer.companyName}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {item.customer.email && <span>{item.customer.email}</span>}
                              {item.customer.phone && (
                                <>
                                  {item.customer.email && <span className="mx-1">•</span>}
                                  <span>{item.customer.phone}</span>
                                </>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="font-medium truncate text-sm">
                              {item.searchText}
                              {item.contact?.isPrimary && (
                                <span className="ml-2 text-xs text-muted-foreground">(Primary)</span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              <span className="font-medium">{item.customer.companyName}</span>
                              {item.contact?.email && (
                                <>
                                  <span className="mx-1">•</span>
                                  <span>{item.contact.email}</span>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Show selected customer details below input */}
      {value && selectedCustomer && !showDropdown && (
        <div className="text-xs text-muted-foreground">
          {selectedCustomer.email && `${selectedCustomer.email}`}
        </div>
      )}
    </div>
  );
}
