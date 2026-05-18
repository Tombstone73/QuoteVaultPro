/**
 * CustomerIdentityBlock
 *
 * Pure presentational component — no internal data fetching, no mutations.
 * Renders the canonical identity display for a customer: company name,
 * primary contact, email/phone, location.
 *
 * Display priority:
 *   1. company/customer name (always)
 *   2. primary contact if available
 *   3. otherwise first contact
 *   4. otherwise email/phone from customer record
 *   5. otherwise muted "No primary contact"
 *
 * Supports: compact mode (no avatar, no location) and full mode.
 *
 * Usage:
 *   - EnhancedCustomerView / CustomerHeader
 *   - SplitCustomerDetail
 *   - Future order/invoice/quote customer cards
 */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Mail, Phone, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/config/routes";
import type { CustomerWithRelations } from "@/hooks/useCustomer";

export interface CustomerIdentityBlockProps {
  customer: CustomerWithRelations;
  /** compact = no avatar, no location, smaller company name */
  mode?: "compact" | "full";
  className?: string;
  /** Whether to show the small account number badge (compact mode only) */
  showAccountNumber?: boolean;
}

export function CustomerIdentityBlock({
  customer,
  mode = "full",
  className,
  showAccountNumber = false,
}: CustomerIdentityBlockProps) {
  const navigate = useNavigate();
  const isCompact = mode === "compact";

  const primaryContact = useMemo(() => {
    return customer.contacts?.find((c) => c.isPrimary) ?? customer.contacts?.[0] ?? null;
  }, [customer.contacts]);

  const cityState = useMemo(() => {
    return [customer.shippingCity, customer.shippingState].filter(Boolean).join(", ") || null;
  }, [customer.shippingCity, customer.shippingState]);

  const displayEmail = primaryContact?.email || customer.email;
  const displayPhone = primaryContact?.phone || customer.phone;

  // Short account number derived from id (first 12 chars, uppercased)
  const accountNumber = customer.id ? customer.id.slice(0, 12).toUpperCase() : null;

  return (
    <div className={cn("flex items-center gap-2.5 flex-1 min-w-0", className)}>
      {/* Avatar / icon — full mode only */}
      {!isCompact && (
        <div className="flex-shrink-0 w-8 h-8 bg-titan-bg-card-elevated rounded-full flex items-center justify-center">
          <Building2 className="w-4 h-4 text-titan-text-secondary" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        {/* Company Name */}
        <h2
          className={cn(
            "font-bold text-titan-text-primary leading-tight truncate",
            isCompact ? "text-base" : "text-lg",
          )}
        >
          {customer.companyName}
        </h2>

        {/* Primary Contact row */}
        {primaryContact ? (
          <div className="flex items-center gap-1 text-[11px] text-titan-text-muted mt-0.5">
            <span className="text-titan-text-secondary font-medium">Primary Contact:</span>
            <button
              type="button"
              onClick={() => navigate(ROUTES.contacts.detail(primaryContact.id))}
              className="hover:text-titan-accent transition-colors truncate"
            >
              {primaryContact.firstName} {primaryContact.lastName}
            </button>
            {showAccountNumber && isCompact && accountNumber && (
              <span className="ml-2 text-titan-text-muted/60">#{accountNumber}</span>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-titan-text-muted/60 mt-0.5 italic">
            No primary contact
          </div>
        )}

        {/* Contact detail row — email, phone, location */}
        <div className="flex items-center gap-2.5 mt-0.5 text-[11px] text-titan-text-muted flex-wrap">
          {displayEmail && (
            <a
              href={`mailto:${displayEmail}`}
              className="flex items-center gap-1 hover:text-titan-accent transition-colors"
            >
              <Mail className="w-3 h-3 flex-shrink-0" />
              <span className="truncate max-w-[160px]">{displayEmail}</span>
            </a>
          )}
          {displayPhone && (
            <a
              href={`tel:${displayPhone.replace(/[^+\d]/g, "")}`}
              className="flex items-center gap-1 hover:text-titan-accent transition-colors"
            >
              <Phone className="w-3 h-3 flex-shrink-0" />
              {displayPhone}
            </a>
          )}
          {!isCompact && cityState && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              {cityState}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
