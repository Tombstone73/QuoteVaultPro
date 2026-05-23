import { Mail, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicPageLayout } from "@/components/layout/PublicPageLayout";

const SUPPORT_EMAIL = "support@printershero.com";

const INTEGRATIONS = [
  {
    name: "QuickBooks Online",
    description:
      "Sync invoices, customers, and payment records with your QuickBooks company file. Push invoices directly from Printers Hero without re-entering data.",
  },
  {
    name: "Google Workspace",
    description:
      "Connect Google Calendar for job scheduling, Google Drive for file attachments, and Gmail for customer communication workflows.",
  },
  {
    name: "Production Workflow",
    description:
      "Built-in prepress, proofing, and production board tools that integrate directly with your quote and order pipeline — no separate app needed.",
  },
  {
    name: "Customer Portal",
    description:
      "Customers can review proofs, approve quotes, and track orders through a dedicated portal. No Printers Hero account required - access is token-based.",
  },
];

const COMMON_TOPICS = [
  {
    title: "Connecting QuickBooks",
    body: (
      <>
        Go to <strong className="text-foreground">Settings → Integrations</strong> and click
        "Connect QuickBooks." You'll be redirected to Intuit's OAuth authorization page. Once
        approved, your QuickBooks company data will begin syncing automatically.
      </>
    ),
  },
  {
    title: "Inviting team members",
    body: (
      <>
        Owners and admins can invite users under{" "}
        <strong className="text-foreground">Settings → Users</strong>. Invited users receive an
        email with a link to set their password and join your organization.
      </>
    ),
  },
  {
    title: "Pricing formulas",
    body: (
      <>
        Pricing formulas define how quotes are calculated for your products. Configure them under{" "}
        <strong className="text-foreground">Settings → Pricing Formulas</strong>. The in-app
        formula reference includes syntax documentation and copy-paste examples to get you started.
      </>
    ),
  },
  {
    title: "Proof approvals",
    body: (
      <>
        Customers receive a proof review link via email. They do not need a Printers Hero account to
        review or approve proofs. The link is valid until the proof is actioned or the job is
        closed.
      </>
    ),
  },
  {
    title: "Resetting a user's password",
    body: (
      <>
        Users can request a password reset from the sign-in page. Admins can also resend an
        invitation from <strong className="text-foreground">Settings → Users</strong> to let a
        user re-set their credentials.
      </>
    ),
  },
];

export default function SupportPage() {
  return (
    <PublicPageLayout
      title="Support"
      description="We're here to help you get the most out of Printers Hero."
    >
      {/* Contact cards */}
      <div className="grid sm:grid-cols-2 gap-4 mb-10">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              Email Support
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">
              Send questions, bug reports, or feature requests to:
            </p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-sm font-medium text-primary hover:underline underline-offset-4"
            >
              {SUPPORT_EMAIL}
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Response Times
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              We aim to respond to all support requests within{" "}
              <strong className="text-foreground">1–2 business days</strong> during normal business
              hours (Monday–Friday, 8 am–6 pm ET).
            </p>
          </CardContent>
        </Card>
      </div>

      {/* About */}
      <section className="mb-8">
        <h2 className="text-base font-semibold mb-3 pb-2 border-b text-foreground">
          About Printers Hero
        </h2>
        <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            <strong className="text-foreground">Printers Hero</strong> is a production management and
            quoting platform built for print shops. It handles the full workflow from customer quote
            to production job, shipping, and invoicing — all in one place.
          </p>
          <p>
            Printers Hero is designed to replace fragmented spreadsheets and disconnected tools with a
            single system your team can use across quoting, prepress, production, fulfillment, and
            accounting.
          </p>
        </div>
      </section>

      {/* Integrations */}
      <section className="mb-8">
        <h2 className="text-base font-semibold mb-3 pb-2 border-b text-foreground">
          Supported Integrations
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {INTEGRATIONS.map((item) => (
            <div key={item.name} className="border rounded-md p-3 space-y-1">
              <p className="text-sm font-medium text-foreground">{item.name}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Common topics */}
      <section className="mb-8">
        <h2 className="text-base font-semibold mb-3 pb-2 border-b text-foreground">
          Common Support Topics
        </h2>
        <div className="space-y-4">
          {COMMON_TOPICS.map((topic) => (
            <div key={topic.title}>
              <p className="text-sm font-medium text-foreground mb-1">{topic.title}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{topic.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Get in touch */}
      <section className="mb-4">
        <h2 className="text-base font-semibold mb-3 pb-2 border-b text-foreground">
          Get in Touch
        </h2>
        <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
          <p>
            For all support inquiries, billing questions, integration issues, or general feedback,
            reach us at:
          </p>
          <p>
            <strong className="text-foreground">Email:</strong>{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
          <p>
            Please include your organization name, a description of the issue, and any relevant
            screenshots or error messages. This helps us respond faster and more accurately.
          </p>
        </div>
      </section>
    </PublicPageLayout>
  );
}
