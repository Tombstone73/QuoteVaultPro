import { useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, CheckCircle } from "lucide-react";
import { getApiUrl } from "@/lib/apiConfig";
import { HERO_LOGO_SRC } from "@/lib/branding";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let response: Response;
      try {
        response = await fetch(getApiUrl("/api/auth/forgot-password"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
          credentials: "include",
        });
      } catch (networkErr) {
        // fetch() itself threw — network failure or CORS block
        const isNetworkErr = networkErr instanceof TypeError;
        console.error(
          isNetworkErr
            ? "Forgot password: network/CORS failure — check VITE_API_BASE_URL, APP_PUBLIC_WEB_ORIGIN, and APP_EXTRA_ORIGINS"
            : "Forgot password: unexpected fetch error",
          networkErr,
        );
        toast({
          title: "Connection error",
          description: "Unable to reach the server. Please check your connection and try again.",
          variant: "destructive",
        });
        return;
      }

      // Parse JSON; guard against non-JSON responses (e.g. proxy error pages)
      let data: { success?: boolean; message?: string } = {};
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        console.error(
          `Forgot password: server returned non-JSON (status=${response.status} content-type=${contentType}) — likely a proxy or backend error`,
        );
        throw new Error(`Server error (${response.status}). Please try again later.`);
      }

      if (response.ok && data.success) {
        setSubmitted(true);
      } else {
        throw new Error(data.message || "Failed to send reset link");
      }
    } catch (error) {
      console.error("Forgot password error:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send reset link. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-center gap-2">
            <img src={HERO_LOGO_SRC} alt="Printers Hero" className="h-16 w-auto" />
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-6 w-6 text-green-500" />
                <CardTitle>Check Your Email</CardTitle>
              </div>
              <CardDescription>
                Password reset instructions sent
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertDescription>
                  If an account exists for <strong>{email}</strong>, you will receive a password reset link shortly.
                  The link will be valid for 1 hour.
                </AlertDescription>
              </Alert>

              <div className="text-sm text-muted-foreground space-y-2">
                <p>Didn't receive an email?</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Check your spam or junk folder</li>
                  <li>Verify the email address is correct</li>
                  <li>Try requesting a new link</li>
                </ul>
              </div>

              <div className="pt-4 space-y-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setSubmitted(false);
                    setEmail("");
                  }}
                >
                  Send Another Link
                </Button>
                <Link to="/login" className="block">
                  <Button variant="ghost" className="w-full">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Login
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center gap-2">
          <img src={HERO_LOGO_SRC} alt="Printers Hero" className="h-16 w-auto" />
          <p className="text-muted-foreground">Reset your password</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Forgot Password?</CardTitle>
            <CardDescription>
              Enter your email address and we'll send you a link to reset your password
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="email"
                  autoFocus
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Send Reset Link
              </Button>

              <Link to="/login" className="block">
                <Button variant="ghost" className="w-full">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Login
                </Button>
              </Link>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
