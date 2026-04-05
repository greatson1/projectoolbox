import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Projectoolbox",
  description: "How Projectoolbox collects, uses, and protects your personal data.",
};

const LAST_UPDATED = "1 April 2026";
const COMPANY = "PMGT Solutions Ltd";
const EMAIL = "privacy@projectoolbox.com";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[760px] mx-auto px-6 py-16">
        {/* Back */}
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-10 transition-colors">
          ← Back to Projectoolbox
        </Link>

        <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: {LAST_UPDATED}</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-8 text-sm leading-relaxed text-foreground/90">

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Who We Are</h2>
            <p>
              Projectoolbox is operated by <strong>{COMPANY}</strong>, a company registered in England and Wales.
              We provide an AI-powered project management platform at{" "}
              <a href="https://www.projectoolbox.com" className="text-primary underline underline-offset-2">
                www.projectoolbox.com
              </a>.
            </p>
            <p className="mt-2">
              For questions about this policy, contact us at{" "}
              <a href={`mailto:${EMAIL}`} className="text-primary underline underline-offset-2">{EMAIL}</a>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">2. What Data We Collect</h2>
            <p>We collect the following categories of personal data:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Account data:</strong> Name, email address, password (hashed), organisation name, industry, and role — provided when you register.</li>
              <li><strong>Usage data:</strong> Actions taken within the platform, feature usage, session metadata, and AI interaction logs.</li>
              <li><strong>Project data:</strong> Content you enter into the platform including project plans, risks, schedules, and documents. This is your data and we act as a data processor.</li>
              <li><strong>Billing data:</strong> Payment method details processed by our payment provider (Stripe). We do not store card numbers.</li>
              <li><strong>Technical data:</strong> IP address, browser type, operating system, device identifiers, and cookies.</li>
              <li><strong>Communications:</strong> Emails and support messages you send us.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">3. How We Use Your Data</h2>
            <p>We use your personal data to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Provide, maintain, and improve the Projectoolbox platform</li>
              <li>Process payments and manage your subscription</li>
              <li>Send transactional emails (account confirmation, password reset, billing notifications)</li>
              <li>Send product updates and newsletters (you may opt out at any time)</li>
              <li>Respond to support requests</li>
              <li>Monitor and analyse usage to improve performance and security</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">4. Legal Basis for Processing (UK/EU)</h2>
            <p>Under UK GDPR and EU GDPR, we process your data on the following legal bases:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Contract:</strong> To fulfil our obligations under our Terms of Service.</li>
              <li><strong>Legitimate interests:</strong> To improve our product, prevent fraud, and ensure security.</li>
              <li><strong>Consent:</strong> For marketing emails and optional cookies. You may withdraw consent at any time.</li>
              <li><strong>Legal obligation:</strong> Where required by law.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">5. Data Sharing</h2>
            <p>We do not sell your personal data. We share data only with:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Supabase</strong> — database and authentication hosting</li>
              <li><strong>Anthropic</strong> — AI model provider. Queries are processed per Anthropic&apos;s data policies. Your data is not used to train their models under our enterprise agreement.</li>
              <li><strong>Stripe</strong> — payment processing</li>
              <li><strong>Vercel</strong> — hosting and CDN</li>
              <li><strong>Recall.ai</strong> — meeting bot functionality (Professional and Business plans only)</li>
              <li>Law enforcement or regulatory bodies where required by law</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">6. Data Retention</h2>
            <p>
              We retain your account data for as long as your account is active. If you delete your account,
              we delete personal data within 30 days, except where retention is required by law (e.g., billing records
              retained for 7 years under UK tax law).
            </p>
            <p className="mt-2">
              Project data (content you have entered) is deleted within 30 days of account deletion.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">7. Your Rights</h2>
            <p>Under UK GDPR and EU GDPR you have the right to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Access</strong> — request a copy of the personal data we hold about you</li>
              <li><strong>Rectification</strong> — correct inaccurate or incomplete data</li>
              <li><strong>Erasure</strong> — request deletion of your data ("right to be forgotten")</li>
              <li><strong>Restriction</strong> — limit how we process your data</li>
              <li><strong>Portability</strong> — receive your data in a machine-readable format</li>
              <li><strong>Object</strong> — object to processing based on legitimate interests</li>
              <li><strong>Withdraw consent</strong> — at any time, without affecting prior processing</li>
            </ul>
            <p className="mt-2">
              To exercise any of these rights, email us at{" "}
              <a href={`mailto:${EMAIL}`} className="text-primary underline underline-offset-2">{EMAIL}</a>.
              We will respond within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">8. Cookies</h2>
            <p>
              We use strictly necessary cookies for authentication and session management.
              We use analytics cookies (Google Analytics) to understand usage. You can opt out of analytics cookies
              via our cookie banner or by visiting{" "}
              <a href="https://tools.google.com/dlpage/gaoptout" className="text-primary underline underline-offset-2" target="_blank" rel="noopener noreferrer">
                Google Analytics Opt-out
              </a>.
            </p>
            <p className="mt-2">
              For full details see our{" "}
              <Link href="/legal/gdpr" className="text-primary underline underline-offset-2">Cookie & GDPR Policy</Link>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">9. International Transfers</h2>
            <p>
              Your data may be processed outside the UK/EEA (for example on Anthropic&apos;s US-based infrastructure).
              Where this occurs, we ensure appropriate safeguards are in place such as Standard Contractual Clauses (SCCs)
              or adequacy decisions.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">10. Security</h2>
            <p>
              We implement industry-standard security measures including encryption in transit (TLS) and at rest,
              role-based access controls, and regular security reviews. However, no system is completely secure
              and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">11. Changes to This Policy</h2>
            <p>
              We may update this policy from time to time. We will notify you of material changes by email
              or by displaying a notice in the platform. Your continued use of the service after changes
              constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">12. Complaints</h2>
            <p>
              If you are unhappy with how we handle your data, you have the right to lodge a complaint with the
              UK Information Commissioner&apos;s Office (ICO) at{" "}
              <a href="https://ico.org.uk" className="text-primary underline underline-offset-2" target="_blank" rel="noopener noreferrer">
                ico.org.uk
              </a>.
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-border flex flex-wrap gap-4 text-xs text-muted-foreground">
          <Link href="/legal/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
          <Link href="/legal/gdpr" className="hover:text-foreground transition-colors">GDPR Policy</Link>
          <Link href="/legal/security" className="hover:text-foreground transition-colors">Security</Link>
          <Link href="/contact" className="hover:text-foreground transition-colors">Contact Us</Link>
        </div>
      </div>
    </div>
  );
}
