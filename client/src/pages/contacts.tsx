/*
 * CONTACTS LIST PAGE
 * 
 * This page provides a searchable list of all customer contacts across the system.
 * Previously, contacts could only be viewed/managed within individual customer detail pages.
 * This centralizes contact management with search by name, email, or company.
 */

import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useContacts, useCreateContact, useDeleteContact, useUpdateContact, type ContactWithStats } from "@/hooks/useContacts";
import { useAuth } from "@/hooks/useAuth";
import { useListViewSettings } from "@/hooks/useListViewSettings";
import { formatPhoneForDisplay, phoneToTelHref, cn } from "@/lib/utils";
import { normalizeCustomerListResponse } from "@/lib/customerListQuery";
import type { ContactListSortBy, ContactListSortDir } from "@/lib/contactListQuery";
import { ListViewSettings } from "@/components/list/ListViewSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Mail, Phone, Building2, MoreHorizontal, Pencil, Trash2, Eye, ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { ContactFlagPill } from "@/components/ContactFlagPill";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Page, PageHeader, ContentLayout, DataCard, StatusPill } from "@/components/titan";
import { useSmartBack } from "@/hooks/useSmartBack";
import BackNavControls from "@/components/BackNavControls";

type ContactRelationshipFilter = "all" | "unlinked" | "linked" | "former" | "archived";

const defaultColumns = [
  { id: "firstName", label: "First Name", visible: true },
  { id: "lastName", label: "Last Name", visible: true },
  { id: "company", label: "Company", visible: true },
  { id: "email", label: "Email", visible: true },
  { id: "phone", label: "Phone", visible: true },
  { id: "orders", label: "Orders", visible: true },
  { id: "quotes", label: "Quotes", visible: true },
  { id: "lastActivity", label: "Last Activity", visible: true },
  { id: "actions", label: "Actions", visible: true },
];

