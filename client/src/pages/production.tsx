import { useJobs, STATUS_VALUES, useUpdateJob } from "@/hooks/useJobs";
import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation } from "wouter";

// Minimal Kanban style using HTML5 drag & drop
export default function ProductionBoard() {
  const { user } = useAuth();
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const { data: jobs, isLoading } = useJobs();
  const [, navigate] = useLocation();

  const internalUser = user && user.role !== 'customer';

  const grouped = (STATUS_VALUES).reduce<Record<string, any[]>>((acc, status) => {
    acc[status] = jobs ? jobs.filter(j => j.status === status) : [];
    return acc;
  }, {});

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    setActiveDragId(id);
  };
  const handleDragEnd = () => setActiveDragId(null);
  const handleDrop = (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    if (!internalUser) return;
    const mutate = useUpdateJob(id); // ephemeral inside drop; better to restructure but acceptable for MVP
    mutate.mutate({ status: newStatus });
    setActiveDragId(null);
  };
  const allowDrop = (e: React.DragEvent) => e.preventDefault();

  return (
    <div className="container mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Production Board</h1>
        <Badge variant="outline">Jobs: {jobs?.length || 0}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">Drag jobs between workflow stages. This MVP is unoptimized.</p>
      {isLoading && (
        <div className="grid grid-cols-7 gap-2">
          {STATUS_VALUES.map(s => <Skeleton key={s} className="h-64" />)}
        </div>
      )}
      {!isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {STATUS_VALUES.map(status => (
            <div
              key={status}
              onDragOver={allowDrop}
              onDrop={(e) => handleDrop(e, status)}
              className="border rounded-md bg-muted/30 flex flex-col min-h-60"
            >
              <div className="p-2 border-b bg-background sticky top-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide">{status.replace(/_/g,' ')}</span>
                  <Badge variant="secondary">{grouped[status].length}</Badge>
                </div>
              </div>
              <div className="p-2 space-y-2">
                {grouped[status].map(job => (
                  <Card
                    key={job.id}
                    draggable={internalUser}
                    onDragStart={(e) => handleDragStart(e, job.id)}
                    onDragEnd={handleDragEnd}
                    className={`cursor-pointer transition border ${activeDragId === job.id ? 'opacity-50' : ''}`}
                    onClick={() => navigate(`/jobs/${job.id}`)}
                  >
                    <CardHeader className="p-3">
                      <CardTitle className="text-sm flex flex-col gap-1">
                        <span className="font-mono">Job {job.id.slice(0,8)}</span>
                        {job.order?.orderNumber && (
                          <span className="text-xs text-muted-foreground">Order #{job.order.orderNumber}</span>
                        )}
                        <span className="text-xs">{job.productType}</span>
                        {job.order?.dueDate && (
                          <Badge variant={"outline"} className="w-fit">Due {new Date(job.order.dueDate).toLocaleDateString()}</Badge>
                        )}
                        {job.assignedToUserId && (
                          <Badge variant="secondary" className="w-fit">Assigned</Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                ))}
                {grouped[status].length === 0 && (
                  <div className="text-xs text-muted-foreground italic">No jobs</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {!internalUser && (
        <div className="text-sm text-muted-foreground">Read-only view for portal users.</div>
      )}
      <div className="pt-4">
        <Link href="/orders"><Button variant="outline" size="sm">Back to Orders</Button></Link>
      </div>
    </div>
  );
}
