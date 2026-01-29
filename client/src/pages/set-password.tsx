import * as React from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TitanCard } from "@/components/titan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getApiUrl } from "@/lib/apiConfig";
import { Loader2, Lock, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export default function SetPasswordPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Redirect if user doesn't need to set password
  React.useEffect(() => {
    if (user && !user.mustSetPassword) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, navigate]);

  const setPasswordMutation = useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      const response = await fetch(getApiUrl("/api/auth/set-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Failed to set password");
      }
      return result;
    },
    onSuccess: () => {
      toast({
        title: "Password set successfully",
        description: "You can now access your account",
      });
      // Invalidate user query to refresh mustSetPassword flag
      queryClient.invalidateQueries({ queryKey: [getApiUrl("/api/auth/user")] });
      // Navigate to dashboard
      setTimeout(() => {
        navigate("/dashboard", { replace: true });
      }, 500);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (newPassword.length < 10) {
      toast({
        title: "Password too short",
        description: "New password must be at least 10 characters",
        variant: "destructive",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "New password and confirmation must match",
        variant: "destructive",
      });
      return;
    }

    setPasswordMutation.mutate({
      currentPassword,
      newPassword,
    });
  };

  return (
    <div className="min-h-screen bg-titan-bg-app flex items-center justify-center p-4">
      <TitanCard className="w-full max-w-md p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mb-4">
            <Lock className="h-6 w-6 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-titan-text-primary">Set New Password</h1>
          <p className="text-sm text-titan-text-secondary text-center mt-2">
            You're logging in with a temporary password. Please set a new password to continue.
          </p>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 mb-6 flex items-start gap-2">
          <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            Your new password must be at least 10 characters long and different from your temporary password.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">
              Current Password (Temporary)
            </Label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              placeholder="Enter temporary password from email"
              autoComplete="current-password"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword">
              New Password
            </Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              placeholder="At least 10 characters"
              autoComplete="new-password"
            />
            {newPassword && newPassword.length < 10 && (
              <p className="text-xs text-red-600">
                Password must be at least 10 characters
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">
              Confirm New Password
            </Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              placeholder="Re-enter new password"
              autoComplete="new-password"
            />
            {confirmPassword && newPassword !== confirmPassword && (
              <p className="text-xs text-red-600">
                Passwords don't match
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={setPasswordMutation.isPending}
          >
            {setPasswordMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Setting Password...
              </>
            ) : (
              "Set New Password"
            )}
          </Button>
        </form>

        <p className="text-xs text-titan-text-secondary text-center mt-6">
          Having trouble? Contact your system administrator for assistance.
        </p>
      </TitanCard>
    </div>
  );
}
