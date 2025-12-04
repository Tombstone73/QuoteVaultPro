import { useJob, useUpdateJob, useAddJobNote, useJobStatuses } from "@/hooks/useJobs";
import { useAuth } from "@/hooks/useAuth";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Ruler } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

// Common banner roll widths in inches
const DEFAULT_ROLL_WIDTHS = [38, 54, 63, 126];

export default function JobDetail(props: any) {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const id = props.params?.id;
  const { data: job, isLoading: jobLoading } = useJob(id);
  const { data: statuses, isLoading: statusesLoading } = useJobStatuses();
  const updateJob = useUpdateJob(id || "");
  const addNote = useAddJobNote(id || "");
  const [noteText, setNoteText] = useState("");
  const [rollWidthInput, setRollWidthInput] = useState<string>("");
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

  // Fetch materials to get roll widths for banner-type products
  const { data: materials } = useQuery({
    queryKey: ["/api/materials"],
    queryFn: async () => {
      const res = await fetch('/api/materials', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch materials');
      const json = await res.json();
      return json.data || json || [];
    }
  });

  // Initialize roll width input from job data
  useEffect(() => {
    if (job?.rollWidthUsedInches) {
      setRollWidthInput(String(job.rollWidthUsedInches));
    }
  }, [job?.rollWidthUsedInches]);

  // Determine if this is a banner/roll-type product that needs roll width tracking
  const isBannerProduct = job?.productType?.toLowerCase().includes('banner') || 
                          job?.productType?.toLowerCase().includes('roll') ||
                          job?.productType === 'wide_roll' ||
                          job?.orderLineItem?.productType === 'wide_roll';

  // Get available roll widths from the material linked to this job's line item
  const linkedMaterialId = job?.materialId || job?.orderLineItem?.materialId;
  const linkedMaterial = materials?.find((m: any) => m.id === linkedMaterialId);
  
  // Build roll width options: prefer material-specific width if available, otherwise use defaults
  const rollWidthOptions: number[] = linkedMaterial?.width 
    ? [parseFloat(linkedMaterial.width)] 
    : DEFAULT_ROLL_WIDTHS;

  const handleStatusChange = (value: string) => {
    updateJob.mutate({ statusKey: value });
  };
  const handleAssign = async (value: string) => {
    const userId = value === 'unassigned' ? undefined : value;
    updateJob.mutate({ assignedToUserId: userId });
  };
  const handleAddNote = () => {
    if (!noteText.trim()) return;
    addNote.mutate(noteText.trim(), { onSuccess: () => setNoteText("") });
  };

  const handleRollWidthChange = (value: string) => {
    if (value === 'clear') {
      setRollWidthInput('');
      updateJob.mutate({ rollWidthUsedInches: null });
    } else if (value === 'custom') {
      // Don't update yet, let user enter custom value
    } else {
      const width = parseFloat(value);
      if (!isNaN(width)) {
        setRollWidthInput(value);
        updateJob.mutate({ rollWidthUsedInches: width });
      }
    }
  };

  const handleCustomRollWidthBlur = () => {
    const width = parseFloat(rollWidthInput);
    if (!isNaN(width) && width > 0) {
      updateJob.mutate({ rollWidthUsedInches: width });
    }
  };

  if (jobLoading || statusesLoading || !job) {
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
              <Select value={job.statusKey} onValueChange={handleStatusChange} disabled={!internalUser}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statuses?.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold">Assigned To</label>
              <Select value={job.assignedToUserId || undefined} onValueChange={handleAssign} disabled={!internalUser}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
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
                <div>{log.oldStatusKey ? log.oldStatusKey : '—'} → <strong>{log.newStatusKey}</strong></div>
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

      {/* Production Details - Roll Width Tracking for Banner Products */}
      {internalUser && isBannerProduct && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ruler className="w-4 h-4" />
              Production Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Roll Width Used (inches)</Label>
              <p className="text-xs text-muted-foreground">
                Record which roll width was actually used for this job. This is optional and used for inventory tracking and cost analysis.
              </p>
              <div className="flex gap-2 items-center">
                <Select 
                  value={rollWidthInput || 'none'} 
                  onValueChange={handleRollWidthChange}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Select roll width" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" disabled>Select roll width</SelectItem>
                    {rollWidthOptions.map((width) => (
                      <SelectItem key={width} value={String(width)}>{width}" roll</SelectItem>
                    ))}
                    <SelectItem value="custom">Custom width...</SelectItem>
                    {rollWidthInput && <SelectItem value="clear">Clear selection</SelectItem>}
                  </SelectContent>
                </Select>
                {/* Show custom input if 'custom' is selected or if current value isn't in options */}
                {(rollWidthInput && !rollWidthOptions.includes(parseFloat(rollWidthInput))) && (
                  <Input
                    type="number"
                    step="0.5"
                    min="1"
                    className="w-24"
                    placeholder="Width"
                    value={rollWidthInput}
                    onChange={(e) => setRollWidthInput(e.target.value)}
                    onBlur={handleCustomRollWidthBlur}
                  />
                )}
              </div>
              {job.rollWidthUsedInches && (
                <div className="text-xs text-green-600">
                  ✓ Recorded: {job.rollWidthUsedInches}" roll
                </div>
              )}
            </div>

            {/* Future: Material selection could go here */}
            {linkedMaterial && (
              <div className="text-xs text-muted-foreground pt-2 border-t">
                <strong>Linked Material:</strong> {linkedMaterial.name} ({linkedMaterial.sku})
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
