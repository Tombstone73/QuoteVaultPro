import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { TitanCard } from "@/components/ui/TitanCard";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Edit, Mail, Phone, MapPin, Globe, Building2 } from "lucide-react";

type CustomerWithRelations = {
  id: string;
  companyName: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  status: string;
  customerType: string;
  shippingAddressLine1: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingZipCode: string | null;
  billingAddressLine1: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingZipCode: string | null;
  currentBalance: string;
  creditLimit: string;
  availableCredit: string;
  paymentTerms: string;
  contacts: any[];
};

interface SplitCustomerDetailProps {
  customerId: string | null;
  onEdit: () => void;
}

export function SplitCustomerDetail({ customerId, onEdit }: SplitCustomerDetailProps) {
  const { data: customer, isLoading } = useQuery<CustomerWithRelations>({
    queryKey: [`/api/customers/${customerId}`],
    queryFn: async () => {
      if (!customerId) return null;
      const res = await fetch(`/api/customers/${customerId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!customerId,
  });

  if (!customerId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <Building2 className="w-16 h-16 mb-4" style={{ color: 'var(--text-muted)' }} />
        <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-muted)' }}>No Customer Selected</h3>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Select a customer from the list to view details.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>Customer not found</div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-green-500/10 text-green-500 border-green-500/20";
      case "inactive": return "bg-gray-500/10 text-gray-500 border-gray-500/20";
      case "suspended": return "bg-red-500/10 text-red-500 border-red-500/20";
      case "on_hold": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      default: return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Avatar className="w-12 h-12">
            <AvatarFallback className="bg-primary/20 text-primary text-lg">
              {customer.companyName[0]}
            </AvatarFallback>
          </Avatar>
          <div>
            <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{customer.companyName}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge
                variant="outline"
                style={
                  customer.status === 'active' ? { backgroundColor: 'var(--badge-success-bg)', color: 'var(--badge-success-text)', borderColor: 'var(--badge-success-border)' } :
                  customer.status === 'suspended' ? { backgroundColor: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderColor: 'var(--badge-danger-border)' } :
                  customer.status === 'on_hold' ? { backgroundColor: 'var(--badge-warning-bg)', color: 'var(--badge-warning-text)', borderColor: 'var(--badge-warning-border)' } :
                  { backgroundColor: 'var(--badge-muted-bg)', color: 'var(--badge-muted-text)', borderColor: 'var(--badge-muted-border)' }
                }
              >
                {customer.status.replace("_", " ")}
              </Badge>
              <Badge variant="outline" className="text-xs" style={{ borderColor: 'var(--badge-muted-border)', color: 'var(--badge-muted-text)', backgroundColor: 'var(--badge-muted-bg)' }}>
                {customer.customerType}
              </Badge>
            </div>
          </div>
        </div>
        <Button size="sm" variant="secondary" className="border" style={{ backgroundColor: 'var(--button-secondary-bg)', color: 'var(--button-secondary-text)', borderColor: 'var(--border-subtle)' }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--button-secondary-hover-bg'))}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--button-secondary-bg'))}
          onClick={onEdit}
        >
          <Edit className="w-4 h-4 mr-2" />
          Edit
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="border rounded-md p-3" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-surface-soft)' }}>
          <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Balance</div>
          <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>${Number(customer.currentBalance || 0).toFixed(2)}</div>
        </div>
        <div className="border rounded-md p-3" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-surface-soft)' }}>
          <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Credit Limit</div>
          <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>${Number(customer.creditLimit || 0).toFixed(2)}</div>
        </div>
        <div className="border rounded-md p-3" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-surface-soft)' }}>
          <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Available</div>
          <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>${Number(customer.availableCredit || 0).toFixed(2)}</div>
        </div>
      </div>

      {/* Contact Info */}
      <div className="space-y-2 text-sm" style={{ color: 'var(--text-muted)' }}>
        <div className="font-medium" style={{ color: 'var(--text-primary)' }}>Contact Information</div>
        {customer.email && (
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4" />
            <span>{customer.email}</span>
          </div>
        )}
        {customer.phone && (
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4" />
            <span>{customer.phone}</span>
          </div>
        )}
        {customer.website && (
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4" />
            <a href={customer.website} target="_blank" rel="noopener" className="hover:underline" style={{ color: 'var(--accent-primary)' }}>{customer.website}</a>
          </div>
        )}
      </div>

      {/* Addresses */}
      <div className="space-y-3">
        {customer.shippingAddressLine1 && (
          <div className="text-sm">
            <div className="font-medium mb-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <MapPin className="w-4 h-4" />
              Shipping Address
            </div>
            <div className="space-y-0.5" style={{ color: 'var(--text-muted)' }}>
              <div>{customer.shippingAddressLine1}</div>
              {customer.shippingCity && (
                <div>{customer.shippingCity}, {customer.shippingState} {customer.shippingZipCode}</div>
              )}
            </div>
          </div>
        )}
        {customer.billingAddressLine1 && (
          <div className="text-sm">
            <div className="font-medium mb-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <MapPin className="w-4 h-4" />
              Billing Address
            </div>
            <div className="space-y-0.5" style={{ color: 'var(--text-muted)' }}>
              <div>{customer.billingAddressLine1}</div>
              {customer.billingCity && (
                <div>{customer.billingCity}, {customer.billingState} {customer.billingZipCode}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Contacts */}
      {customer.contacts && customer.contacts.length > 0 && (
        <div className="text-sm">
          <div className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Contacts ({customer.contacts.length})</div>
          <div className="space-y-2">
            {customer.contacts.map((c: any) => (
              <div key={c.id} className="border rounded-md p-2" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-surface-soft)' }}>
                <div style={{ color: 'var(--text-primary)' }}>{c.firstName} {c.lastName}</div>
                {c.title && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.title}</div>}
                {c.email && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.email}</div>}
                {c.phone && <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{c.phone}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
