import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuoteCheckout, useConvertPortalQuoteToOrder, useUploadOrderFile } from "@/hooks/usePortal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Upload, X, FileIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function QuoteCheckout() {
  const { id: quoteId } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: quote, isLoading } = useQuoteCheckout(quoteId);
  const convertMutation = useConvertPortalQuoteToOrder();

  const [priority, setPriority] = useState("normal");
  const [customerNotes, setCustomerNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [uploadedFileUrls, setUploadedFileUrls] = useState<Array<{ fileName: string; fileUrl: string; fileSize: number }>>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isConverting, setIsConverting] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    setIsUploading(true);
    try {
      // First get upload URL from backend
      const urlResponse = await fetch("/api/objects/upload", {
        method: "POST",
        credentials: "include",
      });
      
      if (!urlResponse.ok) {
        throw new Error("Failed to get upload URL");
      }

      const { url, method } = await urlResponse.json();

      // Upload each file
      for (const file of Array.from(e.target.files)) {
        const uploadResponse = await fetch(url, {
          method: method || "PUT",
          body: file,
          headers: {
            "Content-Type": file.type,
          },
        });

        if (!uploadResponse.ok) {
          throw new Error(`Failed to upload ${file.name}`);
        }

        // Extract the uploaded file URL
        const fileUrl = url.split("?")[0]; // Remove query params

        setUploadedFileUrls((prev) => [
          ...prev,
          {
            fileName: file.name,
            fileUrl,
            fileSize: file.size,
          },
        ]);
      }

      toast({
        title: "Files uploaded",
        description: "Your files have been uploaded successfully",
      });
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const removeFile = (index: number) => {
    setUploadedFileUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!quoteId) return;

    setIsConverting(true);
    try {
      const result = await convertMutation.mutateAsync({
        quoteId,
        priority,
        customerNotes: customerNotes || undefined,
        dueDate: dueDate || undefined,
      });

      const orderId = result?.id;

      // Attach files to the order
      if (uploadedFileUrls.length > 0 && orderId) {
        const uploadMutation = useUploadOrderFile(orderId);
        for (const fileData of uploadedFileUrls) {
          await uploadMutation.mutateAsync({
            fileName: fileData.fileName,
            fileUrl: fileData.fileUrl,
            fileSize: fileData.fileSize,
            description: "Uploaded during checkout",
          });
        }
      }

      toast({
        title: "Order Created",
        description: "Your order has been created successfully.",
      });

      setLocation(`/orders/${orderId}`);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create order",
        variant: "destructive",
      });
    } finally {
      setIsConverting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Quote not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">Checkout - Quote #{quote.quoteNumber}</h1>

      <div className="grid gap-6">
        {/* Quote Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Order Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {quote.lineItems?.map((item: any) => (
                <div key={item.id} className="flex justify-between items-start border-b pb-3">
                  <div>
                    <p className="font-medium">{item.productName}</p>
                    {item.variantName && (
                      <p className="text-sm text-muted-foreground">{item.variantName}</p>
                    )}
                    <p className="text-sm text-muted-foreground">Qty: {item.quantity}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">${parseFloat(item.linePrice || 0).toFixed(2)}</p>
                  </div>
                </div>
              ))}
              <div className="flex justify-between items-center pt-4 border-t-2">
                <p className="text-lg font-bold">Total</p>
                <p className="text-2xl font-bold">${parseFloat(quote.totalPrice || 0).toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Order Details */}
        <Card>
          <CardHeader>
            <CardTitle>Order Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="priority">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="rush">Rush</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="dueDate">Required Date (Optional)</Label>
              <Input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="customerNotes">Special Instructions</Label>
              <Textarea
                id="customerNotes"
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
                placeholder="Any special requirements or notes..."
                rows={4}
              />
            </div>

            <div>
              <Label>Upload Files (Artwork, PO, etc.)</Label>
              <div className="mt-2">
                <label htmlFor="file-upload" className="cursor-pointer">
                  <div className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary transition-colors">
                    <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      {isUploading ? "Uploading..." : "Click to upload files or drag and drop"}
                    </p>
                  </div>
                  <input
                    id="file-upload"
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFileUpload}
                    disabled={isUploading}
                  />
                </label>

                {uploadedFileUrls.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {uploadedFileUrls.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 border rounded"
                      >
                        <div className="flex items-center gap-2">
                          <FileIcon className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{file.fileName}</span>
                          <span className="text-xs text-muted-foreground">
                            ({(file.fileSize / 1024).toFixed(1)} KB)
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Submit Button */}
        <div className="flex justify-end gap-4">
          <Button variant="outline" onClick={() => setLocation("/portal/my-quotes")}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isConverting || isUploading}>
            {isConverting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Place Order
          </Button>
        </div>
      </div>
    </div>
  );
}
