import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Page, PageHeader, ContentLayout } from "@/components/titan";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROUTES } from "@/config/routes";
import { useProductionConfig, useProductionJobs } from "@/hooks/useProduction";
import ProductionViewRenderer from "@/features/production/ProductionViewRenderer";
import ProductionOverviewPage from "@/features/production/views/ProductionOverviewPage";
import {
  getProductionTabCounts,
  persistProductionTab,
  resolvePersistedProductionTab,
  type ProductionBoardTab,
  type ProductionStationPage,
} from "@/lib/productionBoard";

type ProductionStatus = "queued" | "in_progress" | "done" | "all";
type ProductionModule = "overview" | "flatbed" | "roll" | "apparel";

function usePersistedProductionTab(station: ProductionStationPage) {
  const [status, setStatus] = useState<ProductionStatus>(() => resolvePersistedProductionTab(station));

  useEffect(() => {
    persistProductionTab(station, status);
  }, [station, status]);

  return [status, setStatus] as const;
}

function StatusTabLabel(props: { label: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span>{props.label}</span>
      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold leading-none text-muted-foreground">
        {props.count}
      </span>
    </span>
  );
}

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

  const [flatbedStatus, setFlatbedStatus] = usePersistedProductionTab("flatbed");
  const [rollStatus, setRollStatus] = usePersistedProductionTab("roll");
  const [viewKey, setViewKey] = useState<string>("flatbed");

  useEffect(() => {
    if (!config) return;
    const enabled = config.enabledViews || [];
    const next = enabled.includes(config.defaultView) ? config.defaultView : enabled[0];
    if (next) setViewKey(next);
  }, [config]);

  const enabledViews = useMemo(() => config?.enabledViews ?? ["flatbed"], [config]);
  const showViewSelector = enabledViews.length > 1;

  const activeStation = activeModule === "flatbed" || activeModule === "roll" ? activeModule : null;
  const status: ProductionStatus = activeModule === "roll" ? rollStatus : flatbedStatus;
  const setStatus = activeModule === "roll" ? setRollStatus : setFlatbedStatus;
  const hasImplementedEnabledView = activeStation ? enabledViews.includes(activeStation) : false;

  const { data: stationJobs, isLoading: jobsLoading, error: jobsError } = useProductionJobs(
    activeStation ? { view: activeStation } : undefined,
    { enabled: !!activeStation && !isLoading && !error && hasImplementedEnabledView },
  );

  const tabCounts = useMemo(
    () => getProductionTabCounts(stationJobs ?? []),
    [stationJobs],
  );

  // OVERVIEW MODULE - Render without Page/PageHeader wrapper (uses own internal structure)
  if (activeModule === "overview") {
    return <ProductionOverviewPage />;
  }

  // OTHER MODULES - Render with Page/PageHeader wrapper
  return (
    <Page maxWidth="full">
      <PageHeader 
        title={
          activeModule === "flatbed"
            ? "Flatbed Production"
            : activeModule === "roll"
            ? "Roll Production"
            : activeModule === "apparel"
            ? "Apparel Production"
            : "Production"
        }
        subtitle={
          activeModule === "flatbed"
            ? "Flatbed production workflow"
            : activeModule === "roll"
            ? "Roll production workflow"
            : activeModule === "apparel"
            ? "Apparel production workflow"
            : "Production workflow"
        }
      />

      <ContentLayout>
        {/* Flatbed module */}
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
                {/* Header row with status tabs and view selector */}
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  {/* Status tabs */}
                  <Tabs value={status} onValueChange={(v) => setStatus(v as ProductionBoardTab)}>
                    <TabsList>
                      <TabsTrigger value="all"><StatusTabLabel label="All" count={tabCounts.all} /></TabsTrigger>
                      <TabsTrigger value="queued"><StatusTabLabel label="Queued" count={tabCounts.queued} /></TabsTrigger>
                      <TabsTrigger value="in_progress"><StatusTabLabel label="In Progress" count={tabCounts.in_progress} /></TabsTrigger>
                      <TabsTrigger value="done"><StatusTabLabel label="Done" count={tabCounts.done} /></TabsTrigger>
                    </TabsList>
                  </Tabs>

                  {/* View selector (if multiple views enabled) */}
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

                {/* Production view content */}
                {jobsLoading ? (
                  <Card className="bg-titan-bg-card border-titan-border-subtle">
                    <CardContent className="p-4 text-sm text-titan-text-muted">Loading production jobs…</CardContent>
                  </Card>
                ) : jobsError ? (
                  <Card className="bg-titan-bg-card border-titan-border-subtle">
                    <CardContent className="p-4 text-sm text-titan-text-muted">Failed to load production jobs.</CardContent>
                  </Card>
                ) : (
                  <ProductionViewRenderer viewKey="flatbed" status={status} jobs={stationJobs ?? []} />
                )}
              </div>
            )}
          </>
        )}

        {/* Roll module */}
        {activeModule === "roll" && (
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
                    Enable the Roll module (or another implemented view) in settings.
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
                {/* Header row with status tabs and view selector */}
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  {/* Status tabs */}
                  <Tabs value={status} onValueChange={(v) => setStatus(v as ProductionBoardTab)}>
                    <TabsList>
                      <TabsTrigger value="all"><StatusTabLabel label="All" count={tabCounts.all} /></TabsTrigger>
                      <TabsTrigger value="queued"><StatusTabLabel label="Queued" count={tabCounts.queued} /></TabsTrigger>
                      <TabsTrigger value="in_progress"><StatusTabLabel label="In Progress" count={tabCounts.in_progress} /></TabsTrigger>
                      <TabsTrigger value="done"><StatusTabLabel label="Done" count={tabCounts.done} /></TabsTrigger>
                    </TabsList>
                  </Tabs>

                  {/* View selector (if multiple views enabled) */}
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

                {/* Production view content */}
                {jobsLoading ? (
                  <Card className="bg-titan-bg-card border-titan-border-subtle">
                    <CardContent className="p-4 text-sm text-titan-text-muted">Loading production jobs…</CardContent>
                  </Card>
                ) : jobsError ? (
                  <Card className="bg-titan-bg-card border-titan-border-subtle">
                    <CardContent className="p-4 text-sm text-titan-text-muted">Failed to load production jobs.</CardContent>
                  </Card>
                ) : (
                  <ProductionViewRenderer viewKey="roll" status={status} jobs={stationJobs ?? []} />
                )}
              </div>
            )}
          </>
        )}

        {/* Apparel module (placeholder) */}
        {activeModule === "apparel" && (
          <Card>
            <CardContent className="p-8 text-center">
              <h3 className="text-lg font-semibold mb-2">Apparel Printing Module</h3>
              <p className="text-muted-foreground">Production workflow for apparel printing coming soon...</p>
            </CardContent>
          </Card>
        )}
      </ContentLayout>
    </Page>
  );
}
