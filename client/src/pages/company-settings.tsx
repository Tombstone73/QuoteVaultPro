import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, Building2, Save } from "lucide-react";

const settingsSchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  companyLogo: z.string().optional(),
  companyEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  companyPhone: z.string().optional(),
  companyAddress: z.string().optional(),
  quickbooksCompanyId: z.string().optional(),
  quickbooksAccessToken: z.string().optional(),
  quickbooksRealmId: z.string().optional(),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

type CompanySettings = {
  id: string;
  companyName: string;
  companyLogo: string | null;
  companyEmail: string | null;
  companyPhone: string | null;
  companyAddress: string | null;
  quickbooksCompanyId: string | null;
  quickbooksAccessToken: string | null;
  quickbooksRealmId: string | null;
};

export default function CompanySettings() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: settings, isLoading } = useQuery<CompanySettings>({
    queryKey: ["/api/company-settings"],
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    values: settings ? {
      companyName: settings.companyName,
      companyLogo: settings.companyLogo || "",
      companyEmail: settings.companyEmail || "",
      companyPhone: settings.companyPhone || "",
      companyAddress: settings.companyAddress || "",
      quickbooksCompanyId: settings.quickbooksCompanyId || "",
      quickbooksAccessToken: settings.quickbooksAccessToken || "",
      quickbooksRealmId: settings.quickbooksRealmId || "",
    } : undefined,
  });

  const updateMutation = useMutation({
    mutationFn: async (data: SettingsFormData) => {
      const response = await fetch(`/api/company-settings/${settings?.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to update settings");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      toast({ title: "Success", description: "Company settings updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: SettingsFormData) => {
      const response = await fetch("/api/company-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to create settings");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      toast({ title: "Success", description: "Company settings created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = async (data: SettingsFormData) => {
    setIsSubmitting(true);
    try {
      if (settings) {
        await updateMutation.mutateAsync(data);
      } else {
        await createMutation.mutateAsync(data);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You must be an administrator to access this page.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/">
              <Button>Go Home</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Company Settings</h1>
              <p className="text-sm text-muted-foreground">Configure your company branding and integrations</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Company Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Company Information
              </CardTitle>
              <CardDescription>
                Basic information about your company that will be displayed throughout the system
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="companyName">Company Name *</Label>
                <Input
                  id="companyName"
                  {...register("companyName")}
                  placeholder="Titan Graphics"
                />
                {errors.companyName && (
                  <p className="text-sm text-destructive mt-1">{errors.companyName.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="companyLogo">Company Logo URL</Label>
                <Input
                  id="companyLogo"
                  {...register("companyLogo")}
                  placeholder="https://example.com/logo.png"
                />
                {errors.companyLogo && (
                  <p className="text-sm text-destructive mt-1">{errors.companyLogo.message}</p>
                )}
                <p className="text-sm text-muted-foreground mt-1">
                  Enter a URL to your company logo image
                </p>
              </div>

              <div>
                <Label htmlFor="companyEmail">Company Email</Label>
                <Input
                  id="companyEmail"
                  type="email"
                  {...register("companyEmail")}
                  placeholder="info@company.com"
                />
                {errors.companyEmail && (
                  <p className="text-sm text-destructive mt-1">{errors.companyEmail.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="companyPhone">Company Phone</Label>
                <Input
                  id="companyPhone"
                  {...register("companyPhone")}
                  placeholder="(555) 123-4567"
                />
              </div>

              <div>
                <Label htmlFor="companyAddress">Company Address</Label>
                <Input
                  id="companyAddress"
                  {...register("companyAddress")}
                  placeholder="123 Main St, City, State 12345"
                />
              </div>
            </CardContent>
          </Card>

          {/* QuickBooks Integration */}
          <Card>
            <CardHeader>
              <CardTitle>QuickBooks Integration</CardTitle>
              <CardDescription>
                Connect your QuickBooks account to sync customers and invoices
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="quickbooksCompanyId">QuickBooks Company ID</Label>
                <Input
                  id="quickbooksCompanyId"
                  {...register("quickbooksCompanyId")}
                  placeholder="Enter your QuickBooks Company ID"
                />
              </div>

              <div>
                <Label htmlFor="quickbooksRealmId">QuickBooks Realm ID</Label>
                <Input
                  id="quickbooksRealmId"
                  {...register("quickbooksRealmId")}
                  placeholder="Enter your QuickBooks Realm ID"
                />
              </div>

              <div>
                <Label htmlFor="quickbooksAccessToken">QuickBooks Access Token</Label>
                <Input
                  id="quickbooksAccessToken"
                  type="password"
                  {...register("quickbooksAccessToken")}
                  placeholder="Enter your QuickBooks Access Token"
                />
                <p className="text-sm text-muted-foreground mt-1">
                  This token will be encrypted and stored securely
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting} size="lg">
              <Save className="w-4 h-4 mr-2" />
              {isSubmitting ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

