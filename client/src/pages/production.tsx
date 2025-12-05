import { useJobs, useJobStatuses, useUpdateAnyJob } from "@/hooks/useJobs";
import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation } from "wouter";
import { ROUTES } from "@/config/routes";
import { ArrowLeft } from "lucide-react";
import { Page, PageHeader, ContentLayout, DataCard } from "@/components/titan";

// Minimal Kanban style using HTML5 drag & drop
export default function ProductionBoard() {
  const { user } = useAuth();
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const { data: jobs, isLoading: jobsLoading } = useJobs();
  const { data: statuses, isLoading: statusesLoading } = useJobStatuses();
  const [, navigate] = useLocation();
  const updateJobMutation = useUpdateAnyJob();

  const isLoading = jobsLoading || statusesLoading;
  const internalUser = user && user.role !== 'customer';

  const grouped = (statuses || []).reduce<Record<string, any[]>>((acc, status) => {
    acc[status.key] = jobs ? jobs.filter(j => j.statusKey === status.key) : [];
    return acc;
  }, {});

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    setActiveDragId(id);
  };
  const handleDragEnd = () => setActiveDragId(null);
  const handleDrop = (e: React.DragEvent, newStatusKey: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    if (!internalUser) return;
    updateJobMutation.mutate({ id, data: { statusKey: newStatusKey } });
    setActiveDragId(null);
  };
  const allowDrop = (e: React.DragEvent) => e.preventDefault();

  return (
    <Page maxWidth="full">
      <PageHeader
        title="Production Board"
        subtitle="Track and manage job production workflow"
        backButton={
          <Button variant="ghost" size="icon" onClick={() => navigate(ROUTES.orders.list)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
        }
        actions={
          <Badge variant="outline">Jobs: {jobs?.length || 0}</Badge>
        }
      />

      <ContentLayout>
        {isLoading && (
          <div className="grid grid-cols-7 gap-2">
            {[1, 2, 3, 4, 5, 6, 7].map((s) => (
              <Skeleton key={s} className="h-64" />
            ))}
          </div>
        )}

        {!isLoading && statuses && (
          <div className="flex gap-2 overflow-x-auto pb-4 h-[calc(100vh-200px)]">
            {statuses.map((status) => (
              <div
                key={status.key}
                onDragOver={allowDrop}
                onDrop={(e) => handleDrop(e, status.key)}
                className="border border-border/60 rounded-xl bg-card/30 flex flex-col min-w-[280px] w-full h-full"
              >
                <div className="p-3 border-b border-border/60 bg-card sticky top-0 z-10 rounded-t-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                      {status.label}
                    </span>
                    <Badge variant={(status.badgeVariant as any) || "secondary"}>
                      {grouped[status.key]?.length || 0}
                    </Badge>
                  </div>
                </div>
                <div className="p-2 space-y-2 flex-1 overflow-y-auto">
                  {grouped[status.key]?.map((job) => (
                    <Card
                      key={job.id}
                      draggable={internalUser}
                      onDragStart={(e) => handleDragStart(e, job.id)}
                      onDragEnd={handleDragEnd}
                      className={`cursor-pointer transition border ${activeDragId === job.id ? 'opacity-50' : ''} hover:shadow-md`}
                      onClick={() => navigate(ROUTES.jobs.detail(job.id))}
                    >
                      <CardHeader className="p-3">
                        <CardTitle className="text-sm flex flex-col gap-1">
                          <div className="flex justify-between items-start">
                            <span className="font-semibold truncate" title={job.customerName}>
                              {job.customerName}
                            </span>
                            {job.priority === 'rush' && (
                              <Badge variant="destructive" className="text-[10px] px-1 py-0">
                                RUSH
                              </Badge>
                            )}
                          </div>
                          {job.orderNumber && (
                            <span className="text-xs text-muted-foreground">{job.orderNumber}</span>
                          )}
                          <div className="text-xs font-medium">
                            {job.mediaType}
                            {job.quantity > 0 && (
                              <span className="text-muted-foreground"> × {job.quantity}</span>
                            )}
                          </div>
                          {job.dueDate && (
                            <span className="text-xs text-muted-foreground">
                              Due: {new Date(job.dueDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })}
                            </span>
                          )}
                          {job.assignedToUserId && (
                            <Badge variant="secondary" className="w-fit text-[10px]">
                              Assigned
                            </Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                    </Card>
                  ))}
                  {grouped[status.key]?.length === 0 && (
                    <div className="text-xs text-muted-foreground italic text-center py-4">
                      No jobs
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!internalUser && (
          <div className="text-sm text-muted-foreground">
            Read-only view for portal users.
          </div>
        )}
      </ContentLayout>
    </Page>
  );
}
