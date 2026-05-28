import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Page, PageHeader, ContentLayout } from "@/components/titan";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROUTES } from "@/config/routes";
import { useProductionConfig, useProductionJobs, useRecentlyCompletedProductionJobs } from "@/hooks/useProduction";
import ProductionViewRenderer from "@/features/production/ProductionViewRenderer";
import ProductionOverviewPage from "@/features/production/views/ProductionOverviewPage";
import {
  getProductionTabCountsWithRecentlyCompleted,
  persistProductionTab,
  persistProductionQueueControls,
  readPersistedProductionQueueControls,
  resolvePersistedProductionTab,
  type ProductionBoardTab,
  type ProductionQueueControls,
  type ProductionQueueSortBy,
  type ProductionQueueSortDirection,
  type ProductionStationPage,
} from "@/lib/productionBoard";

type ProductionStatus = ProductionBoardTab;
type ProductionModule = "overview" | "flatbed" | "roll" | "apparel";

function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);

  return debouncedValue;
}

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

function updateControls(
  current: ProductionQueueControls,
  patch: Partial<ProductionQueueControls>,
): ProductionQueueControls {
  return { ...current, ...patch };
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
  const [flatbedControls, setFlatbedControls] = useState<ProductionQueueControls>(() => readPersistedProductionQueueControls("flatbed"));
  const [rollControls, setRollControls] = useState<ProductionQueueControls>(() => readPersistedProductionQueueControls("roll"));
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
  const controls = activeModule === "roll" ? rollControls : flatbedControls;
  const setControls = activeModule === "roll" ? setRollControls : setFlatbedControls;
  const debouncedSearch = useDebouncedValue(controls.search.trim(), 250);
  const hasImplementedEnabledView = activeStation ? enabledViews.includes(activeStation) : false;

  useEffect(() => {
    persistProductionQueueControls("flatbed", flatbedControls);
  }, [flatbedControls]);

  useEffect(() => {
    persistProductionQueueControls("roll", rollControls);
  }, [rollControls]);

  const { data: stationJobs, isLoading: jobsLoading, error: jobsError } = useProductionJobs(
    activeStation
      ? {
          view: activeStation,
          search: debouncedSearch,
          sortBy: controls.sortBy,
          sortDirection: controls.sortDirection,
        }
      : undefined,
    { enabled: !!activeStation && !isLoading && !error && hasImplementedEnabledView },
  );

  const { data: recentlyCompletedJobs } = useRecentlyCompletedProductionJobs(
    activeStation ? { station: activeStation } : undefined,
    { enabled: !!activeStation && !isLoading && !error && hasImplementedEnabledView },
  );

  const tabCounts = useMemo(
    () => getProductionTabCountsWithRecentlyCompleted(stationJobs ?? [], recentlyCompletedJobs?.length ?? 0),
    [recentlyCompletedJobs?.length, stationJobs],
  );

  const stationToolbar = activeStation ? (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_180px_120px] lg:max-w-[720px] lg:flex-1">
        <Input
          value={controls.search}
          onChange={(event) => setControls((current) => updateControls(current, { search: event.target.value }))}
          placeholder="Search order, customer, product, media"
          className="h-9 bg-titan-bg-card border-titan-border-subtle"
          aria-label="Search production queue"
        />
        <Select
          value={controls.sortBy}
          onValueChange={(value) => setControls((current) => updateControls(current, { sortBy: value as ProductionQueueSortBy }))}
        >
          <SelectTrigger className="h-9 bg-titan-bg-card border-titan-border-subtle">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="oldest">Oldest</SelectItem>
            <SelectItem value="due_date">Due date</SelectItem>
            <SelectItem value="customer">Customer</SelectItem>
            <SelectItem value="priority">Priority</SelectItem>
            <SelectItem value="status">Status</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={controls.sortDirection}
          onValueChange={(value) => setControls((current) => updateControls(current, { sortDirection: value as ProductionQueueSortDirection }))}
        >
          <SelectTrigger className="h-9 bg-titan-bg-card border-titan-border-subtle">
            <SelectValue placeholder="Direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asc">Asc</SelectItem>
            <SelectItem value="desc">Desc</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {debouncedSearch ? (
        <button
          type="button"
          className="text-xs font-medium text-titan-text-muted hover:text-titan-text-primary"
          onClick={() => setControls((current) => updateControls(current, { search: "" }))}
        >
          Clear search
        </button>
      ) : null}
    </div>
  ) : null;

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
                      <TabsTrigger value="paused"><StatusTabLabel label="Paused" count={tabCounts.paused} /></TabsTrigger>
                      <TabsTrigger value="done"><StatusTabLabel label="Completed" count={tabCounts.done} /></TabsTrigger>
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
                {stationToolbar}

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
                      <TabsTrigger value="paused"><StatusTabLabel label="Paused" count={tabCounts.paused} /></TabsTrigger>
                      <TabsTrigger value="done"><StatusTabLabel label="Completed" count={tabCounts.done} /></TabsTrigger>
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
                {stationToolbar}

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
