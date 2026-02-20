import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronsUpDown, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fetchMyOrgs, setActiveOrg } from "@/lib/api/me";
import { getApiUrl } from "@/lib/apiConfig";

/**
 * OrgSwitcher
 * Renders only when the authenticated user belongs to 2+ organizations.
 * Shows current active org name and a dropdown to switch.
 */
export function OrgSwitcher() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: [getApiUrl("/api/me/orgs")],
    queryFn: fetchMyOrgs,
    staleTime: 60_000,
  });

  const orgs = data?.data?.orgs ?? [];
  const lastActiveOrgId = data?.data?.lastActiveOrgId ?? null;

  const switchMutation = useMutation({
    mutationFn: (orgId: string) => setActiveOrg(orgId),
    onSuccess: () => {
      // Invalidate all cached queries so org-scoped data refreshes
      queryClient.invalidateQueries();
      navigate("/dashboard", { replace: true });
    },
  });

  // Only show when user has multiple orgs
  if (isLoading || orgs.length < 2) return null;

  const currentOrg = orgs.find((o) => o.id === lastActiveOrgId);
  const label = currentOrg?.name ?? "Select org";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2 text-sm font-normal max-w-[160px]"
          disabled={switchMutation.isPending}
        >
          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{label}</span>
          {switchMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          Switch organization
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {orgs.map((org) => (
          <DropdownMenuItem
            key={org.id}
            className="cursor-pointer"
            onSelect={() => {
              if (org.id !== lastActiveOrgId) {
                switchMutation.mutate(org.id);
              }
            }}
          >
            <span className="flex-1 truncate">{org.name}</span>
            {org.id === lastActiveOrgId && (
              <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