export default function ContactsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { onSmartBack } = useSmartBack();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [creatingContact, setCreatingContact] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactWithStats | null>(null);
  const [deletingContact, setDeletingContact] = useState<ContactWithStats | null>(null);
  const [sortKey, setSortKey] = useState<ContactListSortBy>("lastName");
  const [sortDirection, setSortDirection] = useState<ContactListSortDir>("asc");
  const [relationshipFilter, setRelationshipFilter] = useState<ContactRelationshipFilter>("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  // Reset to page 1 when the backend query shape changes
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, sortKey, sortDirection, relationshipFilter]);

  const deleteContactMutation = useDeleteContact();
  const updateContactMutation = useUpdateContact();
  const createContactMutation = useCreateContact();
  
  const {
    columns,
    toggleVisibility,
    setColumnOrder,
    setColumnWidth,
  } = useListViewSettings("contacts-list", defaultColumns);

  const visibleColumns = columns.filter((c) => c.visible);

  // Debounce search
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    const timer = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
    return () => clearTimeout(timer);
  };

  const { data, isLoading, error } = useContacts({
    search: debouncedSearch || undefined,
    page,
    pageSize: PAGE_SIZE,
    sortBy: sortKey,
    sortDir: sortDirection,
    filter: relationshipFilter === "all" ? undefined : relationshipFilter,
  });

  // Role check - only internal users can access
  if (user?.role === "customer") {
    return (
      <Page>
        <ContentLayout>
          <DataCard className="bg-titan-bg-card border-titan-border-subtle">
            <div className="py-16 text-center">
              <h1 className="text-titan-xl font-bold mb-4 text-titan-text-primary">Access Denied</h1>
              <p className="text-titan-text-muted mb-4">This page is only available to staff members.</p>
              <Button 
                onClick={() => navigate("/")}
                className="bg-titan-accent hover:bg-titan-accent-hover text-white rounded-titan-md"
              >
                Return Home
              </Button>
            </div>
          </DataCard>
        </ContentLayout>
      </Page>
    );
  }

  const formatDate = (date: Date | null) => {
    if (!date) return "Never";
    return new Date(date).toLocaleDateString();
  };

  const handleDelete = async () => {
    if (!deletingContact) return;
    await deleteContactMutation.mutateAsync(deletingContact.id);
    setDeletingContact(null);
  };

  const handleRowClick = (contactId: string, e: React.MouseEvent) => {
    // Don't navigate if clicking on action buttons or links
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('a')) {
      return;
    }
    navigate(`/contacts/${contactId}`);
  };

  const contactSortKeyForColumn = (key: string): ContactListSortBy => {
    switch (key) {
      case "name":
        return "lastName";
      case "firstName":
        return "firstName";
      case "lastName":
        return "lastName";
      case "company":
        return "company";
      case "email":
        return "email";
      case "phone":
        return "phone";
      case "orders":
        return "orders";
      case "quotes":
        return "quotes";
      case "lastActivity":
        return "lastActivity";
      default:
        return "lastName";
    }
  };

  const handleSort = (key: string) => {
    const nextSortKey = contactSortKeyForColumn(key);
    if (sortKey === nextSortKey) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortKey(nextSortKey);
      setSortDirection("asc");
    }
  };

  const renderCell = (contact: ContactWithStats, columnId: string) => {
    switch (columnId) {
      case "firstName":
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-titan-text-primary">{contact.firstName}</span>
            {contact.isPrimary && (
              <StatusPill variant="info">Primary</StatusPill>
            )}
            {contact.flags?.map((flag) => (
              <ContactFlagPill key={flag} flag={flag} />
            ))}
          </div>
        );
      case "lastName":
        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-titan-text-primary">{contact.lastName}</span>
            {contact.title && (
              <span className="text-xs text-titan-text-muted">{contact.title}</span>
            )}
          </div>
        );
      case "name":
        return (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium text-titan-text-primary">
                {contact.firstName} {contact.lastName}
              </span>
              {contact.isPrimary && (
                <StatusPill variant="info">Primary</StatusPill>
              )}
              {contact.flags?.map((flag) => (
                <ContactFlagPill key={flag} flag={flag} />
              ))}
            </div>
            {contact.title && (
              <span className="text-xs text-titan-text-muted">{contact.title}</span>
            )}
          </div>
        );
      case "company":
        if (!contact.customerId || contact.companyName === "Unlinked") {
          return <span className="text-titan-text-muted">Unlinked</span>;
        }
        return (
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-titan-text-muted" />
            <Link
              to={`/customers/${contact.customerId}`}
              onClick={(e) => e.stopPropagation()}
              className="hover:underline text-titan-text-secondary hover:text-titan-text-primary"
            >
              {contact.companyName}
            </Link>
          </div>
        );
      case "email":
        return contact.email ? (
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-titan-text-muted" />
            <a
              href={`mailto:${contact.email}`}
              onClick={(e) => e.stopPropagation()}
              className="hover:underline text-titan-sm text-titan-text-secondary"
            >
              {contact.email}
            </a>
          </div>
        ) : (
          <span className="text-titan-text-muted">—</span>
        );
      case "phone":
        return contact.phone ? (
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-titan-text-muted" />
            <a
              href={phoneToTelHref(contact.phone)}
              onClick={(e) => e.stopPropagation()}
              className="hover:underline text-titan-sm text-titan-text-secondary"
            >
              {formatPhoneForDisplay(contact.phone)}
            </a>
          </div>
        ) : (
          <span className="text-titan-text-muted">—</span>
        );
      case "orders":
        return (
          <Badge variant="outline" className="border-titan-border text-titan-text-secondary">
            {contact.ordersCount}
          </Badge>
        );
      case "quotes":
        return (
          <Badge variant="outline" className="border-titan-border text-titan-text-secondary">
            {contact.quotesCount}
          </Badge>
        );
      case "lastActivity":
        return (
          <span className="text-titan-sm text-titan-text-muted">
            {formatDate(contact.lastActivityAt)}
          </span>
        );
      case "actions":
        return (
          <div className="flex gap-1 justify-end flex-nowrap" onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/contacts/${contact.id}`)}
              title="View contact"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditingContact(contact)}
              title="Edit contact"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            {contact.email && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.location.href = `mailto:${contact.email}`}
                title="Email contact"
              >
                <Mail className="h-4 w-4" />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" title="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-titan-bg-card border-titan-border">
                <DropdownMenuItem
                  className="text-titan-error"
                  onClick={() => setDeletingContact(contact)}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Page maxWidth="full">
      <PageHeader
        title="Contacts"
        subtitle="Manage all customer contacts across the system"
        className="pb-3"
        backButton={
          <BackNavControls onBack={onSmartBack} />
        }
      />

      <ContentLayout className="space-y-3">
        {/* Search and Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1 basis-[45%] max-w-2xl">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-titan-text-muted" />
            <Input
              placeholder="Search contacts by name, email, or company..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-8 h-9 bg-titan-bg-input border-titan-border-subtle text-titan-text-primary placeholder:text-titan-text-muted rounded-titan-md"
            />
          </div>
          {data && (
            <span className="text-titan-sm text-titan-text-muted">
              {data.total === 0
                ? "No contacts"
                : data.totalPages > 1
                ? `Showing ${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.total)} of ${data.total} contacts`
                : `${data.total} contact${data.total !== 1 ? "s" : ""}`}
            </span>
          )}
          <Select value={relationshipFilter} onValueChange={(value) => setRelationshipFilter(value as ContactRelationshipFilter)}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unlinked">Unlinked</SelectItem>
              <SelectItem value="linked">Linked</SelectItem>
              <SelectItem value="former">Former/Inactive</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <ListViewSettings
            columns={columns}
            onToggleVisibility={toggleVisibility}
            onReorder={setColumnOrder}
            onWidthChange={setColumnWidth}
          />
          <Button
            size="sm"
            onClick={() => setCreatingContact(true)}
            className="bg-titan-accent hover:bg-titan-accent-hover text-white rounded-titan-md"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Contact
          </Button>
        </div>

        {/* Contacts Table */}
        <DataCard noPadding className="bg-titan-bg-card border-titan-border-subtle">
          {isLoading ? (
            <div className="flex items-center justify-center p-5 py-8">
              <div className="w-8 h-8 border-4 border-titan-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="p-5 py-8 text-center text-titan-error">
              Failed to load contacts. Please try again.
            </div>
          ) : !data || data.contacts.length === 0 ? (
            <div className="p-5 py-8 text-center text-titan-text-muted">
              {searchQuery ? "No contacts found matching your search." : "No contacts found."}
            </div>
          ) : (
            <div className="rounded-titan-lg border border-titan-border-subtle overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
                    {visibleColumns.map((col) => {
                      const isSortable = col.id !== "actions";
                      const isActive = isSortable && sortKey === contactSortKeyForColumn(col.id);
                      const isCentered = col.id === "orders" || col.id === "quotes";
                      const isRight = col.id === "actions";
                      return (
                        <TableHead
                          key={col.id}
                          style={{ width: col.width ? `${col.width}px` : undefined }}
                          className={cn(
                            "text-titan-text-secondary select-none",
                            isCentered ? "text-center" : isRight ? "text-right" : "",
                            isSortable && "cursor-pointer hover:text-titan-text-primary"
                          )}
                          onClick={isSortable ? () => handleSort(col.id) : undefined}
                        >
                          <div className={cn("flex items-center gap-1", isCentered && "justify-center", isRight && "justify-end")}>
                            {col.label}
                            {isSortable && (
                              isActive
                                ? sortDirection === "asc"
                                  ? <ArrowUp className="w-3 h-3 text-titan-accent flex-shrink-0" />
                                  : <ArrowDown className="w-3 h-3 text-titan-accent flex-shrink-0" />
                                : <ArrowUpDown className="w-3 h-3 opacity-30 flex-shrink-0" />
                            )}
                          </div>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.contacts.map((contact) => (
                    <TableRow
                      key={contact.id}
                      className="cursor-pointer hover:bg-titan-bg-card-elevated/50 border-b border-titan-border-subtle"
                      onClick={(e) => handleRowClick(contact.id, e)}
                    >
                      {visibleColumns.map((col) => {
                        const cellContent = renderCell(contact, col.id);
                        return (
                          <TableCell
                            key={col.id}
                            style={{ width: col.width ? `${col.width}px` : undefined }}
                            className={col.id === "orders" || col.id === "quotes" ? "text-center" : ""}
                          >
                            {cellContent}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DataCard>

        {/* Pagination controls */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between py-2 px-1">
            <Button
              size="sm"
              variant="outline"
              disabled={!data.hasPreviousPage || isLoading}
              onClick={() => setPage((p) => p - 1)}
              className="h-8 text-titan-sm"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Previous
            </Button>
            <span className="text-titan-sm text-titan-text-muted">
              Page {data.page} of {data.totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={!data.hasNextPage || isLoading}
              onClick={() => setPage((p) => p + 1)}
              className="h-8 text-titan-sm"
            >
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </ContentLayout>

      {/* Add Contact Dialog */}
      {creatingContact && (
        <EditContactDialog
          open={creatingContact}
          onOpenChange={(open) => !open && setCreatingContact(false)}
          onSave={async (data) => {
            await createContactMutation.mutateAsync(data);
            setCreatingContact(false);
          }}
        />
      )}

      {/* Edit Contact Dialog */}
      {editingContact && (
        <EditContactDialog
          contact={editingContact}
          open={!!editingContact}
          onOpenChange={(open) => !open && setEditingContact(null)}
          onSave={async (data) => {
            await updateContactMutation.mutateAsync({
              id: editingContact.id,
              data,
            });
            setEditingContact(null);
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingContact} onOpenChange={(open) => !open && setDeletingContact(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deletingContact?.firstName} {deletingContact?.lastName}? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

// Edit Contact Dialog Component
interface EditContactDialogProps {
  contact?: ContactWithStats;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: any) => Promise<void>;
}

function EditContactDialog({ contact, open, onOpenChange, onSave }: EditContactDialogProps) {
  type CustomerOption = { id: string; companyName: string };
  const { data: customerOptions = [], isLoading: customersLoading } = useQuery<CustomerOption[]>({
    queryKey: ["/api/customers", "contact-dialog-options"],
    queryFn: async () => {
      const response = await fetch("/api/customers?page=1&pageSize=100&sortBy=name&sortDir=asc", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load customers");
      const normalized = normalizeCustomerListResponse<CustomerOption>(await response.json());
      return normalized.customers;
    },
    enabled: open,
  });

  const [formData, setFormData] = useState({
    customerId: contact?.customerId || "",
    firstName: contact?.firstName || "",
    lastName: contact?.lastName || "",
    title: contact?.title || "",
    email: contact?.email || "",
    phone: contact?.phone || "",
    mobile: contact?.mobile || "",
    isPrimary: contact?.isPrimary ?? false,
    street1: contact?.street1 || "",
    street2: contact?.street2 || "",
    city: contact?.city || "",
    state: contact?.state || "",
    postalCode: contact?.postalCode || "",
    country: contact?.country || "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const isEditing = Boolean(contact);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave({
        ...formData,
        customerId: formData.customerId || null,
        isPrimary: formData.customerId ? formData.isPrimary : false,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Contact" : "Add Contact"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? `Update contact information for ${contact?.firstName} ${contact?.lastName}`
              : "Create an independent contact, or optionally attach it to a customer."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="customerId">Company</Label>
            <Select
              value={formData.customerId || "__unlinked__"}
              onValueChange={(customerId) => setFormData((current) => ({ ...current, customerId: customerId === "__unlinked__" ? "" : customerId }))}
              disabled={customersLoading}
            >
              <SelectTrigger id="customerId">
                <SelectValue placeholder={customersLoading ? "Loading companies..." : "No customer"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__unlinked__">No customer</SelectItem>
                {customerOptions.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.companyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Personal Information */}
          <div className="space-y-4">
            <h4 className="font-medium">Personal Information</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) => setFormData((current) => ({ ...current, firstName: e.target.value }))}
                  required
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) => setFormData((current) => ({ ...current, lastName: e.target.value }))}
                  required
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="title">Title / Role</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="mobile">Mobile</Label>
                <Input
                  id="mobile"
                  value={formData.mobile}
                  onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                />
              </div>
              <div className="col-span-2 flex items-center space-x-2">
                <Checkbox
                  id="isPrimary"
                  checked={formData.isPrimary}
                  disabled={!formData.customerId}
                  onCheckedChange={(checked) => setFormData({ ...formData, isPrimary: Boolean(checked) })}
                />
                <Label htmlFor="isPrimary">Primary Contact</Label>
              </div>
            </div>
          </div>

          {/* Address Information */}
          <div className="space-y-4">
            <h4 className="font-medium">Address</h4>
            <div className="space-y-3">
              <div>
                <Label htmlFor="street1">Street Address</Label>
                <Input
                  id="street1"
                  value={formData.street1}
                  onChange={(e) => setFormData({ ...formData, street1: e.target.value })}
                  placeholder="123 Main St"
                />
              </div>
              <div>
                <Label htmlFor="street2">Street Address 2 (Optional)</Label>
                <Input
                  id="street2"
                  value={formData.street2}
                  onChange={(e) => setFormData({ ...formData, street2: e.target.value })}
                  placeholder="Suite 100"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    placeholder="City"
                  />
                </div>
                <div>
                  <Label htmlFor="state">State</Label>
                  <Input
                    id="state"
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                    placeholder="State"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="postalCode">Postal Code</Label>
                  <Input
                    id="postalCode"
                    value={formData.postalCode}
                    onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                    placeholder="12345"
                  />
                </div>
                <div>
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    placeholder="USA"
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : isEditing ? "Save Changes" : "Create Contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
