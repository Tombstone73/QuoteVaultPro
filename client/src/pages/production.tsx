import { useJobs, useJobStatuses, useUpdateAnyJob } from "@/hooks/useJobs";
import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/config/routes";
import { ArrowLeft } from "lucide-react";
import { Page, PageHeader, ContentLayout, StatusPill } from "@/components/titan";

// Minimal Kanban style using HTML5 drag & drop
export default function ProductionBoard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const { data: jobs, isLoading: jobsLoading } = useJobs();
  const { data: statuses, isLoading: statusesLoading } = useJobStatuses();
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
          <Badge variant="outline" className="text-titan-text-secondary">Jobs: {jobs?.length || 0}</Badge>
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
          <div className="flex gap-3 overflow-x-auto pb-4 h-[calc(100vh-200px)]">
            {statuses.map((status) => (
              <div
                key={status.key}
                onDragOver={allowDrop}
                onDrop={(e) => handleDrop(e, status.key)}
                className="border border-titan-border-subtle rounded-titan-xl bg-titan-bg-card/30 flex flex-col min-w-[280px] w-full h-full"
              >
                <div className="p-3 border-b border-titan-border-subtle bg-titan-bg-card-elevated sticky top-0 z-10 rounded-t-titan-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-titan-xs font-semibold uppercase tracking-wide text-titan-text-primary">
                      {status.label}
                    </span>
                    <Badge variant={(status.badgeVariant as any) || "secondary"}>
                      {grouped[status.key]?.length || 0}
                    </Badge>
                  </div>
                </div>
                <div className="p-2 space-y-2 flex-1 overflow-y-auto">
                  {grouped[status.key]?.map((job) => (
                    <div
                      key={job.id}
                      draggable={internalUser}
                      onDragStart={(e) => handleDragStart(e, job.id)}
                      onDragEnd={handleDragEnd}
                      className={`
                        cursor-pointer transition-all p-3 rounded-titan-lg
                        bg-titan-bg-card border border-titan-border-subtle
                        hover:shadow-titan-md hover:border-titan-border
                        ${activeDragId === job.id ? 'opacity-50' : ''}
                      `}
                      onClick={() => navigate(ROUTES.jobs.detail(job.id))}
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex justify-between items-start">
                          <span className="font-semibold text-titan-sm text-titan-text-primary truncate" title={job.customerName}>
                            {job.customerName}
                          </span>
                          {job.priority === 'rush' && (
                            <StatusPill variant="error">RUSH</StatusPill>
                          )}
                        </div>
                        {job.orderNumber && (
                          <span className="text-titan-xs text-titan-text-muted">{job.orderNumber}</span>
                        )}
                        <div className="text-titan-xs font-medium text-titan-text-secondary">
                          {job.mediaType}
                          {job.quantity > 0 && (
                            <span className="text-titan-text-muted"> × {job.quantity}</span>
                          )}
                        </div>
                        {job.dueDate && (
                          <span className="text-titan-xs text-titan-text-muted">
                            Due: {new Date(job.dueDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })}
                          </span>
                        )}
                        {job.assignedToUserId && (
                          <StatusPill variant="info" className="w-fit">Assigned</StatusPill>
                        )}
                      </div>
                    </div>
                  ))}
                  {grouped[status.key]?.length === 0 && (
                    <div className="text-titan-xs text-titan-text-muted italic text-center py-4">
                      No jobs
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!internalUser && (
          <div className="text-titan-sm text-titan-text-muted">
            Read-only view for portal users.
          </div>
        )}
      </ContentLayout>
    </Page>
  );
}
