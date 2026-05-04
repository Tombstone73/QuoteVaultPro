/*
 * CONTACT DETAIL PAGE
 *
 * CRM-quality contact detail view. Shows:
 *  - Header with name, primary badge, company link, quick email/phone, action buttons
 *  - Contact information card (all available fields)
 *  - Customer information card with View Customer link
 *  - Recent Orders (empty state + clickable rows)
 *  - Recent Quotes  (empty state + clickable rows)
 *
 * Edit Contact reuses the same modal pattern as the Contacts list page.
 * After save, React Query invalidates ["contacts"] which refreshes the detail.
 */

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ROUTES } from "@/config/routes";
import { useContactDetail, useUpdateContact, type Contact } from "@/hooks/useContacts";
import { useAuth } from "@/hooks/useAuth";
import { formatPhoneForDisplay, phoneToTelHref } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  User,
  Building2,
  Mail,
  Phone,
  Smartphone,
  Package,
  FileText,
  ExternalLink,
  Edit,
  ShoppingCart,
  Plus,
} from "lucide-react";
import { Page, ContentLayout, StatusPill, getStatusVariant } from "@/components/titan";
import { useSmartBack } from "@/hooks/useSmartBack";
import BackNavControls from "@/components/BackNavControls";

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function ContactDetailPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id: contactId } = useParams<{ id: string }>();
  const { onSmartBack } = useSmartBack();
  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading, error } = useContactDetail(contactId);
  const updateContact = useUpdateContact();

  // ── Role guard ────────────────────────────────────────────────────────────
  if (user?.role === "customer") {
    return (
      <Page>
        <ContentLayout>
          <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl py-16 text-center">
            <h1 className="text-titan-xl font-bold mb-3 text-titan-text-primary">Access Denied</h1>
            <p className="text-titan-text-muted mb-4">This page is only available to staff members.</p>
            <Button
              onClick={() => navigate("/")}
              className="bg-titan-accent hover:bg-titan-accent-hover text-white"
            >
              Return Home
            </Button>
          </div>
        </ContentLayout>
      </Page>
    );
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Page>
        <ContentLayout>
          <Skeleton className="h-28 w-full rounded-titan-xl bg-titan-bg-card-elevated" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-52 rounded-titan-xl bg-titan-bg-card-elevated" />
            <Skeleton className="h-52 rounded-titan-xl bg-titan-bg-card-elevated" />
          </div>
          <Skeleton className="h-40 rounded-titan-xl bg-titan-bg-card-elevated" />
          <Skeleton className="h-40 rounded-titan-xl bg-titan-bg-card-elevated" />
        </ContentLayout>
      </Page>
    );
  }

  // ── Error / not found ─────────────────────────────────────────────────────
  if (error || !data) {
    return (
      <Page>
        <ContentLayout>
          <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl py-16 text-center">
            <User className="w-12 h-12 text-titan-text-muted mx-auto mb-4 opacity-40" />
            <h1 className="text-titan-xl font-semibold text-titan-text-primary mb-2">Contact Not Found</h1>
            <p className="text-titan-text-muted mb-4">
              This contact doesn't exist or you don't have permission to view it.
            </p>
            <Button
              variant="outline"
              onClick={() => navigate(ROUTES.contacts.list)}
              className="border-titan-border-subtle"
            >
              Back to Contacts
            </Button>
          </div>
        </ContentLayout>
      </Page>
    );
  }

  const { contact, customer, recentOrders, recentQuotes } = data;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

  const formatDate = (date: Date) =>
    new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const formatStatus = (status: string) =>
    status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <Page>
      <ContentLayout>

        {/* ── HEADER ──────────────────────────────────────────────────────── */}
        <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl px-5 py-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">

            {/* Left: back nav + identity */}
            <div className="flex items-start gap-3 min-w-0">
              <BackNavControls onBack={onSmartBack} className="flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                {/* Name + primary badge */}
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-titan-text-primary leading-tight">
                    {contact.firstName} {contact.lastName}
                  </h1>
                  {contact.isPrimary && (
                    <StatusPill variant="info">Primary Contact</StatusPill>
                  )}
                </div>

                {/* Title */}
                {contact.title && (
                  <p className="text-titan-sm text-titan-text-muted mt-0.5">{contact.title}</p>
                )}

                {/* Company link */}
                <button
                  onClick={() => navigate(ROUTES.customers.detail(customer.id))}
                  className="flex items-center gap-1 mt-1 text-titan-sm text-titan-text-secondary hover:text-titan-accent transition-colors group"
                >
                  <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="group-hover:underline">{customer.companyName}</span>
                </button>

                {/* Quick contact metadata */}
                <div className="flex items-center gap-4 mt-2 flex-wrap">
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="flex items-center gap-1.5 text-[12px] text-titan-text-muted hover:text-titan-accent transition-colors"
                    >
                      <Mail className="w-3 h-3 flex-shrink-0" />
                      {contact.email}
                    </a>
                  )}
                  {contact.phone && (
                    <a
                      href={phoneToTelHref(contact.phone)}
                      className="flex items-center gap-1.5 text-[12px] text-titan-text-muted hover:text-titan-accent transition-colors"
                    >
                      <Phone className="w-3 h-3 flex-shrink-0" />
                      {formatPhoneForDisplay(contact.phone)}
                    </a>
                  )}
                  {!contact.phone && contact.mobile && (
                    <a
                      href={phoneToTelHref(contact.mobile)}
                      className="flex items-center gap-1.5 text-[12px] text-titan-text-muted hover:text-titan-accent transition-colors"
                    >
                      <Smartphone className="w-3 h-3 flex-shrink-0" />
                      {formatPhoneForDisplay(contact.mobile)}
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Right: action buttons */}
            <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditOpen(true)}
                className="h-8 text-[12px] border-titan-border-subtle text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
              >
                <Edit className="w-3.5 h-3.5 mr-1.5" />
                Edit Contact
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`${ROUTES.quotes.new}?customerId=${customer.id}`)}
                className="h-8 text-[12px] border-titan-border-subtle text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
              >
                <FileText className="w-3.5 h-3.5 mr-1.5" />
                New Quote
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`${ROUTES.orders.new}?customerId=${customer.id}`)}
                className="h-8 text-[12px] border-titan-border-subtle text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
              >
                <ShoppingCart className="w-3.5 h-3.5 mr-1.5" />
                New Order
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(ROUTES.customers.detail(customer.id))}
                className="h-8 text-[12px] border-titan-border-subtle text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
              >
                <Building2 className="w-3.5 h-3.5 mr-1.5" />
                View Customer
              </Button>
            </div>
          </div>
        </div>

        {/* ── CONTACT INFO + CUSTOMER INFO ────────────────────────────────── */}
        <div className="grid gap-4 md:grid-cols-2">

          {/* Contact Information */}
          <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl p-4">
            <div className="flex items-center gap-2 mb-4">
              <User className="w-4 h-4 text-titan-text-secondary" />
              <h2 className="text-titan-base font-semibold text-titan-text-primary">
                Contact Information
              </h2>
            </div>
            <div className="space-y-3">
              <InfoRow label="Name">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-titan-text-primary">
                    {contact.firstName} {contact.lastName}
                  </span>
                  {contact.isPrimary && (
                    <StatusPill variant="info">Primary</StatusPill>
                  )}
                </div>
              </InfoRow>

              {contact.title && (
                <InfoRow label="Title">{contact.title}</InfoRow>
              )}

              <InfoRow label="Email">
                {contact.email ? (
                  <a
                    href={`mailto:${contact.email}`}
                    className="flex items-center gap-1.5 text-titan-accent hover:underline break-all"
                  >
                    <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                    {contact.email}
                  </a>
                ) : (
                  <span className="text-titan-text-muted text-titan-xs italic">Not provided</span>
                )}
              </InfoRow>

              <InfoRow label="Phone">
                {contact.phone ? (
                  <a
                    href={phoneToTelHref(contact.phone)}
                    className="flex items-center gap-1.5 hover:text-titan-accent transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5 flex-shrink-0 text-titan-text-muted" />
                    {formatPhoneForDisplay(contact.phone)}
                  </a>
                ) : (
                  <span className="text-titan-text-muted text-titan-xs italic">Not provided</span>
                )}
              </InfoRow>

              {contact.mobile && (
                <InfoRow label="Mobile">
                  <a
                    href={phoneToTelHref(contact.mobile)}
                    className="flex items-center gap-1.5 hover:text-titan-accent transition-colors"
                  >
                    <Smartphone className="w-3.5 h-3.5 flex-shrink-0 text-titan-text-muted" />
                    {formatPhoneForDisplay(contact.mobile)}
                  </a>
                </InfoRow>
              )}

              {(contact.street1 || contact.city) && (
                <InfoRow label="Address">
                  <div className="text-titan-sm text-titan-text-secondary space-y-0.5">
                    {contact.street1 && <div>{contact.street1}</div>}
                    {contact.street2 && <div>{contact.street2}</div>}
                    {(contact.city || contact.state || contact.postalCode) && (
                      <div>
                        {[contact.city, contact.state, contact.postalCode]
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    )}
                    {contact.country && <div>{contact.country}</div>}
                  </div>
                </InfoRow>
              )}
            </div>
          </div>

          {/* Customer Information */}
          <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-4">
              <Building2 className="w-4 h-4 text-titan-text-secondary" />
              <h2 className="text-titan-base font-semibold text-titan-text-primary">Customer</h2>
            </div>
            <div className="space-y-3 flex-1">
              <InfoRow label="Company">
                <span className="font-medium text-titan-text-primary">{customer.companyName}</span>
              </InfoRow>

              {customer.email && (
                <InfoRow label="Email">
                  <a
                    href={`mailto:${customer.email}`}
                    className="flex items-center gap-1.5 text-titan-accent hover:underline break-all"
                  >
                    <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                    {customer.email}
                  </a>
                </InfoRow>
              )}

              {customer.phone && (
                <InfoRow label="Phone">
                  <a
                    href={`tel:${customer.phone}`}
                    className="flex items-center gap-1.5 hover:text-titan-accent transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5 flex-shrink-0 text-titan-text-muted" />
                    {customer.phone}
                  </a>
                </InfoRow>
              )}

              {customer.website && (
                <InfoRow label="Website">
                  <a
                    href={
                      customer.website.startsWith("http")
                        ? customer.website
                        : `https://${customer.website}`
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-titan-accent hover:underline break-all"
                  >
                    {customer.website}
                    <ExternalLink className="w-3 h-3 flex-shrink-0 ml-0.5" />
                  </a>
                </InfoRow>
              )}

              {customer.address && (
                <InfoRow label="Address">
                  <span className="text-titan-sm text-titan-text-secondary">
                    {customer.address}
                  </span>
                </InfoRow>
              )}
            </div>

            <div className="mt-5 pt-4 border-t border-titan-border-subtle">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(ROUTES.customers.detail(customer.id))}
                className="w-full h-8 text-[12px] border-titan-border-subtle text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
              >
                View Customer Details
                <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* ── RECENT ORDERS ───────────────────────────────────────────────── */}
        <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-titan-border-subtle">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-titan-text-secondary" />
              <h2 className="text-titan-base font-semibold text-titan-text-primary">
                Recent Orders
              </h2>
              {recentOrders.length > 0 && (
                <span className="text-titan-xs text-titan-text-muted">
                  ({recentOrders.length})
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`${ROUTES.orders.new}?customerId=${customer.id}`)}
              className="h-7 text-[11px] border-titan-border-subtle text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
            >
              <Plus className="w-3 h-3 mr-1" />
              New Order
            </Button>
          </div>

          {recentOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Package className="w-10 h-10 text-titan-text-muted mb-3 opacity-30" />
              <p className="text-titan-sm font-medium text-titan-text-secondary mb-1">
                No orders yet
              </p>
              <p className="text-titan-xs text-titan-text-muted mb-4">
                No orders have been created for this contact yet.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`${ROUTES.orders.new}?customerId=${customer.id}`)}
                className="h-8 text-[12px] border-titan-border-subtle"
              >
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Create Order
              </Button>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
                  <th className="px-4 py-2.5 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
                    Order #
                  </th>
                  <th className="px-4 py-2.5 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-4 py-2.5 text-right text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr
                    key={order.id}
                    className="border-b border-titan-border-subtle last:border-0 hover:bg-titan-bg-table-row transition-colors cursor-pointer"
                    onClick={() => navigate(ROUTES.orders.detail(order.id))}
                  >
                    <td className="px-4 py-3">
                      <span className="text-titan-sm font-medium text-titan-accent">
                        {order.orderNumber}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill variant={getStatusVariant(order.status)}>
                        {formatStatus(order.status)}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-3 text-titan-sm text-titan-text-secondary">
                      {formatDate(order.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right text-titan-sm font-medium text-titan-success">
                      {formatCurrency(order.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── RECENT QUOTES ───────────────────────────────────────────────── */}
        <div className="bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-titan-border-subtle">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-titan-text-secondary" />
              <h2 className="text-titan-base font-semibold text-titan-text-primary">
                Recent Quotes
              </h2>
              {recentQuotes.length > 0 && (
                <span className="text-titan-xs text-titan-text-muted">
                  ({recentQuotes.length})
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`${ROUTES.quotes.new}?customerId=${customer.id}`)}
              className="h-7 text-[11px] border-titan-border-subtle text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
            >
              <Plus className="w-3 h-3 mr-1" />
              New Quote
            </Button>
          </div>

          {recentQuotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="w-10 h-10 text-titan-text-muted mb-3 opacity-30" />
              <p className="text-titan-sm font-medium text-titan-text-secondary mb-1">
                No quotes yet
              </p>
              <p className="text-titan-xs text-titan-text-muted mb-4">
                No quotes have been created for this contact yet.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`${ROUTES.quotes.new}?customerId=${customer.id}`)}
                className="h-8 text-[12px] border-titan-border-subtle"
              >
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Create Quote
              </Button>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-titan-bg-card-elevated border-b border-titan-border-subtle">
                  <th className="px-4 py-2.5 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
                    Quote #
                  </th>
                  <th className="px-4 py-2.5 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-4 py-2.5 text-right text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wider">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentQuotes.map((quote) => (
                  <tr
                    key={quote.id}
                    className="border-b border-titan-border-subtle last:border-0 hover:bg-titan-bg-table-row transition-colors cursor-pointer"
                    onClick={() => navigate(ROUTES.quotes.detail(quote.id))}
                  >
                    <td className="px-4 py-3">
                      <span className="text-titan-sm font-medium text-titan-accent">
                        Q-{quote.quoteNumber}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill
                        variant={quote.status ? getStatusVariant(quote.status) : "muted"}
                      >
                        {quote.status ? formatStatus(quote.status) : "Draft"}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-3 text-titan-sm text-titan-text-secondary">
                      {formatDate(quote.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right text-titan-sm font-medium text-titan-success">
                      {formatCurrency(quote.totalPrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </ContentLayout>

      {/* ── EDIT CONTACT MODAL ──────────────────────────────────────────────── */}
      {editOpen && (
        <EditContactDialog
          contact={contact}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSave={async (formData) => {
            await updateContact.mutateAsync({ id: contact.id, data: formData });
            setEditOpen(false);
          }}
        />
      )}
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InfoRow — label + value helper used in info cards
// ─────────────────────────────────────────────────────────────────────────────

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-20 flex-shrink-0 text-[11px] font-medium text-titan-text-muted uppercase tracking-wide pt-0.5">
        {label}
      </span>
      <div className="flex-1 text-titan-sm text-titan-text-primary min-w-0">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EditContactDialog — mirrors the dialog in contacts.tsx, accepts Contact type
// ─────────────────────────────────────────────────────────────────────────────

interface EditContactDialogProps {
  contact: Contact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: {
    firstName: string;
    lastName: string;
    title: string;
    email: string;
    phone: string;
    mobile: string;
    isPrimary: boolean;
    street1: string;
    street2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  }) => Promise<void>;
}

function EditContactDialog({
  contact,
  open,
  onOpenChange,
  onSave,
}: EditContactDialogProps) {
  const [formData, setFormData] = useState({
    firstName: contact.firstName,
    lastName: contact.lastName,
    title: contact.title ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    mobile: contact.mobile ?? "",
    isPrimary: contact.isPrimary,
    street1: contact.street1 ?? "",
    street2: contact.street2 ?? "",
    city: contact.city ?? "",
    state: contact.state ?? "",
    postalCode: contact.postalCode ?? "",
    country: contact.country ?? "",
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

  const field = <K extends keyof typeof formData>(key: K) => ({
    value: formData[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setFormData({ ...formData, [key]: e.target.value }),
  });

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
                <Label htmlFor="ec-firstName">First Name *</Label>
                <Input id="ec-firstName" {...field("firstName")} required />
              </div>
              <div>
                <Label htmlFor="ec-lastName">Last Name *</Label>
                <Input id="ec-lastName" {...field("lastName")} required />
              </div>
              <div>
                <Label htmlFor="ec-email">Email</Label>
                <Input id="ec-email" type="email" {...field("email")} />
              </div>
              <div>
                <Label htmlFor="ec-title">Title / Role</Label>
                <Input id="ec-title" {...field("title")} />
              </div>
              <div>
                <Label htmlFor="ec-phone">Phone</Label>
                <Input id="ec-phone" {...field("phone")} />
              </div>
              <div>
                <Label htmlFor="ec-mobile">Mobile</Label>
                <Input id="ec-mobile" {...field("mobile")} />
              </div>
              <div className="col-span-2 flex items-center space-x-2">
                <Checkbox
                  id="ec-isPrimary"
                  checked={formData.isPrimary}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, isPrimary: Boolean(checked) })
                  }
                />
                <Label htmlFor="ec-isPrimary">Primary Contact</Label>
              </div>
            </div>
          </div>

          {/* Address */}
          <div className="space-y-4">
            <h4 className="font-medium">Address</h4>
            <div className="space-y-3">
              <div>
                <Label htmlFor="ec-street1">Street Address</Label>
                <Input id="ec-street1" placeholder="123 Main St" {...field("street1")} />
              </div>
              <div>
                <Label htmlFor="ec-street2">Street Address 2</Label>
                <Input id="ec-street2" placeholder="Suite 100" {...field("street2")} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="ec-city">City</Label>
                  <Input id="ec-city" placeholder="City" {...field("city")} />
                </div>
                <div>
                  <Label htmlFor="ec-state">State</Label>
                  <Input id="ec-state" placeholder="State" {...field("state")} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="ec-postalCode">Postal Code</Label>
                  <Input id="ec-postalCode" placeholder="12345" {...field("postalCode")} />
                </div>
                <div>
                  <Label htmlFor="ec-country">Country</Label>
                  <Input id="ec-country" placeholder="USA" {...field("country")} />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
