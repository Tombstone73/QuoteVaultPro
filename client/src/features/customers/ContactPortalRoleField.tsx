import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { useActiveOrganizationRole } from "@/hooks/useActiveOrganizationRole";
import { apiRequest } from "@/lib/queryClient";
import { defaultPortalRole, isPortalRole, PORTAL_ROLES, PORTAL_ROLE_LABELS, type PortalRole } from "@shared/portalPermissions";

type Props = {
  customerId?: string;
  newCompany?: boolean;
  value?: PortalRole;
  onChange: (role: PortalRole | undefined) => void;
};

export function ContactPortalRoleField({ customerId, newCompany, value, onChange }: Props) {
  const id = useId();
  const { activeOrgId, isAdminOrOwner } = useActiveOrganizationRole();
  const contacts = useQuery<number>({
    queryKey: ["company-contact-count", activeOrgId, customerId],
    enabled: Boolean(customerId),
    refetchOnMount: "always",
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/customers/${encodeURIComponent(customerId!)}/contacts`);
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error("Could not load the company contact count.");
      return data.length;
    },
  });
  const contactCount = newCompany ? 0 : contacts.data;
  const defaultLabel = contactCount === undefined
    ? contacts.isError ? "Determined when saved" : "Loading company default…"
    : PORTAL_ROLE_LABELS[defaultPortalRole(contactCount)];

  return <div className="space-y-1.5">
    <Label htmlFor={id}>Portal role</Label>
    {isAdminOrOwner ? <select id={id} value={value ?? ""}
      onChange={event => onChange(isPortalRole(event.target.value) ? event.target.value : undefined)}
      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
      <option value="">Default · {defaultLabel}</option>
      {PORTAL_ROLES.map(portalRole => <option key={portalRole} value={portalRole}>{PORTAL_ROLE_LABELS[portalRole]}</option>)}
    </select> : <div id={id} className="text-sm">{defaultLabel}</div>}
    <p className="text-xs text-muted-foreground">Used when portal access is created.</p>
  </div>;
}
