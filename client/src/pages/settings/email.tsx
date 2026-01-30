import { TitanCard } from "@/components/titan";
import { EmailSettingsTab } from "@/components/admin-settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { Edit, Mail, FileText } from "lucide-react";
import { useState } from "react";

// Schema for email templates
const emailTemplatesSchema = z.object({
  replyToEmail: z.string().email("Must be a valid email").optional().or(z.literal("")),
  quoteEmailSubject: z.string().optional(),
  quoteEmailBody: z.string().optional(),
  invoiceEmailSubject: z.string().optional(),
  invoiceEmailBody: z.string().optional(),
});

type EmailTemplatesFormData = z.infer<typeof emailTemplatesSchema>;

function EmailTemplatesCard() {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);

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
  useState(() => {
    if (preferences?.emailTemplates) {
      form.reset({
        replyToEmail: preferences.emailTemplates.replyToEmail || "",
        quoteEmailSubject: preferences.emailTemplates.quoteEmailSubject || "Quote #{quoteNumber} from {companyName}",
        quoteEmailBody: preferences.emailTemplates.quoteEmailBody || "Hello,\n\nPlease find your quote #{quoteNumber} attached.\n\nThank you for your business!",
        invoiceEmailSubject: preferences.emailTemplates.invoiceEmailSubject || "Invoice #{invoiceNumber} from {companyName}",
        invoiceEmailBody: preferences.emailTemplates.invoiceEmailBody || "Hello,\n\nPlease find your invoice #{invoiceNumber} attached.\n\nThank you for your business!",
      });
    }
  });

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
          Customize email content for quotes and invoices. Use variables like {"{quoteNumber}"}, {"{invoiceNumber}"}, {"{companyName}"}, {"{customerName}"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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

            <div className="border-t pt-4">
              <h3 className="font-semibold mb-4">Quote Email Template</h3>
              
              <FormField
                control={form.control}
                name="quoteEmailSubject"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subject Line</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Quote #{quoteNumber} from {companyName}"
                        disabled={!isEditing}
                      />
                    </FormControl>
                    <FormDescription>
                      Email subject for quote emails
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="quoteEmailBody"
                render={({ field }) => (
                  <FormItem className="mt-4">
                    <FormLabel>Email Body</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Hello,&#10;&#10;Please find your quote #{quoteNumber} attached.&#10;&#10;Thank you for your business!"
                        rows={6}
                        disabled={!isEditing}
                      />
                    </FormControl>
                    <FormDescription>
                      Email body for quote emails (plain text)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="border-t pt-4">
              <h3 className="font-semibold mb-4">Invoice Email Template</h3>
              
              <FormField
                control={form.control}
                name="invoiceEmailSubject"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subject Line</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Invoice #{invoiceNumber} from {companyName}"
                        disabled={!isEditing}
                      />
                    </FormControl>
                    <FormDescription>
                      Email subject for invoice emails
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="invoiceEmailBody"
                render={({ field }) => (
                  <FormItem className="mt-4">
                    <FormLabel>Email Body</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Hello,&#10;&#10;Please find your invoice #{invoiceNumber} attached.&#10;&#10;Thank you for your business!"
                        rows={6}
                        disabled={!isEditing}
                      />
                    </FormControl>
                    <FormDescription>
                      Email body for invoice emails (plain text)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex gap-2">
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
