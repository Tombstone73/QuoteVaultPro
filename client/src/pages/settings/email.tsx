import { TitanCard } from "@/components/titan";
import { EmailSettingsTab } from "@/components/admin-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { Edit, Mail, FileText, Plus } from "lucide-react";
import { useState, useEffect } from "react";

// Schema for email templates
const emailTemplatesSchema = z.object({
  replyToEmail: z.string().email("Must be a valid email").optional().or(z.literal("")),
  quoteEmailSubject: z.string().optional(),
  quoteEmailBody: z.string().optional(),
  invoiceEmailSubject: z.string().optional(),
  invoiceEmailBody: z.string().optional(),
});

type EmailTemplatesFormData = z.infer<typeof emailTemplatesSchema>;

// Available template variables
const QUOTE_VARIABLES = [
  { label: "Quote Number", value: "{quoteNumber}" },
  { label: "Company Name", value: "{companyName}" },
  { label: "Customer Name", value: "{customerName}" },
];

const INVOICE_VARIABLES = [
  { label: "Invoice Number", value: "{invoiceNumber}" },
  { label: "Company Name", value: "{companyName}" },
  { label: "Customer Name", value: "{customerName}" },
];

function EmailTemplatesCard() {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState("quote");

  // Fetch organization preferences
  const { data: preferences, isLoading } = useQuery({
    queryKey: ["/api/organization/preferences"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/organization/preferences");
      return await response.json();
    },
  });

  const form = useForm<EmailTemplatesFormData>({
    resolver: zodResolver(emailTemplatesSchema),
    defaultValues: {
      replyToEmail: "",
      quoteEmailSubject: "Quote #{quoteNumber} from {companyName}",
      quoteEmailBody: "Hello,\n\nPlease find your quote #{quoteNumber} attached.\n\nThank you for your business!",
      invoiceEmailSubject: "Invoice #{invoiceNumber} from {companyName}",
      invoiceEmailBody: "Hello,\n\nPlease find your invoice #{invoiceNumber} attached.\n\nThank you for your business!",
    },
  });

  // Load existing templates when data arrives
  useEffect(() => {
    if (preferences?.emailTemplates) {
      form.reset({
        replyToEmail: preferences.emailTemplates.replyToEmail || "",
        quoteEmailSubject: preferences.emailTemplates.quoteEmailSubject || "Quote #{quoteNumber} from {companyName}",
        quoteEmailBody: preferences.emailTemplates.quoteEmailBody || "Hello,\n\nPlease find your quote #{quoteNumber} attached.\n\nThank you for your business!",
        invoiceEmailSubject: preferences.emailTemplates.invoiceEmailSubject || "Invoice #{invoiceNumber} from {companyName}",
        invoiceEmailBody: preferences.emailTemplates.invoiceEmailBody || "Hello,\n\nPlease find your invoice #{invoiceNumber} attached.\n\nThank you for your business!",
      });
    }
  }, [preferences, form]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data: EmailTemplatesFormData) => {
      return apiRequest("PUT", "/api/organization/preferences", {
        emailTemplates: data,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization/preferences"] });
      toast({
        title: "Success",
        description: "Email templates saved successfully",
      });
      setIsEditing(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save email templates",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: EmailTemplatesFormData) => {
    saveMutation.mutate(data);
  };

  // Helper to insert variable into field at cursor position
  const insertVariable = (fieldName: keyof EmailTemplatesFormData, variable: string) => {
    const currentValue = form.getValues(fieldName) || "";
    const textarea = document.querySelector(`textarea[name="${fieldName}"]`) as HTMLTextAreaElement;
    const input = document.querySelector(`input[name="${fieldName}"]`) as HTMLInputElement;
    const element = textarea || input;
    
    if (element) {
      const start = element.selectionStart || currentValue.length;
      const end = element.selectionEnd || currentValue.length;
      const newValue = currentValue.substring(0, start) + variable + currentValue.substring(end);
      form.setValue(fieldName, newValue);
      
      // Set cursor position after inserted variable
      setTimeout(() => {
        element.focus();
        element.setSelectionRange(start + variable.length, start + variable.length);
      }, 0);
    } else {
      // Fallback: append to end
      form.setValue(fieldName, currentValue + variable);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Email Templates</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Email Templates
        </CardTitle>
        <CardDescription>
          Customize email content for quotes and invoices
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Reply-To Email */}
            <FormField
              control={form.control}
              name="replyToEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reply-To Email Address</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      placeholder="replies@your-company.com"
                      disabled={!isEditing}
                    />
                  </FormControl>
                  <FormDescription>
                    Email address where customer replies will be sent (optional)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Tabbed Templates */}
            <div className="border-t pt-4">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="quote">Quote Template</TabsTrigger>
                  <TabsTrigger value="invoice">Invoice Template</TabsTrigger>
                </TabsList>

                {/* Quote Template Tab */}
                <TabsContent value="quote" className="space-y-4 mt-4">
                  {/* Variable Buttons */}
                  {isEditing && (
                    <div className="bg-muted/50 p-3 rounded-lg">
                      <p className="text-sm font-medium mb-2">Insert Variables:</p>
                      <div className="flex flex-wrap gap-2">
                        {QUOTE_VARIABLES.map((variable) => (
                          <Badge
                            key={variable.value}
                            variant="secondary"
                            className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                            onClick={() => {
                              const focusedElement = document.activeElement;
                              const fieldName = focusedElement?.getAttribute("name");
                              if (fieldName === "quoteEmailSubject" || fieldName === "quoteEmailBody") {
                                insertVariable(fieldName as keyof EmailTemplatesFormData, variable.value);
                              } else {
                                insertVariable("quoteEmailBody", variable.value);
                              }
                            }}
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            {variable.label}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Click a variable to insert it at the cursor position
                      </p>
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="quoteEmailSubject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subject Line</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            name="quoteEmailSubject"
                            placeholder="Quote #{quoteNumber} from {companyName}"
                            disabled={!isEditing}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="quoteEmailBody"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Body</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            name="quoteEmailBody"
                            placeholder="Hello,&#10;&#10;Please find your quote #{quoteNumber} attached.&#10;&#10;Thank you for your business!"
                            rows={8}
                            disabled={!isEditing}
                          />
                        </FormControl>
                        <FormDescription>
                          Plain text email body for quote emails
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TabsContent>

                {/* Invoice Template Tab */}
                <TabsContent value="invoice" className="space-y-4 mt-4">
                  {/* Variable Buttons */}
                  {isEditing && (
                    <div className="bg-muted/50 p-3 rounded-lg">
                      <p className="text-sm font-medium mb-2">Insert Variables:</p>
                      <div className="flex flex-wrap gap-2">
                        {INVOICE_VARIABLES.map((variable) => (
                          <Badge
                            key={variable.value}
                            variant="secondary"
                            className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                            onClick={() => {
                              const focusedElement = document.activeElement;
                              const fieldName = focusedElement?.getAttribute("name");
                              if (fieldName === "invoiceEmailSubject" || fieldName === "invoiceEmailBody") {
                                insertVariable(fieldName as keyof EmailTemplatesFormData, variable.value);
                              } else {
                                insertVariable("invoiceEmailBody", variable.value);
                              }
                            }}
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            {variable.label}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Click a variable to insert it at the cursor position
                      </p>
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="invoiceEmailSubject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subject Line</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            name="invoiceEmailSubject"
                            placeholder="Invoice #{invoiceNumber} from {companyName}"
                            disabled={!isEditing}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="invoiceEmailBody"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Body</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            name="invoiceEmailBody"
                            placeholder="Hello,&#10;&#10;Please find your invoice #{invoiceNumber} attached.&#10;&#10;Thank you for your business!"
                            rows={8}
                            disabled={!isEditing}
                          />
                        </FormControl>
                        <FormDescription>
                          Plain text email body for invoice emails
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TabsContent>
              </Tabs>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-4 border-t">
              {isEditing ? (
                <>
                  <Button type="submit" disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? "Saving..." : "Save Templates"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsEditing(false);
                      if (preferences?.emailTemplates) {
                        form.reset({
                          replyToEmail: preferences.emailTemplates.replyToEmail || "",
                          quoteEmailSubject: preferences.emailTemplates.quoteEmailSubject || "Quote #{quoteNumber} from {companyName}",
                          quoteEmailBody: preferences.emailTemplates.quoteEmailBody || "Hello,\n\nPlease find your quote #{quoteNumber} attached.\n\nThank you for your business!",
                          invoiceEmailSubject: preferences.emailTemplates.invoiceEmailSubject || "Invoice #{invoiceNumber} from {companyName}",
                          invoiceEmailBody: preferences.emailTemplates.invoiceEmailBody || "Hello,\n\nPlease find your invoice #{invoiceNumber} attached.\n\nThank you for your business!",
                        });
                      }
                    }}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button type="button" onClick={() => setIsEditing(true)}>
                  <Edit className="w-4 h-4 mr-2" />
                  Edit Templates
                </Button>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export function EmailSettings() {
  return (
    <TitanCard className="p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-titan-lg font-semibold text-titan-text-primary">Email Settings</h2>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Configure email for sending invoices and quotes
          </p>
        </div>
        
        <div className="h-px bg-titan-border-subtle" />
        
        <div className="space-y-4">
          <EmailSettingsTab />
          <EmailTemplatesCard />
        </div>
      </div>
    </TitanCard>
  );
}

export default EmailSettings;
