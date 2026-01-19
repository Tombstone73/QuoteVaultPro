import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Page, PageHeader, ContentLayout } from "@/components/titan";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/config/routes";
import { useProductionConfig } from "@/hooks/useProduction";
import ProductionViewRenderer from "@/features/production/ProductionViewRenderer";
import ProductionOverviewPage from "@/features/production/views/ProductionOverviewPage";

type ProductionStatus = "queued" | "in_progress" | "done";
type ProductionModule = "overview" | "flatbed" | "roll" | "apparel";

export default function ProductionBoard() {
  const { data: config, isLoading, error } = useProductionConfig();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Determine active module from URL (default to overview)
  const activeModule: ProductionModule = useMemo(() => {
    const path = location.pathname;
    if (path === "/production/flatbed") return "flatbed";
    if (path === "/production/roll") return "roll";
    if (path === "/production/apparel") return "apparel";
    return "overview";
  }, [location.pathname]);

  // Default to "in_progress" - operators want to see active jobs first
  const [status, setStatus] = useState<ProductionStatus>("in_progress");
  const [viewKey, setViewKey] = useState<string>("flatbed");

  useEffect(() => {
    if (!config) return;
    const enabled = config.enabledViews || [];
    const next = enabled.includes(config.defaultView) ? config.defaultView : enabled[0];
    if (next) setViewKey(next);
  }, [config]);

  const enabledViews = useMemo(() => config?.enabledViews ?? ["flatbed"], [config]);
  const showViewSelector = enabledViews.length > 1;

  const hasImplementedEnabledView = enabledViews.includes("flatbed");

  const handleModuleChange = (module: string) => {
    if (module === "overview") navigate("/production");
    else if (module === "flatbed") navigate("/production/flatbed");
    else if (module === "roll") navigate("/production/roll");
    else if (module === "apparel") navigate("/production/apparel");
  };

  return (
    <Page maxWidth="full">
      <PageHeader 
        title="Production" 
        subtitle={
          activeModule === "overview" 
            ? "Production job overview across all modules"
            : activeModule === "flatbed"
            ? "Flatbed production workflow (MVP)"
            : `${activeModule.charAt(0).toUpperCase() + activeModule.slice(1)} production module`
        }
      />

      <ContentLayout>
        {/* Module tabs for future expansion */}
        <div className="mb-4">
          <Tabs value={activeModule} onValueChange={handleModuleChange}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="flatbed">
                Flatbed
              </TabsTrigger>
              <TabsTrigger value="roll" disabled>
                Roll
                <Badge variant="outline" className="ml-2 text-[10px]">Soon</Badge>
              </TabsTrigger>
              <TabsTrigger value="apparel" disabled>
                Apparel
                <Badge variant="outline" className="ml-2 text-[10px]">Soon</Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Overview module (new) */}
        {activeModule === "overview" && <ProductionOverviewPage />}

        {/* Flatbed module (existing MVP) */}
        {activeModule === "flatbed" && (
          <>
            {isLoading && (
              <Card className="bg-titan-bg-card border-titan-border-subtle">
                <CardContent className="p-4 text-sm text-titan-text-muted">Loading production…</CardContent>
              </Card>
            )}

            {!isLoading && error && (
              <Card className="bg-titan-bg-card border-titan-border-subtle">
                <CardContent className="p-4 text-sm text-titan-text-muted">Failed to load production config.</CardContent>
              </Card>
            )}

            {!isLoading && !error && !hasImplementedEnabledView && (
              <Card className="bg-titan-bg-card border-titan-border-subtle">
                <CardContent className="p-4">
                  <div className="text-sm font-medium text-titan-text-primary">No production views enabled</div>
                  <div className="text-sm text-titan-text-muted mt-1">
                    Enable the Flatbed module (or another implemented view) in settings.
                  </div>
                  <div className="mt-3">
                    <Link className="text-sm underline" to={ROUTES.settings.production}>
                      Go to Production Settings
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}

            {!isLoading && !error && hasImplementedEnabledView && (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <Tabs value={status} onValueChange={(v) => setStatus(v as ProductionStatus)}>
                    <TabsList>
                      <TabsTrigger value="queued">Queued</TabsTrigger>
                      <TabsTrigger value="in_progress">In Progress</TabsTrigger>
                      <TabsTrigger value="done">Done</TabsTrigger>
                    </TabsList>
                  </Tabs>

                  {showViewSelector && (
                    <div className="w-full md:w-[240px]">
                      <Select value={viewKey} onValueChange={setViewKey}>
                        <SelectTrigger className="bg-titan-bg-card border-titan-border-subtle">
                          <SelectValue placeholder="Select view" />
                        </SelectTrigger>
                        <SelectContent>
                          {enabledViews.map((v) => (
                            <SelectItem key={v} value={v}>
                              {v}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                <ProductionViewRenderer viewKey={viewKey} status={status} />
              </div>
            )}
          </>
        )}

        {/* Roll module (placeholder) */}
        {activeModule === "roll" && (
          <Card>
            <CardContent className="p-8 text-center">
              <h3 className="text-lg font-semibold mb-2">Roll Printing Module</h3>
              <p className="text-muted-foreground">Coming soon...</p>
            </CardContent>
          </Card>
        )}

        {/* Apparel module (placeholder) */}
        {activeModule === "apparel" && (
          <Card>
            <CardContent className="p-8 text-center">
              <h3 className="text-lg font-semibold mb-2">Apparel Printing Module</h3>
              <p className="text-muted-foreground">Coming soon...</p>
            </CardContent>
          </Card>
        )}
      </ContentLayout>
    </Page>
  );
}
