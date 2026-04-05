import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Projectoolbox",
  description: "Terms governing your use of the Projectoolbox platform.",
};

const LAST_UPDATED = "1 April 2026";
const COMPANY = "PMGT Solutions Ltd";
const EMAIL = "legal@projectoolbox.com";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[760px] mx-auto px-6 py-16">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-10 transition-colors">
          ← Back to Projectoolbox
        </Link>

        <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: {LAST_UPDATED}</p>

        <div className="space-y-8 text-sm leading-relaxed text-foreground/90">

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Agreement</h2>
            <p>
              By creating an account or using Projectoolbox (&quot;Service&quot;), you agree to these Terms of Service
              (&quot;Terms&quot;) with <strong>{COMPANY}</strong> (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;).
              If you are using the Service on behalf of an organisation, you represent that you have authority to bind
              that organisation to these Terms.
            </p>
            <p className="mt-2">
              If you do not agree, do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">2. The Service</h2>
            <p>
              Projectoolbox provides an AI-powered project management platform. Features vary by subscription plan.
              We reserve the right to modify, suspend, or discontinue any part of the Service at any time, with
              reasonable notice where practical.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">3. Account Registration</h2>
            <p>You must:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Provide accurate and complete information when registering</li>
              <li>Keep your login credentials secure and confidential</li>
              <li>Notify us immediately of any unauthorised access to your account</li>
              <li>Be at least 18 years of age (or the age of legal majority in your jurisdiction)</li>
            </ul>
            <p className="mt-2">You are responsible for all activity that occurs under your account.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">4. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Use the Service for any unlawful purpose or in violation of any applicable laws</li>
              <li>Upload or transmit harmful, offensive, or infringing content</li>
              <li>Attempt to reverse-engineer, decompile, or extract source code</li>
              <li>Use automated means to scrape or access the Service beyond normal usage</li>
              <li>Resell or sublicense the Service without our written consent</li>
              <li>Interfere with or disrupt the Service or its infrastructure</li>
              <li>Use the Service to compete with us or build a substantially similar product</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">5. Subscriptions and Credits</h2>
            <p>
              Paid plans are billed monthly or annually as selected. Credits are consumed each time an AI operation is
              performed. Credits do not roll over to subsequent billing periods on the Free plan but do roll over on
              paid plans. If you exceed your credit allocation, operations will pause until you purchase top-ups or
              your plan renews.
            </p>
            <p className="mt-2">
              All fees are exclusive of applicable taxes. We may change pricing with 30 days&apos; notice.
              Continued use after a price change constitutes acceptance of the new pricing.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">6. Free Trial</h2>
            <p>
              Paid plans include a 14-day free trial. You will not be charged during the trial period.
              If you do not cancel before the trial ends, your selected payment method will be charged for
              the applicable plan. You may cancel at any time from your billing settings.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">7. Cancellation and Refunds</h2>
            <p>
              You may cancel your subscription at any time. Cancellation takes effect at the end of the
              current billing period — you retain access until then. We do not offer pro-rata refunds for
              unused portions of a billing period, except where required by law.
            </p>
            <p className="mt-2">
              If you believe you have been charged in error, contact us at{" "}
              <a href={`mailto:${EMAIL}`} className="text-primary underline underline-offset-2">{EMAIL}</a>{" "}
              within 30 days of the charge.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">8. Your Content</h2>
            <p>
              You retain ownership of all content you upload or create within the Service (&quot;Your Content&quot;).
              By using the Service, you grant us a limited licence to store, process, and transmit Your Content
              solely to provide the Service to you.
            </p>
            <p className="mt-2">
              We do not use Your Content to train AI models. Your Content is not shared with other customers.
              You are responsible for ensuring Your Content does not violate any laws or third-party rights.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">9. AI-Generated Content</h2>
            <p>
              The Service uses artificial intelligence to generate project artefacts, analysis, and recommendations.
              AI outputs are provided for informational purposes only and may contain errors or inaccuracies.
              You are responsible for reviewing and validating all AI-generated content before acting on it.
              We are not liable for decisions made based on AI outputs.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">10. Intellectual Property</h2>
            <p>
              The Service, its design, code, and all associated intellectual property are owned by {COMPANY}.
              Nothing in these Terms grants you any rights to our intellectual property except the limited
              right to use the Service as described herein.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">11. Confidentiality</h2>
            <p>
              Each party agrees to keep the other&apos;s confidential information confidential and not to disclose
              it to third parties without prior written consent, except as required by law. Confidential information
              does not include information that is publicly available or independently developed.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">12. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, {COMPANY} shall not be liable for any indirect, incidental,
              special, consequential, or punitive damages, or loss of profits, revenue, data, or goodwill,
              arising from your use of or inability to use the Service.
            </p>
            <p className="mt-2">
              Our total aggregate liability to you for any claims arising under these Terms shall not exceed
              the greater of (a) the total fees paid by you to us in the 12 months preceding the claim or
              (b) £100.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">13. Indemnification</h2>
            <p>
              You agree to indemnify and hold harmless {COMPANY} and its officers, directors, and employees
              from any claims, damages, and expenses (including reasonable legal fees) arising from your
              use of the Service, Your Content, or your violation of these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">14. Termination</h2>
            <p>
              We may suspend or terminate your access to the Service immediately, with or without notice,
              if we reasonably believe you have violated these Terms or applicable law.
              Upon termination, your right to use the Service ceases and we may delete Your Content
              in accordance with our data retention policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">15. Governing Law</h2>
            <p>
              These Terms are governed by and construed in accordance with the laws of England and Wales.
              Any disputes shall be subject to the exclusive jurisdiction of the courts of England and Wales.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">16. Changes to Terms</h2>
            <p>
              We may update these Terms at any time. We will provide at least 14 days&apos; notice for material
              changes via email or an in-app notification. Your continued use of the Service after the effective
              date constitutes acceptance of the updated Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">17. Contact</h2>
            <p>
              For questions about these Terms, contact us at{" "}
              <a href={`mailto:${EMAIL}`} className="text-primary underline underline-offset-2">{EMAIL}</a>.
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-border flex flex-wrap gap-4 text-xs text-muted-foreground">
          <Link href="/legal/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          <Link href="/legal/gdpr" className="hover:text-foreground transition-colors">GDPR Policy</Link>
          <Link href="/legal/security" className="hover:text-foreground transition-colors">Security</Link>
          <Link href="/contact" className="hover:text-foreground transition-colors">Contact Us</Link>
        </div>
      </div>
    </div>
  );
}
