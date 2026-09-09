import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getApiUrl } from "@/lib/apiConfig";
import { HERO_LOGO_SRC } from "@/lib/branding";

const GENERIC_CONFIRMATION = "If this email is associated with a customer account, we'll send an access link.";

export default function RequestPortalAccessPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const requestAccess = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await fetch(getApiUrl("/api/customer-portal/request-access"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        credentials: "include",
      });
    } finally {
      // The endpoint deliberately returns the same browser outcome for every
      // eligibility state, including network-safe retry cases.
      setSubmitted(true);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center gap-2">
          <img src={HERO_LOGO_SRC} alt="Printers Hero" className="h-16 w-auto" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Request Portal Access</CardTitle>
            <CardDescription>Enter the email address associated with your customer account.</CardDescription>
          </CardHeader>
          <CardContent>
            {submitted ? (
              <div className="space-y-5">
                <div className="flex gap-3 text-sm text-muted-foreground">
                  <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                  <p>{GENERIC_CONFIRMATION}</p>
                </div>
                <Button asChild variant="outline" className="w-full"><Link to="/login">Back to login</Link></Button>
              </div>
            ) : (
              <form onSubmit={requestAccess} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="portal-access-email" className="text-sm font-medium">Email</label>
                  <Input
                    id="portal-access-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    disabled={submitting}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Request Access
                </Button>
                <Button asChild variant="ghost" className="w-full"><Link to="/login"><ArrowLeft className="mr-2 h-4 w-4" />Back to login</Link></Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
