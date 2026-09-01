import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Loader2, Mail, RefreshCcw, ShieldCheck, UserCheck, UserMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ContentLayout, DataCard, Page, PageHeader } from "@/components/titan";

type PortalAccessRole = "COMPANY_ADMIN" | "BUYER" | "BILLING" | "VIEWER";
type BulkAction = "invite_selected_contacts" | "invite_all_eligible_contacts" | "resend_expired_invitations" | "suspend_portal_users";

type PortalContact = {
  contactId: string;
  customerId: string;
  name: string;
  email: string | null;
  accessId: string | null;
  accessRole: PortalAccessRole;
  relationshipRole: string | null;
  isPrimary: boolean;
  isBilling: boolean;
  eligible: boolean;
  eligibilityReasons: string[];
  warnings: string[];
  contactPortalState: string;
  invitationState: string | null;
  recommended: boolean;
};

type PortalCompanyRow = {
  customerId: string;
  companyName: string;
  companyPortalState: "disabled" | "enabled" | "suspended";
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  eligibleContactsCount: number;
  alreadyInvitedCount: number;
  activeCount: number;
  warnings: string[];
  recommendedContactId: string | null;
  rolloutStatus: "auto_eligible" | "needs_contact_review" | "invited" | "portal_active" | "missing_email";
  contacts: PortalContact[];
};

type PortalOnboardingResponse = {
  rows: PortalCompanyRow[];
  summary: {
    companies: number;
    noPortalAccess: number;
    portalEnabled: number;
    eligibleContacts: number;
    invited: number;
    active: number;
    autoEligible: number;
    needsContactReview: number;
    missingEmail: number;
  };
};

const filters = [
  ["all", "All"],
  ["auto_eligible", "Auto-eligible single contact"],
  ["needs_contact_review", "Needs contact review"],
  ["missing_email", "Missing email / contact"],
  ["no_portal_access", "No portal access"],
  ["portal_enabled", "Portal enabled"],
  ["no_eligible_email", "No eligible email"],
  ["multiple_contacts", "Multiple contacts"],
  ["already_active", "Already active"],
  ["invitation_pending", "Invitation pending"],
  ["invitation_failed", "Invitation failed"],
  ["skipped", "Skipped"],
] as const;

function roleLabel(role: PortalAccessRole) {
  if (role === "COMPANY_ADMIN") return "Company Admin";
  if (role === "BILLING") return "Billing";
  if (role === "BUYER") return "Buyer";
  return "Viewer";
}

function stateBadgeVariant(state: string): "default" | "secondary" | "destructive" | "outline" {
  if (state === "active" || state === "enabled") return "default";
  if (state === "suspended" || state === "failed") return "destructive";
  if (state === "invited" || state === "invitation_expired") return "secondary";
  return "outline";
}

function rolloutStatusLabel(status: PortalCompanyRow["rolloutStatus"]) {
  return {
    auto_eligible: "Auto eligible",
    needs_contact_review: "Needs contact review",
    invited: "Invited",
    portal_active: "Portal active",
    missing_email: "Missing email",
  }[status];
}

function parseApiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(message.slice(jsonStart));
      return parsed.message ?? message;
    } catch {
      return message;
    }
  }
  return message;
}

