import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Download, Edit, Plus, Settings as SettingsIcon, Trash2, Upload, LayoutGrid, LayoutList, Users, Hash, X, Mail, Send, Link as LinkIcon, BookOpen, ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ObjectUploader } from "@/components/object-uploader";
import { MediaPicker } from "@/components/media-picker";
import UserManagement from "@/components/user-management";
import { EmailTemplatesSettings } from "@/components/email-templates-settings";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type {
  Product,
  InsertProduct,
  UpdateProduct,
  ProductOption,
  InsertProductOption,
  UpdateProductOption,
  ProductVariant,
  InsertProductVariant,
  UpdateProductVariant,
  GlobalVariable,
  InsertGlobalVariable,
  UpdateGlobalVariable,
  MediaAsset,
  FormulaTemplate,
  InsertFormulaTemplate,
  UpdateFormulaTemplate,
  EmailSettings,
  InsertEmailSettings,
  UpdateEmailSettings
} from "@shared/schema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  insertProductSchema,
  insertProductOptionSchema,
  insertProductVariantSchema,
  insertGlobalVariableSchema,
  insertFormulaTemplateSchema,
  insertEmailSettingsSchema
} from "@shared/schema";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { JobStatusSettings } from "@/components/job-status-settings";
import { useProductTypes } from "@/hooks/useProductTypes";

function SelectChoicesInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [newChoice, setNewChoice] = useState("");
  const choices = value?.split(",").map(s => s.trim()).filter(Boolean) || [];
  
  const addChoice = () => {
    const trimmed = newChoice.trim();
    if (trimmed && !choices.includes(trimmed)) {
      onChange([...choices, trimmed].join(","));
      setNewChoice("");
    }
  };
  
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder="Add a choice (e.g., Matte, Gloss)"
          value={newChoice}
          onChange={(e) => setNewChoice(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addChoice();
            }
          }}
          data-testid="input-add-select-choice"
        />
        <Button
          type="button"
          variant="outline"
          onClick={addChoice}
          data-testid="button-add-select-choice"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {choices.map((choice, index) => (
          <Badge
            key={index}
            variant="secondary"
            className="gap-1"
            data-testid={`badge-choice-${index}`}
          >
            {choice}
            <button
              type="button"
              onClick={() => {
                const newChoices = choices.filter((_, i) => i !== index);
                onChange(newChoices.join(","));
              }}
              className="ml-1 hover:text-destructive"
              data-testid={`button-remove-choice-${index}`}
            >
              ×
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}

/**
 * Helper: Convert storage path to browsable URL
 * Storage paths can be:
 * - Already prefixed with /objects/ -> use as-is
 * - Raw storage key (bucket/path or just path) -> prefix with /objects/
 * - Full HTTP URL -> use as-is
 * 
 * NOTE: Server should now return proper view URLs, but this provides fallback protection
 */
function getMediaUrl(url: string): string {
  if (!url) return '';
  
  // Full HTTP/HTTPS URL - use as-is
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  
  // Already prefixed with /objects/ - use as-is
  if (url.startsWith('/objects/')) return url;
  
  // Upload/sign URLs should never reach here (server converts them), but handle as fallback
  if (url.includes('/upload/sign/')) {
    console.warn('Client received upload/sign URL - this should be fixed server-side:', url);
    // Try to extract object path
    const pathMatch = url.match(/\/upload\/sign\/[^\/]+\/(.+?)(?:\?|$)/);
    if (pathMatch && pathMatch[1]) {
      return `/objects/${pathMatch[1]}`;
    }
  }
  
  // Raw storage path - prefix with /objects/
  return `/objects/${url}`;
}

export function MediaLibraryTab() {
  const { toast } = useToast();
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);

  const { data: mediaAssets, isLoading } = useQuery<MediaAsset[]>({
    queryKey: ["/api/media"],
  });

  const deleteAssetMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/media/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });
      toast({
        title: "Asset deleted",
        description: "Media asset has been removed from the library",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete asset",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveAssetMutation = useMutation({
    mutationFn: async (data: { filename: string; url: string; fileSize: number; mimeType: string }) => {
      return apiRequest("POST", "/api/media", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });
      toast({
        title: "Image saved to library",
        description: "Your image is now available in the media library",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to save image",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleUploadChange = async (urls: string[]) => {
    // Update local upload queue
    setUploadQueue(urls);
    
    // Only save new URLs that aren't already in the library
    const existingUrls = mediaAssets?.map(a => a.url) || [];
    const newUrls = urls.filter(url => !existingUrls.includes(url));
    
    console.log('handleUploadChange called', { allUrls: urls, existingUrls, newUrls });
    
    if (newUrls.length === 0) return;
    
    for (const url of newUrls) {
      const filename = url.split('/').pop() || 'unknown.jpg';
      const extension = filename.split('.').pop()?.toLowerCase() || 'jpg';
      
      const mimeTypes: Record<string, string> = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
      };
      
      const mimeType = mimeTypes[extension] || 'image/jpeg';
      
      console.log('Attempting to save asset:', { filename, url, mimeType });
      
      try {
        const result = await saveAssetMutation.mutateAsync({
          filename,
          url,
          fileSize: 0,
          mimeType,
        });
        console.log('Asset saved successfully:', result);
      } catch (error: any) {
        console.error('Failed to save asset - full error:', error);
        const errorMessage = error?.message || error?.toString() || 'Unknown error';
        toast({
          title: "Upload failed",
          description: `Failed to save ${filename}: ${errorMessage}`,
          variant: "destructive",
        });
      }
    }
    
    // Clear upload queue after processing
    setUploadQueue([]);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (date: string | Date) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload Media</CardTitle>
          <CardDescription>
            Upload images to automatically add them to your media library. You can then reuse them across multiple products.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ObjectUploader
            value={uploadQueue}
            onChange={handleUploadChange}
            maxFiles={25}
            allowedFileTypes={["image/*"]}
          />
          <p className="text-xs text-muted-foreground mt-2">
            Upload up to 25 images per batch. You can upload multiple batches for larger libraries.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Media Library</CardTitle>
          <CardDescription>
            {mediaAssets?.length || 0} images in library
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="aspect-square" />
              ))}
            </div>
          ) : mediaAssets && mediaAssets.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="media-library-grid">
              {mediaAssets.map((asset) => (
                <Card key={asset.id} className="overflow-hidden" data-testid={`media-asset-${asset.id}`}>
                  <div className="aspect-square relative bg-muted">
                    <img
                      src={getMediaUrl(asset.url)}
                      alt={asset.filename}
                      className="w-full h-full object-cover"
                      data-testid={`media-image-${asset.id}`}
                    />
                  </div>
                  <CardContent className="p-3 space-y-2">
                    <div className="text-sm font-medium truncate" title={asset.filename}>
                      {asset.filename}
                    </div>
                    <div className="flex justify-between items-center text-xs text-muted-foreground">
                      <span>{formatFileSize(asset.fileSize)}</span>
                      <span>{formatDate(asset.uploadedAt)}</span>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="w-full"
                          data-testid={`button-delete-asset-${asset.id}`}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Media Asset</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{asset.filename}"? This action cannot be undone.
                            Products using this image will no longer display it.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteAssetMutation.mutate(asset.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              No media assets yet. Upload your first image to get started.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function QuoteNumberSettings() {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [newStartNumber, setNewStartNumber] = useState<string>("");

  const { data: globalVariables, isLoading } = useQuery<GlobalVariable[]>({
    queryKey: ["/api/global-variables"],
  });

  const updateQuoteNumberMutation = useMutation({
    mutationFn: async (newNumber: number) => {
      const quoteNumberVar = globalVariables?.find(v => v.name === 'next_quote_number');
      if (!quoteNumberVar) {
        throw new Error('Quote numbering system not initialized');
      }
      return apiRequest("PATCH", `/api/global-variables/${quoteNumberVar.id}`, {
        value: newNumber
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] });
      setIsEditing(false);
      setNewStartNumber("");
      toast({
        title: "Quote numbering updated",
        description: "The next quote number has been updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update quote numbering",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const quoteNumberVar = globalVariables?.find(v => v.name === 'next_quote_number');
  const currentNextNumber = quoteNumberVar ? Math.floor(Number(quoteNumberVar.value)) : null;

  const handleSave = () => {
    const num = parseInt(newStartNumber);
    if (isNaN(num) || num < 1) {
      toast({
        title: "Invalid number",
        description: "Please enter a valid positive number",
        variant: "destructive",
      });
      return;
    }
    updateQuoteNumberMutation.mutate(num);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Quote Numbering System</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-quote-number-settings">
      <CardHeader>
        <CardTitle>Quote Numbering System</CardTitle>
        <CardDescription>
          Configure the starting number for new quotes. Current quotes will keep their existing numbers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Label htmlFor="next-quote-number" data-testid="label-next-quote-number">
              Next Quote Number
            </Label>
            {isEditing ? (
              <Input
                id="next-quote-number"
                type="number"
                min="1"
                value={newStartNumber}
                onChange={(e) => setNewStartNumber(e.target.value)}
                placeholder={currentNextNumber?.toString() || "1001"}
                data-testid="input-next-quote-number"
                className="mt-2"
              />
            ) : (
              <div className="text-2xl font-bold mt-2" data-testid="text-current-quote-number">
                {currentNextNumber || "Not set"}
              </div>
            )}
            <p className="text-sm text-muted-foreground mt-2">
              The next quote created will be assigned number {currentNextNumber || "N/A"}
            </p>
          </div>
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsEditing(false);
                    setNewStartNumber("");
                  }}
                  data-testid="button-cancel-quote-number"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={updateQuoteNumberMutation.isPending}
                  data-testid="button-save-quote-number"
                >
                  {updateQuoteNumberMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setIsEditing(true);
                  setNewStartNumber(currentNextNumber?.toString() || "1001");
                }}
                data-testid="button-edit-quote-number"
              >
                Change Starting Number
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Email Settings Tab Component
export function EmailSettingsTab() {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState("");
  const [hasHydrated, setHasHydrated] = useState(false);
  const [lastFetchedSettings, setLastFetchedSettings] = useState<EmailSettings | null>(null);

  // Fetch email settings
  const { data: emailSettings, isLoading } = useQuery<EmailSettings | null>({
    queryKey: ["/api/email-settings/default"],
    queryFn: async () => {
      try {
        const response = await apiRequest("GET", "/api/email-settings/default");
        return await response.json();
      } catch (error: any) {
        if (error.message?.includes("404")) {
          return null; // No settings configured yet
        }
        throw error;
      }
    },
  });

  // Form setup
  const form = useForm<InsertEmailSettings>({
    resolver: zodResolver(insertEmailSettingsSchema),
    defaultValues: {
      provider: "gmail",
      fromAddress: "",
      fromName: "",
      clientId: "",
      clientSecret: "",
      refreshToken: "",
      isActive: true,
      isDefault: true,
    },
  });

  // Update form when data loads (only when not editing and data exists)
  useEffect(() => {
    if (emailSettings && !isEditing) {
      const mappedSettings = {
        provider: emailSettings.provider as "gmail" | "sendgrid" | "smtp",
        fromAddress: emailSettings.fromAddress,
        fromName: emailSettings.fromName,
        clientId: emailSettings.clientId || "",
        clientSecret: emailSettings.clientSecret || "",
        refreshToken: emailSettings.refreshToken || "",
        isActive: emailSettings.isActive,
        isDefault: emailSettings.isDefault,
      };
      
      form.reset(mappedSettings);
      setLastFetchedSettings(emailSettings);
      
      if (!hasHydrated) {
        setHasHydrated(true);
      }
    }
  }, [emailSettings, isEditing, hasHydrated]);

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (data: InsertEmailSettings) => {
      if (emailSettings?.id) {
        return apiRequest("PATCH", `/api/email-settings/${emailSettings.id}`, data);
      } else {
        return apiRequest("POST", "/api/email-settings", data);
      }
    },
    onSuccess: () => {
      // Show success toast ONLY when save mutation completes
      toast({
        title: "Success",
        description: "Email settings saved successfully",
      });
      setIsEditing(false);
      // Invalidate after UI update to refetch latest
      queryClient.invalidateQueries({ queryKey: ["/api/email-settings/default"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save email settings",
        variant: "destructive",
      });
    },
  });

  // Test email mutation with timeout
  const testEmailMutation = useMutation({
    mutationFn: async (recipientEmail: string) => {
      // Set aggressive timeout for test email (20s max)
      const response = await apiRequest("POST", "/api/email/test", 
        { recipientEmail },
        { timeout: 20000 } // 20 second timeout
      );
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Success",
        description: "Test email sent successfully! Check your inbox.",
      });
      setTestEmailAddress("");
    },
    onError: (error: any) => {
      // Extract error details from structured error response
      let errorMessage = "Failed to send test email";
      let requestId: string | undefined;
      let errorCode: string | undefined;
      let errorCategory: string | undefined;

      // Check if error has structured data (from throwIfResNotOk)
      if (error.data) {
        errorMessage = error.data.message || errorMessage;
        requestId = error.data.requestId;
        errorCode = error.data.error?.code;
        errorCategory = error.data.error?.category;

        // Special handling for configuration errors
        if (errorCode === 'EMAIL_NOT_CONFIGURED') {
          errorMessage = error.data.message; // Use the detailed reason from server
        }
      } else if (error.message) {
        // Handle timeout or network errors
        if (error.message.includes("timed out")) {
          errorMessage = "Request timed out. Please check your internet connection and try again.";
          errorCode = "CLIENT_TIMEOUT";
        } else if (error.name === "AbortError") {
          errorMessage = "Request timed out after 20 seconds. Please try again.";
          errorCode = "CLIENT_TIMEOUT";
        } else {
          errorMessage = error.message;
        }
      }

      // Build description with error code and requestId for diagnosis
      const details = [
        errorMessage,
        errorCode && `Error: ${errorCode}`,
        requestId && `Request ID: ${requestId}`
      ].filter(Boolean).join("\n");

      toast({
        title: "Test Email Failed",
        description: details,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InsertEmailSettings) => {
    saveMutation.mutate(data);
  };

  const handleSendTest = () => {
    if (!testEmailAddress) {
      toast({
        title: "Error",
        description: "Please enter an email address",
        variant: "destructive",
      });
      return;
    }
    testEmailMutation.mutate(testEmailAddress);
  };

  const handleCancel = () => {
    setIsEditing(false);
    if (lastFetchedSettings) {
      form.reset({
        provider: lastFetchedSettings.provider as "gmail" | "sendgrid" | "smtp",
        fromAddress: lastFetchedSettings.fromAddress,
        fromName: lastFetchedSettings.fromName,
        clientId: lastFetchedSettings.clientId || "",
        clientSecret: lastFetchedSettings.clientSecret || "",
        refreshToken: lastFetchedSettings.refreshToken || "",
        isActive: lastFetchedSettings.isActive,
        isDefault: lastFetchedSettings.isDefault,
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Email Settings</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Setup Guide */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            Gmail OAuth Setup Guide
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="setup-guide">
              <AccordionTrigger className="text-base font-medium">
                How to configure Gmail OAuth for sending emails
              </AccordionTrigger>
              <AccordionContent className="space-y-4 pt-4">
                <div className="space-y-3 text-sm">
                  <div>
                    <h4 className="font-semibold mb-2">Step 1: Create a Google Cloud Project</h4>
                    <p className="text-muted-foreground">
                      Go to <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Google Cloud Console</a> and create a new project (or select an existing one).
                    </p>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold mb-2">Step 2: Enable Gmail API</h4>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                      <li>Navigate to "APIs & Services" → "Library"</li>
                      <li>Search for "Gmail API"</li>
                      <li>Click "Enable"</li>
                    </ul>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold mb-2">Step 3: Create OAuth 2.0 Client ID</h4>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                      <li>Go to "APIs & Services" → "Credentials"</li>
                      <li>Click "Create Credentials" → "OAuth client ID"</li>
                      <li>Select "Web application" as application type</li>
                      <li>Add authorized redirect URI: <code className="bg-muted px-1 py-0.5 rounded">https://developers.google.com/oauthplayground</code></li>
                      <li>Save your Client ID and Client Secret</li>
                    </ul>
                  </div>
                  
                  <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                    <h4 className="font-semibold mb-2 text-amber-900 dark:text-amber-100">⚠️ Production Deployment Note</h4>
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      If you moved from localhost to production (e.g., Railway, Vercel, or your own domain), you must update your Google Cloud OAuth Authorized Redirect URIs to include your production URL. The redirect URI configured in Google Cloud Console must match the <code className="bg-amber-100 dark:bg-amber-900 px-1 py-0.5 rounded">GMAIL_OAUTH_REDIRECT_URI</code> environment variable on your server.
                    </p>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold mb-2">Step 4: Generate Refresh Token</h4>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                      <li>Go to <a href="https://developers.google.com/oauthplayground" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">OAuth 2.0 Playground</a></li>
                      <li>Click the gear icon (⚙️) in the top right</li>
                      <li>Check "Use your own OAuth credentials"</li>
                      <li>Enter your Client ID and Client Secret</li>
                      <li>In the left panel, select "Gmail API v1" → expand and check <code className="bg-muted px-1 py-0.5 rounded">https://mail.google.com/</code></li>
                      <li>Click "Authorize APIs" and sign in with the Gmail account you want to use</li>
                      <li>Click "Exchange authorization code for tokens"</li>
                      <li>Copy the "Refresh token" value</li>
                    </ul>
                    
                    <div className="mt-4 pl-4 border-l-2 border-primary/30">
                      <h5 className="font-semibold text-sm mb-2">If you moved from localhost to production</h5>
                      <p className="text-xs text-muted-foreground mb-2">
                        When migrating to a production domain (Railway, Vercel, custom domain), your old refresh token may stop working. Generate a new one:
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground ml-2">
                        <li>In Google Cloud Console → "Credentials" → Edit your OAuth client → Add both <code className="bg-muted px-1 py-0.5 rounded">https://developers.google.com/oauthplayground</code> AND your production callback URL (e.g., <code className="bg-muted px-1 py-0.5 rounded">https://yourdomain.com/api/oauth/gmail/callback</code>) to Authorized Redirect URIs</li>
                        <li>Visit <a href="https://developers.google.com/oauthplayground" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">OAuth 2.0 Playground</a> and click the gear icon → "Use your own OAuth credentials"</li>
                        <li>Authorize scope <code className="bg-muted px-1 py-0.5 rounded">https://mail.google.com/</code> and exchange the authorization code for tokens</li>
                        <li>Copy the new refresh token and paste it into TitanOS settings below (old tokens will be revoked)</li>
                      </ul>
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold mb-2">Step 5: Configure Settings Below</h4>
                    <p className="text-muted-foreground">
                      Fill in the form fields below with your Gmail address, Client ID, Client Secret, and Refresh Token.
                    </p>
                  </div>
                  
                  <div>
                    <h4 className="font-semibold mb-2">Step 6: Test Your Configuration</h4>
                    <p className="text-muted-foreground">
                      After saving, use the "Test Email" section to verify your settings are working correctly.
                    </p>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Email Configuration
          </CardTitle>
          <CardDescription>
            Configure Gmail OAuth settings to send quote emails
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!emailSettings && !isEditing ? (
            <div className="text-center py-8">
              <Mail className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Email Settings Configured</h3>
              <p className="text-muted-foreground mb-4">
                Set up your Gmail OAuth credentials to start sending quote emails
              </p>
              <Button type="button" onClick={() => setIsEditing(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Configure Email
              </Button>
            </div>
          ) : null}

          {(emailSettings || isEditing) && (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="fromAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Gmail Address</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="email"
                          placeholder="your-email@gmail.com"
                          disabled={!isEditing}
                        />
                      </FormControl>
                      <FormDescription>
                        The Gmail address that will send emails
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="fromName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>From Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Titan Graphics"
                          disabled={!isEditing}
                        />
                      </FormControl>
                      <FormDescription>
                        The name that will appear in sent emails
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="clientId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>OAuth Client ID</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type={isEditing ? "text" : "password"}
                          placeholder={isEditing ? "Your Client ID" : "••••••••••••••••"}
                          disabled={!isEditing}
                        />
                      </FormControl>
                      <FormDescription>
                        From Google Cloud Console OAuth credentials
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="clientSecret"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>OAuth Client Secret</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          placeholder={isEditing ? "Your Client Secret" : "••••••••••••••••"}
                          disabled={!isEditing}
                        />
                      </FormControl>
                      <FormDescription>
                        From Google Cloud Console OAuth credentials
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="refreshToken"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>OAuth Refresh Token</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder={isEditing ? "1//..." : "••••••••••••••••"}
                          disabled={!isEditing}
                          rows={3}
                        />
                      </FormControl>
                      <FormDescription>
                        From OAuth 2.0 Playground
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex gap-2">
                  {isEditing ? (
                    <>
                      <Button type="submit" disabled={saveMutation.isPending}>
                        {saveMutation.isPending ? "Saving..." : "Save Settings"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancel}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button 
                      type="button" 
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsEditing(true);
                      }}
                    >
                      <Edit className="w-4 h-4 mr-2" />
                      Edit Settings
                    </Button>
                  )}
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>

      {emailSettings && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="w-5 h-5" />
              Test Email
            </CardTitle>
            <CardDescription>
              Send a test email to verify your configuration
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="test@example.com"
                value={testEmailAddress}
                onChange={(e) => setTestEmailAddress(e.target.value)}
                disabled={testEmailMutation.isPending}
              />
              <Button
                onClick={handleSendTest}
                disabled={testEmailMutation.isPending || !testEmailAddress}
              >
                {testEmailMutation.isPending ? "Sending..." : "Send Test"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Email Templates Section */}
      <EmailTemplatesSettings />
    </div>
  );
}

// Helper: validate URL is a proper http(s) string
const isValidHttpUrl = (v: unknown): v is string =>
  typeof v === "string" && (v.startsWith("http://") || v.startsWith("https://"));

type AdminSettingsProps = {
  defaultTab?: string;
  hideTabs?: boolean;
};

export default function AdminSettings({ defaultTab = "products", hideTabs = false }: AdminSettingsProps = {}) {
  const { toast } = useToast();
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingOption, setEditingOption] = useState<ProductOption | null>(null);
  const [isAddOptionDialogOpen, setIsAddOptionDialogOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [isAddVariantDialogOpen, setIsAddVariantDialogOpen] = useState(false);
  const [editingVariable, setEditingVariable] = useState<GlobalVariable | null>(null);
  const [isAddVariableDialogOpen, setIsAddVariableDialogOpen] = useState(false);
  const [editingFormulaTemplate, setEditingFormulaTemplate] = useState<FormulaTemplate | null>(null);
  const [isAddFormulaTemplateDialogOpen, setIsAddFormulaTemplateDialogOpen] = useState(false);
  const [viewingTemplateProducts, setViewingTemplateProducts] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [templateSearchTerm, setTemplateSearchTerm] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);
  const [mediaPickerMode, setMediaPickerMode] = useState<"add" | "edit">("add");
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());

  const { data: products, isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: productTypes } = useProductTypes();

  const addProductForm = useForm<InsertProduct>({
    resolver: zodResolver(insertProductSchema),
    defaultValues: {
      name: "",
      description: "",
      category: "",
      pricingFormula: "sqft * p * q",
      storeUrl: "",
      showStoreLink: true,
      thumbnailUrls: [],
      priceBreaks: {
        enabled: false,
        type: "quantity",
        tiers: [],
      },
      useNestingCalculator: false,
      sheetWidth: null,
      sheetHeight: null,
      materialType: "sheet",
      minPricePerItem: null,
      nestingVolumePricing: {
        enabled: false,
        tiers: [],
      },
      isActive: true,
    },
  });

  const editProductForm = useForm<UpdateProduct>({
    resolver: zodResolver(insertProductSchema.partial()),
  });

  const optionForm = useForm<Omit<InsertProductOption, "productId">>({
    resolver: zodResolver(insertProductOptionSchema.omit({ productId: true })),
    defaultValues: {
      name: "",
      description: "",
      type: "toggle",
      defaultValue: "false",
      defaultSelection: "",
      isDefaultEnabled: false,
      setupCost: 0,
      priceFormula: "0",
      parentOptionId: null,
      displayOrder: 0,
      isActive: true,
    },
  });

  const variantForm = useForm<Omit<InsertProductVariant, "productId">>({
    resolver: zodResolver(insertProductVariantSchema.omit({ productId: true })),
    defaultValues: {
      name: "",
      description: "",
      basePricePerSqft: 0,
      volumePricing: { enabled: false, tiers: [] },
      isDefault: false,
      displayOrder: 0,
      isActive: true,
    },
  });

  const editVariantForm = useForm<Omit<InsertProductVariant, "productId">>({
    resolver: zodResolver(insertProductVariantSchema.omit({ productId: true })),
  });

  const variableForm = useForm<InsertGlobalVariable>({
    resolver: zodResolver(insertGlobalVariableSchema),
    defaultValues: {
      name: "",
      value: "",
      description: "",
      category: "",
      isActive: true,
    },
  });

  const editVariableForm = useForm<InsertGlobalVariable>({
    resolver: zodResolver(insertGlobalVariableSchema),
  });

  const formulaTemplateForm = useForm<InsertFormulaTemplate>({
    resolver: zodResolver(insertFormulaTemplateSchema),
    defaultValues: {
      name: "",
      description: "",
      formula: "sqft * p * q",
      category: "",
      isActive: true,
    },
  });

  const editFormulaTemplateForm = useForm<InsertFormulaTemplate>({
    resolver: zodResolver(insertFormulaTemplateSchema),
  });

  const { data: formulaTemplates, isLoading: formulaTemplatesLoading } = useQuery<FormulaTemplate[]>({
    queryKey: ["/api/formula-templates"],
    queryFn: async () => {
      console.log("[DEBUG] Fetching formula templates...");
      const response = await fetch("/api/formula-templates", { credentials: "include" });
      console.log("[DEBUG] Response status:", response.status, response.statusText);
      const data = await response.json();
      console.log("[DEBUG] Response data:", data);
      return data;
    },
  });

  // Debug logging
  console.log("[DEBUG] Formula Templates:", {
    loading: formulaTemplatesLoading,
    data: formulaTemplates,
    count: formulaTemplates?.length || 0
  });

  const { data: templateProducts } = useQuery<Product[]>({
    queryKey: [`/api/formula-templates/${viewingTemplateProducts}/products`],
    enabled: !!viewingTemplateProducts,
  });

  const addProductMutation = useMutation({
    mutationFn: async (data: InsertProduct) => {
      return await apiRequest("POST", "/api/products", data);
    },
    onSuccess: () => {
      toast({
        title: "Product Added",
        description: "The product has been added successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setIsAddDialogOpen(false);
      addProductForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateProduct }) => {
      return await apiRequest("PATCH", `/api/products/${id}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Product Updated",
        description: "The product has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setEditingProduct(null);
      editProductForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/products/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Product Deleted",
        description: "The product has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const cloneProductMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", `/api/products/${id}/clone`);
    },
    onSuccess: () => {
      toast({
        title: "Product Cloned",
        description: "The product has been cloned successfully. You can now edit the name and pricing.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importProductsMutation = useMutation({
    mutationFn: async (csvData: string) => {
      return await apiRequest("POST", "/api/products/import", { csvData });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Products Imported",
        description: `Successfully imported ${data.imported.products} products, ${data.imported.variants} variants, and ${data.imported.options} options.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setCsvFile(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCsvUpload = async () => {
    if (!csvFile) {
      toast({
        title: "No File Selected",
        description: "Please select a CSV file to upload.",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const csvData = e.target?.result as string;
      importProductsMutation.mutate(csvData);
    };
    reader.readAsText(csvFile);
  };

  const handleExportProducts = async () => {
    try {
      const response = await fetch('/api/products/export', {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to export products');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      a.download = `products-export-${timestamp}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({
        title: "Export Successful",
        description: "Products exported to CSV successfully.",
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export products to CSV.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch('/api/products/csv-template', {
        credentials: 'include',
      });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'product-import-template.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Failed to download the CSV template.",
        variant: "destructive",
      });
    }
  };

  const { data: productOptions } = useQuery<ProductOption[]>({
    queryKey: ["/api/products", editingProduct?.id, "options"],
    enabled: !!editingProduct?.id,
  });

  const addOptionMutation = useMutation({
    mutationFn: async (data: Omit<InsertProductOption, "productId">) => {
      if (!editingProduct) throw new Error("No product selected");
      return await apiRequest("POST", `/api/products/${editingProduct.id}/options`, data);
    },
    onSuccess: () => {
      toast({
        title: "Option Added",
        description: "The product option has been added successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products", editingProduct?.id, "options"] });
      setIsAddOptionDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateOptionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Omit<InsertProductOption, "productId"> }) => {
      if (!editingProduct) throw new Error("No product selected");
      const updateData: UpdateProductOption = { ...data, id, productId: editingProduct.id };
      return await apiRequest("PATCH", `/api/products/${editingProduct.id}/options/${id}`, updateData);
    },
    onSuccess: () => {
      toast({
        title: "Option Updated",
        description: "The product option has been updated successfully.",
      });
      // DON'T invalidate query - keeps product dialog open
      // User can close/reopen dialog to see changes
      setEditingOption(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteOptionMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!editingProduct) throw new Error("No product selected");
      return await apiRequest("DELETE", `/api/products/${editingProduct.id}/options/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Option Deleted",
        description: "The product option has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products", editingProduct?.id, "options"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Fetch all variants for all products
  const { data: allVariants, isLoading: variantsLoading } = useQuery<{ productId: string; productName: string; variants: ProductVariant[] }[]>({
    queryKey: ["/api/all-variants"],
    queryFn: async () => {
      if (!products) return [];
      const variantsData = await Promise.all(
        products.map(async (product) => {
          try {
            const response = await fetch(`/api/products/${product.id}/variants`);
            if (!response.ok) {
              console.error(`Failed to fetch variants for product ${product.id}:`, response.status);
              return {
                productId: product.id,
                productName: product.name,
                variants: [],
              };
            }
            const variants = await response.json();
            // Ensure variants is an array
            return {
              productId: product.id,
              productName: product.name,
              variants: Array.isArray(variants) ? variants : [],
            };
          } catch (error) {
            console.error(`Error fetching variants for product ${product.id}:`, error);
            return {
              productId: product.id,
              productName: product.name,
              variants: [],
            };
          }
        })
      );
      return variantsData;
    },
    enabled: !!products,
  });

  const addVariantMutation = useMutation({
    mutationFn: async ({ productId, data }: { productId: string; data: Omit<InsertProductVariant, "productId"> }) => {
      return await apiRequest("POST", `/api/products/${productId}/variants`, data);
    },
    onSuccess: async () => {
      toast({
        title: "Variant Added",
        description: "The product variant has been added successfully.",
      });
      // Invalidate and wait for refetch to complete
      await queryClient.invalidateQueries({ queryKey: ["/api/all-variants"] });
      // Close the add variant dialog
      setIsAddVariantDialogOpen(false);
      // Reset form
      variantForm.reset({
        name: "",
        description: "",
        basePricePerSqft: 0,
        isDefault: false,
        displayOrder: 0,
        isActive: true,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateVariantMutation = useMutation({
    mutationFn: async ({ productId, id, data }: { productId: string; id: string; data: Omit<InsertProductVariant, "productId"> }) => {
      return await apiRequest("PATCH", `/api/products/${productId}/variants/${id}`, data);
    },
    onSuccess: async (updatedVariant, variables) => {
      toast({
        title: "Variant Updated",
        description: "The product variant has been updated successfully.",
      });

      // Invalidate to show updated variant immediately
      await queryClient.invalidateQueries({ queryKey: ["/api/all-variants"] });

      // Close the variant edit dialog
      setEditingVariant(null);
      editVariantForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteVariantMutation = useMutation({
    mutationFn: async ({ productId, id }: { productId: string; id: string }) => {
      return await apiRequest("DELETE", `/api/products/${productId}/variants/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Variant Deleted",
        description: "The product variant has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/all-variants"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { data: globalVariables, isLoading: variablesLoading } = useQuery<GlobalVariable[]>({
    queryKey: ["/api/global-variables"],
  });

  const addVariableMutation = useMutation({
    mutationFn: async (data: InsertGlobalVariable) => {
      return await apiRequest("POST", "/api/global-variables", data);
    },
    onSuccess: () => {
      toast({
        title: "Variable Added",
        description: "The global variable has been added successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] });
      setIsAddVariableDialogOpen(false);
      variableForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateVariableMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: InsertGlobalVariable }) => {
      return await apiRequest("PATCH", `/api/global-variables/${id}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Variable Updated",
        description: "The global variable has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] });
      setEditingVariable(null);
      editVariableForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteVariableMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/global-variables/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Variable Deleted",
        description: "The global variable has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/global-variables"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product);
    // Reset dialog states when opening a product
    setIsAddVariantDialogOpen(false);
    setIsAddOptionDialogOpen(false);
    editProductForm.reset({
      name: product.name,
      description: product.description,
      category: product.category || "",
      pricingFormula: product.pricingFormula,
      storeUrl: product.storeUrl || "",
      showStoreLink: product.showStoreLink,
      useNestingCalculator: product.useNestingCalculator || false,
      sheetWidth: product.sheetWidth ? parseFloat(product.sheetWidth as any) : null,
      sheetHeight: product.sheetHeight ? parseFloat(product.sheetHeight as any) : null,
      materialType: product.materialType || "sheet",
      minPricePerItem: product.minPricePerItem ? parseFloat(product.minPricePerItem as any) : null,
      nestingVolumePricing: product.nestingVolumePricing || { enabled: false, tiers: [] },
      isActive: product.isActive,
    });
  };

  const handleEditVariant = (variant: ProductVariant, productId: string) => {
    setEditingVariant({ ...variant, productId } as any);
    editVariantForm.reset({
      name: variant.name,
      description: variant.description || "",
      basePricePerSqft: Number(variant.basePricePerSqft),
      volumePricing: variant.volumePricing || { enabled: false, tiers: [] },
      isDefault: variant.isDefault,
      displayOrder: variant.displayOrder,
      isActive: variant.isActive,
    });
  };

  const handleCloneVariant = (variant: ProductVariant, productId: string) => {
    // Get the highest display order from existing variants
    const existingVariants = allVariants?.find(pv => pv.productId === productId)?.variants || [];
    const maxDisplayOrder = existingVariants.length > 0
      ? Math.max(...existingVariants.map(v => v.displayOrder))
      : 0;

    // Pre-fill the add variant form with cloned data
    variantForm.reset({
      name: `${variant.name} (Copy)`,
      description: variant.description || "",
      basePricePerSqft: Number(variant.basePricePerSqft),
      volumePricing: variant.volumePricing || { enabled: false, tiers: [] },
      isDefault: false, // Don't clone the default status
      displayOrder: maxDisplayOrder + 1,
      isActive: variant.isActive,
    });

    // Open the add variant dialog
    setIsAddVariantDialogOpen(true);
  };

  const handleEditVariable = (variable: GlobalVariable) => {
    setEditingVariable(variable);
    editVariableForm.reset({
      name: variable.name,
      value: variable.value,
      description: variable.description || "",
      category: variable.category || "",
      isActive: variable.isActive,
    });
  };

  const handleEditFormulaTemplate = (template: FormulaTemplate) => {
    setEditingFormulaTemplate(template);
    editFormulaTemplateForm.reset({
      name: template.name,
      description: template.description || "",
      formula: template.formula,
      category: template.category || "",
      isActive: template.isActive,
    });
  };

  const addFormulaTemplateMutation = useMutation({
    mutationFn: async (data: InsertFormulaTemplate) => {
      console.log("[DEBUG] Creating formula template:", data);
      const result = await apiRequest("POST", "/api/formula-templates", data);
      console.log("[DEBUG] Formula template created:", result);
      return result;
    },
    onSuccess: (data) => {
      console.log("[DEBUG] onSuccess called with:", data);
      toast({
        title: "Formula Template Added",
        description: "The formula template has been added successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/formula-templates"] });
      setIsAddFormulaTemplateDialogOpen(false);
      formulaTemplateForm.reset();
    },
    onError: (error: Error) => {
      console.error("[DEBUG] Error creating formula template:", error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateFormulaTemplateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: InsertFormulaTemplate }) => {
      return await apiRequest("PATCH", `/api/formula-templates/${id}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Formula Template Updated",
        description: "The formula template has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/formula-templates"] });
      setEditingFormulaTemplate(null);
      editFormulaTemplateForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteFormulaTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/formula-templates/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Formula Template Deleted",
        description: "The formula template has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/formula-templates"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const filteredVariables = globalVariables
    ?.filter((variable) => variable.name !== 'next_quote_number') // Exclude quote numbering system
    ?.filter((variable) =>
      variable.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      variable.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      variable.category?.toLowerCase().includes(searchTerm.toLowerCase())
    );

  if (productsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Integrations Card - only show in Dashboard context, not in Settings pages */}
      {!hideTabs && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LinkIcon className="w-5 h-5" />
            Integrations
          </CardTitle>
          <CardDescription>
            Connect external services like QuickBooks Online
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/settings/integrations">
            <Button variant="outline" className="w-full">
              <LinkIcon className="w-4 h-4 mr-2" />
              Manage Integrations
            </Button>
          </Link>
        </CardContent>
      </Card>
      )}

      <Card data-testid="card-admin-settings">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="w-5 h-5" />
            Admin Configuration
          </CardTitle>
          <CardDescription>
            Manage products, pricing formulas, and system settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={defaultTab} data-testid="tabs-admin-settings">
            {!hideTabs && (
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="products" data-testid="tab-products">Products</TabsTrigger>
              <TabsTrigger value="media" data-testid="tab-media">Media Library</TabsTrigger>
              <TabsTrigger value="variables" data-testid="tab-variables">Pricing Variables</TabsTrigger>
              <TabsTrigger value="formulas" data-testid="tab-formulas">Formula Templates</TabsTrigger>
              <TabsTrigger value="email" data-testid="tab-email">Email Settings</TabsTrigger>
              <TabsTrigger value="workflow" data-testid="tab-workflow">Workflow</TabsTrigger>
            </TabsList>
            )}

            <TabsContent value="products" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Product Types</CardTitle>
                  <CardDescription>
                    Manage product categories (Roll, Sheet, Digital Print, etc.)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Link href="/settings/product-types">
                    <Button variant="outline" className="w-full">
                      <SettingsIcon className="w-4 h-4 mr-2" />
                      Manage Product Types
                    </Button>
                  </Link>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Import Products from CSV</CardTitle>
                  <CardDescription>
                    Bulk import products with variants and options using a CSV file
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={handleDownloadTemplate}
                      data-testid="button-download-csv-template"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download Template
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleExportProducts}
                      data-testid="button-export-csv"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Export CSV
                    </Button>
                    <div className="flex-1 flex gap-2">
                      <Input
                        type="file"
                        accept=".csv"
                        onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                        data-testid="input-csv-file"
                      />
                      <Button
                        onClick={handleCsvUpload}
                        disabled={!csvFile || importProductsMutation.isPending}
                        data-testid="button-upload-csv"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        {importProductsMutation.isPending ? "Importing..." : "Import CSV"}
                      </Button>
                    </div>
                  </div>
                  {csvFile && (
                    <p className="text-sm text-muted-foreground" data-testid="text-selected-file">
                      Selected file: {csvFile.name}
                    </p>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Product Management</h3>
                <div className="flex gap-2">
                  <div className="flex border rounded-md">
                    <Button
                      variant={viewMode === "table" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setViewMode("table")}
                      className="rounded-r-none"
                      data-testid="button-view-table"
                    >
                      <LayoutList className="w-4 h-4" />
                    </Button>
                    <Button
                      variant={viewMode === "grid" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setViewMode("grid")}
                      className="rounded-l-none"
                      data-testid="button-view-grid"
                    >
                      <LayoutGrid className="w-4 h-4" />
                    </Button>
                  </div>

                  <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                    <DialogTrigger asChild>
                      <Button data-testid="button-add-product">
                        <Plus className="w-4 h-4 mr-2" />
                        Add Product
                      </Button>
                    </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-add-product">
                    <DialogHeader>
                      <DialogTitle>Add New Product</DialogTitle>
                      <DialogDescription>
                        Create a new product with pricing formula
                      </DialogDescription>
                    </DialogHeader>
                    <Form {...addProductForm}>
                      <form onSubmit={addProductForm.handleSubmit((data) => {
                        const cleanData: any = {};
                        Object.entries(data).forEach(([k, v]) => {
                          // Convert empty strings to null, preserve null/undefined to let backend handle defaults
                          cleanData[k] = v === '' ? null : v;
                        });
                        addProductMutation.mutate(cleanData);
                      })} className="space-y-4">
                        <FormField
                          control={addProductForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-product-name">Product Name</FormLabel>
                              <FormControl>
                                <Input placeholder="Business Cards" {...field} data-testid="input-product-name" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-product-description">Description</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Professional business cards with custom designs..."
                                  {...field}
                                  data-testid="textarea-product-description"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="category"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-product-category">Category (Optional)</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="flatbed, adhesive backed, paper, misc"
                                  {...field}
                                  value={field.value || ""}
                                  data-testid="input-product-category"
                                />
                              </FormControl>
                              <FormDescription>
                                Product category for filtering (e.g., flatbed, adhesive backed, paper, misc)
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="productTypeId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Product Type</FormLabel>
                              <Select
                                value={field.value || undefined}
                                onValueChange={field.onChange}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select product type" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {productTypes?.map((type: any) => (
                                    <SelectItem key={type.id} value={type.id}>
                                      {type.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormDescription>
                                Categorize this product (e.g., Roll, Sheet, Digital Print)
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="space-y-2">
                          <Label>Formula Template (Optional)</Label>
                          <Select
                            onValueChange={(value) => {
                              if (value) {
                                const template = formulaTemplates?.find(t => t.id === value);
                                if (template) {
                                  addProductForm.setValue("pricingFormula", template.formula);
                                }
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select a formula template..." />
                            </SelectTrigger>
                            <SelectContent>
                              {formulaTemplates && formulaTemplates.length > 0 ? (
                                formulaTemplates.map((template) => (
                                  <SelectItem key={template.id} value={template.id}>
                                    <div className="flex flex-col">
                                      <span className="font-medium">{template.name}</span>
                                      {template.description && (
                                        <span className="text-xs text-muted-foreground">{template.description}</span>
                                      )}
                                    </div>
                                  </SelectItem>
                                ))
                              ) : (
                                <SelectItem value="none" disabled>No templates available</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            Select a template to auto-fill the formula below, or write your own
                          </p>
                        </div>
                        {!addProductForm.watch("useNestingCalculator") && (
                          <FormField
                            control={addProductForm.control}
                            name="pricingFormula"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel data-testid="label-product-formula">Pricing Formula</FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="sqft * p * q"
                                    {...field}
                                    value={field.value || ""}
                                    data-testid="input-product-formula"
                                  />
                                </FormControl>
                                <FormDescription>
                                  Use: w (width), h (height), q (quantity), sqft, p (price/sqft). Example: sqft * p * q
                                </FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                        <FormField
                          control={addProductForm.control}
                          name="variantLabel"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-product-variant-label">Variant Label (Optional)</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Material, Size, Type, etc. (default: Variant)"
                                  {...field}
                                  value={field.value || ""}
                                  data-testid="input-product-variant-label"
                                />
                              </FormControl>
                              <FormDescription>
                                Customize how variants are labeled (e.g., "Material", "Size", "Type")
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Nesting Calculator Section */}
                        <div className="space-y-4 border-t pt-4">
                          <FormField
                            control={addProductForm.control}
                            name="useNestingCalculator"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                <div className="space-y-0.5">
                                  <FormLabel className="text-base">Use Nesting Calculator</FormLabel>
                                  <FormDescription>
                                    Calculate optimal piece nesting on sheets instead of using formulas
                                  </FormDescription>
                                </div>
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />

                          {addProductForm.watch("useNestingCalculator") && (
                            <>
                              <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-800">
                                <strong>⚠️ Required:</strong> Enter sheet dimensions below to use the nesting calculator. The pricing formula is not needed when nesting calculator is enabled.
                              </div>
                              <FormField
                                control={addProductForm.control}
                                name="materialType"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Material Type</FormLabel>
                                    <Select
                                      onValueChange={field.onChange}
                                      defaultValue={field.value || undefined}
                                    >
                                      <FormControl>
                                        <SelectTrigger>
                                          <SelectValue placeholder="Select material type" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        <SelectItem value="sheet">Sheet (e.g., foam board, coroplast)</SelectItem>
                                        <SelectItem value="roll">Roll (e.g., vinyl)</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <FormDescription>
                                      Sheet materials use 2D nesting, rolls optimize for width only
                                    </FormDescription>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <div className="grid grid-cols-2 gap-4">
                                <FormField
                                  control={addProductForm.control}
                                  name="sheetWidth"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>
                                        {addProductForm.watch("materialType") === "roll" ? "Roll Width" : "Sheet Width"} (inches)
                                      </FormLabel>
                                      <FormControl>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          placeholder={addProductForm.watch("materialType") === "roll" ? "Enter roll width" : "Enter sheet width"}
                                          {...field}
                                          value={field.value ?? ""}
                                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />

                                <FormField
                                  control={addProductForm.control}
                                  name="sheetHeight"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>
                                        {addProductForm.watch("materialType") === "roll" ? "Roll Length" : "Sheet Height"} (inches)
                                      </FormLabel>
                                      <FormControl>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          placeholder={addProductForm.watch("materialType") === "roll" ? "Enter roll length" : "Enter sheet height"}
                                          {...field}
                                          value={field.value ?? ""}
                                          onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                                        />
                                      </FormControl>
                                      <FormDescription>
                                        {addProductForm.watch("materialType") === "roll"
                                          ? "For 150' roll, enter 1800 inches"
                                          : "Example: 96 for 48×96 sheet"}
                                      </FormDescription>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>

                              <FormField
                                control={addProductForm.control}
                                name="minPricePerItem"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Minimum Price Per Item (Optional)</FormLabel>
                                    <FormControl>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        placeholder="10.00"
                                        {...field}
                                        value={field.value ?? ""}
                                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                                      />
                                    </FormControl>
                                    <FormDescription>
                                      Ensures each piece meets a minimum price threshold
                                    </FormDescription>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <div className="space-y-4 rounded-md border p-4">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <h4 className="text-sm font-medium">Volume Pricing Tiers</h4>
                                    <p className="text-sm text-muted-foreground">
                                      Set different prices per sheet based on quantity
                                    </p>
                                  </div>
                                  <FormField
                                    control={addProductForm.control}
                                    name="nestingVolumePricing.enabled"
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormControl>
                                          <Switch
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                          />
                                        </FormControl>
                                      </FormItem>
                                    )}
                                  />
                                </div>

                                {addProductForm.watch("nestingVolumePricing.enabled") && (
                                  <div className="space-y-3">
                                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                                      {addProductForm.watch("nestingVolumePricing.tiers")?.map((tier: any, index: number) => (
                                        <div key={index} className="flex items-center gap-2 p-2 border rounded">
                                          <div className="flex-1 grid grid-cols-3 gap-2">
                                            <div>
                                              <label className="text-xs text-muted-foreground">Min Sheets</label>
                                              <Input
                                                type="number"
                                                value={tier.minSheets}
                                                onChange={(e) => {
                                                  const tiers = [...(addProductForm.watch("nestingVolumePricing.tiers") || [])];
                                                  tiers[index] = { ...tiers[index], minSheets: parseInt(e.target.value) || 0 };
                                                  addProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                                }}
                                                className="h-8"
                                              />
                                            </div>
                                            <div>
                                              <label className="text-xs text-muted-foreground">Max Sheets (optional)</label>
                                              <Input
                                                type="number"
                                                value={tier.maxSheets || ""}
                                                onChange={(e) => {
                                                  const tiers = [...(addProductForm.watch("nestingVolumePricing.tiers") || [])];
                                                  tiers[index] = { ...tiers[index], maxSheets: e.target.value ? parseInt(e.target.value) : undefined };
                                                  addProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                                }}
                                                placeholder="No limit"
                                                className="h-8"
                                              />
                                            </div>
                                            <div>
                                              <label className="text-xs text-muted-foreground">Price Per Sheet</label>
                                              <Input
                                                type="number"
                                                step="0.01"
                                                value={tier.pricePerSheet}
                                                onChange={(e) => {
                                                  const tiers = [...(addProductForm.watch("nestingVolumePricing.tiers") || [])];
                                                  tiers[index] = { ...tiers[index], pricePerSheet: parseFloat(e.target.value) || 0 };
                                                  addProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                                }}
                                                className="h-8"
                                              />
                                            </div>
                                          </div>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            onClick={() => {
                                              const tiers = [...(addProductForm.watch("nestingVolumePricing.tiers") || [])];
                                              tiers.splice(index, 1);
                                              addProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                            }}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </div>
                                      ))}
                                    </div>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        const tiers = [...(addProductForm.watch("nestingVolumePricing.tiers") || [])];
                                        const lastTier = tiers.length > 0 ? tiers[tiers.length - 1] : null;
                                        const minSheets = (lastTier && typeof lastTier.maxSheets === 'number') ? lastTier.maxSheets + 1 : 1;
                                        tiers.push({ minSheets, pricePerSheet: 0 });
                                        addProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                      }}
                                    >
                                      <Plus className="h-4 w-4 mr-1" />
                                      Add Tier
                                    </Button>
                                    <p className="text-xs text-muted-foreground">
                                      Example: 1-4 sheets @ $18, 5-9 sheets @ $16, 10+ sheets @ $14
                                    </p>
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>

                        <FormField
                          control={addProductForm.control}
                          name="storeUrl"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-product-url">Store URL (Optional)</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="https://example.com/business-cards"
                                  {...field}
                                  value={field.value || ""}
                                  data-testid="input-product-url"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="showStoreLink"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                              <div className="space-y-0.5">
                                <FormLabel className="text-base" data-testid="label-show-store-link">
                                  Show Store Link
                                </FormLabel>
                                <FormDescription>
                                  Display "View in Store" button in calculator
                                </FormDescription>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  data-testid="switch-show-store-link"
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="thumbnailUrls"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-product-thumbnails">
                                Product Thumbnails (Optional)
                              </FormLabel>
                              <div className="space-y-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => {
                                    setMediaPickerMode("add");
                                    setIsMediaPickerOpen(true);
                                  }}
                                  data-testid="button-select-from-library"
                                >
                                  <LayoutGrid className="w-4 h-4 mr-2" />
                                  Select from Library
                                </Button>
                                <FormControl>
                                  <ObjectUploader
                                    value={field.value ?? []}
                                    onChange={field.onChange}
                                    maxFiles={5}
                                    allowedFileTypes={["image/*"]}
                                  />
                                </FormControl>
                              </div>
                              <FormDescription>
                                Upload up to 5 product images or select from your media library. Drag to reorder.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={addProductForm.control}
                          name="isActive"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                              <div className="space-y-0.5">
                                <FormLabel className="text-base" data-testid="label-product-active">
                                  Active
                                </FormLabel>
                                <FormDescription>
                                  Product will be available in the calculator
                                </FormDescription>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  data-testid="switch-product-active"
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <DialogFooter>
                          <Button
                            type="submit"
                            disabled={addProductMutation.isPending}
                            data-testid="button-submit-add-product"
                          >
                            {addProductMutation.isPending ? "Adding..." : "Add Product"}
                          </Button>
                        </DialogFooter>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>

                <MediaPicker
                  value={addProductForm.watch("thumbnailUrls") ?? []}
                  onChange={(urls) => addProductForm.setValue("thumbnailUrls", urls)}
                  open={isMediaPickerOpen && mediaPickerMode === "add"}
                  onOpenChange={setIsMediaPickerOpen}
                />
              </div>
            </div>

            {viewMode === "table" ? (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead data-testid="header-name">Name</TableHead>
                      <TableHead data-testid="header-description">Description</TableHead>
                      <TableHead data-testid="header-formula">Formula</TableHead>
                      <TableHead data-testid="header-status">Status</TableHead>
                      <TableHead data-testid="header-actions" className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products && products.length > 0 ? (
                      products.map((product) => (
                        <TableRow key={product.id} data-testid={`row-product-${product.id}`}>
                          <TableCell className="font-medium" data-testid={`cell-name-${product.id}`}>
                            {product.name}
                          </TableCell>
                          <TableCell className="max-w-xs truncate" data-testid={`cell-description-${product.id}`}>
                            {product.description}
                          </TableCell>
                          <TableCell className="font-mono text-sm" data-testid={`cell-formula-${product.id}`}>
                            {product.pricingFormula}
                          </TableCell>
                          <TableCell data-testid={`cell-status-${product.id}`}>
                            {product.isActive ? (
                              <span className="text-green-600 dark:text-green-400">Active</span>
                            ) : (
                              <span className="text-muted-foreground">Inactive</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Dialog
                                open={editingProduct?.id === product.id}
                                onOpenChange={(open) => {
                                  if (!open) {
                                    setEditingProduct(null);
                                    setIsAddVariantDialogOpen(false);
                                    setIsAddOptionDialogOpen(false);
                                  }
                                }}
                              >
                                <DialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => handleEditProduct(product)}
                                    data-testid={`button-edit-${product.id}`}
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid={`dialog-edit-${product.id}`}>
                                  <DialogHeader>
                                    <DialogTitle>Edit Product</DialogTitle>
                                    <DialogDescription>
                                      Update product details and pricing formula
                                    </DialogDescription>
                                  </DialogHeader>
                                  <Form {...editProductForm}>
                                    <form
                                      onSubmit={editProductForm.handleSubmit(() => {
                                        // Get all form values, not just dirty fields
                                        const data = editProductForm.getValues();
                                        const cleanData: any = {};
                                        Object.entries(data).forEach(([k, v]) => {
                                          // Convert empty strings to null, preserve null/undefined to let backend handle defaults
                                          cleanData[k] = v === '' ? null : v;
                                        });
                                        updateProductMutation.mutate({ id: product.id, data: cleanData });
                                      })}
                                      className="space-y-4"
                                    >
                                      <FormField
                                        control={editProductForm.control}
                                        name="name"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Product Name</FormLabel>
                                            <FormControl>
                                              <Input {...field} data-testid={`input-edit-name-${product.id}`} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="description"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Description</FormLabel>
                                            <FormControl>
                                              <Textarea {...field} data-testid={`textarea-edit-description-${product.id}`} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="category"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Category (Optional)</FormLabel>
                                            <FormControl>
                                              <Input 
                                                {...field} 
                                                value={field.value || ""} 
                                                placeholder="flatbed, adhesive backed, paper, misc"
                                                data-testid={`input-edit-category-${product.id}`} 
                                              />
                                            </FormControl>
                                            <FormDescription>
                                              Product category for filtering
                                            </FormDescription>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="productTypeId"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Product Type</FormLabel>
                                            <Select
                                              value={field.value || undefined}
                                              onValueChange={field.onChange}
                                            >
                                              <FormControl>
                                                <SelectTrigger>
                                                  <SelectValue placeholder="Select product type" />
                                                </SelectTrigger>
                                              </FormControl>
                                              <SelectContent>
                                                {productTypes?.map((type: any) => (
                                                  <SelectItem key={type.id} value={type.id}>
                                                    {type.name}
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                            <FormDescription>
                                              Categorize this product (e.g., Roll, Sheet, Digital Print)
                                            </FormDescription>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <div className="space-y-2">
                                        <Label>Formula Template (Optional)</Label>
                                        <Select
                                          onValueChange={(value) => {
                                            if (value) {
                                              const template = formulaTemplates?.find(t => t.id === value);
                                              if (template) {
                                                editProductForm.setValue("pricingFormula", template.formula);
                                              }
                                            }
                                          }}
                                        >
                                          <SelectTrigger>
                                            <SelectValue placeholder="Select a formula template..." />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {formulaTemplates && formulaTemplates.length > 0 ? (
                                              formulaTemplates.map((template) => (
                                                <SelectItem key={template.id} value={template.id}>
                                                  <div className="flex flex-col">
                                                    <span className="font-medium">{template.name}</span>
                                                    {template.description && (
                                                      <span className="text-xs text-muted-foreground">{template.description}</span>
                                                    )}
                                                  </div>
                                                </SelectItem>
                                              ))
                                            ) : (
                                              <SelectItem value="none" disabled>No templates available</SelectItem>
                                            )}
                                          </SelectContent>
                                        </Select>
                                        <p className="text-xs text-muted-foreground">
                                          Select a template to auto-fill the formula below
                                        </p>
                                      </div>
                                      {!editProductForm.watch("useNestingCalculator") && (
                                        <FormField
                                          control={editProductForm.control}
                                          name="pricingFormula"
                                          render={({ field }) => (
                                            <FormItem>
                                              <FormLabel>Pricing Formula</FormLabel>
                                              <FormControl>
                                                <Input {...field} value={field.value || ""} data-testid={`input-edit-formula-${product.id}`} />
                                              </FormControl>
                                              <FormDescription>
                                                Use: w (width), h (height), q (quantity), sqft, p (price/sqft)
                                              </FormDescription>
                                              <FormMessage />
                                            </FormItem>
                                          )}
                                        />
                                      )}
                                      <FormField
                                        control={editProductForm.control}
                                        name="variantLabel"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Variant Label (Optional)</FormLabel>
                                            <FormControl>
                                              <Input 
                                                {...field} 
                                                value={field.value || ""} 
                                                placeholder="Material, Size, Type, etc. (default: Variant)"
                                                data-testid={`input-edit-variant-label-${product.id}`} 
                                              />
                                            </FormControl>
                                            <FormDescription>
                                              Customize how variants are labeled
                                            </FormDescription>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />

                                      {/* Nesting Calculator Section */}
                                      <div className="space-y-4 border-t pt-4">
                                        <FormField
                                          control={editProductForm.control}
                                          name="useNestingCalculator"
                                          render={({ field }) => (
                                            <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                              <div className="space-y-0.5">
                                                <FormLabel className="text-base">Use Nesting Calculator</FormLabel>
                                                <FormDescription>
                                                  Calculate optimal piece nesting on sheets instead of using formulas
                                                </FormDescription>
                                              </div>
                                              <FormControl>
                                                <Switch
                                                  checked={field.value}
                                                  onCheckedChange={field.onChange}
                                                />
                                              </FormControl>
                                            </FormItem>
                                          )}
                                        />

                                        {editProductForm.watch("useNestingCalculator") && (
                                          <>
                                            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-800">
                                              <strong>⚠️ Required:</strong> Enter sheet dimensions below to use the nesting calculator. The pricing formula is not needed when nesting calculator is enabled.
                                            </div>
                                            <FormField
                                              control={editProductForm.control}
                                              name="materialType"
                                              render={({ field }) => (
                                                <FormItem>
                                                  <FormLabel>Material Type</FormLabel>
                                                  <Select
                                                    onValueChange={field.onChange}
                                                    value={field.value || undefined}
                                                  >
                                                    <FormControl>
                                                      <SelectTrigger>
                                                        <SelectValue placeholder="Select material type" />
                                                      </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                      <SelectItem value="sheet">Sheet (e.g., foam board, coroplast)</SelectItem>
                                                      <SelectItem value="roll">Roll (e.g., vinyl)</SelectItem>
                                                    </SelectContent>
                                                  </Select>
                                                  <FormDescription>
                                                    Sheet materials use 2D nesting, rolls optimize for width only
                                                  </FormDescription>
                                                  <FormMessage />
                                                </FormItem>
                                              )}
                                            />

                                            <div className="grid grid-cols-2 gap-4">
                                              <FormField
                                                control={editProductForm.control}
                                                name="sheetWidth"
                                                render={({ field }) => (
                                                  <FormItem>
                                                    <FormLabel>
                                                      {editProductForm.watch("materialType") === "roll" ? "Roll Width" : "Sheet Width"} (inches)
                                                    </FormLabel>
                                                    <FormControl>
                                                      <Input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder={editProductForm.watch("materialType") === "roll" ? "Enter roll width" : "Enter sheet width"}
                                                        {...field}
                                                        value={field.value ?? ""}
                                                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                                                      />
                                                    </FormControl>
                                                    <FormMessage />
                                                  </FormItem>
                                                )}
                                              />

                                              <FormField
                                                control={editProductForm.control}
                                                name="sheetHeight"
                                                render={({ field }) => (
                                                  <FormItem>
                                                    <FormLabel>
                                                      {editProductForm.watch("materialType") === "roll" ? "Roll Length" : "Sheet Height"} (inches)
                                                    </FormLabel>
                                                    <FormControl>
                                                      <Input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder={editProductForm.watch("materialType") === "roll" ? "Enter roll length" : "Enter sheet height"}
                                                        {...field}
                                                        value={field.value ?? ""}
                                                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                                                      />
                                                    </FormControl>
                                                    <FormDescription>
                                                      {editProductForm.watch("materialType") === "roll"
                                                        ? "For 150' roll, enter 1800 inches"
                                                        : "Example: 96 for 48×96 sheet"}
                                                    </FormDescription>
                                                    <FormMessage />
                                                  </FormItem>
                                                )}
                                              />
                                            </div>

                                            <FormField
                                              control={editProductForm.control}
                                              name="minPricePerItem"
                                              render={({ field }) => (
                                                <FormItem>
                                                  <FormLabel>Minimum Price Per Item (Optional)</FormLabel>
                                                  <FormControl>
                                                    <Input
                                                      type="number"
                                                      step="0.01"
                                                      placeholder="10.00"
                                                      {...field}
                                                      value={field.value ?? ""}
                                                      onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)}
                                                    />
                                                  </FormControl>
                                                  <FormDescription>
                                                    Ensures each piece meets a minimum price threshold
                                                  </FormDescription>
                                                  <FormMessage />
                                                </FormItem>
                                              )}
                                            />

                                            <div className="space-y-4 rounded-md border p-4">
                                              <div className="flex items-center justify-between">
                                                <div>
                                                  <h4 className="text-sm font-medium">Volume Pricing Tiers</h4>
                                                  <p className="text-sm text-muted-foreground">
                                                    Set different prices per sheet based on quantity
                                                  </p>
                                                </div>
                                                <FormField
                                                  control={editProductForm.control}
                                                  name="nestingVolumePricing.enabled"
                                                  render={({ field }) => (
                                                    <FormItem>
                                                      <FormControl>
                                                        <Switch
                                                          checked={field.value}
                                                          onCheckedChange={field.onChange}
                                                        />
                                                      </FormControl>
                                                    </FormItem>
                                                  )}
                                                />
                                              </div>

                                              {editProductForm.watch("nestingVolumePricing.enabled") && (
                                                <div className="space-y-3">
                                                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                                                    {editProductForm.watch("nestingVolumePricing.tiers")?.map((tier: any, index: number) => (
                                                      <div key={index} className="flex items-center gap-2 p-2 border rounded">
                                                        <div className="flex-1 grid grid-cols-3 gap-2">
                                                          <div>
                                                            <label className="text-xs text-muted-foreground">Min Sheets</label>
                                                            <Input
                                                              type="number"
                                                              value={tier.minSheets}
                                                              onChange={(e) => {
                                                                const tiers = [...(editProductForm.watch("nestingVolumePricing.tiers") || [])];
                                                                tiers[index] = { ...tiers[index], minSheets: parseInt(e.target.value) || 0 };
                                                                editProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                                              }}
                                                              className="h-8"
                                                            />
                                                          </div>
                                                          <div>
                                                            <label className="text-xs text-muted-foreground">Max Sheets (optional)</label>
                                                            <Input
                                                              type="number"
                                                              value={tier.maxSheets || ""}
                                                              onChange={(e) => {
                                                                const tiers = [...(editProductForm.watch("nestingVolumePricing.tiers") || [])];
                                                                tiers[index] = { ...tiers[index], maxSheets: e.target.value ? parseInt(e.target.value) : undefined };
                                                                editProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                                              }}
                                                              placeholder="No limit"
                                                              className="h-8"
                                                            />
                                                          </div>
                                                          <div>
                                                            <label className="text-xs text-muted-foreground">Price Per Sheet</label>
                                                            <Input
                                                              type="number"
                                                              step="0.01"
                                                              value={tier.pricePerSheet}
                                                              onChange={(e) => {
                                                                const tiers = [...(editProductForm.watch("nestingVolumePricing.tiers") || [])];
                                                                tiers[index] = { ...tiers[index], pricePerSheet: parseFloat(e.target.value) || 0 };
                                                                editProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                                              }}
                                                              className="h-8"
                                                            />
                                                          </div>
                                                        </div>
                                                        <Button
                                                          type="button"
                                                          variant="ghost"
                                                          size="icon"
                                                          className="h-8 w-8"
                                                          onClick={() => {
                                                            const tiers = [...(editProductForm.watch("nestingVolumePricing.tiers") || [])];
                                                            tiers.splice(index, 1);
                                                            editProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                                          }}
                                                        >
                                                          <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                      </div>
                                                    ))}
                                                  </div>
                                                  <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                      const tiers = [...(editProductForm.watch("nestingVolumePricing.tiers") || [])];
                                                      const lastTier = tiers.length > 0 ? tiers[tiers.length - 1] : null;
                                                      const minSheets = (lastTier && typeof lastTier.maxSheets === 'number') ? lastTier.maxSheets + 1 : 1;
                                                      tiers.push({ minSheets, pricePerSheet: 0 });
                                                      editProductForm.setValue("nestingVolumePricing.tiers", tiers);
                                                    }}
                                                  >
                                                    <Plus className="h-4 w-4 mr-1" />
                                                    Add Tier
                                                  </Button>
                                                  <p className="text-xs text-muted-foreground">
                                                    Example: 1-4 sheets @ $18, 5-9 sheets @ $16, 10+ sheets @ $14
                                                  </p>
                                                </div>
                                              )}
                                            </div>
                                          </>
                                        )}
                                      </div>

                                      <FormField
                                        control={editProductForm.control}
                                        name="storeUrl"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Store URL (Optional)</FormLabel>
                                            <FormControl>
                                              <Input {...field} value={field.value || ""} data-testid={`input-edit-url-${product.id}`} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="showStoreLink"
                                        render={({ field }) => (
                                          <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                            <div className="space-y-0.5">
                                              <FormLabel className="text-base">Show Store Link</FormLabel>
                                              <FormDescription>
                                                Display "View in Store" button in calculator
                                              </FormDescription>
                                            </div>
                                            <FormControl>
                                              <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                                data-testid={`switch-edit-show-store-link-${product.id}`}
                                              />
                                            </FormControl>
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="thumbnailUrls"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel data-testid={`label-edit-thumbnails-${product.id}`}>
                                              Product Thumbnails (Optional)
                                            </FormLabel>
                                            <div className="space-y-2">
                                              <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => {
                                                  setMediaPickerMode("edit");
                                                  setIsMediaPickerOpen(true);
                                                }}
                                                data-testid={`button-select-from-library-edit-${product.id}`}
                                              >
                                                <LayoutGrid className="w-4 h-4 mr-2" />
                                                Select from Library
                                              </Button>
                                              <FormControl>
                                                <ObjectUploader
                                                  value={field.value || []}
                                                  onChange={field.onChange}
                                                  maxFiles={5}
                                                  allowedFileTypes={["image/*"]}
                                                />
                                              </FormControl>
                                            </div>
                                            <FormDescription>
                                              Upload up to 5 product images or select from your media library. Drag to reorder.
                                            </FormDescription>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editProductForm.control}
                                        name="isActive"
                                        render={({ field }) => (
                                          <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                            <div className="space-y-0.5">
                                              <FormLabel className="text-base">Active</FormLabel>
                                              <FormDescription>
                                                Product will be available in the calculator
                                              </FormDescription>
                                            </div>
                                            <FormControl>
                                              <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                                data-testid={`switch-edit-active-${product.id}`}
                                              />
                                            </FormControl>
                                          </FormItem>
                                        )}
                                      />

                                      {/* Product Variants Section */}
                                      <div className="space-y-4 border-t pt-4 mt-4">
                                        <div className="flex items-center justify-between">
                                          <div>
                                            <h3 className="text-lg font-semibold">
                                              {product.variantLabel ?? "Variant"}s
                                            </h3>
                                            <p className="text-sm text-muted-foreground">
                                              Manage different {(product.variantLabel ?? "variant").toLowerCase()} options for this product
                                            </p>
                                          </div>
                                          <Dialog open={isAddVariantDialogOpen} onOpenChange={setIsAddVariantDialogOpen}>
                                            <DialogTrigger asChild>
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                  variantForm.reset({
                                                    name: "",
                                                    description: "",
                                                    basePricePerSqft: 0,
                                                    isDefault: false,
                                                    displayOrder: 0,
                                                    isActive: true,
                                                  });
                                                }}
                                                data-testid={`button-add-variant-${product.id}`}
                                              >
                                                <Plus className="w-4 h-4 mr-2" />
                                                Add {product.variantLabel ?? "Variant"}
                                              </Button>
                                            </DialogTrigger>
                                            <DialogContent className="max-w-2xl" data-testid="dialog-add-variant-inline">
                                              <DialogHeader>
                                                <DialogTitle>Add {product.variantLabel ?? "Variant"}</DialogTitle>
                                                <DialogDescription>
                                                  Create a new {(product.variantLabel || "variant").toLowerCase()} option for {product.name}
                                                </DialogDescription>
                                              </DialogHeader>
                                              <Form {...variantForm}>
                                                <form onSubmit={variantForm.handleSubmit((data) => addVariantMutation.mutate({ productId: product.id, data }))} className="space-y-4">
                                                  <FormField
                                                    control={variantForm.control}
                                                    name="name"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>{product.variantLabel ?? "Variant"} Name</FormLabel>
                                                        <FormControl>
                                                          <Input placeholder="13oz Vinyl" {...field} data-testid="input-variant-name-inline" />
                                                        </FormControl>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <FormField
                                                    control={variantForm.control}
                                                    name="description"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>Description (Optional)</FormLabel>
                                                        <FormControl>
                                                          <Textarea
                                                            placeholder="Standard vinyl banner material"
                                                            {...field}
                                                            value={field.value || ""}
                                                            data-testid="textarea-variant-description-inline"
                                                          />
                                                        </FormControl>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <FormField
                                                    control={variantForm.control}
                                                    name="basePricePerSqft"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>Base Price per Square Foot</FormLabel>
                                                        <FormControl>
                                                          <Input
                                                            type="number"
                                                            step="0.0001"
                                                            {...field}
                                                            onChange={(e) => field.onChange(Number(e.target.value))}
                                                            data-testid="input-variant-price-inline"
                                                          />
                                                        </FormControl>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <FormField
                                                    control={variantForm.control}
                                                    name="isDefault"
                                                    render={({ field }) => (
                                                      <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                                        <div className="space-y-0.5">
                                                          <FormLabel className="text-base">Is Default {product.variantLabel ?? "Variant"}</FormLabel>
                                                          <FormDescription>
                                                            This {(product.variantLabel || "variant").toLowerCase()} will be pre-selected in the calculator
                                                          </FormDescription>
                                                        </div>
                                                        <FormControl>
                                                          <Switch
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                            data-testid="checkbox-variant-default-inline"
                                                          />
                                                        </FormControl>
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <FormField
                                                    control={variantForm.control}
                                                    name="displayOrder"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>Display Order</FormLabel>
                                                        <FormControl>
                                                          <Input
                                                            type="number"
                                                            {...field}
                                                            onChange={(e) => field.onChange(Number(e.target.value))}
                                                            data-testid="input-variant-order-inline"
                                                          />
                                                        </FormControl>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />

                                                  {/* Volume Pricing for Nesting Calculator Products */}
                                                  {product.useNestingCalculator && (
                                                    <div className="space-y-4 rounded-md border p-4">
                                                      <div className="flex items-center justify-between">
                                                        <div>
                                                          <h4 className="text-sm font-medium">Volume Pricing Tiers</h4>
                                                          <p className="text-sm text-muted-foreground">
                                                            Set different prices per sheet based on quantity
                                                          </p>
                                                        </div>
                                                        <FormField
                                                          control={variantForm.control}
                                                          name="volumePricing.enabled"
                                                          render={({ field }) => (
                                                            <FormItem>
                                                              <FormControl>
                                                                <Switch
                                                                  checked={field.value}
                                                                  onCheckedChange={field.onChange}
                                                                />
                                                              </FormControl>
                                                            </FormItem>
                                                          )}
                                                        />
                                                      </div>

                                                      {variantForm.watch("volumePricing.enabled") && (
                                                        <div className="space-y-3">
                                                          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                                                            {variantForm.watch("volumePricing.tiers")?.map((tier: any, index: number) => (
                                                              <div key={index} className="flex items-center gap-2 p-2 border rounded">
                                                                <div className="flex-1 grid grid-cols-3 gap-2">
                                                                  <div>
                                                                    <label className="text-xs text-muted-foreground">Min Sheets</label>
                                                                    <Input
                                                                      type="number"
                                                                      value={tier.minSheets}
                                                                      onChange={(e) => {
                                                                        const tiers = [...(variantForm.watch("volumePricing.tiers") || [])];
                                                                        tiers[index] = { ...tiers[index], minSheets: parseInt(e.target.value) || 0 };
                                                                        variantForm.setValue("volumePricing.tiers", tiers);
                                                                      }}
                                                                      className="h-8"
                                                                    />
                                                                  </div>
                                                                  <div>
                                                                    <label className="text-xs text-muted-foreground">Max Sheets (optional)</label>
                                                                    <Input
                                                                      type="number"
                                                                      value={tier.maxSheets || ""}
                                                                      onChange={(e) => {
                                                                        const tiers = [...(variantForm.watch("volumePricing.tiers") || [])];
                                                                        tiers[index] = { ...tiers[index], maxSheets: e.target.value ? parseInt(e.target.value) : undefined };
                                                                        variantForm.setValue("volumePricing.tiers", tiers);
                                                                      }}
                                                                      placeholder="No limit"
                                                                      className="h-8"
                                                                    />
                                                                  </div>
                                                                  <div>
                                                                    <label className="text-xs text-muted-foreground">Price Per Sheet</label>
                                                                    <Input
                                                                      type="number"
                                                                      step="0.01"
                                                                      value={tier.pricePerSheet}
                                                                      onChange={(e) => {
                                                                        const tiers = [...(variantForm.watch("volumePricing.tiers") || [])];
                                                                        tiers[index] = { ...tiers[index], pricePerSheet: parseFloat(e.target.value) || 0 };
                                                                        variantForm.setValue("volumePricing.tiers", tiers);
                                                                      }}
                                                                      className="h-8"
                                                                    />
                                                                  </div>
                                                                </div>
                                                                <Button
                                                                  type="button"
                                                                  variant="ghost"
                                                                  size="icon"
                                                                  className="h-8 w-8"
                                                                  onClick={() => {
                                                                    const tiers = [...(variantForm.watch("volumePricing.tiers") || [])];
                                                                    tiers.splice(index, 1);
                                                                    variantForm.setValue("volumePricing.tiers", tiers);
                                                                  }}
                                                                >
                                                                  <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                              </div>
                                                            ))}
                                                          </div>
                                                          <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => {
                                                              const tiers = [...(variantForm.watch("volumePricing.tiers") || [])];
                                                              const lastTier = tiers.length > 0 ? tiers[tiers.length - 1] : null;
                                                              const minSheets = (lastTier && typeof lastTier.maxSheets === 'number') ? lastTier.maxSheets + 1 : 1;
                                                              tiers.push({ minSheets, pricePerSheet: 0 });
                                                              variantForm.setValue("volumePricing.tiers", tiers);
                                                            }}
                                                          >
                                                            <Plus className="h-4 w-4 mr-1" />
                                                            Add Tier
                                                          </Button>
                                                          <p className="text-xs text-muted-foreground">
                                                            Example: 1-9 sheets @ $70, 10+ sheets @ $60
                                                          </p>
                                                        </div>
                                                      )}
                                                    </div>
                                                  )}

                                                  <DialogFooter>
                                                    <Button
                                                      type="submit"
                                                      disabled={addVariantMutation.isPending}
                                                      data-testid="button-submit-add-variant-inline"
                                                    >
                                                      {addVariantMutation.isPending ? "Adding..." : `Add ${product.variantLabel ?? "Variant"}`}
                                                    </Button>
                                                  </DialogFooter>
                                                </form>
                                              </Form>
                                            </DialogContent>
                                          </Dialog>
                                        </div>

                                        {/* Variants List */}
                                        <div className="space-y-2">
                                          {allVariants?.find(pv => pv.productId === product.id)?.variants.length ? (
                                            allVariants
                                              .find(pv => pv.productId === product.id)
                                              ?.variants.sort((a, b) => a.displayOrder - b.displayOrder)
                                              .map((variant) => (
                                                <Card key={variant.id} data-testid={`card-variant-${variant.id}`}>
                                                  <CardContent className="p-4">
                                                    <div className="flex items-start justify-between gap-4">
                                                      <div className="flex-1 space-y-2">
                                                        <div className="flex items-center gap-2">
                                                          <h4 className="font-semibold" data-testid={`text-variant-name-${variant.id}`}>
                                                            {variant.name}
                                                          </h4>
                                                          {variant.isDefault && (
                                                            <Badge variant="default" data-testid={`badge-default-variant-${variant.id}`}>Default</Badge>
                                                          )}
                                                          {!variant.isActive && (
                                                            <Badge variant="secondary">Inactive</Badge>
                                                          )}
                                                        </div>
                                                        {variant.description && (
                                                          <p className="text-sm text-muted-foreground" data-testid={`text-variant-description-${variant.id}`}>
                                                            {variant.description}
                                                          </p>
                                                        )}
                                                        <div className="text-sm font-mono" data-testid={`text-variant-price-${variant.id}`}>
                                                          Base Price: ${Number(variant.basePricePerSqft).toFixed(4)}/sqft
                                                        </div>
                                                      </div>
                                                      <div className="flex gap-2">
                                                        <Dialog
                                                          open={editingVariant?.id === variant.id}
                                                          onOpenChange={(open) => !open && setEditingVariant(null)}
                                                        >
                                                          <DialogTrigger asChild>
                                                            <Button
                                                              variant="outline"
                                                              size="icon"
                                                              onClick={() => handleEditVariant(variant, product.id)}
                                                              data-testid={`button-edit-variant-inline-${variant.id}`}
                                                            >
                                                              <Edit className="w-4 h-4" />
                                                            </Button>
                                                          </DialogTrigger>
                                                          <DialogContent className="max-w-2xl" data-testid={`dialog-edit-variant-inline-${variant.id}`}>
                                                            <DialogHeader>
                                                              <DialogTitle>Edit {product.variantLabel ?? "Variant"}</DialogTitle>
                                                              <DialogDescription>
                                                                Update {(product.variantLabel || "variant").toLowerCase()} details
                                                              </DialogDescription>
                                                            </DialogHeader>
                                                            <Form {...editVariantForm}>
                                                              <form onSubmit={(e) => {
                                                                e.stopPropagation();
                                                                editVariantForm.handleSubmit((data) => updateVariantMutation.mutate({ productId: product.id, id: variant.id, data }))(e);
                                                              }} className="space-y-4">
                                                                <FormField
                                                                  control={editVariantForm.control}
                                                                  name="name"
                                                                  render={({ field }) => (
                                                                    <FormItem>
                                                                      <FormLabel>{product.variantLabel ?? "Variant"} Name</FormLabel>
                                                                      <FormControl>
                                                                        <Input {...field} data-testid={`input-edit-variant-name-${variant.id}`} />
                                                                      </FormControl>
                                                                      <FormMessage />
                                                                    </FormItem>
                                                                  )}
                                                                />
                                                                <FormField
                                                                  control={editVariantForm.control}
                                                                  name="description"
                                                                  render={({ field }) => (
                                                                    <FormItem>
                                                                      <FormLabel>Description (Optional)</FormLabel>
                                                                      <FormControl>
                                                                        <Textarea {...field} value={field.value || ""} data-testid={`textarea-edit-variant-description-${variant.id}`} />
                                                                      </FormControl>
                                                                      <FormMessage />
                                                                    </FormItem>
                                                                  )}
                                                                />
                                                                <FormField
                                                                  control={editVariantForm.control}
                                                                  name="basePricePerSqft"
                                                                  render={({ field }) => (
                                                                    <FormItem>
                                                                      <FormLabel>Base Price per Square Foot</FormLabel>
                                                                      <FormControl>
                                                                        <Input
                                                                          type="number"
                                                                          step="0.0001"
                                                                          {...field}
                                                                          onChange={(e) => field.onChange(Number(e.target.value))}
                                                                          data-testid={`input-edit-variant-price-${variant.id}`}
                                                                        />
                                                                      </FormControl>
                                                                      <FormMessage />
                                                                    </FormItem>
                                                                  )}
                                                                />
                                                                <FormField
                                                                  control={editVariantForm.control}
                                                                  name="isDefault"
                                                                  render={({ field }) => (
                                                                    <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                                                      <div className="space-y-0.5">
                                                                        <FormLabel className="text-base">Is Default {product.variantLabel ?? "Variant"}</FormLabel>
                                                                        <FormDescription>
                                                                          This {(product.variantLabel || "variant").toLowerCase()} will be pre-selected
                                                                        </FormDescription>
                                                                      </div>
                                                                      <FormControl>
                                                                        <Switch
                                                                          checked={field.value}
                                                                          onCheckedChange={field.onChange}
                                                                          data-testid={`checkbox-edit-variant-default-${variant.id}`}
                                                                        />
                                                                      </FormControl>
                                                                    </FormItem>
                                                                  )}
                                                                />
                                                                <FormField
                                                                  control={editVariantForm.control}
                                                                  name="displayOrder"
                                                                  render={({ field }) => (
                                                                    <FormItem>
                                                                      <FormLabel>Display Order</FormLabel>
                                                                      <FormControl>
                                                                        <Input
                                                                          type="number"
                                                                          {...field}
                                                                          onChange={(e) => field.onChange(Number(e.target.value))}
                                                                          data-testid={`input-edit-variant-order-${variant.id}`}
                                                                        />
                                                                      </FormControl>
                                                                      <FormMessage />
                                                                    </FormItem>
                                                                  )}
                                                                />

                                                                {/* Volume Pricing for Nesting Calculator Products */}
                                                                {product.useNestingCalculator && (
                                                                  <div className="space-y-4 rounded-md border p-4">
                                                                    <div className="flex items-center justify-between">
                                                                      <div>
                                                                        <h4 className="text-sm font-medium">Volume Pricing Tiers</h4>
                                                                        <p className="text-sm text-muted-foreground">
                                                                          Set different prices per sheet based on quantity
                                                                        </p>
                                                                      </div>
                                                                      <FormField
                                                                        control={editVariantForm.control}
                                                                        name="volumePricing.enabled"
                                                                        render={({ field }) => (
                                                                          <FormItem>
                                                                            <FormControl>
                                                                              <Switch
                                                                                checked={field.value}
                                                                                onCheckedChange={field.onChange}
                                                                              />
                                                                            </FormControl>
                                                                          </FormItem>
                                                                        )}
                                                                      />
                                                                    </div>

                                                                    {editVariantForm.watch("volumePricing.enabled") && (
                                                                      <div className="space-y-3">
                                                                        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                                                                          {editVariantForm.watch("volumePricing.tiers")?.map((tier: any, index: number) => (
                                                                            <div key={index} className="flex items-center gap-2 p-2 border rounded">
                                                                              <div className="flex-1 grid grid-cols-3 gap-2">
                                                                                <div>
                                                                                  <label className="text-xs text-muted-foreground">Min Sheets</label>
                                                                                  <Input
                                                                                    type="number"
                                                                                    value={tier.minSheets}
                                                                                    onChange={(e) => {
                                                                                      const tiers = [...(editVariantForm.watch("volumePricing.tiers") || [])];
                                                                                      tiers[index] = { ...tiers[index], minSheets: parseInt(e.target.value) || 0 };
                                                                                      editVariantForm.setValue("volumePricing.tiers", tiers);
                                                                                    }}
                                                                                    className="h-8"
                                                                                  />
                                                                                </div>
                                                                                <div>
                                                                                  <label className="text-xs text-muted-foreground">Max Sheets (optional)</label>
                                                                                  <Input
                                                                                    type="number"
                                                                                    value={tier.maxSheets || ""}
                                                                                    onChange={(e) => {
                                                                                      const tiers = [...(editVariantForm.watch("volumePricing.tiers") || [])];
                                                                                      tiers[index] = { ...tiers[index], maxSheets: e.target.value ? parseInt(e.target.value) : undefined };
                                                                                      editVariantForm.setValue("volumePricing.tiers", tiers);
                                                                                    }}
                                                                                    placeholder="No limit"
                                                                                    className="h-8"
                                                                                  />
                                                                                </div>
                                                                                <div>
                                                                                  <label className="text-xs text-muted-foreground">Price Per Sheet</label>
                                                                                  <Input
                                                                                    type="number"
                                                                                    step="0.01"
                                                                                    value={tier.pricePerSheet}
                                                                                    onChange={(e) => {
                                                                                      const tiers = [...(editVariantForm.watch("volumePricing.tiers") || [])];
                                                                                      tiers[index] = { ...tiers[index], pricePerSheet: parseFloat(e.target.value) || 0 };
                                                                                      editVariantForm.setValue("volumePricing.tiers", tiers);
                                                                                    }}
                                                                                    className="h-8"
                                                                                  />
                                                                                </div>
                                                                              </div>
                                                                              <Button
                                                                                type="button"
                                                                                variant="ghost"
                                                                                size="icon"
                                                                                className="h-8 w-8"
                                                                                onClick={() => {
                                                                                  const tiers = [...(editVariantForm.watch("volumePricing.tiers") || [])];
                                                                                  tiers.splice(index, 1);
                                                                                  editVariantForm.setValue("volumePricing.tiers", tiers);
                                                                                }}
                                                                              >
                                                                                <Trash2 className="h-4 w-4" />
                                                                              </Button>
                                                                            </div>
                                                                          ))}
                                                                        </div>
                                                                        <Button
                                                                          type="button"
                                                                          variant="outline"
                                                                          size="sm"
                                                                          onClick={() => {
                                                                            const tiers = [...(editVariantForm.watch("volumePricing.tiers") || [])];
                                                                            const lastTier = tiers.length > 0 ? tiers[tiers.length - 1] : null;
                                                                            const minSheets = (lastTier && typeof lastTier.maxSheets === 'number') ? lastTier.maxSheets + 1 : 1;
                                                                            tiers.push({ minSheets, pricePerSheet: 0 });
                                                                            editVariantForm.setValue("volumePricing.tiers", tiers);
                                                                          }}
                                                                        >
                                                                          <Plus className="h-4 w-4 mr-1" />
                                                                          Add Tier
                                                                        </Button>
                                                                        <p className="text-xs text-muted-foreground">
                                                                          Example: 1-9 sheets @ $70, 10+ sheets @ $60
                                                                        </p>
                                                                      </div>
                                                                    )}
                                                                  </div>
                                                                )}

                                                                <DialogFooter>
                                                                  <Button
                                                                    type="submit"
                                                                    disabled={updateVariantMutation.isPending}
                                                                    data-testid={`button-submit-edit-variant-${variant.id}`}
                                                                  >
                                                                    {updateVariantMutation.isPending ? "Updating..." : `Update ${product.variantLabel ?? "Variant"}`}
                                                                  </Button>
                                                                </DialogFooter>
                                                              </form>
                                                            </Form>
                                                          </DialogContent>
                                                        </Dialog>
                                                        <Button
                                                          type="button"
                                                          variant="outline"
                                                          size="icon"
                                                          onClick={() => handleCloneVariant(variant, product.id)}
                                                          data-testid={`button-clone-variant-${variant.id}`}
                                                          title="Clone variant"
                                                        >
                                                          <Copy className="w-4 h-4" />
                                                        </Button>
                                                        <AlertDialog>
                                                          <AlertDialogTrigger asChild>
                                                            <Button
                                                              variant="outline"
                                                              size="icon"
                                                              data-testid={`button-delete-variant-inline-${variant.id}`}
                                                            >
                                                              <Trash2 className="w-4 h-4" />
                                                            </Button>
                                                          </AlertDialogTrigger>
                                                          <AlertDialogContent data-testid={`dialog-delete-variant-${variant.id}`}>
                                                            <AlertDialogHeader>
                                                              <AlertDialogTitle>Delete {product.variantLabel ?? "Variant"}?</AlertDialogTitle>
                                                              <AlertDialogDescription>
                                                                This will permanently delete "{variant.name}".
                                                              </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                              <AlertDialogCancel data-testid={`button-cancel-delete-variant-${variant.id}`}>
                                                                Cancel
                                                              </AlertDialogCancel>
                                                              <AlertDialogAction
                                                                onClick={() => deleteVariantMutation.mutate({ productId: product.id, id: variant.id })}
                                                                data-testid={`button-confirm-delete-variant-${variant.id}`}
                                                              >
                                                                Delete
                                                              </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                          </AlertDialogContent>
                                                        </AlertDialog>
                                                      </div>
                                                    </div>
                                                  </CardContent>
                                                </Card>
                                              ))
                                          ) : (
                                            <div className="text-center py-8 text-muted-foreground">
                                              No {(product.variantLabel || "variant").toLowerCase()}s configured yet
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      {/* Product Options Section */}
                                      <div className="space-y-4 border-t pt-4 mt-4">
                                        <div className="flex items-center justify-between">
                                          <div>
                                            <h3 className="text-lg font-semibold">Product Options</h3>
                                            <p className="text-sm text-muted-foreground">
                                              Configure add-on options with custom pricing formulas
                                            </p>
                                          </div>
                                          <Dialog 
                                            open={isAddOptionDialogOpen} 
                                            onOpenChange={(open) => {
                                              setIsAddOptionDialogOpen(open);
                                              if (!open) {
                                                setEditingOption(null);
                                                optionForm.reset({
                                                  name: "",
                                                  description: "",
                                                  type: "toggle",
                                                  defaultValue: "false",
                                                  isDefaultEnabled: false,
                                                  setupCost: 0,
                                                  priceFormula: "0",
                                                  parentOptionId: null,
                                                  displayOrder: 0,
                                                  isActive: true,
                                                });
                                              }
                                            }}
                                          >
                                            <DialogTrigger asChild>
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                  setEditingOption(null);
                                                  optionForm.reset({
                                                    name: "",
                                                    description: "",
                                                    type: "toggle",
                                                    defaultValue: "false",
                                                    isDefaultEnabled: false,
                                                    setupCost: 0,
                                                    priceFormula: "0",
                                                    parentOptionId: null,
                                                    displayOrder: 0,
                                                    isActive: true,
                                                  });
                                                }}
                                                data-testid={`button-add-option-${product.id}`}
                                              >
                                                <Plus className="w-4 h-4 mr-2" />
                                                Add Option
                                              </Button>
                                            </DialogTrigger>
                                            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid={`dialog-add-option-${product.id}`}>
                                              <DialogHeader>
                                                <DialogTitle>{editingOption ? "Edit Option" : "Add Option"}</DialogTitle>
                                                <DialogDescription>
                                                  Configure option details and pricing formula
                                                </DialogDescription>
                                              </DialogHeader>
                                              <Form {...optionForm}>
                                                <form
                                                  onSubmit={(e) => {
                                                    e.stopPropagation();
                                                    optionForm.handleSubmit((data) => {
                                                      if (editingOption) {
                                                        updateOptionMutation.mutate({ id: editingOption.id, data });
                                                      } else {
                                                        addOptionMutation.mutate(data);
                                                      }
                                                    })(e);
                                                  }}
                                                  className="space-y-4"
                                                >
                                                  <div className="grid grid-cols-2 gap-4">
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="name"
                                                      render={({ field }) => (
                                                        <FormItem>
                                                          <FormLabel>Option Name</FormLabel>
                                                          <FormControl>
                                                            <Input placeholder="Pole Pocket" {...field} data-testid="input-option-name" />
                                                          </FormControl>
                                                          <FormMessage />
                                                        </FormItem>
                                                      )}
                                                    />
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="type"
                                                      render={({ field }) => (
                                                        <FormItem>
                                                          <FormLabel>Type</FormLabel>
                                                          <Select onValueChange={field.onChange} value={field.value}>
                                                            <FormControl>
                                                              <SelectTrigger data-testid="select-option-type">
                                                                <SelectValue />
                                                              </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                              <SelectItem value="toggle">Toggle</SelectItem>
                                                              <SelectItem value="number">Number</SelectItem>
                                                              <SelectItem value="select">Select</SelectItem>
                                                            </SelectContent>
                                                          </Select>
                                                          <FormMessage />
                                                        </FormItem>
                                                      )}
                                                    />
                                                  </div>
                                                  <FormField
                                                    control={optionForm.control}
                                                    name="description"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>Description</FormLabel>
                                                        <FormControl>
                                                          <Textarea
                                                            placeholder="Add a pole pocket for hanging..."
                                                            {...field}
                                                            value={field.value || ""}
                                                            data-testid="textarea-option-description"
                                                          />
                                                        </FormControl>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <FormField
                                                    control={optionForm.control}
                                                    name="defaultValue"
                                                    render={({ field }) => {
                                                      const optionType = optionForm.watch("type");
                                                      
                                                      if (optionType === "select") {
                                                        return (
                                                          <FormItem className="col-span-2">
                                                            <FormLabel>Dropdown Choices</FormLabel>
                                                            <FormControl>
                                                              <SelectChoicesInput
                                                                value={field.value || ""}
                                                                onChange={field.onChange}
                                                              />
                                                            </FormControl>
                                                            <FormDescription className="text-xs">
                                                              Add dropdown choices for users to select from
                                                            </FormDescription>
                                                            <FormMessage />
                                                          </FormItem>
                                                        );
                                                      }
                                                      
                                                      return (
                                                        <FormItem>
                                                          <FormLabel>Default Value</FormLabel>
                                                          <FormControl>
                                                            <Input
                                                              placeholder={optionType === "toggle" ? "false" : "0"}
                                                              {...field}
                                                              value={field.value || ""}
                                                              data-testid="input-option-default-value"
                                                            />
                                                          </FormControl>
                                                          <FormDescription className="text-xs">
                                                            {optionType === "toggle" ? "Use 'true' or 'false'" : "Default numeric value"}
                                                          </FormDescription>
                                                          <FormMessage />
                                                        </FormItem>
                                                      );
                                                    }}
                                                  />
                                                  {optionForm.watch("type") === "select" && (
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="defaultSelection"
                                                      render={({ field }) => {
                                                        const choices = (optionForm.watch("defaultValue") || "")
                                                          .split(",")
                                                          .map(s => s.trim())
                                                          .filter(Boolean);
                                                        
                                                        return (
                                                          <FormItem>
                                                            <FormLabel>Default Selection</FormLabel>
                                                            <Select
                                                              onValueChange={(value) => {
                                                                field.onChange(value === "__none__" ? "" : value);
                                                              }}
                                                              value={field.value || "__none__"}
                                                            >
                                                              <FormControl>
                                                                <SelectTrigger data-testid="select-default-selection">
                                                                  <SelectValue placeholder="Select default choice (optional)" />
                                                                </SelectTrigger>
                                                              </FormControl>
                                                              <SelectContent>
                                                                {choices.length === 0 ? (
                                                                  <SelectItem value="__disabled__" disabled>
                                                                    Add choices first
                                                                  </SelectItem>
                                                                ) : (
                                                                  <>
                                                                    <SelectItem value="__none__">None (user must select)</SelectItem>
                                                                    {choices.map((choice) => (
                                                                      <SelectItem key={choice} value={choice}>
                                                                        {choice}
                                                                      </SelectItem>
                                                                    ))}
                                                                  </>
                                                                )}
                                                              </SelectContent>
                                                            </Select>
                                                            <FormDescription className="text-xs">
                                                              Which option should be selected by default
                                                            </FormDescription>
                                                            <FormMessage />
                                                          </FormItem>
                                                        );
                                                      }}
                                                    />
                                                  )}
                                                  <div className="grid grid-cols-2 gap-4">
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="setupCost"
                                                      render={({ field }) => (
                                                        <FormItem>
                                                          <FormLabel>Setup Cost ($)</FormLabel>
                                                          <FormControl>
                                                            <Input
                                                              type="number"
                                                              step="0.01"
                                                              placeholder="0.00"
                                                              {...field}
                                                              onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                                              data-testid="input-option-setup-cost"
                                                            />
                                                          </FormControl>
                                                          <FormMessage />
                                                        </FormItem>
                                                      )}
                                                    />
                                                  </div>
                                                  <FormField
                                                    control={optionForm.control}
                                                    name="priceFormula"
                                                    render={({ field }) => (
                                                      <FormItem>
                                                        <FormLabel>Price Formula</FormLabel>
                                                        <FormControl>
                                                          <Input
                                                            placeholder="width * 0.5"
                                                            className="font-mono"
                                                            {...field}
                                                            value={field.value || ""}
                                                            data-testid="input-option-formula"
                                                          />
                                                        </FormControl>
                                                        <FormDescription className="text-xs">
                                                          JavaScript expression. Available: w, h, q, sqft, setupCost
                                                        </FormDescription>
                                                        <FormMessage />
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <div className="grid grid-cols-2 gap-4">
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="parentOptionId"
                                                      render={({ field }) => (
                                                        <FormItem>
                                                          <FormLabel>Parent Option (Optional)</FormLabel>
                                                          <Select
                                                            onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                                                            value={field.value || "none"}
                                                          >
                                                            <FormControl>
                                                              <SelectTrigger data-testid="select-option-parent">
                                                                <SelectValue placeholder="None (Top-level)" />
                                                              </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                              <SelectItem value="none">None (Top-level)</SelectItem>
                                                              {productOptions
                                                                ?.filter((opt) => !opt.parentOptionId && opt.id !== editingOption?.id)
                                                                .map((opt) => (
                                                                  <SelectItem key={opt.id} value={opt.id}>
                                                                    {opt.name}
                                                                  </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                          </Select>
                                                          <FormMessage />
                                                        </FormItem>
                                                      )}
                                                    />
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="displayOrder"
                                                      render={({ field }) => (
                                                        <FormItem>
                                                          <FormLabel>Display Order</FormLabel>
                                                          <FormControl>
                                                            <Input
                                                              type="number"
                                                              {...field}
                                                              onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                                                              data-testid="input-option-order"
                                                            />
                                                          </FormControl>
                                                          <FormMessage />
                                                        </FormItem>
                                                      )}
                                                    />
                                                  </div>
                                                  {optionForm.watch("type") === "toggle" && (
                                                    <FormField
                                                      control={optionForm.control}
                                                      name="isDefaultEnabled"
                                                      render={({ field }) => (
                                                        <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                                          <div className="space-y-0.5">
                                                            <FormLabel className="text-base">Default On</FormLabel>
                                                            <FormDescription>
                                                              Toggle will be enabled by default
                                                            </FormDescription>
                                                          </div>
                                                          <FormControl>
                                                            <Switch
                                                              checked={field.value}
                                                              onCheckedChange={field.onChange}
                                                              data-testid="switch-option-is-default"
                                                            />
                                                          </FormControl>
                                                        </FormItem>
                                                      )}
                                                    />
                                                  )}
                                                  <FormField
                                                    control={optionForm.control}
                                                    name="isActive"
                                                    render={({ field }) => (
                                                      <FormItem className="flex flex-row items-center justify-between rounded-md border p-4">
                                                        <div className="space-y-0.5">
                                                          <FormLabel className="text-base">Active</FormLabel>
                                                          <FormDescription>
                                                            Option will be available in the calculator
                                                          </FormDescription>
                                                        </div>
                                                        <FormControl>
                                                          <Switch
                                                            checked={field.value}
                                                            onCheckedChange={field.onChange}
                                                            data-testid="switch-option-active"
                                                          />
                                                        </FormControl>
                                                      </FormItem>
                                                    )}
                                                  />
                                                  <DialogFooter>
                                                    <Button
                                                      type="submit"
                                                      disabled={addOptionMutation.isPending || updateOptionMutation.isPending}
                                                      data-testid="button-submit-option"
                                                    >
                                                      {addOptionMutation.isPending || updateOptionMutation.isPending
                                                        ? editingOption ? "Updating..." : "Adding..."
                                                        : editingOption ? "Update Option" : "Add Option"}
                                                    </Button>
                                                  </DialogFooter>
                                                </form>
                                              </Form>
                                            </DialogContent>
                                          </Dialog>
                                        </div>

                                        {/* Options List */}
                                        <div className="space-y-2">
                                          {productOptions && productOptions.length > 0 ? (
                                            productOptions
                                              .filter((opt) => !opt.parentOptionId)
                                              .sort((a, b) => a.displayOrder - b.displayOrder)
                                              .map((parentOpt) => (
                                                <div key={parentOpt.id} className="space-y-2">
                                                  <Card data-testid={`card-option-${parentOpt.id}`}>
                                                    <CardContent className="p-4">
                                                      <div className="flex items-start justify-between gap-4">
                                                        <div className="flex-1 space-y-2">
                                                          <div className="flex items-center gap-2">
                                                            <h4 className="font-semibold" data-testid={`text-option-name-${parentOpt.id}`}>
                                                              {parentOpt.name}
                                                            </h4>
                                                            <Badge variant="outline" data-testid={`badge-option-type-${parentOpt.id}`}>
                                                              {parentOpt.type}
                                                            </Badge>
                                                            {!parentOpt.isActive && (
                                                              <Badge variant="secondary">Inactive</Badge>
                                                            )}
                                                          </div>
                                                          {parentOpt.description && (
                                                            <p className="text-sm text-muted-foreground" data-testid={`text-option-description-${parentOpt.id}`}>
                                                              {parentOpt.description}
                                                            </p>
                                                          )}
                                                          <div className="flex gap-4 text-xs text-muted-foreground">
                                                            {parseFloat(parentOpt.setupCost.toString()) > 0 && (
                                                              <span data-testid={`text-option-setup-${parentOpt.id}`}>
                                                                Setup: ${parentOpt.setupCost}
                                                              </span>
                                                            )}
                                                            <span className="font-mono" data-testid={`text-option-formula-${parentOpt.id}`}>
                                                              Formula: {parentOpt.priceFormula}
                                                            </span>
                                                          </div>
                                                        </div>
                                                        <div className="flex gap-2">
                                                          <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="icon"
                                                            onClick={() => {
                                                              setEditingOption(parentOpt);
                                                              optionForm.reset({
                                                                name: parentOpt.name,
                                                                description: parentOpt.description || "",
                                                                type: parentOpt.type,
                                                                defaultValue: parentOpt.defaultValue || "",
                                                                isDefaultEnabled: parentOpt.isDefaultEnabled,
                                                                setupCost: parseFloat(parentOpt.setupCost.toString()),
                                                                priceFormula: parentOpt.priceFormula || "0",
                                                                parentOptionId: parentOpt.parentOptionId,
                                                                displayOrder: parentOpt.displayOrder,
                                                                isActive: parentOpt.isActive,
                                                              });
                                                              setIsAddOptionDialogOpen(true);
                                                            }}
                                                            data-testid={`button-edit-option-${parentOpt.id}`}
                                                          >
                                                            <Edit className="w-4 h-4" />
                                                          </Button>
                                                          <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                              <Button
                                                                variant="outline"
                                                                size="icon"
                                                                data-testid={`button-delete-option-${parentOpt.id}`}
                                                              >
                                                                <Trash2 className="w-4 h-4" />
                                                              </Button>
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent data-testid={`dialog-delete-option-${parentOpt.id}`}>
                                                              <AlertDialogHeader>
                                                                <AlertDialogTitle>Delete Option?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                  This will permanently delete "{parentOpt.name}" and all its child options.
                                                                </AlertDialogDescription>
                                                              </AlertDialogHeader>
                                                              <AlertDialogFooter>
                                                                <AlertDialogCancel data-testid={`button-cancel-delete-option-${parentOpt.id}`}>
                                                                  Cancel
                                                                </AlertDialogCancel>
                                                                <AlertDialogAction
                                                                  onClick={() => deleteOptionMutation.mutate(parentOpt.id)}
                                                                  data-testid={`button-confirm-delete-option-${parentOpt.id}`}
                                                                >
                                                                  Delete
                                                                </AlertDialogAction>
                                                              </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                          </AlertDialog>
                                                        </div>
                                                      </div>
                                                    </CardContent>
                                                  </Card>

                                                  {/* Child Options */}
                                                  {productOptions
                                                    .filter((opt) => opt.parentOptionId === parentOpt.id)
                                                    .sort((a, b) => a.displayOrder - b.displayOrder)
                                                    .map((childOpt) => (
                                                      <Card
                                                        key={childOpt.id}
                                                        className="ml-6 border-l-4"
                                                        data-testid={`card-option-${childOpt.id}`}
                                                      >
                                                        <CardContent className="p-4">
                                                          <div className="flex items-start justify-between gap-4">
                                                            <div className="flex-1 space-y-2">
                                                              <div className="flex items-center gap-2">
                                                                <h4 className="font-semibold" data-testid={`text-option-name-${childOpt.id}`}>
                                                                  {childOpt.name}
                                                                </h4>
                                                                <Badge variant="outline" data-testid={`badge-option-type-${childOpt.id}`}>
                                                                  {childOpt.type}
                                                                </Badge>
                                                                {!childOpt.isActive && (
                                                                  <Badge variant="secondary">Inactive</Badge>
                                                                )}
                                                              </div>
                                                              {childOpt.description && (
                                                                <p className="text-sm text-muted-foreground" data-testid={`text-option-description-${childOpt.id}`}>
                                                                  {childOpt.description}
                                                                </p>
                                                              )}
                                                              <div className="flex gap-4 text-xs text-muted-foreground">
                                                                {parseFloat(childOpt.setupCost.toString()) > 0 && (
                                                                  <span data-testid={`text-option-setup-${childOpt.id}`}>
                                                                    Setup: ${childOpt.setupCost}
                                                                  </span>
                                                                )}
                                                                <span className="font-mono" data-testid={`text-option-formula-${childOpt.id}`}>
                                                                  Formula: {childOpt.priceFormula}
                                                                </span>
                                                              </div>
                                                            </div>
                                                            <div className="flex gap-2">
                                                              <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="icon"
                                                                onClick={() => {
                                                                  setEditingOption(childOpt);
                                                                  optionForm.reset({
                                                                    name: childOpt.name,
                                                                    description: childOpt.description || "",
                                                                    type: childOpt.type,
                                                                    defaultValue: childOpt.defaultValue || "",
                                                                    isDefaultEnabled: childOpt.isDefaultEnabled,
                                                                    setupCost: parseFloat(childOpt.setupCost.toString()),
                                                                    priceFormula: childOpt.priceFormula || "0",
                                                                    parentOptionId: childOpt.parentOptionId,
                                                                    displayOrder: childOpt.displayOrder,
                                                                    isActive: childOpt.isActive,
                                                                  });
                                                                  setIsAddOptionDialogOpen(true);
                                                                }}
                                                                data-testid={`button-edit-option-${childOpt.id}`}
                                                              >
                                                                <Edit className="w-4 h-4" />
                                                              </Button>
                                                              <AlertDialog>
                                                                <AlertDialogTrigger asChild>
                                                                  <Button
                                                                    variant="outline"
                                                                    size="icon"
                                                                    data-testid={`button-delete-option-${childOpt.id}`}
                                                                  >
                                                                    <Trash2 className="w-4 h-4" />
                                                                  </Button>
                                                                </AlertDialogTrigger>
                                                                <AlertDialogContent data-testid={`dialog-delete-option-${childOpt.id}`}>
                                                                  <AlertDialogHeader>
                                                                    <AlertDialogTitle>Delete Option?</AlertDialogTitle>
                                                                    <AlertDialogDescription>
                                                                      This will permanently delete "{childOpt.name}".
                                                                    </AlertDialogDescription>
                                                                  </AlertDialogHeader>
                                                                  <AlertDialogFooter>
                                                                    <AlertDialogCancel data-testid={`button-cancel-delete-option-${childOpt.id}`}>
                                                                      Cancel
                                                                    </AlertDialogCancel>
                                                                    <AlertDialogAction
                                                                      onClick={() => deleteOptionMutation.mutate(childOpt.id)}
                                                                      data-testid={`button-confirm-delete-option-${childOpt.id}`}
                                                                    >
                                                                      Delete
                                                                    </AlertDialogAction>
                                                                  </AlertDialogFooter>
                                                                </AlertDialogContent>
                                                              </AlertDialog>
                                                            </div>
                                                          </div>
                                                        </CardContent>
                                                      </Card>
                                                    ))}
                                                </div>
                                              ))
                                          ) : (
                                            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-options">
                                              No options configured yet. Click "Add Option" to get started.
                                            </p>
                                          )}
                                        </div>
                                      </div>

                                      <DialogFooter>
                                        <Button
                                          type="submit"
                                          disabled={updateProductMutation.isPending}
                                          data-testid={`button-submit-edit-${product.id}`}
                                        >
                                          {updateProductMutation.isPending ? "Updating..." : "Update Product"}
                                        </Button>
                                      </DialogFooter>
                                    </form>
                                  </Form>
                                </DialogContent>
                              </Dialog>

                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => cloneProductMutation.mutate(product.id)}
                                disabled={cloneProductMutation.isPending}
                                data-testid={`button-clone-${product.id}`}
                              >
                                <Copy className="w-4 h-4" />
                              </Button>

                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    data-testid={`button-delete-${product.id}`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent data-testid={`dialog-delete-${product.id}`}>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Product?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will permanently delete "{product.name}". This action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel data-testid={`button-cancel-delete-${product.id}`}>
                                      Cancel
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deleteProductMutation.mutate(product.id)}
                                      data-testid={`button-confirm-delete-${product.id}`}
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No products yet. Add your first product to get started.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" data-testid="products-grid">
                  {products && products.length > 0 ? (
                    products.map((product) => {
                      const safeSrc = isValidHttpUrl(product.thumbnailUrls?.[0]) ? product.thumbnailUrls[0] : null;
                      const hasError = imageErrors.has(product.id);
                      
                      return (
                      <Card key={product.id} className="flex flex-col" data-testid={`card-product-${product.id}`}>
                        <div className="aspect-square relative bg-muted overflow-hidden rounded-t-md">
                          {safeSrc && !hasError ? (
                            <img
                              src={safeSrc}
                              alt=""
                              className="w-full h-full object-cover"
                              onError={() => {
                                setImageErrors(prev => new Set(prev).add(product.id));
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                              No image
                            </div>
                          )}
                        </div>
                        <CardContent className="flex-1 p-4 space-y-2">
                          <h4 className="font-semibold truncate" data-testid={`text-product-name-${product.id}`}>
                            {product.name}
                          </h4>
                          {product.category && (
                            <Badge variant="secondary" className="text-xs" data-testid={`badge-category-${product.id}`}>
                              {product.category}
                            </Badge>
                          )}
                          <p className="text-sm text-muted-foreground line-clamp-2" data-testid={`text-description-${product.id}`}>
                            {product.description || "No description"}
                          </p>
                          <div className="flex items-center gap-2 pt-2">
                            {product.isActive ? (
                              <span className="text-xs text-green-600 dark:text-green-400" data-testid={`status-active-${product.id}`}>Active</span>
                            ) : (
                              <span className="text-xs text-muted-foreground" data-testid={`status-inactive-${product.id}`}>Inactive</span>
                            )}
                          </div>
                        </CardContent>
                        <div className="p-4 pt-0 flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => handleEditProduct(product)}
                            data-testid={`button-edit-card-${product.id}`}
                          >
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                data-testid={`button-delete-card-${product.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Product</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete "{product.name}"? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteProductMutation.mutate(product.id)}>
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </Card>
                      );
                    })
                  ) : (
                    <div className="col-span-full text-center py-12 text-muted-foreground">
                      No products yet. Add your first product to get started.
                    </div>
                  )}
                </div>
              )}

              <MediaPicker
                value={editProductForm.watch("thumbnailUrls") ?? []}
                onChange={(urls) => editProductForm.setValue("thumbnailUrls", urls)}
                open={isMediaPickerOpen && mediaPickerMode === "edit"}
                onOpenChange={setIsMediaPickerOpen}
              />
            </TabsContent>

            <TabsContent value="media" className="space-y-4">
              <MediaLibraryTab />
            </TabsContent>

            <TabsContent value="variables" className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">Pricing Variables</h3>
                    <p className="text-sm text-muted-foreground">
                      Manage global variables for use in pricing formulas
                    </p>
                  </div>
                </div>

                <Card data-testid="card-formula-guide">
                  <CardHeader>
                    <CardTitle>How to Use Variables in Formulas</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <h4 className="font-medium mb-2">Built-in Variables:</h4>
                      <p className="text-sm text-muted-foreground mb-2">
                        These variables are automatically available in all formulas:
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                        <li><code className="bg-muted px-1 rounded">width</code> or <code className="bg-muted px-1 rounded">w</code> - Product width in inches</li>
                        <li><code className="bg-muted px-1 rounded">height</code> or <code className="bg-muted px-1 rounded">h</code> - Product height in inches</li>
                        <li><code className="bg-muted px-1 rounded">quantity</code> or <code className="bg-muted px-1 rounded">q</code> - Number of items</li>
                        <li><code className="bg-muted px-1 rounded">sqft</code> - Square footage (width × height ÷ 144)</li>
                        <li><code className="bg-muted px-1 rounded">basePricePerSqft</code> or <code className="bg-muted px-1 rounded">p</code> - Price per sq ft from variant</li>
                      </ul>
                      <p className="text-xs text-muted-foreground mt-2 italic">
                        💡 Tip: Use single letters (w, h, q, p) for shorter formulas!
                      </p>
                      <p className="text-xs text-muted-foreground mt-2 font-semibold">
                        ⚠️ Note: Set price per sq ft in Product Variants, not in the formula!
                      </p>
                    </div>
                    <div>
                      <h4 className="font-medium mb-2">Your Custom Variables:</h4>
                      {globalVariables && globalVariables.length > 0 ? (
                        <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                          {globalVariables
                            .filter(v => v.name !== 'next_quote_number')
                            .map(variable => (
                              <li key={variable.id}>
                                <code className="bg-muted px-1 rounded">{variable.name}</code> = {Number(variable.value).toFixed(4)}
                                {variable.description && <span className="ml-2">- {variable.description}</span>}
                              </li>
                            ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground">No custom variables yet. Add variables below to use them in formulas.</p>
                      )}
                    </div>
                    <div>
                      <h4 className="font-medium mb-2">Example Formulas:</h4>
                      <div className="space-y-2 text-sm">
                        <div className="bg-muted p-2 rounded">
                          <code className="font-mono">sqft * p * q</code>
                          <p className="text-muted-foreground mt-1">Simple: sqft × price per sqft × quantity</p>
                        </div>
                        <div className="bg-muted p-2 rounded">
                          <code className="font-mono">(sqft * p * q) + SETUP_FEE</code>
                          <p className="text-muted-foreground mt-1">With setup fee from global variable</p>
                        </div>
                        <div className="bg-muted p-2 rounded">
                          <code className="font-mono">max(MIN_ORDER, sqft * p * q)</code>
                          <p className="text-muted-foreground mt-1">Minimum order price</p>
                        </div>
                        <div className="bg-muted p-2 rounded">
                          <code className="font-mono">sqft * p * q * (q &gt; 100 ? 0.9 : 1)</code>
                          <p className="text-muted-foreground mt-1">10% discount for orders over 100</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
              
              <div className="flex justify-between items-center gap-4">
                <div className="flex-1 max-w-md">
                  <Input
                    placeholder="Search variables..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    data-testid="input-search-variables"
                  />
                </div>
                <Dialog open={isAddVariableDialogOpen} onOpenChange={setIsAddVariableDialogOpen}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-add-variable">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Variable
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl" data-testid="dialog-add-variable">
                    <DialogHeader>
                      <DialogTitle>Add New Global Variable</DialogTitle>
                      <DialogDescription>
                        Create a new global variable for use in pricing calculations
                      </DialogDescription>
                    </DialogHeader>
                    <Form {...variableForm}>
                      <form onSubmit={variableForm.handleSubmit((data) => addVariableMutation.mutate(data))} className="space-y-4">
                        <FormField
                          control={variableForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-variable-name">Variable Name</FormLabel>
                              <FormControl>
                                <Input placeholder="BASE_COST" {...field} data-testid="input-variable-name" />
                              </FormControl>
                              <FormDescription>
                                Use a unique, descriptive name (e.g., BASE_COST, TAX_RATE)
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={variableForm.control}
                          name="value"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-variable-value">Value</FormLabel>
                              <FormControl>
                                <Input
                                  type="text"
                                  placeholder="0.05 or BASE_COST"
                                  {...field}
                                  data-testid="input-variable-value"
                                />
                              </FormControl>
                              <FormDescription>
                                Can be a number (e.g., 0.05) or a variable name (e.g., BASE_COST)
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={variableForm.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-variable-description">Description</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Description of what this variable is used for..."
                                  {...field}
                                  value={field.value || ""}
                                  data-testid="textarea-variable-description"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={variableForm.control}
                          name="category"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel data-testid="label-variable-category">Category (Optional)</FormLabel>
                              <FormControl>
                                <Input 
                                  placeholder="Costs" 
                                  {...field} 
                                  value={field.value || ""}
                                  data-testid="input-variable-category"
                                />
                              </FormControl>
                              <FormDescription>
                                Group related variables by category
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <DialogFooter>
                          <Button
                            type="submit"
                            disabled={addVariableMutation.isPending}
                            data-testid="button-submit-add-variable"
                          >
                            {addVariableMutation.isPending ? "Adding..." : "Add Variable"}
                          </Button>
                        </DialogFooter>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead data-testid="header-variable-name">Name</TableHead>
                      <TableHead data-testid="header-variable-value">Value</TableHead>
                      <TableHead data-testid="header-variable-description">Description</TableHead>
                      <TableHead data-testid="header-variable-category">Category</TableHead>
                      <TableHead data-testid="header-variable-actions" className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {variablesLoading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8">
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    ) : filteredVariables && filteredVariables.length > 0 ? (
                      filteredVariables.map((variable) => (
                        <TableRow key={variable.id} data-testid={`row-variable-${variable.id}`}>
                          <TableCell className="font-medium font-mono" data-testid={`cell-variable-name-${variable.id}`}>
                            {variable.name}
                          </TableCell>
                          <TableCell className="font-mono" data-testid={`cell-variable-value-${variable.id}`}>
                            {Number(variable.value).toFixed(4)}
                          </TableCell>
                          <TableCell className="max-w-xs truncate" data-testid={`cell-variable-description-${variable.id}`}>
                            {variable.description || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell data-testid={`cell-variable-category-${variable.id}`}>
                            {variable.category ? (
                              <Badge variant="outline" data-testid={`badge-category-${variable.id}`}>{variable.category}</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Dialog
                                open={editingVariable?.id === variable.id}
                                onOpenChange={(open) => !open && setEditingVariable(null)}
                              >
                                <DialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => handleEditVariable(variable)}
                                    data-testid={`button-edit-variable-${variable.id}`}
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl" data-testid={`dialog-edit-variable-${variable.id}`}>
                                  <DialogHeader>
                                    <DialogTitle>Edit Global Variable</DialogTitle>
                                    <DialogDescription>
                                      Update variable details
                                    </DialogDescription>
                                  </DialogHeader>
                                  <Form {...editVariableForm}>
                                    <form
                                      onSubmit={editVariableForm.handleSubmit((data) =>
                                        updateVariableMutation.mutate({ id: variable.id, data })
                                      )}
                                      className="space-y-4"
                                    >
                                      <FormField
                                        control={editVariableForm.control}
                                        name="name"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Variable Name</FormLabel>
                                            <FormControl>
                                              <Input {...field} data-testid={`input-edit-variable-name-${variable.id}`} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editVariableForm.control}
                                        name="value"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Value</FormLabel>
                                            <FormControl>
                                              <Input
                                                type="text"
                                                {...field}
                                                data-testid={`input-edit-variable-value-${variable.id}`}
                                              />
                                            </FormControl>
                                            <FormDescription>
                                              Can be a number (e.g., 0.05) or a variable name (e.g., BASE_COST)
                                            </FormDescription>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editVariableForm.control}
                                        name="description"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Description</FormLabel>
                                            <FormControl>
                                              <Textarea {...field} value={field.value || ""} data-testid={`textarea-edit-variable-description-${variable.id}`} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <FormField
                                        control={editVariableForm.control}
                                        name="category"
                                        render={({ field }) => (
                                          <FormItem>
                                            <FormLabel>Category</FormLabel>
                                            <FormControl>
                                              <Input {...field} value={field.value || ""} data-testid={`input-edit-variable-category-${variable.id}`} />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                      <DialogFooter>
                                        <Button
                                          type="submit"
                                          disabled={updateVariableMutation.isPending}
                                          data-testid={`button-submit-edit-variable-${variable.id}`}
                                        >
                                          {updateVariableMutation.isPending ? "Updating..." : "Update Variable"}
                                        </Button>
                                      </DialogFooter>
                                    </form>
                                  </Form>
                                </DialogContent>
                              </Dialog>

                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    data-testid={`button-delete-variable-${variable.id}`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent data-testid={`dialog-delete-variable-${variable.id}`}>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Variable?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will permanently delete "{variable.name}". This action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel data-testid={`button-cancel-delete-variable-${variable.id}`}>
                                      Cancel
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deleteVariableMutation.mutate(variable.id)}
                                      data-testid={`button-confirm-delete-variable-${variable.id}`}
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : searchTerm ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No variables match your search.
                        </TableCell>
                      </TableRow>
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No global variables yet. Add your first variable to get started.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="formulas" className="space-y-4">
              <div className="flex justify-between items-center gap-4">
                <div className="flex-1 max-w-md">
                  <Input
                    placeholder="Search formula templates..."
                    value={templateSearchTerm}
                    onChange={(e) => setTemplateSearchTerm(e.target.value)}
                  />
                </div>
                <Dialog open={isAddFormulaTemplateDialogOpen} onOpenChange={setIsAddFormulaTemplateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Formula Template
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Add New Formula Template</DialogTitle>
                      <DialogDescription>
                        Create a reusable formula template for pricing calculations
                      </DialogDescription>
                    </DialogHeader>
                    <Form {...formulaTemplateForm}>
                      <form onSubmit={formulaTemplateForm.handleSubmit((data) => addFormulaTemplateMutation.mutate(data))} className="space-y-4">
                        <FormField
                          control={formulaTemplateForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Template Name</FormLabel>
                              <FormControl>
                                <Input placeholder="Area-based pricing" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={formulaTemplateForm.control}
                          name="formula"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Formula</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="sqft * p * q"
                                  {...field}
                                  className="font-mono"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={formulaTemplateForm.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Description</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Description of what this formula does..."
                                  {...field}
                                  value={field.value || ""}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={formulaTemplateForm.control}
                          name="category"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Category</FormLabel>
                              <FormControl>
                                <Input placeholder="Standard" {...field} value={field.value || ""} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <DialogFooter>
                          <Button type="submit" disabled={addFormulaTemplateMutation.isPending}>
                            {addFormulaTemplateMutation.isPending ? "Adding..." : "Add Template"}
                          </Button>
                        </DialogFooter>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Formula</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Products</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {formulaTemplatesLoading ? (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    ) : formulaTemplates && formulaTemplates.length > 0 ? (
                      formulaTemplates
                        .filter(template =>
                          template.name.toLowerCase().includes(templateSearchTerm.toLowerCase()) ||
                          template.description?.toLowerCase().includes(templateSearchTerm.toLowerCase())
                        )
                        .map((template) => (
                          <TableRow key={template.id}>
                            <TableCell className="font-medium">{template.name}</TableCell>
                            <TableCell className="font-mono text-sm max-w-xs truncate">{template.formula}</TableCell>
                            <TableCell className="max-w-xs truncate">
                              {template.description || <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              {template.category ? (
                                <Badge variant="outline">{template.category}</Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setViewingTemplateProducts(template.id)}
                              >
                                View Products
                              </Button>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Dialog
                                  open={editingFormulaTemplate?.id === template.id}
                                  onOpenChange={(open) => !open && setEditingFormulaTemplate(null)}
                                >
                                  <DialogTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      onClick={() => handleEditFormulaTemplate(template)}
                                    >
                                      <Edit className="w-4 h-4" />
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent className="max-w-2xl">
                                    <DialogHeader>
                                      <DialogTitle>Edit Formula Template</DialogTitle>
                                    </DialogHeader>
                                    <Form {...editFormulaTemplateForm}>
                                      <form
                                        onSubmit={editFormulaTemplateForm.handleSubmit((data) =>
                                          updateFormulaTemplateMutation.mutate({ id: template.id, data })
                                        )}
                                        className="space-y-4"
                                      >
                                        <FormField
                                          control={editFormulaTemplateForm.control}
                                          name="name"
                                          render={({ field }) => (
                                            <FormItem>
                                              <FormLabel>Template Name</FormLabel>
                                              <FormControl>
                                                <Input {...field} />
                                              </FormControl>
                                              <FormMessage />
                                            </FormItem>
                                          )}
                                        />
                                        <FormField
                                          control={editFormulaTemplateForm.control}
                                          name="formula"
                                          render={({ field }) => (
                                            <FormItem>
                                              <FormLabel>Formula</FormLabel>
                                              <FormControl>
                                                <Textarea {...field} className="font-mono" />
                                              </FormControl>
                                              <FormMessage />
                                            </FormItem>
                                          )}
                                        />
                                        <FormField
                                          control={editFormulaTemplateForm.control}
                                          name="description"
                                          render={({ field }) => (
                                            <FormItem>
                                              <FormLabel>Description</FormLabel>
                                              <FormControl>
                                                <Textarea {...field} value={field.value || ""} />
                                              </FormControl>
                                              <FormMessage />
                                            </FormItem>
                                          )}
                                        />
                                        <FormField
                                          control={editFormulaTemplateForm.control}
                                          name="category"
                                          render={({ field }) => (
                                            <FormItem>
                                              <FormLabel>Category</FormLabel>
                                              <FormControl>
                                                <Input {...field} value={field.value || ""} />
                                              </FormControl>
                                              <FormMessage />
                                            </FormItem>
                                          )}
                                        />
                                        <DialogFooter>
                                          <Button type="submit" disabled={updateFormulaTemplateMutation.isPending}>
                                            {updateFormulaTemplateMutation.isPending ? "Updating..." : "Update Template"}
                                          </Button>
                                        </DialogFooter>
                                      </form>
                                    </Form>
                                  </DialogContent>
                                </Dialog>

                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="outline" size="icon">
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete Formula Template</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Are you sure you want to delete "{template.name}"? This action cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => deleteFormulaTemplateMutation.mutate(template.id)}>
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No formula templates yet. Add your first template to get started.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Products using this template dialog */}
              <Dialog open={!!viewingTemplateProducts} onOpenChange={(open) => !open && setViewingTemplateProducts(null)}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Products Using This Formula</DialogTitle>
                    <DialogDescription>
                      These products are currently using this formula template
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    {templateProducts && templateProducts.length > 0 ? (
                      templateProducts.map((product) => (
                        <div key={product.id} className="p-3 border rounded-md">
                          <div className="font-medium">{product.name}</div>
                          <div className="text-sm text-muted-foreground">{product.description}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        No products are currently using this formula template.
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </TabsContent>

            {/* Email Settings Tab */}
            <TabsContent value="email" className="space-y-4">
              <EmailSettingsTab />
            </TabsContent>
            <TabsContent value="workflow" className="space-y-4">
              <JobStatusSettings />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
