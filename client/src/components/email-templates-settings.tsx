import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, RotateCcw, Save } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { EmailTemplates } from "@shared/emailTemplates";
import { DEFAULT_EMAIL_TEMPLATES, TEMPLATE_VARIABLES } from "@shared/emailTemplates";
import { TemplateEditor } from "@/components/email/TemplateEditor";
import { SubjectVariableInput } from "@/components/email/SubjectVariableInput";

export function EmailTemplatesSettings() {
  const { toast } = useToast();
  const [quoteSubject, setQuoteSubject] = useState("");
  const [quoteBody, setQuoteBody] = useState("");
  const [invoiceSubject, setInvoiceSubject] = useState("");
  const [invoiceBody, setInvoiceBody] = useState("");
  
  // Convert TEMPLATE_VARIABLES to array format for components
  const allowedTokens = Object.entries(TEMPLATE_VARIABLES).map(([token, label]) => ({
    token,
    label,
  }));
  
  // Fetch email templates
  const { data: templates, isLoading } = useQuery<EmailTemplates>({
    queryKey: ["/api/settings/email-templates"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/settings/email-templates");
      const data = await response.json();
      
      // Initialize form state
      setQuoteSubject(data.quote.subject);
      setQuoteBody(data.quote.body);
      setInvoiceSubject(data.invoice.subject);
      setInvoiceBody(data.invoice.body);
      
      return data;
    },
  });

  // Save templates mutation
  const saveMutation = useMutation({
    mutationFn: async (data: EmailTemplates) => {
      return apiRequest("PUT", "/api/settings/email-templates", data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Email templates saved successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/email-templates"] });
    },
    onError: (error: any) => {
      const errors = error.data?.errors || {};
      const errorMessages = Object.entries(errors)
        .map(([key, msgs]) => `${key}: ${(msgs as string[]).join(", ")}`)
        .join("; ");
      
      toast({
        title: "Error",
        description: errorMessages || error.message || "Failed to save email templates",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    saveMutation.mutate({
      quote: {
        subject: quoteSubject,
        body: quoteBody,
      },
      invoice: {
        subject: invoiceSubject,
        body: invoiceBody,
      },
    });
  };

  const handleResetQuote = () => {
    setQuoteSubject(DEFAULT_EMAIL_TEMPLATES.quote.subject);
    setQuoteBody(DEFAULT_EMAIL_TEMPLATES.quote.body);
  };

  const handleResetInvoice = () => {
    setInvoiceSubject(DEFAULT_EMAIL_TEMPLATES.invoice.subject);
    setInvoiceBody(DEFAULT_EMAIL_TEMPLATES.invoice.body);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Email Templates</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Templates</CardTitle>
        <CardDescription>
          Customize subject and body templates for quote and invoice emails. Use variables like {"{{quote.number}}"} or {"{{customer.name}}"}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Variable Library */}
        <div className="border rounded-lg p-4 bg-muted/50">
          <h3 className="font-semibold text-sm mb-3">Available Variables</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(TEMPLATE_VARIABLES).map(([token, description]) => (
              <div key={token} className="flex flex-col gap-1">
                <code className="text-xs bg-background px-2 py-1 rounded border font-mono">
                  {`{{${token}}}`}
                </code>
                <span className="text-xs text-muted-foreground">{description}</span>
              </div>
            ))}
          </div>
          <Alert className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Only variables shown above are allowed. Unknown variables will be left unchanged or replaced with empty values.
            </AlertDescription>
          </Alert>
        </div>

        {/* Template Editors */}
        <Tabs defaultValue="quote" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="quote">Quote Templates</TabsTrigger>
            <TabsTrigger value="invoice">Invoice Templates</TabsTrigger>
          </TabsList>

          <TabsContent value="quote" className="space-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Quote Email Template</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleResetQuote}
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset to Default
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="quote-subject">Subject Line</Label>
                <SubjectVariableInput
                  value={quoteSubject}
                  onChange={setQuoteSubject}
                  variables={allowedTokens}
                  placeholder="Quote #{{quote.number}} from {{org.name}}"
                  maxLength={200}
                />
                <p className="text-xs text-muted-foreground">
                  {quoteSubject.length}/200 characters
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="quote-body">Email Body</Label>
                <TemplateEditor
                  valueHtml={quoteBody}
                  onChangeHtml={setQuoteBody}
                  variables={allowedTokens}
                />
                <p className="text-xs text-muted-foreground">
                  {quoteBody.length}/10,000 characters
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="invoice" className="space-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Invoice Email Template</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleResetInvoice}
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset to Default
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="invoice-subject">Subject Line</Label>
                <SubjectVariableInput
                  value={invoiceSubject}
                  onChange={setInvoiceSubject}
                  variables={allowedTokens}
                  placeholder="Invoice #{{invoice.number}} from {{org.name}}"
                  maxLength={200}
                />
                <p className="text-xs text-muted-foreground">
                  {invoiceSubject.length}/200 characters
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="invoice-body">Email Body</Label>
                <TemplateEditor
                  valueHtml={invoiceBody}
                  onChangeHtml={setInvoiceBody}
                  variables={allowedTokens}
                />
                <p className="text-xs text-muted-foreground">
                  {invoiceBody.length}/10,000 characters
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? "Saving..." : "Save Templates"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