export default function CustomerPortalAccessPage() {
  const { toast } = useToast();
  const [filter, setFilter] = useState("no_portal_access");
  const [search, setSearch] = useState("");
  const [selectedCompanies, setSelectedCompanies] = useState<Set<string>>(new Set());
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [accessRoles, setAccessRoles] = useState<Record<string, PortalAccessRole>>({});
  const [reviewAction, setReviewAction] = useState<BulkAction | null>(null);

  const query = useQuery<{ success: true; data: PortalOnboardingResponse }>({
    queryKey: ["/api/customer-portal-onboarding/companies", filter, search],
    queryFn: async () => {
      const params = new URLSearchParams({ filter, search });
      const res = await fetch(`/api/customer-portal-onboarding/companies?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const rows = query.data?.data.rows ?? [];
  const summary = query.data?.data.summary;

  const selectedRows = useMemo(() => rows.filter((row) => selectedCompanies.has(row.customerId)), [rows, selectedCompanies]);
  const selectedContactRows = useMemo(() => {
    return rows.flatMap((row) => row.contacts
      .filter((contact) => selectedContacts.has(contact.contactId))
      .map((contact) => ({ company: row, contact })));
  }, [rows, selectedContacts]);

  const reviewTargets = useMemo(() => {
    if (reviewAction === "invite_selected_contacts") return selectedContactRows;
    if (reviewAction === "invite_all_eligible_contacts") {
      return selectedRows.flatMap((row) => row.contacts
        .filter((contact) => contact.eligible && contact.contactPortalState !== "active")
        .map((contact) => ({ company: row, contact })));
    }
    if (reviewAction === "resend_expired_invitations") {
      return rows.flatMap((row) => row.contacts
        .filter((contact) => contact.contactPortalState === "invitation_expired" && (selectedContacts.size === 0 || selectedContacts.has(contact.contactId)))
        .map((contact) => ({ company: row, contact })));
    }
    if (reviewAction === "suspend_portal_users") {
      return selectedContactRows.filter(({ contact }) => contact.contactPortalState === "active");
    }
    return [];
  }, [reviewAction, selectedContactRows, selectedRows, rows, selectedContacts]);

  const actionMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/customer-portal-onboarding/actions", payload);
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/customer-portal-onboarding/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-portal-onboarding/batches"] });
      const data = result?.data;
      toast({
        title: "Portal onboarding updated",
        description: data?.counts
          ? `Sent ${data.counts.sent}, skipped ${data.counts.skipped}, failed ${data.counts.failed}.`
          : `Enabled ${data?.enabled ?? 0} companies.`,
      });
      setReviewAction(null);
    },
    onError: (error) => {
      toast({ title: "Portal onboarding failed", description: parseApiError(error), variant: "destructive" });
    },
  });

  const toggleCompany = (customerId: string, checked: boolean) => {
    setSelectedCompanies((current) => {
      const next = new Set(current);
      checked ? next.add(customerId) : next.delete(customerId);
      return next;
    });
  };

  const toggleContact = (contactId: string, checked: boolean) => {
    setSelectedContacts((current) => {
      const next = new Set(current);
      checked ? next.add(contactId) : next.delete(contactId);
      return next;
    });
  };

  const selectRecommended = () => {
    const next = new Set(selectedContacts);
    const roleUpdates: Record<string, PortalAccessRole> = {};
    for (const row of selectedRows) {
      const recommended = row.contacts.find((contact) => contact.contactId === row.recommendedContactId);
      if (recommended?.eligible) {
        next.add(recommended.contactId);
        roleUpdates[recommended.contactId] = recommended.accessRole;
      }
    }
    setSelectedContacts(next);
    setAccessRoles((current) => ({ ...current, ...roleUpdates }));
    toast({ title: "Recommended contacts selected", description: `${Object.keys(roleUpdates).length} contacts staged for review.` });
  };

  const excludeSelectedContacts = () => {
    const count = selectedContacts.size;
    setSelectedContacts(new Set());
    setAccessRoles({});
    toast({ title: "Contacts excluded", description: `${count} staged contacts removed from this bulk review.` });
  };

  const enableSelectedCompanies = () => {
    actionMutation.mutate({
      action: "enable_companies",
      customerIds: Array.from(selectedCompanies),
    });
  };

  const submitReviewAction = () => {
    if (!reviewAction) return;
    actionMutation.mutate({
      action: reviewAction,
      customerIds: Array.from(selectedCompanies),
      contactIds: Array.from(selectedContacts),
      accessIds: reviewTargets.map(({ contact }) => contact.accessId).filter(Boolean),
      accessRoles,
    });
  };

  const exportCsv = () => {
    const params = new URLSearchParams({ filter, search });
    window.location.href = `/api/customer-portal-onboarding/export.csv?${params.toString()}`;
  };

  return (
    <Page>
      <PageHeader
        title="Customer Portal"
        subtitle="Portal access is available by default to eligible customer contacts. Invitations are optional setup convenience; suspend access only when needed."
      />
      <ContentLayout>
        <div className="grid gap-3 md:grid-cols-6">
          {[
            ["Companies", summary?.companies ?? 0],
            ["Eligible contacts", summary?.autoEligible ?? 0],
            ["Contact review", summary?.needsContactReview ?? 0],
            ["Missing email", summary?.missingEmail ?? 0],
            ["Invited", summary?.invited ?? 0],
            ["Active", summary?.active ?? 0],
          ].map(([label, value]) => (
            <DataCard key={label} className="p-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-xl font-semibold tabular-nums">{value}</div>
            </DataCard>
          ))}
        </div>

        <DataCard className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {filters.map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search company, contact, or email"
              className="w-[320px]"
            />
            <Button variant="outline" onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="outline" onClick={selectRecommended} disabled={selectedCompanies.size === 0}>
                <UserCheck className="mr-2 h-4 w-4" />
                Select Recommended
              </Button>
              <Button variant="outline" onClick={excludeSelectedContacts} disabled={selectedContacts.size === 0}>
                Exclude Selected
              </Button>
              <Button onClick={() => setReviewAction("invite_selected_contacts")} disabled={selectedContacts.size === 0}>
                <Mail className="mr-2 h-4 w-4" />
                Invite Selected
              </Button>
              <Button variant="outline" onClick={() => setReviewAction("invite_all_eligible_contacts")} disabled={selectedCompanies.size === 0}>
                <Mail className="mr-2 h-4 w-4" />
                Invite Eligible
              </Button>
              <Button variant="outline" onClick={() => setReviewAction("resend_expired_invitations")}>
                <RefreshCcw className="mr-2 h-4 w-4" />
                Resend Expired
              </Button>
              <Button variant="outline" onClick={() => setReviewAction("suspend_portal_users")} disabled={selectedContacts.size === 0}>
                <UserMinus className="mr-2 h-4 w-4" />
                Suspend Users
              </Button>
            </div>
          </div>
        </DataCard>

        <DataCard className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Company</TableHead>
                <TableHead>Primary Contact</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Eligible</TableHead>
                <TableHead>Invited</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Access rollout</TableHead>
                <TableHead>Company State</TableHead>
                <TableHead>Warnings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading && (
                <TableRow>
                  <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              )}
              {!query.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">No companies match this review.</TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.customerId}>
                  <TableCell>
                    <Checkbox
                      checked={selectedCompanies.has(row.customerId)}
                      onCheckedChange={(checked) => toggleCompany(row.customerId, checked === true)}
                      aria-label={`Select ${row.companyName}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{row.companyName}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {row.contacts.slice(0, 3).map((contact) => (
                        <label key={contact.contactId} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Checkbox
                            className="h-3.5 w-3.5"
                            checked={selectedContacts.has(contact.contactId)}
                            disabled={!contact.eligible && contact.contactPortalState !== "active"}
                            onCheckedChange={(checked) => toggleContact(contact.contactId, checked === true)}
                          />
                          {contact.name}
                        </label>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{row.primaryContactName ?? "-"}</TableCell>
                  <TableCell>{row.primaryContactEmail ?? "-"}</TableCell>
                  <TableCell className="tabular-nums">{row.eligibleContactsCount}</TableCell>
                  <TableCell className="tabular-nums">{row.alreadyInvitedCount}</TableCell>
                  <TableCell className="tabular-nums">{row.activeCount}</TableCell>
                  <TableCell><Badge variant={stateBadgeVariant(row.rolloutStatus)}>{rolloutStatusLabel(row.rolloutStatus)}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={stateBadgeVariant(row.companyPortalState)}>{row.companyPortalState}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-[260px] flex-wrap gap-1">
                      {row.warnings.length === 0 ? (
                        <span className="text-muted-foreground">-</span>
                      ) : row.warnings.map((warning) => (
                        <Badge key={warning} variant="outline">{warning.replace(/_/g, " ")}</Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataCard>
      </ContentLayout>

      <Dialog open={reviewAction !== null} onOpenChange={(open) => !open && setReviewAction(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Review Portal Invitations</DialogTitle>
            <DialogDescription>
              Review the selected contacts and access roles before invitations are sent.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[420px] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Visible Data</TableHead>
                  <TableHead>Warnings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviewTargets.map(({ company, contact }) => (
                  <TableRow key={`${company.customerId}-${contact.contactId}`}>
                    <TableCell>{company.companyName}</TableCell>
                    <TableCell>{contact.name}</TableCell>
                    <TableCell>{contact.email}</TableCell>
                    <TableCell>
                      <Select
                        value={accessRoles[contact.contactId] ?? contact.accessRole}
                        onValueChange={(value) => setAccessRoles((current) => ({ ...current, [contact.contactId]: value as PortalAccessRole }))}
                      >
                        <SelectTrigger className="w-[160px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(["COMPANY_ADMIN", "BUYER", "BILLING", "VIEWER"] as PortalAccessRole[]).map((role) => (
                            <SelectItem key={role} value={role}>{roleLabel(role)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="max-w-[260px] text-xs text-muted-foreground">
                      Company-scoped portal documents, visible quotes, orders, invoices, proofs, and profile data for this company only.
                    </TableCell>
                    <TableCell>
                      {[...contact.warnings, ...contact.eligibilityReasons].length === 0 ? "-" : [...contact.warnings, ...contact.eligibilityReasons].join(", ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="text-sm text-muted-foreground">Total invitations/actions: {reviewTargets.length}</div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewAction(null)}>Cancel</Button>
            <Button onClick={submitReviewAction} disabled={actionMutation.isPending || reviewTargets.length === 0}>
              {actionMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
