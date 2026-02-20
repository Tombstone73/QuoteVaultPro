import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fetchMyOrgs, setActiveOrg, type OrgSummary } from "@/lib/api/me";
import { getApiUrl } from "@/lib/apiConfig";

export default function SelectOrgPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: [getApiUrl("/api/me/orgs")],
    queryFn: fetchMyOrgs,
    staleTime: 30_000,
  });

  const orgs = data?.data?.orgs ?? [];
  const lastActiveOrgId = data?.data?.lastActiveOrgId ?? null;

  // Auto-select if exactly one org
  useEffect(() => {
    if (!isLoading && orgs.length === 1) {
      handleSelect(orgs[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, orgs.length]);

  const selectMutation = useMutation({
    mutationFn: (orgId: string) => setActiveOrg(orgId),
    onSuccess: () => {
      queryClient.invalidateQueries();
      navigate("/dashboard", { replace: true });
    },
  });

  function handleSelect(org: OrgSummary) {
    selectMutation.mutate(org.id);
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (orgs.length === 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-8">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <Building2 className="mx-auto mb-2 h-10 w-10 text-muted-foreground" />
            <CardTitle>No Organization Access</CardTitle>
            <CardDescription>
              Your account isn't associated with any organization yet.
              Please ask your administrator for an invite link.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="w-full max-w-lg space-y-4">
        <div className="text-center">
          <Building2 className="mx-auto mb-2 h-10 w-10 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">Select Organization</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose the organization you want to work in.
          </p>
        </div>

        <div className="space-y-2">
          {orgs.map((org) => (
            <Card
              key={org.id}
              className="cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => !selectMutation.isPending && handleSelect(org)}
            >
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary font-semibold text-sm">
                    {org.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      {org.name}
                      {org.id === lastActiveOrgId && (
                        <span className="ml-2 text-xs text-muted-foreground">(last active)</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{org.slug}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs capitalize">
                    {org.role}
                  </Badge>
                  {selectMutation.isPending && selectMutation.variables === org.id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
