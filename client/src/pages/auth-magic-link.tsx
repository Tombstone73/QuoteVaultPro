import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AuthMagicLink() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    const error = searchParams.get("error");

    // Handle error from server redirect
    if (error) {
      setStatus("error");
      if (error === "expired") {
        setErrorMessage("This sign-in link has expired. Please request a new one.");
      } else if (error === "invalid") {
        setErrorMessage("This sign-in link is invalid. Please request a new one.");
      } else if (error === "session") {
        setErrorMessage("Failed to establish session. Please try again.");
      } else {
        setErrorMessage("An error occurred. Please try again.");
      }
      return;
    }

    // If no token, redirect to login
    if (!token) {
      setStatus("error");
      setErrorMessage("No sign-in token provided.");
      return;
    }

    // Redirect to server endpoint to consume token
    // Server will verify token, establish session, and redirect to home
    window.location.href = `/api/auth/magic-link/consume?token=${encodeURIComponent(token)}`;
  }, [searchParams]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold">Signing you in...</CardTitle>
            <CardDescription>Please wait while we verify your sign-in link</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center py-8">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="rounded-full bg-destructive/10 p-4">
                <AlertCircle className="h-8 w-8 text-destructive" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold">Sign-in Failed</CardTitle>
            <CardDescription>{errorMessage}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/login")} className="w-full">
              Back to Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state (shouldn't normally be seen, as server redirects)
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-primary/10 p-4">
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">Success!</CardTitle>
          <CardDescription>You've been signed in. Redirecting...</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
