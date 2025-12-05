/*
 * CONTACTS LIST PAGE
 * 
 * This page provides a searchable list of all customer contacts across the system.
 * Previously, contacts could only be viewed/managed within individual customer detail pages.
 * This centralizes contact management with search by name, email, or company.
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ROUTES } from "@/config/routes";
import { useContacts, useDeleteContact, useUpdateContact, type ContactWithStats } from "@/hooks/useContacts";
import { useAuth } from "@/hooks/useAuth";
import { useListViewSettings } from "@/hooks/useListViewSettings";
import { ListViewSettings } from "@/components/list/ListViewSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Mail, Phone, ArrowLeft, Building2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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

const defaultColumns = [
  { id: "name", label: "Name", visible: true },
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
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [editingContact, setEditingContact] = useState<ContactWithStats | null>(null);
  const [deletingContact, setDeletingContact] = useState<ContactWithStats | null>(null);
  
  const deleteContactMutation = useDeleteContact();
  const updateContactMutation = useUpdateContact();
  
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
    page: 1,
    pageSize: 50,
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

  const renderCell = (contact: ContactWithStats, columnId: string) => {
    switch (columnId) {
      case "name":
        return (
          <div className="flex flex-col">
            <span className="font-medium text-titan-text-primary">
              {contact.firstName} {contact.lastName}
            </span>
            {contact.title && (
              <span className="text-xs text-titan-text-muted">
                {contact.title}
              </span>
            )}
            {contact.isPrimary && (
              <StatusPill variant="info" className="w-fit mt-1">
                Primary
              </StatusPill>
            )}
          </div>
        );
      case "company":
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
              href={`tel:${contact.phone}`}
              onClick={(e) => e.stopPropagation()}
              className="hover:underline text-titan-sm text-titan-text-secondary"
            >
              {contact.phone}
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
          <div className="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="text-titan-text-secondary hover:text-titan-text-primary">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-titan-bg-card border-titan-border">
                <DropdownMenuLabel className="text-titan-text-primary">Actions</DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-titan-border-subtle" />
                <DropdownMenuItem onClick={() => setEditingContact(contact)} className="text-titan-text-secondary hover:text-titan-text-primary">
                  <Pencil className="w-4 h-4 mr-2" />
                  Edit
                </DropdownMenuItem>
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
    <Page>
      <PageHeader
        title="Contacts"
        subtitle="Manage all customer contacts across the system"
        className="pb-3"
        backButton={
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate("/")}
            className="text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated rounded-titan-md"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        }
      />

      <ContentLayout className="space-y-3">
        {/* Search and Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
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
              {data.total} contact{data.total !== 1 ? "s" : ""}
            </span>
          )}
          <ListViewSettings
            columns={columns}
            onToggleVisibility={toggleVisibility}
            onReorder={setColumnOrder}
            onWidthChange={setColumnWidth}
          />
        </div>

        {/* Contacts Table */}
        <DataCard 
          title="All Contacts"
          description="Search contacts by name, email, or company name"
          className="bg-titan-bg-card border-titan-border-subtle"
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-4 border-titan-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-titan-error">
              Failed to load contacts. Please try again.
            </div>
          ) : !data || data.contacts.length === 0 ? (
            <div className="text-center py-8 text-titan-text-muted">
              {searchQuery ? "No contacts found matching your search." : "No contacts found."}
            </div>
          ) : (
            <div className="rounded-titan-lg border border-titan-border-subtle overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
                    {visibleColumns.map((col) => (
                      <TableHead
                        key={col.id}
                        style={{ width: col.width ? `${col.width}px` : undefined }}
                        className={`text-titan-text-secondary ${col.id === "orders" || col.id === "quotes" ? "text-center" : col.id === "actions" ? "text-right" : ""}`}
                      >
                        {col.label}
                      </TableHead>
                    ))}
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
      </ContentLayout>

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
  contact: ContactWithStats;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: any) => Promise<void>;
}

function EditContactDialog({ contact, open, onOpenChange, onSave }: EditContactDialogProps) {
  const [formData, setFormData] = useState({
    firstName: contact.firstName,
    lastName: contact.lastName,
    title: contact.title || "",
    email: contact.email || "",
    phone: contact.phone || "",
    mobile: contact.mobile || "",
    isPrimary: contact.isPrimary,
    street1: contact.street1 || "",
    street2: contact.street2 || "",
    city: contact.city || "",
    state: contact.state || "",
    postalCode: contact.postalCode || "",
    country: contact.country || "",
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave(formData);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Contact</DialogTitle>
          <DialogDescription>
            Update contact information for {contact.firstName} {contact.lastName}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Personal Information */}
          <div className="space-y-4">
            <h4 className="font-medium">Personal Information</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
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
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
