import * as React from "react";
import { Loader2, Save, UserCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  portalDashboardKeys,
  portalProfileKeys,
  usePortalProfile,
  useUpdatePortalProfile,
  type PortalProfileAddressDto,
  type PortalProfileDto,
  type PortalProfileUpdatePayload,
} from "@/hooks/usePortal";
import { useQueryClient } from "@tanstack/react-query";

type ProfileFormState = {
  company: {
    phone: string;
    email: string;
  };
  billingAddress: Record<keyof PortalProfileAddressDto, string>;
  shippingAddress: Record<keyof PortalProfileAddressDto, string>;
  contact: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
  };
};

const ADDRESS_FIELDS: Array<{ key: keyof PortalProfileAddressDto; label: string; autoComplete: string }> = [
  { key: "street1", label: "Street address", autoComplete: "billing address-line1" },
  { key: "street2", label: "Suite / unit", autoComplete: "billing address-line2" },
  { key: "city", label: "City", autoComplete: "billing address-level2" },
  { key: "state", label: "State", autoComplete: "billing address-level1" },
  { key: "postalCode", label: "Postal code", autoComplete: "billing postal-code" },
  { key: "country", label: "Country", autoComplete: "billing country-name" },
];

function value(value: string | null | undefined) {
  return value ?? "";
}

function buildFormState(profile: PortalProfileDto): ProfileFormState {
  return {
    company: {
      phone: value(profile.company.phone),
      email: value(profile.company.email),
    },
    billingAddress: {
      street1: value(profile.billingAddress.street1),
      street2: value(profile.billingAddress.street2),
      city: value(profile.billingAddress.city),
      state: value(profile.billingAddress.state),
      postalCode: value(profile.billingAddress.postalCode),
      country: value(profile.billingAddress.country),
    },
    shippingAddress: {
      street1: value(profile.shippingAddress.street1),
      street2: value(profile.shippingAddress.street2),
      city: value(profile.shippingAddress.city),
      state: value(profile.shippingAddress.state),
      postalCode: value(profile.shippingAddress.postalCode),
      country: value(profile.shippingAddress.country),
    },
    contact: {
      firstName: value(profile.contact?.firstName),
      lastName: value(profile.contact?.lastName),
      phone: value(profile.contact?.phone),
      email: value(profile.contact?.email),
    },
  };
}

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildUpdatePayload(form: ProfileFormState, profile: PortalProfileDto): PortalProfileUpdatePayload {
  const payload: PortalProfileUpdatePayload = {
    company: {
      phone: nullableText(form.company.phone),
      email: nullableText(form.company.email),
    },
    billingAddress: {},
    shippingAddress: {},
  };

  for (const field of ADDRESS_FIELDS) {
    payload.billingAddress![field.key] = nullableText(form.billingAddress[field.key]);
    payload.shippingAddress![field.key] = nullableText(form.shippingAddress[field.key]);
  }

  if (profile.contact) {
    payload.contact = {
      firstName: form.contact.firstName.trim(),
      lastName: form.contact.lastName.trim(),
      phone: nullableText(form.contact.phone),
      ...(profile.contact.emailEditable ? { email: nullableText(form.contact.email) } : {}),
    };
  }

  return payload;
}

