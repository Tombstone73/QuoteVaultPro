import { useJob, useUpdateJob, useAddJobNote, STATUS_VALUES } from "@/hooks/useJobs";
import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function JobDetail(props: any) {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const id = props.params?.id;
  const { data: job, isLoading } = useJob(id);
  const updateJob = useUpdateJob(id || "");
  const addNote = useAddJobNote(id || "");
  const [noteText, setNoteText] = useState("");
  const internalUser = user && user.role !== 'customer';

  // Fetch staff users for assignment
  const { data: staff } = useQuery({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const res = await fetch('/api/users', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch users');
      const arr = await res.json();
      return (arr || []).filter((u: any) => ['owner','admin','manager','employee'].includes(u.role));
    }
  });

  const handleStatusChange = (value: string) => {
    updateJob.mutate({ status: value });
  };
  const handleAssign = (value: string) => {
    updateJob.mutate({ assignedTo: value });
  };
  const handleAddNote = () => {
    if (!noteText.trim()) return;
    addNote.mutate(noteText.trim(), { onSuccess: () => setNoteText("") });
  };

  if (isLoading || !job) {
    return (
      <div className="container mx-auto p-6 space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate('/production')}><ArrowLeft className="w-4 h-4 mr-2" />Back</Button>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono">Job {job.id.slice(0,8)}</Badge>
          {job.order?.orderNumber && (
            <Badge variant="secondary">Order #{job.order.orderNumber}</Badge>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Column 1: Core */}
        <Card className="md:col-span-1">
          <CardHeader><CardTitle>Workflow</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold">Status</label>
              <Select value={job.status} onValueChange={handleStatusChange} disabled={!internalUser}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_VALUES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g,' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold">Assigned To</label>
              <Select value={job.assignedToUserId || ''} onValueChange={handleAssign} disabled={!internalUser}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {staff?.map((u: any) => (
                    <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.role})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 text-xs">
              <div><strong>Product Type:</strong> {job.productType}</div>
              {job.orderLineItem && (
                <div><strong>Line Item Qty:</strong> {job.orderLineItem.quantity}</div>
              )}
              {job.order?.dueDate && (
                <div><strong>Due Date:</strong> {new Date(job.order.dueDate).toLocaleDateString()}</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Column 2: Notes */}
        <Card className="md:col-span-1">
          <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {internalUser && (
              <div className="space-y-2">
                <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add internal note" rows={3} />
                <Button size="sm" onClick={handleAddNote} disabled={addNote.isPending}>Add Note</Button>
              </div>
            )}
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {job.notesLog && job.notesLog.length > 0 ? job.notesLog.map(n => (
                <div key={n.id} className="p-2 border rounded text-xs">
                  <div className="font-mono text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</div>
                  <div>{n.noteText}</div>
                </div>
              )) : <div className="text-xs text-muted-foreground">No notes yet.</div>}
            </div>
          </CardContent>
        </Card>

        {/* Column 3: Status Timeline */}
        <Card className="md:col-span-1">
          <CardHeader><CardTitle>Status Timeline</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto text-xs">
            {job.statusLog && job.statusLog.length > 0 ? job.statusLog.map(log => (
              <div key={log.id} className="p-2 border rounded">
                <div className="font-mono">{new Date(log.createdAt).toLocaleString()}</div>
                <div>{log.oldStatus ? log.oldStatus : '—'} → <strong>{log.newStatus}</strong></div>
              </div>
            )) : <div className="text-muted-foreground">No transitions logged.</div>}
          </CardContent>
        </Card>
      </div>

      {/* Order & Line Item Summary */}
      <Card>
        <CardHeader><CardTitle>Order & Line Item</CardTitle></CardHeader>
        <CardContent className="text-xs space-y-2">
          {job.order ? (
            <div className="space-y-1">
              <div><strong>Order #:</strong> {job.order.orderNumber}</div>
              <div><strong>Status:</strong> {job.order.status}</div>
              {job.order.priority && <div><strong>Priority:</strong> {job.order.priority}</div>}
            </div>
          ) : <div>No order snapshot.</div>}
          {job.orderLineItem ? (
            <div className="space-y-1 pt-2">
              <div><strong>Description:</strong> {job.orderLineItem.description}</div>
              <div><strong>Quantity:</strong> {job.orderLineItem.quantity}</div>
              <div><strong>Total Price:</strong> ${parseFloat(job.orderLineItem.totalPrice).toFixed(2)}</div>
            </div>
          ) : <div>No line item snapshot.</div>}
        </CardContent>
      </Card>
    </div>
  );
}
