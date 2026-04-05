import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GDPR & Cookie Policy — Projectoolbox",
  description: "Our commitments under UK GDPR and EU GDPR, and how we use cookies.",
};

const LAST_UPDATED = "1 April 2026";
const EMAIL = "privacy@projectoolbox.com";

export default function GdprPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[760px] mx-auto px-6 py-16">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-10 transition-colors">
          ← Back to Projectoolbox
        </Link>

        <h1 className="text-4xl font-bold mb-2">GDPR &amp; Cookie Policy</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: {LAST_UPDATED}</p>

        <div className="space-y-8 text-sm leading-relaxed text-foreground/90">

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Our GDPR Commitment</h2>
            <p>
              Projectoolbox is committed to complying with the UK General Data Protection Regulation (UK GDPR)
              and, where applicable, the EU General Data Protection Regulation (EU GDPR).
              This page explains our key commitments and how to exercise your rights.
            </p>
            <p className="mt-2">
              For full details on how we collect and use your personal data, please read our{" "}
              <Link href="/legal/privacy" className="text-primary underline underline-offset-2">Privacy Policy</Link>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">2. Data Controller</h2>
            <p>
              <strong>PMGT Solutions Ltd</strong> is the data controller for personal data collected through the
              Projectoolbox platform. Where you upload project data, we act as a data <em>processor</em> on
              your behalf — you remain the controller of that content.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">3. Your Rights Under GDPR</h2>
            <p>You have the following rights regarding your personal data:</p>
            <div className="mt-3 space-y-3">
              {[
                { right: "Right of Access", desc: "Request a copy of all personal data we hold about you (Subject Access Request)." },
                { right: "Right to Rectification", desc: "Ask us to correct inaccurate or incomplete data." },
                { right: "Right to Erasure", desc: 'Request deletion of your personal data ("right to be forgotten"). Some data may be retained for legal reasons.' },
                { right: "Right to Restriction", desc: "Ask us to restrict processing of your data in certain circumstances." },
                { right: "Right to Data Portability", desc: "Receive your data in a structured, machine-readable format (JSON or CSV)." },
                { right: "Right to Object", desc: "Object to processing based on our legitimate interests or for direct marketing." },
                { right: "Right to Withdraw Consent", desc: "Withdraw consent at any time where processing is based on consent." },
                { right: "Right Not to Be Subject to Automated Decisions", desc: "Request human review of any significant automated decisions." },
              ].map(({ right, desc }) => (
                <div key={right} className="pl-4 border-l-2 border-primary/30">
                  <p className="font-semibold text-foreground">{right}</p>
                  <p className="text-muted-foreground mt-0.5">{desc}</p>
                </div>
              ))}
            </div>
            <p className="mt-4">
              To exercise any right, email{" "}
              <a href={`mailto:${EMAIL}`} className="text-primary underline underline-offset-2">{EMAIL}</a>.
              We will respond within <strong>30 days</strong> (extendable to 90 days for complex requests, with notice).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">4. International Data Transfers</h2>
            <p>
              We use sub-processors located outside the UK/EEA. Where personal data is transferred internationally,
              we ensure adequate protections through:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>UK adequacy regulations or EU Commission adequacy decisions</li>
              <li>Standard Contractual Clauses (SCCs) approved by the ICO or European Commission</li>
              <li>The UK International Data Transfer Agreement (IDTA) where applicable</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">5. Sub-Processors</h2>
            <p>We use the following sub-processors to deliver the Service:</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 font-semibold text-foreground">Sub-processor</th>
                    <th className="text-left py-2 pr-4 font-semibold text-foreground">Purpose</th>
                    <th className="text-left py-2 font-semibold text-foreground">Location</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  {[
                    ["Supabase", "Database, authentication, storage", "US (AWS)"],
                    ["Anthropic", "AI model processing", "US"],
                    ["Stripe", "Payment processing", "US"],
                    ["Vercel", "Hosting, CDN, edge functions", "US / Global"],
                    ["Recall.ai", "Meeting bot transcription", "US"],
                    ["Google Analytics", "Usage analytics", "US"],
                  ].map(([name, purpose, location]) => (
                    <tr key={name} className="border-b border-border/50">
                      <td className="py-2 pr-4 font-medium text-foreground">{name}</td>
                      <td className="py-2 pr-4">{purpose}</td>
                      <td className="py-2">{location}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">6. Cookie Policy</h2>
            <p>We use the following categories of cookies:</p>

            <div className="mt-4 space-y-4">
              <div>
                <h3 className="font-semibold text-foreground">Strictly Necessary Cookies</h3>
                <p className="text-muted-foreground mt-1">
                  Required for the platform to function. These include session tokens, CSRF protection,
                  and authentication state. They cannot be disabled.
                </p>
                <p className="text-xs text-muted-foreground mt-1">Examples: <code>next-auth.session-token</code>, <code>__Host-next-auth.csrf-token</code></p>
              </div>

              <div>
                <h3 className="font-semibold text-foreground">Analytics Cookies</h3>
                <p className="text-muted-foreground mt-1">
                  We use Google Analytics 4 to understand how the platform is used.
                  These cookies collect anonymised data about page visits, feature usage, and navigation.
                </p>
                <p className="text-xs text-muted-foreground mt-1">Examples: <code>_ga</code>, <code>_ga_*</code></p>
                <p className="mt-2">
                  You can opt out of analytics cookies at any time via our cookie banner or by installing the{" "}
                  <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2">
                    Google Analytics Opt-out Browser Add-on
                  </a>.
                </p>
              </div>

              <div>
                <h3 className="font-semibold text-foreground">Preference Cookies</h3>
                <p className="text-muted-foreground mt-1">
                  Store your preferences such as theme (light/dark mode) and UI settings.
                </p>
                <p className="text-xs text-muted-foreground mt-1">Examples: <code>theme</code></p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">7. Complaints</h2>
            <p>
              If you are unhappy with how we handle your data, you have the right to lodge a complaint with:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>
                <strong>UK:</strong>{" "}
                <a href="https://ico.org.uk/make-a-complaint" target="_blank" rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2">
                  Information Commissioner&apos;s Office (ICO)
                </a>
              </li>
              <li>
                <strong>EU:</strong> Your local data protection authority
              </li>
            </ul>
            <p className="mt-2">
              We would appreciate the opportunity to address your concerns first — please contact us at{" "}
              <a href={`mailto:${EMAIL}`} className="text-primary underline underline-offset-2">{EMAIL}</a>{" "}
              before escalating to a supervisory authority.
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-border flex flex-wrap gap-4 text-xs text-muted-foreground">
          <Link href="/legal/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          <Link href="/legal/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
          <Link href="/legal/security" className="hover:text-foreground transition-colors">Security</Link>
          <Link href="/contact" className="hover:text-foreground transition-colors">Contact Us</Link>
        </div>
      </div>
    </div>
  );
}
