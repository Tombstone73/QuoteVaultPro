import { useState } from "react";
import { useProductTypes, useCreateProductType, useUpdateProductType, useDeleteProductType } from "@/hooks/useProductTypes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Pencil, Trash2, GripVertical } from "lucide-react";
import { TitanCard } from "@/components/ui/TitanCard";

export default function ProductTypesSettings() {
  const { data: productTypes, isLoading } = useProductTypes();
  const createMutation = useCreateProductType();
  const updateMutation = useUpdateProductType();
  const deleteMutation = useDeleteProductType();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingType, setEditingType] = useState<any>(null);
  const [formData, setFormData] = useState({ name: "", description: "", sortOrder: 0 });
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const handleCreate = async () => {
    await createMutation.mutateAsync(formData);
    setIsCreateOpen(false);
    setFormData({ name: "", description: "", sortOrder: 0 });
  };

  const handleUpdate = async () => {
    if (!editingType) return;
    await updateMutation.mutateAsync({ id: editingType.id, data: formData });
    setEditingType(null);
    setFormData({ name: "", description: "", sortOrder: 0 });
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure? This will fail if products are using this type.")) {
      await deleteMutation.mutateAsync(id);
    }
  };

  const openEdit = (type: any) => {
    setEditingType(type);
    setFormData({ name: type.name, description: type.description || "", sortOrder: type.sortOrder || 0 });
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
              <Button onClick={handleCreate} disabled={!formData.name || createMutation.isPending}>
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
            <Button onClick={handleUpdate} disabled={!formData.name || updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
