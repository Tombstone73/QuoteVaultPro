import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useJobStatuses } from "@/hooks/useJobs";

export function JobStatusSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: statuses, isLoading } = useJobStatuses();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingStatus, setEditingStatus] = useState<any>(null);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/settings/job-statuses", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/job-statuses"] });
      toast({ title: "Success", description: "Job status created" });
      setIsDialogOpen(false);
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string, data: any }) => {
      const res = await apiRequest("PATCH", `/api/settings/job-statuses/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/job-statuses"] });
      toast({ title: "Success", description: "Job status updated" });
      setIsDialogOpen(false);
      setEditingStatus(null);
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/settings/job-statuses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/job-statuses"] });
      toast({ title: "Success", description: "Job status deleted" });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      key: formData.get("key") as string,
      label: formData.get("label") as string,
      position: parseInt(formData.get("position") as string),
      badgeVariant: formData.get("badgeVariant") as string,
      isDefault: formData.get("isDefault") === "on",
    };

    if (editingStatus) {
      updateMutation.mutate({ id: editingStatus.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Job Workflow Statuses</CardTitle>
            <CardDescription>Configure the pipeline stages for production jobs.</CardDescription>
          </div>
          <Button onClick={() => { setEditingStatus(null); setIsDialogOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" /> Add Status
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>Badge</TableHead>
              <TableHead>Default</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {statuses?.map((status) => (
              <TableRow key={status.id}>
                <TableCell className="font-medium">{status.label}</TableCell>
                <TableCell className="font-mono text-xs">{status.key}</TableCell>
                <TableCell>{status.position}</TableCell>
                <TableCell><Badge variant={status.badgeVariant as any}>{status.badgeVariant}</Badge></TableCell>
                <TableCell>{status.isDefault ? "Yes" : ""}</TableCell>
                <TableCell className="text-right space-x-2">
                  <Button variant="ghost" size="icon" onClick={() => { setEditingStatus(status); setIsDialogOpen(true); }}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => {
                     if(confirm('Are you sure? This might break existing jobs if they use this status.')) deleteMutation.mutate(status.id);
                  }}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingStatus ? "Edit Status" : "Add Status"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="label">Label</Label>
                <Input id="label" name="label" defaultValue={editingStatus?.label} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="key">Key (unique, snake_case)</Label>
                <Input id="key" name="key" defaultValue={editingStatus?.key} required pattern="[a-z0-9_]+" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="position">Position (Sort Order)</Label>
                  <Input id="position" name="position" type="number" defaultValue={editingStatus?.position || (statuses?.length || 0) + 1} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="badgeVariant">Badge Variant</Label>
                  <select id="badgeVariant" name="badgeVariant" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" defaultValue={editingStatus?.badgeVariant || "secondary"}>
                    <option value="default">Default (Black)</option>
                    <option value="secondary">Secondary (Gray)</option>
                    <option value="destructive">Destructive (Red)</option>
                    <option value="outline">Outline</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Switch id="isDefault" name="isDefault" defaultChecked={editingStatus?.isDefault} />
                <Label htmlFor="isDefault">Is Default Status?</Label>
              </div>
              <DialogFooter>
                <Button type="submit">{editingStatus ? "Update" : "Create"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
