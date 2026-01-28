import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ConfigErrorProps {
  error: string;
}

/**
 * Full-page configuration error display.
 * Shown when critical environment variables are missing in production.
 */
export function ConfigError({ error }: ConfigErrorProps) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full border-destructive">
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <div>
              <CardTitle className="text-2xl">Configuration Error</CardTitle>
              <CardDescription>Application cannot start due to missing configuration</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
            <p className="text-sm font-mono text-foreground">{error}</p>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">For Administrators:</h3>
              <p className="text-sm text-muted-foreground mb-3">
                This application requires the <code className="bg-muted px-1.5 py-0.5 rounded text-xs">VITE_API_BASE_URL</code> environment variable to be set in your deployment platform (Vercel).
              </p>
              
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Required Environment Variable:</p>
                <code className="block text-xs bg-background p-2 rounded border">
                  VITE_API_BASE_URL=https://quotevaultpro-production.up.railway.app
                </code>
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Setup Steps:</h3>
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li>Go to your Vercel project dashboard</li>
                <li>Navigate to Settings → Environment Variables</li>
                <li>Add <code className="bg-muted px-1 py-0.5 rounded text-xs">VITE_API_BASE_URL</code> with the Railway backend URL</li>
                <li>Redeploy the application</li>
              </ol>
            </div>

            <div className="pt-4 border-t">
              <Button 
                onClick={() => window.location.reload()} 
                variant="outline"
                className="w-full"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry After Configuration
              </Button>
            </div>
          </div>

          <div className="text-xs text-muted-foreground text-center pt-4 border-t">
            <p>For more information, see the deployment documentation.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
