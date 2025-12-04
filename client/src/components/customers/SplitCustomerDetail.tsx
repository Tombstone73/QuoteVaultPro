import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Edit, Mail, Phone, MapPin, Globe, Building2 } from "lucide-react";
import { DataCard, Section } from "@/components/titan";

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
  onEdit: (customerId: string) => void;
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
        <Building2 className="w-16 h-16 mb-4 text-muted-foreground" />
        <h3 className="text-lg font-medium mb-2 text-muted-foreground">No Customer Selected</h3>
        <p className="text-sm text-muted-foreground">
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
      <div className="py-12 text-center text-muted-foreground">Customer not found</div>
    );
  }

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "active": return "bg-green-500/10 text-green-600 border-green-500/20";
      case "inactive": return "bg-gray-500/10 text-gray-500 border-gray-500/20";
      case "suspended": return "bg-red-500/10 text-red-600 border-red-500/20";
      case "on_hold": return "bg-yellow-500/10 text-yellow-600 border-yellow-500/20";
      default: return "bg-gray-500/10 text-gray-500 border-gray-500/20";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Avatar className="w-12 h-12">
            <AvatarFallback className="bg-primary/20 text-primary text-lg">
              {customer.companyName[0]}
            </AvatarFallback>
          </Avatar>
          <div>
            <h2 className="text-xl font-bold text-foreground">{customer.companyName}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className={getStatusBadgeClass(customer.status)}>
                {customer.status.replace("_", " ")}
              </Badge>
              <Badge variant="outline" className="text-xs text-muted-foreground">
                {customer.customerType}
              </Badge>
            </div>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => onEdit(customer.id)}>
          <Edit className="w-4 h-4 mr-2" />
          Edit
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="border border-border/60 rounded-lg p-3 bg-card/50">
          <div className="text-xs text-muted-foreground mb-1">Balance</div>
          <div className="text-lg font-bold text-foreground">${Number(customer.currentBalance || 0).toFixed(2)}</div>
        </div>
        <div className="border border-border/60 rounded-lg p-3 bg-card/50">
          <div className="text-xs text-muted-foreground mb-1">Credit Limit</div>
          <div className="text-lg font-bold text-foreground">${Number(customer.creditLimit || 0).toFixed(2)}</div>
        </div>
        <div className="border border-border/60 rounded-lg p-3 bg-card/50">
          <div className="text-xs text-muted-foreground mb-1">Available</div>
          <div className="text-lg font-bold text-foreground">${Number(customer.availableCredit || 0).toFixed(2)}</div>
        </div>
      </div>

      {/* Contact Info */}
      <Section title="Contact Information">
        <div className="space-y-2 text-sm text-muted-foreground">
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
              <a href={customer.website} target="_blank" rel="noopener" className="text-primary hover:underline">
                {customer.website}
              </a>
            </div>
          )}
        </div>
      </Section>

      {/* Addresses */}
      <div className="space-y-4">
        {customer.shippingAddressLine1 && (
          <Section>
            <div className="text-sm">
              <div className="font-medium mb-1 flex items-center gap-2 text-foreground">
                <MapPin className="w-4 h-4" />
                Shipping Address
              </div>
              <div className="space-y-0.5 text-muted-foreground">
                <div>{customer.shippingAddressLine1}</div>
                {customer.shippingCity && (
                  <div>{customer.shippingCity}, {customer.shippingState} {customer.shippingZipCode}</div>
                )}
              </div>
            </div>
          </Section>
        )}
        {customer.billingAddressLine1 && (
          <Section>
            <div className="text-sm">
              <div className="font-medium mb-1 flex items-center gap-2 text-foreground">
                <MapPin className="w-4 h-4" />
                Billing Address
              </div>
              <div className="space-y-0.5 text-muted-foreground">
                <div>{customer.billingAddressLine1}</div>
                {customer.billingCity && (
                  <div>{customer.billingCity}, {customer.billingState} {customer.billingZipCode}</div>
                )}
              </div>
            </div>
          </Section>
        )}
      </div>

      {/* Contacts */}
      {customer.contacts && customer.contacts.length > 0 && (
        <Section title={`Contacts (${customer.contacts.length})`}>
          <div className="space-y-2">
            {customer.contacts.map((c: any) => (
              <div key={c.id} className="border border-border/60 rounded-lg p-3 bg-card/50">
                <div className="text-sm font-medium text-foreground">{c.firstName} {c.lastName}</div>
                {c.title && <div className="text-xs text-muted-foreground">{c.title}</div>}
                {c.email && <div className="text-xs text-muted-foreground">{c.email}</div>}
                {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
