import { useState } from "react";
import { useProductTypes, useCreateProductType, useUpdateProductType, useDeleteProductType } from "@/hooks/useProductTypes";
import { useProductionStations, useProductionStationSteps } from "@/hooks/useProductionSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Pencil, Trash2, GripVertical } from "lucide-react";
import { TitanCard } from "@/components/ui/TitanCard";

export default function ProductTypesSettings() {
  const { data: productTypes, isLoading } = useProductTypes();
  const {
    data: stations,
    isLoading: isStationsLoading,
    isError: isStationsError,
    error: stationsError,
  } = useProductionStations();
  const {
    data: stationSteps,
    isLoading: isStepsLoading,
    isError: isStepsError,
    error: stepsError,
  } = useProductionStationSteps();
  const createMutation = useCreateProductType();
  const updateMutation = useUpdateProductType();
  const deleteMutation = useDeleteProductType();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingType, setEditingType] = useState<any>(null);
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    sortOrder: number;
    defaultStationKey: string | null;
    defaultStepKey: string | null;
    sendToProductionDefault: boolean;
    requiresPrepressOverride: boolean | null;
  }>({
    name: "",
    description: "",
    sortOrder: 0,
    defaultStationKey: null,
    defaultStepKey: null,
    sendToProductionDefault: false,
    requiresPrepressOverride: null,
  });
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const stationOptions = (stations ?? [])
    .map((station) => ({ value: String(station.key ?? "").trim(), label: String(station.name ?? station.key ?? "").trim() }))
    .filter((station) => station.value.length > 0);

  const stationLoadError = isStationsError
    ? ((stationsError as any)?.message || "Unable to load stations")
    : null;

  const stepLoadError = isStepsError
    ? ((stepsError as any)?.message || "Unable to load steps")
    : null;

  const selectedStationKey = String(formData.defaultStationKey ?? "").trim();
  const allStepsForSelectedStation = selectedStationKey ? stationSteps?.[selectedStationKey] ?? [] : [];
  const activeStepsForSelectedStation = allStepsForSelectedStation.filter((step) => step.active !== false);
  const selectedStepKey = String(formData.defaultStepKey ?? "").trim();
  const selectedStepMeta = selectedStepKey
    ? allStepsForSelectedStation.find((step) => step.key === selectedStepKey) ?? null
    : null;
  const hasMissingSelectedStep = !!selectedStepKey && !selectedStepMeta;
  const hasInactiveSelectedStep = !!selectedStepMeta && selectedStepMeta.active === false;
  const hasInvalidSelectedStep = !isStepsLoading && !isStepsError && (hasMissingSelectedStep || hasInactiveSelectedStep);

  const handleCreate = async () => {
    await createMutation.mutateAsync({
      name: formData.name,
      description: formData.description || undefined,
      sortOrder: formData.sortOrder,
      defaultStationKey: formData.defaultStationKey || null,
      defaultStepKey: formData.defaultStepKey || null,
      sendToProductionDefault: formData.sendToProductionDefault,
      requiresPrepressOverride: formData.requiresPrepressOverride,
    });
    setIsCreateOpen(false);
    setFormData({ name: "", description: "", sortOrder: 0, defaultStationKey: null, defaultStepKey: null, sendToProductionDefault: false, requiresPrepressOverride: null });
  };

  const handleUpdate = async () => {
    if (!editingType) return;
    await updateMutation.mutateAsync({
      id: editingType.id,
      data: {
        name: formData.name,
        description: formData.description || undefined,
        sortOrder: formData.sortOrder,
        defaultStationKey: formData.defaultStationKey || null,
        defaultStepKey: formData.defaultStepKey || null,
        sendToProductionDefault: formData.sendToProductionDefault,
        requiresPrepressOverride: formData.requiresPrepressOverride,
      },
    });
    setEditingType(null);
    setFormData({ name: "", description: "", sortOrder: 0, defaultStationKey: null, defaultStepKey: null, sendToProductionDefault: false, requiresPrepressOverride: null });
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure? This will fail if products are using this type.")) {
      await deleteMutation.mutateAsync(id);
    }
  };

  const openEdit = (type: any) => {
    setEditingType(type);
    setFormData({
      name: type.name,
      description: type.description || "",
      sortOrder: type.sortOrder || 0,
      defaultStationKey: type.defaultStationKey || null,
      defaultStepKey: type.defaultStepKey || null,
      sendToProductionDefault: type.sendToProductionDefault ?? false,
      requiresPrepressOverride: type.requiresPrepressOverride ?? null,
    });
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || !productTypes) return;
    if (draggedIndex === dropIndex) {
      setDraggedIndex(null);
      return;
    }

    // Reorder the array
    const reordered = [...productTypes];
    const [draggedItem] = reordered.splice(draggedIndex, 1);
    reordered.splice(dropIndex, 0, draggedItem);

    // Update sortOrder for all affected items
    const updates = reordered.map((type, index) => ({
      id: type.id,
      data: { sortOrder: index }
    }));

    // Execute all updates
    await Promise.all(updates.map(update => updateMutation.mutateAsync(update)));
    setDraggedIndex(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Product Types</h1>
          <p className="text-muted-foreground text-sm">Manage categories for your products (e.g., Roll, Sheet, Digital Print)</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Product Type
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Product Type</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Roll, Sheet, Digital Print"
                />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description"
                />
              </div>
              <div>
                <Label htmlFor="sortOrder">Sort Order</Label>
                <Input
                  id="sortOrder"
                  type="number"
                  value={formData.sortOrder}
                  onChange={(e) => setFormData({ ...formData, sortOrder: Number(e.target.value) })}
                />
              </div>

              <div className="border-t pt-4">
                <p className="text-sm font-medium mb-3">Production Routing Defaults</p>
                <div className="space-y-3">
                  <div>
                    <Label>Default Station</Label>
                    <Select
                      value={formData.defaultStationKey || "__none__"}
                      onValueChange={(v) => setFormData({ ...formData, defaultStationKey: v === "__none__" ? null : v })}
                      disabled={isStationsLoading || !!stationLoadError}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="— None —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— None —</SelectItem>
                        {stationOptions.map((station) => (
                          <SelectItem key={station.value} value={station.value}>
                            {station.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {stationLoadError ? (
                      <p className="text-xs text-red-600 mt-1">Unable to load stations: {stationLoadError}</p>
                    ) : null}
                  </div>
                  <div>
                    <Label>Default Step</Label>
                    <div className="space-y-2">
                      <Select
                        value={selectedStepKey || "__none__"}
                        onValueChange={(v) => setFormData({ ...formData, defaultStepKey: v === "__none__" ? null : v })}
                        disabled={isStepsLoading || !selectedStationKey}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="queued (fallback)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">queued (fallback)</SelectItem>
                          {activeStepsForSelectedStation.map((step) => (
                            <SelectItem key={step.key} value={step.key}>
                              {step.label}
                            </SelectItem>
                          ))}
                          {hasInvalidSelectedStep && selectedStepKey ? (
                            <SelectItem value={selectedStepKey}>
                              {hasInactiveSelectedStep ? `${selectedStepMeta?.label ?? selectedStepKey} (inactive)` : `${selectedStepKey} (missing)`}
                            </SelectItem>
                          ) : null}
                        </SelectContent>
                      </Select>
                      {hasInvalidSelectedStep ? (
                        <Badge variant="destructive" className="text-[11px]">
                          {hasInactiveSelectedStep ? "Selected step is inactive" : "Selected step is missing"}
                        </Badge>
                      ) : null}
                      <p className="text-[11px] text-muted-foreground">
                        Manage station steps from Settings → Production & Operations.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <Label htmlFor="create-sendToProduction" className="font-normal">
                      Send to Production by default
                    </Label>
                    <Switch
                      id="create-sendToProduction"
                      checked={formData.sendToProductionDefault}
                      onCheckedChange={(v) => setFormData({ ...formData, sendToProductionDefault: v })}
                    />
                  </div>
                  <div>
                    <Label>Prepress Requirement</Label>
                    <Select
                      value={formData.requiresPrepressOverride === null ? "__inherit__" : formData.requiresPrepressOverride ? "__required__" : "__skip__"}
                      onValueChange={(v) => setFormData({ 
                        ...formData, 
                        requiresPrepressOverride: v === "__inherit__" ? null : v === "__required__" ? true : false 
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__inherit__">Inherit org default</SelectItem>
                        <SelectItem value="__required__">Required</SelectItem>
                        <SelectItem value="__skip__">Skip</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Controls whether jobs require prepress before printing. Default inherits org setting.
                    </p>
                  </div>
                </div>
              </div>

              {stepLoadError ? <p className="text-xs text-red-600">Unable to load steps: {stepLoadError}</p> : null}

              <Button onClick={handleCreate} disabled={!formData.name || createMutation.isPending || hasInvalidSelectedStep}>
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <TitanCard className="p-0 overflow-hidden">
          {productTypes && productTypes.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-28">Default Station</TableHead>
                  <TableHead className="w-28">Auto-Production</TableHead>
                  <TableHead className="w-24">Sort Order</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productTypes.map((type, index) => (
                  <TableRow
                    key={type.id}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, index)}
                    className={`cursor-move ${draggedIndex === index ? 'opacity-50' : ''} hover:bg-muted/50`}
                  >
                    <TableCell>
                      <GripVertical className="h-5 w-5 text-muted-foreground" />
                    </TableCell>
                    <TableCell className="font-medium">{type.name}</TableCell>
                    <TableCell className="text-muted-foreground">{type.description || "—"}</TableCell>
                    <TableCell className="text-muted-foreground capitalize">{type.defaultStationKey || "—"}</TableCell>
                    <TableCell>{type.sendToProductionDefault ? <span className="text-xs font-medium text-emerald-600">On</span> : <span className="text-xs text-muted-foreground">Off</span>}</TableCell>
                    <TableCell>{type.sortOrder}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(type)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(type.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No product types found. Create one to get started.
            </div>
          )}
      </TitanCard>

      {/* Edit Dialog */}
      <Dialog open={!!editingType} onOpenChange={(open) => !open && setEditingType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Product Type</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-sortOrder">Sort Order</Label>
              <Input
                id="edit-sortOrder"
                type="number"
                value={formData.sortOrder}
                onChange={(e) => setFormData({ ...formData, sortOrder: Number(e.target.value) })}
              />
            </div>

            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-3">Production Routing Defaults</p>
              <div className="space-y-3">
                <div>
                  <Label>Default Station</Label>
                  <Select
                    value={formData.defaultStationKey || "__none__"}
                    onValueChange={(v) => setFormData({ ...formData, defaultStationKey: v === "__none__" ? null : v })}
                    disabled={isStationsLoading || !!stationLoadError}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="— None —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {stationOptions.map((station) => (
                        <SelectItem key={station.value} value={station.value}>
                          {station.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {stationLoadError ? (
                    <p className="text-xs text-red-600 mt-1">Unable to load stations: {stationLoadError}</p>
                  ) : null}
                </div>
                <div>
                  <Label>Default Step</Label>
                  <div className="space-y-2">
                    <Select
                      value={selectedStepKey || "__none__"}
                      onValueChange={(v) => setFormData({ ...formData, defaultStepKey: v === "__none__" ? null : v })}
                      disabled={isStepsLoading || !selectedStationKey}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="queued (fallback)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">queued (fallback)</SelectItem>
                        {activeStepsForSelectedStation.map((step) => (
                          <SelectItem key={step.key} value={step.key}>
                            {step.label}
                          </SelectItem>
                        ))}
                        {hasInvalidSelectedStep && selectedStepKey ? (
                          <SelectItem value={selectedStepKey}>
                            {hasInactiveSelectedStep ? `${selectedStepMeta?.label ?? selectedStepKey} (inactive)` : `${selectedStepKey} (missing)`}
                          </SelectItem>
                        ) : null}
                      </SelectContent>
                    </Select>
                    {hasInvalidSelectedStep ? (
                      <Badge variant="destructive" className="text-[11px]">
                        {hasInactiveSelectedStep ? "Selected step is inactive" : "Selected step is missing"}
                      </Badge>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground">
                      Manage station steps from Settings → Production & Operations.
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between py-1">
                  <Label htmlFor="edit-sendToProduction" className="font-normal">
                    Send to Production by default
                  </Label>
                  <Switch
                    id="edit-sendToProduction"
                    checked={formData.sendToProductionDefault}
                    onCheckedChange={(v) => setFormData({ ...formData, sendToProductionDefault: v })}
                  />
                </div>
                <div>
                  <Label>Prepress Requirement</Label>
                  <Select
                    value={formData.requiresPrepressOverride === null ? "__inherit__" : formData.requiresPrepressOverride ? "__required__" : "__skip__"}
                    onValueChange={(v) => setFormData({ 
                      ...formData, 
                      requiresPrepressOverride: v === "__inherit__" ? null : v === "__required__" ? true : false 
                    })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__inherit__">Inherit org default</SelectItem>
                      <SelectItem value="__required__">Required</SelectItem>
                      <SelectItem value="__skip__">Skip</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Controls whether jobs require prepress before printing. Default inherits org setting.
                  </p>
                </div>
              </div>
            </div>

            {stepLoadError ? <p className="text-xs text-red-600">Unable to load steps: {stepLoadError}</p> : null}

            <Button onClick={handleUpdate} disabled={!formData.name || updateMutation.isPending || hasInvalidSelectedStep}>
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
