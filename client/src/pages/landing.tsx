import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calculator, FileText, Settings, TrendingUp } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calculator className="w-6 h-6 text-primary" data-testid="logo-calculator" />
            <h1 className="text-xl font-semibold" data-testid="text-app-title">Pricing Calculator</h1>
          </div>
          <Button asChild data-testid="button-login">
            <a href="/api/login">Sign In</a>
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center mb-16">
          <h2 className="text-4xl font-bold mb-4" data-testid="text-hero-title">
            Professional Pricing Calculator
          </h2>
          <p className="text-lg text-muted-foreground mb-8" data-testid="text-hero-description">
            Generate accurate quotes for business cards, postcards, flyers, and more. 
            Save your quote history and manage pricing with ease.
          </p>
          <Button size="lg" asChild data-testid="button-get-started">
            <a href="/api/login">Get Started</a>
          </Button>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          <Card data-testid="card-feature-calculator">
            <CardHeader>
              <Calculator className="w-10 h-10 mb-2 text-primary" />
              <CardTitle>Smart Calculator</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Select products, enter dimensions and quantities to get instant, accurate pricing
              </CardDescription>
            </CardContent>
          </Card>

          <Card data-testid="card-feature-history">
            <CardHeader>
              <FileText className="w-10 h-10 mb-2 text-primary" />
              <CardTitle>Quote History</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Save and search all your quotes with advanced filtering by customer, date, and product
              </CardDescription>
            </CardContent>
          </Card>

          <Card data-testid="card-feature-admin">
            <CardHeader>
              <Settings className="w-10 h-10 mb-2 text-primary" />
              <CardTitle>Admin Dashboard</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Manage products, pricing formulas, and view system-wide analytics and reports
              </CardDescription>
            </CardContent>
          </Card>

          <Card data-testid="card-feature-analytics">
            <CardHeader>
              <TrendingUp className="w-10 h-10 mb-2 text-primary" />
              <CardTitle>Analytics</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Track popular products, active users, and export data for production planning
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
