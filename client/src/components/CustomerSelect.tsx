import { useState, useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, User, X, ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { Customer, CustomerContact } from "@shared/schema";

export type CustomerWithContacts = Customer & {
  contacts?: CustomerContact[];
};

export interface CustomerSelectRef {
  focus: () => void;
}

interface CustomerSelectProps {
  value: string | null;
  onChange: (customerId: string | null, customer?: CustomerWithContacts, contactId?: string | null) => void;
  autoFocus?: boolean;
  label?: string;
  placeholder?: string;
  initialCustomer?: CustomerWithContacts;
  disabled?: boolean;
}

export const CustomerSelect = forwardRef<CustomerSelectRef, CustomerSelectProps>(({
  value,
  onChange,
  autoFocus = true,
  label = "Customer",
  placeholder = "Search customers...",
  initialCustomer,
  disabled = false,
}, ref) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);

  // Debounce search input
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 200);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery]);

  // Fetch customers with search - show all when no search query
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

  // Reset search when popover closes
  useEffect(() => {
    if (!open) {
      setSearchQuery("");
    }
  }, [open]);

  // Expose focus method via ref
  useImperativeHandle(ref, () => ({
    focus: () => {
      if (disabled) return;
      // Open the popover first, then focus the input
      setOpen(true);
      // Use multiple animation frames to ensure popover is fully rendered before focusing
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            // Focus the command input inside the popover
            const input = commandInputRef.current;
            if (input) {
              input.focus();
            }
          }, 100);
        });
      });
    },
  }), [disabled]);

  // Handle customer selection
  const handleSelectCustomer = useCallback((customer: CustomerWithContacts) => {
    let contactId: string | null = null;
    
    if (customer.contacts && customer.contacts.length > 0) {
      const primaryContact = customer.contacts.find(c => c.isPrimary);
      contactId = primaryContact?.id || customer.contacts[0].id;
    }

    onChange(customer.id, customer, contactId);
    setOpen(false);
    setSearchQuery("");
  }, [onChange]);

  // Helper function to get sort key for a customer (alphabetical sorting)
  const getCustomerSortKey = useCallback((customer: CustomerWithContacts): string => {
    // Primary: companyName (trimmed, case-insensitive)
    // Fallbacks: email, then id
    const companyName = (customer.companyName || "").trim().toLowerCase();
    const email = (customer.email || "").trim().toLowerCase();
    const id = customer.id || "";
    
    // Return the first available value, with id as final fallback
    return companyName || email || id;
  }, []);

  // Filter and sort customers based on search
  const filteredCustomers = useMemo(() => {
    let result = customers;
    
    // Apply search filter if query exists
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      result = customers.filter((customer) => {
        const companyName = (customer.companyName || "").toLowerCase();
        const email = (customer.email || "").toLowerCase();
        const phone = (customer.phone || "").toLowerCase();
        const matchesName = companyName.includes(q);
        const matchesEmail = email.includes(q);
        const matchesPhone = phone.includes(q);
        const matchesContact = customer.contacts?.some((contact) => {
          const contactName = `${contact.firstName || ""} ${contact.lastName || ""}`.trim().toLowerCase();
          const contactEmail = (contact.email || "").toLowerCase();
          const contactPhone = (contact.phone || "").toLowerCase();
          return contactName.includes(q) || contactEmail.includes(q) || contactPhone.includes(q);
        });
        return matchesName || matchesEmail || matchesPhone || matchesContact;
      });
    }
    
    // Sort alphabetically by companyName (with fallbacks) - stable sort, non-mutating
    return [...result].sort((a, b) => {
      const keyA = getCustomerSortKey(a);
      const keyB = getCustomerSortKey(b);
      return keyA.localeCompare(keyB, undefined, { sensitivity: 'base' });
    });
  }, [customers, debouncedSearch, getCustomerSortKey]);

  return (
    <div className="space-y-2">
      {label && (
        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          {label}
        </label>
      )}
      
      <Popover open={open} onOpenChange={(newOpen) => {
        setOpen(newOpen);
        if (!newOpen) {
          setSearchQuery("");
        }
      }}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal h-9"
          >
            <span className="truncate">
              {selectedCustomer?.companyName || selectedCustomer?.email || placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              ref={commandInputRef}
              placeholder="Search by company name, email, or contact..."
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList>
              {isLoading ? (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  Loading customers...
                </div>
              ) : (
                <>
                  <CommandEmpty>No customers found. Try a different search term.</CommandEmpty>
                  <CommandGroup heading={searchQuery ? `Found ${filteredCustomers.length} customer${filteredCustomers.length !== 1 ? 's' : ''}` : `All customers (${filteredCustomers.length})`}>
                    {filteredCustomers.map((customer) => {
                      const isSelected = value === customer.id;
                      return (
                        <CommandItem
                          key={customer.id}
                          value={`${customer.companyName} ${customer.email || ''} ${customer.phone || ''}`}
                          onSelect={() => handleSelectCustomer(customer)}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              isSelected ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <Building2 className="mr-2 h-4 w-4 text-muted-foreground" />
                          <div className="flex flex-col flex-1 min-w-0">
                            <div className="font-medium truncate">
                              {customer.companyName || customer.email || `Customer ${customer.id}`}
                            </div>
                            {(customer.email || customer.phone) && customer.companyName && (
                              <div className="text-xs text-muted-foreground truncate">
                                {customer.email && <span>{customer.email}</span>}
                                {customer.email && customer.phone && <span className="mx-1">•</span>}
                                {customer.phone && <span>{customer.phone}</span>}
                              </div>
                            )}
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
});

CustomerSelect.displayName = "CustomerSelect";
