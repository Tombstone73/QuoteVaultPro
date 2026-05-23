import { useEffect } from "react";
import { Link } from "react-router-dom";
import { SHIELD_LOGO_SRC } from "@/lib/branding";

interface PublicPageLayoutProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function PublicFooter() {
  return (
    <footer className="border-t bg-background mt-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
        <p>© 2026 Workflow Dynamics Group, LLC. All rights reserved.</p>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 justify-center">
          <Link to="/privacy" className="hover:text-foreground transition-colors">
            Privacy Policy
          </Link>
          <Link to="/terms" className="hover:text-foreground transition-colors">
            Terms of Service
          </Link>
          <Link to="/support" className="hover:text-foreground transition-colors">
            Support
          </Link>
        </nav>
      </div>
    </footer>
  );
}

export function PublicPageLayout({ title, description, children }: PublicPageLayoutProps) {
  useEffect(() => {
    document.title = `${title} - Printers Hero`;
    return () => {
      document.title = "Printers Hero";
    };
  }, [title]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link
            to="/login"
            className="flex items-center gap-2 text-foreground hover:text-primary transition-colors"
          >
            <img src={SHIELD_LOGO_SRC} alt="" className="h-5 w-5" aria-hidden="true" />
            <span className="font-semibold text-sm">Printers Hero</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/support" className="text-muted-foreground hover:text-foreground transition-colors">
              Support
            </Link>
            <Link
              to="/login"
              className="font-medium text-primary hover:underline underline-offset-4"
            >
              Sign In
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{title}</h1>
          {description && (
            <p className="text-muted-foreground mt-2 text-sm">{description}</p>
          )}
        </div>
        {children}
      </main>

      <PublicFooter />
    </div>
  );
}