function AddressSection({
  title,
  description,
  values,
  onChange,
}: {
  title: string;
  description: string;
  values: Record<keyof PortalProfileAddressDto, string>;
  onChange: (field: keyof PortalProfileAddressDto, value: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {ADDRESS_FIELDS.map((field) => (
          <div key={field.key} className={field.key === "street1" || field.key === "street2" ? "sm:col-span-2" : undefined}>
            <Label htmlFor={`${title}-${field.key}`}>{field.label}</Label>
            <Input
              id={`${title}-${field.key}`}
              className="mt-1"
              autoComplete={field.autoComplete}
              value={values[field.key]}
              onChange={(event) => onChange(field.key, event.target.value)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function PortalProfilePage() {
  const { data: profile, isLoading, error } = usePortalProfile();
  const updateProfile = useUpdatePortalProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = React.useState<ProfileFormState | null>(null);

  React.useEffect(() => {
    if (profile) setForm(buildFormState(profile));
  }, [profile]);

  if (isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !profile || !form) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium text-destructive">Could not load profile</p>
            <p className="mt-1 text-sm text-muted-foreground">{error instanceof Error ? error.message : "Profile unavailable"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const save = async () => {
    try {
      const updated = await updateProfile.mutateAsync(buildUpdatePayload(form, profile));
      setForm(buildFormState(updated));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: portalProfileKeys.current }),
        queryClient.invalidateQueries({ queryKey: portalDashboardKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["portal", "me"] }),
      ]);
      toast({ title: "Updated successfully", description: "Your account info has been updated." });
    } catch (err) {
      toast({
        title: "Profile update failed",
        description: err instanceof Error ? err.message : "Please check your changes and try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Keep your account and contact information current.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserCircle className="h-5 w-5 text-muted-foreground" />
            Company Info
          </CardTitle>
          <CardDescription>Basic account details your print partner uses to reach your company.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Company name</Label>
            <Input className="mt-1" value={profile.company.name} disabled />
            <p className="mt-1 text-xs text-muted-foreground">Contact support for legal business name changes.</p>
          </div>
          <div>
            <Label htmlFor="company-phone">Company phone</Label>
            <Input
              id="company-phone"
              className="mt-1"
              autoComplete="tel"
              value={form.company.phone}
              onChange={(event) => setForm({ ...form, company: { ...form.company, phone: event.target.value } })}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="company-email">Company general email</Label>
            <Input
              id="company-email"
              className="mt-1"
              autoComplete="email"
              value={form.company.email}
              onChange={(event) => setForm({ ...form, company: { ...form.company, email: event.target.value } })}
            />
          </div>
        </CardContent>
      </Card>

      <AddressSection
        title="Billing Address"
        description="Address used for account billing and invoices."
        values={form.billingAddress}
        onChange={(field, next) => setForm({ ...form, billingAddress: { ...form.billingAddress, [field]: next } })}
      />

      <AddressSection
        title="Shipping Address"
        description="Default address used for deliveries and shipping paperwork."
        values={form.shippingAddress}
        onChange={(field, next) => setForm({ ...form, shippingAddress: { ...form.shippingAddress, [field]: next } })}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">My Contact Info</CardTitle>
          <CardDescription>Your personal contact information for this account.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {profile.contact ? (
            <>
              <div>
                <Label htmlFor="contact-first">First name</Label>
                <Input
                  id="contact-first"
                  className="mt-1"
                  autoComplete="given-name"
                  value={form.contact.firstName}
                  onChange={(event) => setForm({ ...form, contact: { ...form.contact, firstName: event.target.value } })}
                />
              </div>
              <div>
                <Label htmlFor="contact-last">Last name</Label>
                <Input
                  id="contact-last"
                  className="mt-1"
                  autoComplete="family-name"
                  value={form.contact.lastName}
                  onChange={(event) => setForm({ ...form, contact: { ...form.contact, lastName: event.target.value } })}
                />
              </div>
              <div>
                <Label htmlFor="contact-phone">Contact phone</Label>
                <Input
                  id="contact-phone"
                  className="mt-1"
                  autoComplete="tel"
                  value={form.contact.phone}
                  onChange={(event) => setForm({ ...form, contact: { ...form.contact, phone: event.target.value } })}
                />
              </div>
              <div>
                <Label htmlFor="contact-email">Contact email</Label>
                <Input
                  id="contact-email"
                  className="mt-1"
                  autoComplete="email"
                  value={form.contact.email}
                  disabled={!profile.contact.emailEditable}
                  onChange={(event) => setForm({ ...form, contact: { ...form.contact, email: event.target.value } })}
                />
                {profile.contact.emailEditMessage ? (
                  <p className="mt-1 text-xs text-muted-foreground">{profile.contact.emailEditMessage}</p>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground sm:col-span-2">No contact record is linked to this portal login.</p>
          )}
        </CardContent>
      </Card>

      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Changes save immediately and are visible to your print partner.
          </p>
          <Button type="button" onClick={save} disabled={updateProfile.isPending}>
            {updateProfile.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Profile
          </Button>
        </div>
      </div>
    </div>
  );
}
