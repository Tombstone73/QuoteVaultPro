import { useState, useRef } from "react";
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
import { FileIcon, Edit2, Trash2, Upload, Image as ImageIcon, Star, FileText, Loader2 } from "lucide-react";
import { useOrderFiles, useAttachFileToOrder, useUpdateOrderFile, useDetachOrderFile } from "@/hooks/useOrderFiles";
import type { OrderFileWithUser } from "@/hooks/useOrderFiles";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { isValidHttpUrl } from "@/lib/utils";

// Max file size: 50MB
const MAX_SIZE_BYTES = 50 * 1024 * 1024;

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
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit dialog form state
  const [editRole, setEditRole] = useState<string>('other');
  const [editSide, setEditSide] = useState<string>('na');
  const [editIsPrimary, setEditIsPrimary] = useState(false);
  const [editDescription, setEditDescription] = useState('');

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const filesToUpload = Array.from(e.target.files);

    // Check file sizes
    const oversizedFiles = filesToUpload.filter(f => f.size > MAX_SIZE_BYTES);
    if (oversizedFiles.length > 0) {
      toast({
        title: "File Too Large",
        description: "Files larger than 50MB cannot be uploaded. Please use WeTransfer or another file sharing service for large files.",
        variant: "destructive",
      });
      const validFiles = filesToUpload.filter(f => f.size <= MAX_SIZE_BYTES);
      if (validFiles.length === 0) {
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
    }

    setIsUploading(true);
    let successCount = 0;
    let errorCount = 0;

    try {
      for (const file of filesToUpload) {
        if (file.size > MAX_SIZE_BYTES) continue;

        try {
          // Step 1: Get signed upload URL from backend
          const urlResponse = await fetch("/api/objects/upload", {
            method: "POST",
            credentials: "include",
          });

          if (!urlResponse.ok) {
            const errorData = await urlResponse.json().catch(() => ({}));
            console.error("Failed to get upload URL:", errorData);
            throw new Error(errorData.message || "Failed to get upload URL");
          }

          const { url, method, path } = await urlResponse.json();

          // Step 2: Upload file to storage
          const uploadResponse = await fetch(url, {
            method: method || "PUT",
            body: file,
            headers: {
              "Content-Type": file.type || "application/octet-stream",
            },
          });

          if (!uploadResponse.ok) {
            console.error("Upload failed:", uploadResponse.status, uploadResponse.statusText);
            throw new Error(`Failed to upload ${file.name}`);
          }

          // Step 3: Persist storage key (bucket-relative path) — never persist signed URLs.
          // Supabase returns { url, path, token }. Replit fallback returns only { url }.
          const fileUrl = typeof path === "string" && path ? path : url.split("?")[0];

          // Step 4: Attach file to order
          await attachFile.mutateAsync({
            fileName: file.name,
            fileUrl,
            fileSize: file.size,
            mimeType: file.type,
            role: 'other',
            side: 'na',
          });

          successCount++;
        } catch (fileError: any) {
          console.error(`Error uploading ${file.name}:`, fileError);
          errorCount++;
        }
      }

      if (successCount > 0) {
        toast({
          title: "Files Uploaded",
          description: `${successCount} file${successCount !== 1 ? "s" : ""} uploaded successfully.`,
        });
      }

      if (errorCount > 0) {
        toast({
          title: "Some Uploads Failed",
          description: `${errorCount} file${errorCount !== 1 ? "s" : ""} failed to upload.`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("Upload error:", error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload files. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

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
              <CardTitle className="text-lg font-medium">Artwork & Files</CardTitle>
              <CardDescription>
                {files.length} {files.length === 1 ? 'file' : 'files'} attached
              </CardDescription>
            </div>
            {/* Upload button */}
            <div>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                multiple
                accept="image/*,.pdf,.ai,.eps,.psd,.svg,.doc,.docx,.xls,.xlsx"
                onChange={handleFileUpload}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                {isUploading ? "Uploading..." : "Upload Files"}
              </Button>
            </div>
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
                {files.map((file) => {
                  // Prefer thumbUrl (signed URL from enrichAttachmentWithUrls) over legacy thumbnailUrl
                  // thumbUrl is only present if thumbKey exists and was successfully enriched
                  const thumbSrc = file.thumbUrl && isValidHttpUrl(file.thumbUrl) 
                    ? file.thumbUrl 
                    : (file.thumbnailUrl && isValidHttpUrl(file.thumbnailUrl) 
                      ? file.thumbnailUrl 
                      : null);
                  const hasError = imageErrors.has(file.id);
                  
                  return (
                  <TableRow key={file.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {thumbSrc && !hasError ? (
                          <img 
                            src={thumbSrc} 
                            alt="" 
                            className="h-10 w-10 object-cover rounded"
                            onError={() => {
                              setImageErrors(prev => new Set(prev).add(file.id));
                            }}
                          />
                        ) : (
                          <div className="h-10 w-10 rounded border border-border/60 bg-muted/30 flex items-center justify-center shrink-0">
                            {getRoleIcon(file.role || 'other')}
                          </div>
                        )}
                        <div>
                          {/* Use signed originalUrl from server, not storage key fileUrl */}
                          {file.originalUrl && isValidHttpUrl(file.originalUrl) ? (
                            <a
                              href={file.originalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium hover:underline text-sm"
                            >
                              {file.originalFilename || file.fileName}
                            </a>
                          ) : (
                            <span className="font-medium text-sm text-muted-foreground">
                              {file.originalFilename || file.fileName}
                            </span>
                          )}
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
                          <span title="Primary">
                            <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                          </span>
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
                  );
                })}
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
