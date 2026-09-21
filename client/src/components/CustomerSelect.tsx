import { useState, useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { Building2, User, X, ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { getBestMatchingCustomerContact, sortCustomersForSearch } from "@/lib/customerSearchRanking";
import type { Customer, CustomerContact } from "@shared/schema";
import { useCustomerById, useCustomerSearchPage, useDebouncedValue } from "@/hooks/useCustomerSearch";

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
  const debouncedSearch = useDebouncedValue(searchQuery, 250);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const commandListRef = useRef<HTMLDivElement>(null);

  // Fetch customers with search - show all when no search query
  const { data: customerPage, isLoading } = useCustomerSearchPage({ search: debouncedSearch, page: 1, pageSize: 50 });
  const customers = (customerPage?.customers || []) as CustomerWithContacts[];

  // Fetch contacts for selected customer if not already loaded
  const { data: customerDetail } = useCustomerById<CustomerWithContacts>(value, !initialCustomer?.contacts);

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
    const matchedContact = getBestMatchingCustomerContact(customer, searchQuery);
    const primaryContact = customer.contacts?.find((contact) => contact.isPrimary);
    const contactId = matchedContact?.id ?? primaryContact?.id ?? customer.contacts?.[0]?.id ?? null;

    onChange(customer.id, customer, contactId);
    setOpen(false);
    setSearchQuery("");
  }, [onChange, searchQuery]);

  // Rank direct company matches before weaker customer/contact matches.
  const filteredCustomers = useMemo(() => {
    const uniqueCustomers = Array.from(new Map(customers.map((customer) => [customer.id, customer])).values());
    return sortCustomersForSearch(uniqueCustomers, debouncedSearch);
  }, [customers, debouncedSearch]);
  const resultSignature = filteredCustomers.map((customer) => customer.id).join(",");

  useEffect(() => {
    if (commandListRef.current) commandListRef.current.scrollTop = 0;
  }, [searchQuery, debouncedSearch, resultSignature]);

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
            <CommandList ref={commandListRef}>
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
                      const matchedContact = getBestMatchingCustomerContact(customer, searchQuery);
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
                            {matchedContact && (
                              <div className="text-xs text-muted-foreground truncate">
                                Matched contact: {[matchedContact.firstName, matchedContact.lastName].filter(Boolean).join(" ") || matchedContact.email}
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
