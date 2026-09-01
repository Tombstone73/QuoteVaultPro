import { useState, FormEvent, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { getApiUrl } from "@/lib/apiConfig";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiFetch } from "@/lib/queryClient";
import { HERO_LOGO_SRC, SHIELD_LOGO_SRC, SPLASH_STATIC_SRC } from "@/lib/branding";
import { sanitizePortalReturnTarget } from "@shared/portalReturnTarget";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: authLoading, user, isPortalCustomer } = useAuth();
  const returnTo = sanitizePortalReturnTarget(new URLSearchParams(location.search).get("returnTo"));

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(isPortalCustomer ? returnTo : "/dashboard", { replace: true });
    }
  }, [isAuthenticated, authLoading, navigate, isPortalCustomer, returnTo]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await apiFetch(getApiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Invalid credentials");
      }

      const data = await response.json();

      if (data.success) {
        if (process.env.NODE_ENV !== "production") {
          const sessionCheck = await apiFetch(getApiUrl("/api/auth/session"), {
            credentials: "include",
          });
          console.log(`[AuthDiag] post-login /api/auth/session status=${sessionCheck.status}`);
        }

        // Debug logging (non-production only)
        if (process.env.NODE_ENV !== "production") {
          console.log("[Login] Success, invalidating auth query and redirecting");
        }
        
        // Invalidate auth query to trigger refetch with new session
        await queryClient.invalidateQueries({ queryKey: [getApiUrl("/api/auth/session")], exact: true });
        
        toast({
          title: "Logged in",
          description: "Welcome back!",
        });
        
        // Use window.location.assign for absolute certainty of navigation
        // This bypasses React Router and guarantees we enter the app
        const loginUser = data.user || user;
        const portalLogin = loginUser?.accountType === "PORTAL_CUSTOMER" || loginUser?.role === "customer";
        window.location.assign(portalLogin ? returnTo : "/dashboard");
      } else {
        throw new Error("Login failed");
      }
    } catch (error) {
      console.error("Login error:", error);
      toast({
        title: "Login failed",
        description: error instanceof Error ? error.message : "Invalid email or password",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#05080d] p-4 text-white">
      <img
        src={SPLASH_STATIC_SRC}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover object-center opacity-[0.18] blur-[2px]"
      />
      <div className="pointer-events-none absolute inset-0 bg-[#05080d]/78" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(0,169,224,0.2),transparent_34%),radial-gradient(circle_at_70%_70%,rgba(255,45,149,0.12),transparent_32%),linear-gradient(180deg,rgba(5,8,13,0.55)_0%,#05080d_100%)]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#00a9e0]/10 blur-[140px]" />

      <div className="relative z-10 w-full max-w-md space-y-7 sm:space-y-8">
        <div className="flex flex-col items-center gap-4">
          <img
            src={HERO_LOGO_SRC}
            alt="Printers Hero"
            className="w-[min(76vw,300px)] max-w-full drop-shadow-[0_18px_45px_rgba(0,0,0,0.45)] sm:w-[300px]"
          />
          <p className="text-sm font-medium text-slate-300">Print shop workflow software</p>
        </div>

        <Card className="border-white/[0.12] bg-[#0b1018]/88 text-white shadow-[0_24px_90px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.04)] backdrop-blur-xl">
          <CardHeader className="space-y-3 pb-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] shadow-[0_0_35px_rgba(0,169,224,0.18)]">
              <img src={SHIELD_LOGO_SRC} alt="" className="h-7 w-7" aria-hidden="true" />
            </div>
            <CardTitle className="text-2xl">Welcome back</CardTitle>
            <CardDescription className="text-slate-400">
              Sign in to Printers Hero.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-slate-200">
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
                  className="border-white/10 bg-white/[0.06] text-white placeholder:text-slate-500 focus-visible:ring-[#00a9e0]"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium text-slate-200">
                  Password
                </label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                    autoComplete="current-password"
                    className="border-white/10 bg-white/[0.06] pr-10 text-white placeholder:text-slate-500 focus-visible:ring-[#00a9e0]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-slate-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00a9e0] focus-visible:ring-offset-1 focus-visible:ring-offset-[#0b1018]"
                    tabIndex={0}
                    disabled={loading}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="text-right">
                  <a
                    href="/forgot-password"
                    className="text-sm text-slate-400 transition-colors hover:text-[#00a9e0]"
                  >
                    Forgot password?
                  </a>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full border-0 bg-[#ffd400] font-semibold text-[#05080d] shadow-[0_0_35px_rgba(255,212,0,0.16)] hover:bg-[#ffe45c]"
                disabled={loading}
              >
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Sign In
              </Button>
            </form>

            {process.env.NODE_ENV === "development" && (
              <div className="mt-6 border-t border-white/10 pt-6">
                <p className="mb-2 text-xs text-slate-500">Development mode: Any email works</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-white/15 bg-transparent text-white hover:bg-white/10"
                  onClick={() => {
                    setEmail("test@local.dev");
                    setPassword("password");
                  }}
                >
                  Fill Test Credentials
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
