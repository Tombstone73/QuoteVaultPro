import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Edit } from "lucide-react";
import type { CustomerWithRelations } from "@/hooks/useCustomer";
import type { CustomerFormSection } from "@/components/customer-form";
import { customerPaymentTermsLabel } from "@shared/customerCommercialConfiguration";
import { taxRatePercentFromDecimal } from "@shared/salesTax";

export function customerAddress(customer: CustomerWithRelations, kind: "billing" | "shipping"): string {
  return [
    customer[`${kind}Street1`] || customer[`${kind}AddressLine1`],
    customer[`${kind}Street2`] || customer[`${kind}AddressLine2`],
    [customer[`${kind}City`], customer[`${kind}State`], customer[`${kind}PostalCode`] || customer[`${kind}ZipCode`]].filter(Boolean).join(" "),
    customer[`${kind}Country`],
  ].filter(Boolean).join(", ") || customer[`${kind}Address`] || "Not set";
}

function Value({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-2 py-0.5 text-xs">
    <dt className="text-titan-text-secondary">{label}</dt>
    <dd className="min-w-0 whitespace-pre-wrap break-words text-titan-text-primary">{children ?? "Not set"}</dd>
  </div>;
}

function Section({ title, section, onEdit, children }: { title: string; section: CustomerFormSection; onEdit: (section: CustomerFormSection) => void; children: ReactNode }) {
  return <section aria-label={title} className="min-w-0 p-3">
    <div className="mb-1 flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-titan-text-primary">{title}</h3>
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2" aria-label={`Edit ${title}`} onClick={() => onEdit(section)}><Edit className="mr-1 h-3 w-3" aria-hidden="true" />Edit</Button>
    </div>
    <dl>{children}</dl>
  </section>;
}

const percent = (value: string | number | null | undefined) => value == null ? "Not set" : `${Number(value)}%`;

export function CustomerCompanySections({ customer, companyNotes, artworkFolder, onEdit, onEditDestination }: {
  customer: CustomerWithRelations;
  companyNotes: string | null | undefined;
  artworkFolder: string;
  onEdit: (section: CustomerFormSection) => void;
  onEditDestination: () => void;
}) {
  return <div className="mt-2 grid divide-y divide-titan-border-subtle rounded-lg border border-titan-border-subtle sm:grid-cols-2 xl:grid-cols-4 xl:divide-y-0">
    <Section title="Company Information" section="company" onEdit={onEdit}>
      <Value label="Billing address">{customerAddress(customer, "billing")}</Value>
      <Value label="Shipping address">{customerAddress(customer, "shipping")}</Value>
      <Value label="Email">{customer.email ? <a className="underline underline-offset-2" href={`mailto:${customer.email}`}>{customer.email}</a> : "Not set"}</Value>
      <Value label="Phone">{customer.phone || "Not set"}</Value>
      <Value label="Website">{customer.website || "Not set"}</Value>
      <Value label="Notes">{companyNotes === undefined ? "Company notes unavailable" : companyNotes || "No company notes"}</Value>
      {customer.notes?.length > 0 && <Value label="History"><details><summary className="cursor-pointer">Note history ({customer.notes.length})</summary><div className="max-h-32 overflow-y-auto">{customer.notes.map(note => <p className="mt-1 whitespace-pre-wrap break-words" key={note.id}>{note.subject && <strong>{note.subject}: </strong>}{note.content}</p>)}</div></details></Value>}
    </Section>
    <Section title="Financial & Tax" section="financial" onEdit={onEdit}>
      <Value label="Payment terms">{customerPaymentTermsLabel(customer.paymentTerms)}</Value>
      <Value label="Credit limit">{customer.creditLimitConfigured ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(customer.creditLimit)) : "Not set"}</Value>
      <Value label="Tax exempt">{customer.isTaxExempt ? "Yes" : "No"}</Value>
      <Value label="Tax override">{customer.taxRateOverride == null ? "Default tax rate" : `${taxRatePercentFromDecimal(customer.taxRateOverride)}%`}</Value>
      <Value label="Exemption reason">{customer.taxExemptReason || "Not set"}</Value>
      <Value label="Certificate">{customer.taxExemptCertificateRef || "Not set"}</Value>
      <Value label="Tax ID">{customer.taxId || "Not set"}</Value>
    </Section>
    <Section title="Pricing & Products" section="pricing" onEdit={onEdit}>
      <Value label="Pricing tier">{customer.pricingTier || "default"}</Value>
      <Value label="Discount">{percent(customer.defaultDiscountPercent)}</Value>
      <Value label="Markup">{percent(customer.defaultMarkupPercent)}</Value>
      <Value label="Margin">{percent(customer.defaultMarginPercent)}</Value>
      <Value label="Portal catalog">{customer.productVisibilityMode === "linked-only" ? "Linked products only" : "Default catalog"}</Value>
    </Section>
    <Section title="Production Settings" section="production" onEdit={onEdit}>
      <Value label="Art output folder">{artworkFolder}</Value>
      <Value label="Require proof">{customer.alwaysRequireProof ? "Always" : "Standard workflow"}</Value>
      <Value label="Blind shipping">{customer.blindShipping ? "Yes" : "No"}</Value>
      <Value label="Production folder">{customer.localCompanyFolderPath || "Not set"}</Value>
      {customer.customerProductionFolderReference && <Value label="Folder status">{customer.customerProductionFolderReference.status}</Value>}
      <Button type="button" variant="link" size="sm" className="mt-1 h-auto p-0 text-xs" onClick={onEditDestination}>Edit production destination</Button>
    </Section>
  </div>;
}
