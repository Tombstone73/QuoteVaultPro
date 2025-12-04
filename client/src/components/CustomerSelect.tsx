import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
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
    staleTime: 30000, // Cache for 30 seconds to prevent flickering
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

  // Get the selected customer (from initial data, detail fetch, or search results)
  const selectedCustomer = initialCustomer || customerDetail || customers.find(c => c.id === value);

  // Auto-focus and auto-open when component mounts
  useEffect(() => {
    if (autoFocus && !value) {
      // Open the popover and focus the input
      setOpen(true);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [autoFocus, value]);

  // Focus input when popover opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  }, [open]);

  // Handle customer selection
  const handleSelectCustomer = useCallback((customer: CustomerWithContacts, matchedContactId?: string) => {
    // Determine which contact to use
    let contactId: string | null = null;
    
    if (matchedContactId) {
      // User clicked on a specific contact match
      contactId = matchedContactId;
    } else if (customer.contacts && customer.contacts.length > 0) {
      // Find primary contact or use first contact
      const primaryContact = customer.contacts.find(c => c.isPrimary);
      contactId = primaryContact?.id || customer.contacts[0].id;
    }

    onChange(customer.id, customer, contactId);
    setOpen(false);
    setSearchQuery("");
  }, [onChange]);

  // Clear selection
  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null, undefined, null);
    setSearchQuery("");
  }, [onChange]);

  // Build display items that include customer and their contacts
  const displayItems: Array<{
    type: 'customer' | 'contact';
    customer: CustomerWithContacts;
    contact?: CustomerContact;
    searchText: string;
  }> = [];

  customers.forEach(customer => {
    // Add the customer as a main item
    displayItems.push({
      type: 'customer',
      customer,
      searchText: customer.companyName,
    });

    // Add contacts if they exist and there's a search query (to show contact matches)
    if (debouncedSearch && customer.contacts && customer.contacts.length > 0) {
      customer.contacts.forEach(contact => {
        const contactName = `${contact.firstName} ${contact.lastName}`.trim();
        const contactSearch = `${contactName} ${contact.email || ''} ${contact.phone || ''}`.toLowerCase();
        
        // Only show contact if it matches the search
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

  return (
    <div className="space-y-2">
      {label && <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">{label}</label>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
            disabled={disabled}
          >
            {value && selectedCustomer ? (
              <span className="truncate">{selectedCustomer.companyName}</span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            <div className="flex items-center gap-1">
              {value && !disabled && (
                <X
                  className="h-4 w-4 shrink-0 opacity-50 hover:opacity-100"
                  onClick={handleClear}
                />
              )}
              <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              ref={inputRef}
              placeholder={placeholder}
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList>
              <CommandEmpty>
                {isLoading ? "Loading customers..." : "No customers found."}
              </CommandEmpty>
              <CommandGroup>
                {displayItems.map((item, index) => {
                  const isSelected = value === item.customer.id;
                  const key = item.type === 'contact' 
                    ? `contact-${item.contact?.id}-${index}` 
                    : `customer-${item.customer.id}`;

                  return (
                    <CommandItem
                      key={key}
                      value={key}
                      onSelect={() => handleSelectCustomer(
                        item.customer,
                        item.type === 'contact' ? item.contact?.id : undefined
                      )}
                      className={cn(
                        item.type === 'contact' && "pl-8",
                        "cursor-pointer"
                      )}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          isSelected && item.type === 'customer' ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <div className="flex flex-col flex-1 min-w-0">
                        {item.type === 'customer' ? (
                          <>
                            <div className="font-medium truncate">{item.customer.companyName}</div>
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
                            <div className="font-medium truncate">
                              {item.searchText}
                              {item.contact?.isPrimary && (
                                <span className="ml-2 text-xs text-muted-foreground">(Primary)</span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              <span className="font-medium">{item.customer.companyName}</span>
                              {item.contact?.title && (
                                <>
                                  <span className="mx-1">•</span>
                                  <span>{item.contact.title}</span>
                                </>
                              )}
                              {item.contact?.email && (
                                <>
                                  <span className="mx-1">•</span>
                                  <span>{item.contact.email}</span>
                                </>
                              )}
                              {item.contact?.phone && (
                                <>
                                  <span className="mx-1">•</span>
                                  <span>{item.contact.phone}</span>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      
      {/* Show selected customer details */}
      {value && selectedCustomer && (
        <div className="text-xs text-muted-foreground">
          {selectedCustomer.email && `${selectedCustomer.email}`}
        </div>
      )}
    </div>
  );
}
