import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FileIcon, Edit2, Trash2, Upload, Image as ImageIcon, Star, FileText } from "lucide-react";
import { useOrderFiles, useAttachFileToOrder, useUpdateOrderFile, useDetachOrderFile } from "@/hooks/useOrderFiles";
import type { OrderFileWithUser } from "@/hooks/useOrderFiles";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const FILE_ROLES = [
  { value: 'artwork', label: 'Artwork', icon: ImageIcon },
  { value: 'proof', label: 'Proof', icon: FileText },
  { value: 'reference', label: 'Reference', icon: FileIcon },
  { value: 'customer_po', label: 'Customer PO', icon: FileText },
  { value: 'setup', label: 'Setup', icon: FileIcon },
  { value: 'output', label: 'Output', icon: FileIcon },
  { value: 'other', label: 'Other', icon: FileIcon },
] as const;

const FILE_SIDES = [
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
  { value: 'na', label: 'N/A' },
] as const;

interface OrderArtworkPanelProps {
  orderId: string;
  isAdminOrOwner: boolean;
}

export function OrderArtworkPanel({ orderId, isAdminOrOwner }: OrderArtworkPanelProps) {
  const { toast } = useToast();
  const { data: files = [], isLoading } = useOrderFiles(orderId);
  const attachFile = useAttachFileToOrder(orderId);
  const updateFile = useUpdateOrderFile(orderId);
  const detachFile = useDetachOrderFile(orderId);

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingFile, setEditingFile] = useState<OrderFileWithUser | null>(null);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);

  // Edit dialog form state
  const [editRole, setEditRole] = useState<string>('other');
  const [editSide, setEditSide] = useState<string>('na');
  const [editIsPrimary, setEditIsPrimary] = useState(false);
  const [editDescription, setEditDescription] = useState('');

  const handleEditFile = (file: OrderFileWithUser) => {
    setEditingFile(file);
    setEditRole(file.role || 'other');
    setEditSide(file.side || 'na');
    setEditIsPrimary(file.isPrimary || false);
    setEditDescription(file.description || '');
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!editingFile) return;

    try {
      await updateFile.mutateAsync({
        fileId: editingFile.id,
        updates: {
          role: editRole as any,
          side: editSide as any,
          isPrimary: editIsPrimary,
          description: editDescription || null,
        },
      });

      toast({
        title: "File updated",
        description: "File metadata has been updated successfully.",
      });

      setShowEditDialog(false);
      setEditingFile(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update file",
        variant: "destructive",
      });
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    try {
      await detachFile.mutateAsync(fileId);
      toast({
        title: "File removed",
        description: "File has been detached from this order.",
      });
      setFileToDelete(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to remove file",
        variant: "destructive",
      });
    }
  };

  const getRoleIcon = (role: string) => {
    const roleData = FILE_ROLES.find(r => r.value === role);
    const Icon = roleData?.icon || FileIcon;
    return <Icon className="h-4 w-4" />;
  };

  const getRoleLabel = (role: string) => {
    return FILE_ROLES.find(r => r.value === role)?.label || role;
  };

  const getSideLabel = (side: string) => {
    return FILE_SIDES.find(s => s.value === side)?.label || side;
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Artwork & Files</CardTitle>
              <CardDescription>
                {files.length} {files.length === 1 ? 'file' : 'files'} attached
              </CardDescription>
            </div>
            {/* Future: Add "Attach File" button when upload UI is ready */}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading files...</div>
          ) : files.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No files attached to this order yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  {isAdminOrOwner && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {file.thumbnailUrl ? (
                          <img 
                            src={file.thumbnailUrl} 
                            alt={file.originalFilename || file.fileName} 
                            className="h-10 w-10 object-cover rounded"
                          />
                        ) : (
                          getRoleIcon(file.role || 'other')
                        )}
                        <div>
                          <a
                            href={file.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium hover:underline text-sm"
                          >
                            {file.originalFilename || file.fileName}
                          </a>
                          {file.description && (
                            <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {file.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Badge variant="outline">{getRoleLabel(file.role || 'other')}</Badge>
                        {file.isPrimary && (
                          <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" title="Primary" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{getSideLabel(file.side || 'na')}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatFileSize(file.fileSize)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {file.uploadedByUser && (
                        <div>
                          <div>{file.uploadedByUser.firstName} {file.uploadedByUser.lastName}</div>
                          <div className="text-xs">{format(new Date(file.createdAt), 'MMM d, yyyy')}</div>
                        </div>
                      )}
                    </TableCell>
                    {isAdminOrOwner && (
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditFile(file)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setFileToDelete(file.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit File Metadata</DialogTitle>
            <DialogDescription>
              Update role, side, and primary flag for {editingFile?.originalFilename || editingFile?.fileName}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Role</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FILE_ROLES.map(role => (
                    <SelectItem key={role.value} value={role.value}>
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Side</Label>
              <Select value={editSide} onValueChange={setEditSide}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FILE_SIDES.map(side => (
                    <SelectItem key={side.value} value={side.value}>
                      {side.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="isPrimary"
                checked={editIsPrimary}
                onChange={(e) => setEditIsPrimary(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="isPrimary" className="cursor-pointer">
                Set as primary artwork for this side/role
              </Label>
            </div>

            <div>
              <Label>Description (optional)</Label>
              <Input
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Add a description..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={updateFile.isPending}>
              {updateFile.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!fileToDelete} onOpenChange={() => setFileToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove File?</AlertDialogTitle>
            <AlertDialogDescription>
              This will detach the file from this order. The file itself will not be deleted from storage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => fileToDelete && handleDeleteFile(fileToDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
