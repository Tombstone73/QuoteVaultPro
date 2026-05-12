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

export default function TermsPage() {
  return (
    <PublicPageLayout title="Terms of Service" description={`Last updated: ${LAST_UPDATED}`}>
      <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
        These Terms of Service ("Terms") govern your use of PrintersHero and TitanOS (collectively,
        the "Platform"), operated by {COMPANY_NAME} ("we," "us," or "our"). By accessing or
        using the Platform, you agree to these Terms. If you do not agree, do not use the Platform.
      </p>

      <Section title="1. Acceptance of Terms">
        <p>
          By using the Platform, you represent that you have the authority to bind your organization
          to these Terms. These Terms apply to all users, including organization owners,
          administrators, staff members, and anyone else who accesses the Platform under your
          organization's account.
        </p>
      </Section>

      <Section title="2. Use of the Platform">
        <p>
          Subject to these Terms, we grant your organization a limited, non-exclusive,
          non-transferable license to access and use TitanOS for your internal business operations
          related to print production, quoting, order management, and related workflows.
        </p>
        <p>You may not:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            Resell, sublicense, or share access to the Platform with organizations outside your
            account without our written consent.
          </li>
          <li>
            Use the Platform for any purpose that violates applicable law or these Terms.
          </li>
          <li>
            Reverse engineer, decompile, or attempt to extract the source code of the Platform.
          </li>
        </ul>
      </Section>

      <Section title="3. User Responsibilities">
        <p>You are responsible for:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            Maintaining the security of your account credentials and session. Do not share passwords
            or allow unauthorized access.
          </li>
          <li>
            Ensuring that all users added to your organization's account are authorized members of
            your team.
          </li>
          <li>
            Managing user roles and permissions appropriately to limit access to sensitive data.
          </li>
          <li>Keeping your account contact information accurate and up to date.</li>
        </ul>
        <p>
          You are responsible for any activity that occurs under your organization's account,
          regardless of who performed that activity.
        </p>
      </Section>

      <Section title="4. Accuracy of Financial and Accounting Data">
        <p>
          The Platform integrates with QuickBooks and may sync invoice, payment, and customer data.{" "}
          <strong className="text-foreground">
            The accuracy of all financial data, accounting records, and business data entered into or
            synced through TitanOS is your responsibility.
          </strong>
        </p>
        <p>
          We are not accountants, financial advisors, or auditors. The Platform is a workflow and
          production management tool. Any figures, totals, or synced records displayed in TitanOS
          should be verified against your authoritative accounting records before use in financial
          reporting, tax filings, or other compliance purposes.
        </p>
        <p>
          We are not liable for errors arising from incorrect data entry, misconfigured pricing
          formulas, or discrepancies between TitanOS and your QuickBooks account.
        </p>
      </Section>

      <Section title="5. Service Availability">
        <p>
          We aim to keep TitanOS available and reliable, but we do not guarantee uninterrupted
          access. The Platform may be temporarily unavailable due to:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            Planned maintenance windows (we will attempt to communicate these in advance).
          </li>
          <li>
            Infrastructure outages or third-party service disruptions outside our control.
          </li>
          <li>Security incidents requiring immediate response.</li>
        </ul>
        <p>We provide no uptime SLA unless separately agreed in writing.</p>
      </Section>

      <Section title="6. Limitation of Liability">
        <p>
          To the fullest extent permitted by applicable law, {COMPANY_NAME} shall not be liable
          for any indirect, incidental, special, consequential, or punitive damages, including loss
          of profits, business interruption, or data loss, arising from your use of or inability to
          use the Platform.
        </p>
        <p>
          Our total cumulative liability to you for any claims arising under these Terms shall not
          exceed the amount paid by your organization for the Platform in the three months
          immediately preceding the claim.
        </p>
      </Section>

      <Section title="7. Acceptable Use">
        <p>You agree not to use the Platform to:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Transmit unlawful, harmful, or fraudulent content.</li>
          <li>
            Attempt unauthorized access to other organizations' data or platform infrastructure.
          </li>
          <li>
            Perform automated scraping, crawling, or bulk data extraction beyond normal platform
            use.
          </li>
          <li>
            Introduce malware, scripts, or code intended to disrupt, damage, or exploit the
            Platform.
          </li>
          <li>
            Misrepresent your identity or organization to gain unauthorized access to accounts or
            data.
          </li>
        </ul>
        <p>Violation of this section may result in immediate account suspension.</p>
      </Section>

      <Section title="8. Intellectual Property">
        <p>
          The Platform and its underlying software, design, trademarks, and documentation are owned
          by {COMPANY_NAME}. Nothing in these Terms transfers ownership of our intellectual
          property to you.
        </p>
        <p>
          Your organization retains ownership of all data you enter into the Platform, including
          customer records, quotes, order history, and uploaded files. We do not claim ownership of
          your business data.
        </p>
      </Section>

      <Section title="9. Account Suspension and Termination">
        <p>We may suspend or terminate your access to the Platform:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>If you violate these Terms.</li>
          <li>
            If your account has been inactive for an extended period (we will provide notice where
            reasonably practicable).
          </li>
          <li>
            If required to do so by law or to protect the security of the Platform or other users.
          </li>
        </ul>
        <p>
          You may terminate your organization's account at any time by contacting us. Upon
          termination, your access to the Platform will be removed. You should export any data you
          need before requesting termination, as we cannot guarantee data retention after account
          closure.
        </p>
      </Section>

      <Section title="10. Changes to These Terms">
        <p>
          We may update these Terms from time to time. We will notify active users of material
          changes by email or in-platform notification. Continued use of the Platform after changes
          take effect constitutes acceptance of the updated Terms.
        </p>
      </Section>

      <Section title="11. Contact Information">
        <p>For questions about these Terms, contact:</p>
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
      </Section>
    </PublicPageLayout>
  );
}
