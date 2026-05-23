import { PublicPageLayout } from "@/components/layout/PublicPageLayout";

const LAST_UPDATED = "May 2026";
const CONTACT_EMAIL = "support@printershero.com";
const COMPANY_NAME = "Workflow Dynamics Group, LLC";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold mb-3 pb-2 border-b text-foreground">{title}</h2>
      <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <PublicPageLayout title="Privacy Policy" description={`Last updated: ${LAST_UPDATED}`}>
      <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
        Printers Hero, a {COMPANY_NAME} platform, provides a print shop management and quoting
        platform for printing businesses and their teams. This Privacy Policy describes how
        we collect, use, and protect information when you use our platform.
      </p>

      <Section title="1. Information We Collect">
        <p>We collect the following categories of information:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">Account information:</strong> Your name, work email
            address, and organization details provided during registration or invitation.
          </li>
          <li>
            <strong className="text-foreground">Business data:</strong> Quotes, orders, customer
            records, product configurations, pricing formulas, and production job information entered
            into the platform.
          </li>
          <li>
            <strong className="text-foreground">Accounting data:</strong> Invoice records and customer
            accounting data synchronized through connected integrations (e.g., QuickBooks).
          </li>
          <li>
            <strong className="text-foreground">Usage data:</strong> Log entries, page views, and
            feature usage information used to operate and improve the platform.
          </li>
          <li>
            <strong className="text-foreground">Integration credentials:</strong> OAuth tokens for
            connected third-party services (QuickBooks, Google). We store tokens necessary to maintain
            integrations — we do not store passwords for those services.
          </li>
        </ul>
      </Section>

      <Section title="2. OAuth Integrations">
        <p>
          Printers Hero supports OAuth-based integrations with third-party platforms. When you authorize
          a connection, we receive and store the access and refresh tokens needed to operate that
          integration on behalf of your organization.
        </p>
        <p>
          <strong className="text-foreground">QuickBooks:</strong>
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            We request access to your QuickBooks company data to sync invoices, customers, and payment
            records.
          </li>
          <li>
            Data pulled from QuickBooks is stored within your organization's workspace in Printers Hero for
            reference and reporting.
          </li>
          <li>
            We do not write to QuickBooks without an explicit user-initiated action (such as pushing
            an invoice).
          </li>
        </ul>
        <p className="mt-3">
          <strong className="text-foreground">Google (Calendar, Drive, Gmail):</strong>
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            If you connect Google, we may request scopes for Calendar (job scheduling), Drive (file
            attachments), and/or Gmail (email delivery and read access), depending on which features
            your organization enables.
          </li>
          <li>We only request the minimum permissions needed for the features you activate.</li>
          <li>
            Google account data is used solely to operate the integration — it is not used for
            advertising or shared with third parties.
          </li>
        </ul>
        <p className="mt-3">
          You can revoke any integration at any time from{" "}
          <strong className="text-foreground">Settings → Integrations</strong> within Printers Hero.
          Revoking an integration removes the stored tokens from our system immediately.
        </p>
      </Section>

      <Section title="3. How We Use Your Data">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>To operate and deliver the Printers Hero platform and its features.</li>
          <li>
            To process quotes, orders, production jobs, and invoices on your behalf.
          </li>
          <li>
            To synchronize data with connected integrations (QuickBooks, Google) as authorized by
            your organization.
          </li>
          <li>
            To send transactional notifications related to your account and jobs (proof approvals,
            order status updates, invitations).
          </li>
          <li>
            To diagnose errors, investigate bugs, and improve platform reliability.
          </li>
          <li>To comply with applicable legal obligations.</li>
        </ul>
        <p>
          We do not sell your data. We do not use your business data for advertising purposes.
        </p>
      </Section>

      <Section title="4. Data Security">
        <p>
          We take reasonable technical and organizational measures to protect your data, including:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Encryption in transit (HTTPS/TLS) for all data exchanged with the platform.</li>
          <li>Encrypted storage of OAuth tokens and sensitive credentials.</li>
          <li>Session-based authentication with automatic expiration.</li>
          <li>
            Role-based access controls limiting which users can view or modify data within an
            organization.
          </li>
          <li>Routine security reviews of dependencies and infrastructure.</li>
        </ul>
        <p>
          No system is perfectly secure. If you believe your account has been compromised, contact us
          immediately at{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>

      <Section title="5. Multi-Tenant Organization Separation">
        <p>
          Printers Hero is a multi-tenant platform. Each organization's data is logically isolated - users
          can only access data belonging to their own organization. Users with multi-organization
          access (platform administrators) are subject to additional access controls.
        </p>
        <p>
          Your organization's customers, quotes, orders, products, and pricing data are never
          accessible to other organizations using the platform.
        </p>
      </Section>

      <Section title="6. Cookies and Sessions">
        <p>
          We use session cookies to maintain your authenticated state while you use Printers Hero. These
          cookies are necessary for the platform to function and are not used for advertising or
          cross-site tracking.
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">Session cookies:</strong> Set when you sign in.
            Expire when the session ends or you sign out.
          </li>
          <li>
            <strong className="text-foreground">Preference cookies:</strong> Store UI preferences
            such as theme settings. These are functional and not shared with third parties.
          </li>
        </ul>
        <p>
          We do not use third-party analytics cookies, advertising cookies, or tracking pixels.
        </p>
      </Section>

      <Section title="7. Third-Party Providers">
        <p>
          We work with a limited set of third-party providers to operate the platform. These providers
          process data only as necessary to deliver their services to us:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">Cloud infrastructure:</strong> Hosting, storage, and
            database services.
          </li>
          <li>
            <strong className="text-foreground">Email delivery:</strong> Transactional email sending
            (order confirmations, proof requests, invitations).
          </li>
          <li>
            <strong className="text-foreground">QuickBooks Online:</strong> Accounting integration
            via Intuit's API.
          </li>
          <li>
            <strong className="text-foreground">Google Workspace APIs:</strong> Calendar, Drive, and
            Gmail integrations.
          </li>
        </ul>
        <p>
          We do not share your data with marketing platforms, data brokers, or unrelated third
          parties.
        </p>
      </Section>

      <Section title="8. Your Rights and Revoking Integrations">
        <p>
          Depending on applicable law, you may have rights to access, correct, export, or delete your
          personal data. To exercise these rights or to request deletion of your account data, contact
          us at{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <p>To revoke a third-party integration:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            Within Printers Hero: go to{" "}
            <strong className="text-foreground">Settings → Integrations</strong> and disconnect the
            service.
          </li>
          <li>
            Within QuickBooks: visit the Intuit developer portal and revoke app access from your
            QuickBooks account settings.
          </li>
          <li>
            Within Google: visit{" "}
            <strong className="text-foreground">myaccount.google.com/permissions</strong> and revoke
            Printers Hero's access.
          </li>
        </ul>
        <p>
          Revoking an integration from Printers Hero removes the stored token immediately. It does not
          delete historical data that was synced before revocation.
        </p>
      </Section>

      <Section title="9. Contact Information">
        <p>
          For privacy questions, data requests, or security concerns, contact us at:
        </p>
        <p>
          <strong className="text-foreground">Email:</strong>{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
        <p>
          <strong className="text-foreground">Company:</strong> {COMPANY_NAME}
        </p>
        <p className="text-xs mt-4 text-muted-foreground/70">
          We may update this Privacy Policy from time to time. The "Last updated" date at the top of
          this page reflects the most recent revision. Continued use of the platform after changes
          are posted constitutes acceptance of the updated policy.
        </p>
      </Section>
    </PublicPageLayout>
  );
}
