import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  contactMatchesCustomer,
  filterContactsForCustomer,
  getContactDisplayName,
  getContactSecondaryLine,
  sortContactsForCustomer,
  type ContactPickerContact,
} from "@/lib/contactPicker";

interface ContactSelectProps {
  value: string | null;
  customerId?: string | null;
  onChange: (contactId: string | null, contact?: ContactPickerContact | null) => void;
  onResolvedContact?: (contact: ContactPickerContact | null) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}

function normalizeContactPayload(row: any): ContactPickerContact {
  return {
    ...row,
    customerId: row?.customerId ?? row?.customer_id ?? row?.customer?.id ?? null,
    companyName: row?.companyName ?? row?.company_name ?? row?.customer?.companyName ?? null,
    customer: row?.customer ?? null,
    linkedCustomers: Array.isArray(row?.linkedCustomers) ? row.linkedCustomers : [],
  };
}

export function ContactSelect({
  value,
  customerId = null,
  onChange,
  onResolvedContact,
  label = "Contact",
  placeholder = "Search contacts...",
  disabled = false,
}: ContactSelectProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 200);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [searchQuery]);

  const contactsQuery = useQuery<ContactPickerContact[]>({
    queryKey: ["/api/contacts", "picker", { search: debouncedSearch, customerId: customerId ?? null }],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: "1",
        pageSize: customerId ? "200" : "50",
        sortBy: "lastName",
        sortDir: "asc",
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (customerId) params.set("customerId", customerId);
      const response = await fetch(`/api/contacts?${params.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to search contacts");
      const payload = await response.json();
      const rows = Array.isArray(payload?.contacts) ? payload.contacts : Array.isArray(payload?.data) ? payload.data : [];
      return rows.map(normalizeContactPayload);
    },
    enabled: !disabled,
    staleTime: 30000,
  });

  const selectedContactQuery = useQuery<ContactPickerContact | null>({
    queryKey: ["/api/contacts", value],
    queryFn: async () => {
      if (!value) return null;
      const response = await fetch(`/api/contacts/${value}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load selected contact");
      const payload = await response.json();
      return normalizeContactPayload({ ...(payload?.contact ?? {}), customer: payload?.customer ?? null });
    },
    enabled: Boolean(value) && !disabled,
    staleTime: 30000,
  });

  const contacts = useMemo(
    () => sortContactsForCustomer(filterContactsForCustomer(contactsQuery.data ?? [], customerId), customerId),
    [contactsQuery.data, customerId],
  );

  const selectedContact = useMemo(() => {
    if (!value) return null;
    return contacts.find((contact) => contact.id === value) ?? selectedContactQuery.data ?? null;
  }, [contacts, selectedContactQuery.data, value]);

  useEffect(() => {
    if (value && selectedContact) onResolvedContact?.(selectedContact);
    if (!value) onResolvedContact?.(null);
  }, [onResolvedContact, selectedContact, value]);

  const selectContact = (contact: ContactPickerContact) => {
    onChange(contact.id, contact);
    setOpen(false);
    setSearchQuery("");
  };

  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      <div className="flex gap-2">
        <Popover
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) setSearchQuery("");
            if (nextOpen) {
              requestAnimationFrame(() => {
                inputRef.current?.focus();
              });
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled}
              className="h-9 flex-1 justify-between font-normal"
            >
              <span className="truncate">{selectedContact ? getContactDisplayName(selectedContact) : placeholder}</span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[420px] p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput
                ref={inputRef}
                placeholder={customerId ? "Search by name, email, or phone..." : "Search by name, email, phone, or customer..."}
                value={searchQuery}
                onValueChange={setSearchQuery}
              />
              <CommandList>
                {contactsQuery.isLoading ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">Loading contacts...</div>
                ) : contactsQuery.isError ? (
                  <div className="p-4 text-center text-sm text-destructive">
                    Failed to search contacts. Try again.
                  </div>
                ) : contacts.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    {customerId ? "No contacts are linked to this customer." : "No contacts found."}
                  </div>
                ) : (
                  <CommandGroup heading={debouncedSearch ? `Found ${contacts.length} contact${contacts.length === 1 ? "" : "s"}` : `Contacts (${contacts.length})`}>
                    {contacts.map((contact) => {
                      const isSelected = value === contact.id;
                      const compatible = contactMatchesCustomer(contact, customerId);
                      return (
                        <CommandItem
                          key={contact.id}
                          value={`${getContactDisplayName(contact)} ${contact.email ?? ""} ${contact.phone ?? ""} ${contact.mobile ?? ""} ${contact.companyName ?? ""}`}
                          onSelect={() => selectContact(contact)}
                        >
                          <Check className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                          <User className="mr-2 h-4 w-4 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{getContactDisplayName(contact)}</div>
                            <div className="truncate text-xs text-muted-foreground">{getContactSecondaryLine(contact)}</div>
                            {!compatible && (
                              <div className="text-xs text-destructive">CONTACT_CUSTOMER_CONFLICT</div>
                            )}
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {value && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Clear contact"
            onClick={() => onChange(null, null)}
            disabled={disabled}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
