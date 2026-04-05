import Link from "next/link";
import type { Metadata } from "next";
import { Shield, Lock, Eye, Server, AlertTriangle, CheckCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "Security — Projectoolbox",
  description: "How Projectoolbox protects your data and keeps the platform secure.",
};

const LAST_UPDATED = "1 April 2026";
const SECURITY_EMAIL = "security@projectoolbox.com";

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[760px] mx-auto px-6 py-16">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-10 transition-colors">
          ← Back to Projectoolbox
        </Link>

        <h1 className="text-4xl font-bold mb-2">Security</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: {LAST_UPDATED}</p>

        <p className="text-base text-muted-foreground mb-10 leading-relaxed">
          Security is core to what we do. Project data is sensitive — we treat it that way.
          Below is an overview of the measures we take to protect your data and platform access.
        </p>

        <div className="space-y-10 text-sm leading-relaxed text-foreground/90">

          <section>
            <div className="flex items-center gap-3 mb-4">
              <Lock className="w-5 h-5 text-primary flex-shrink-0" />
              <h2 className="text-lg font-semibold text-foreground">Data Encryption</h2>
            </div>
            <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
              <li>All data is encrypted <strong className="text-foreground">in transit</strong> using TLS 1.2 or higher</li>
              <li>All data is encrypted <strong className="text-foreground">at rest</strong> using AES-256</li>
              <li>Passwords are hashed using bcrypt with per-user salts — we never store plaintext passwords</li>
              <li>Database backups are encrypted</li>
            </ul>
          </section>

          <section>
            <div className="flex items-center gap-3 mb-4">
              <Shield className="w-5 h-5 text-primary flex-shrink-0" />
              <h2 className="text-lg font-semibold text-foreground">Authentication &amp; Access Control</h2>
            </div>
            <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
              <li>Multi-factor authentication (MFA) available on all plans</li>
              <li>SSO/SAML integration available on Business and Enterprise plans</li>
              <li>Sessions expire automatically after inactivity</li>
              <li>Role-based access control (RBAC) within workspaces</li>
              <li>All API requests require authenticated tokens</li>
              <li>Row-level security enforced at the database layer</li>
            </ul>
          </section>

          <section>
            <div className="flex items-center gap-3 mb-4">
              <Server className="w-5 h-5 text-primary flex-shrink-0" />
              <h2 className="text-lg font-semibold text-foreground">Infrastructure</h2>
            </div>
            <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
              <li>Hosted on <strong className="text-foreground">Vercel</strong> (edge network) and <strong className="text-foreground">Supabase</strong> (database) — both SOC 2 Type II certified</li>
              <li>Automated daily database backups with point-in-time recovery</li>
              <li>Dependency scanning and vulnerability alerts via automated tooling</li>
              <li>Production environment is isolated from development and staging</li>
              <li>Security headers enforced on all responses (HSTS, CSP, X-Frame-Options, etc.)</li>
            </ul>
          </section>

          <section>
            <div className="flex items-center gap-3 mb-4">
              <Eye className="w-5 h-5 text-primary flex-shrink-0" />
              <h2 className="text-lg font-semibold text-foreground">Monitoring &amp; Audit Logs</h2>
            </div>
            <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
              <li>Real-time monitoring of API errors, latency, and anomalies</li>
              <li>Audit logs capture all sensitive actions (login, data export, permission changes)</li>
              <li>Audit logs are available to Business and Enterprise customers in-platform</li>
              <li>Failed authentication attempts trigger automatic rate-limiting</li>
            </ul>
          </section>

          <section>
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle className="w-5 h-5 text-primary flex-shrink-0" />
              <h2 className="text-lg font-semibold text-foreground">AI Data Handling</h2>
            </div>
            <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
              <li>AI queries are processed by Anthropic. Under our agreement, your data is <strong className="text-foreground">not used to train AI models</strong></li>
              <li>Prompts and responses are logged for debugging and abuse prevention, not for model training</li>
              <li>Enterprise customers can request single-tenant AI processing</li>
            </ul>
          </section>

          <section>
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-primary flex-shrink-0" />
              <h2 className="text-lg font-semibold text-foreground">Vulnerability Disclosure</h2>
            </div>
            <p className="text-muted-foreground">
              If you discover a security vulnerability, please report it responsibly. Do not publicly disclose
              vulnerabilities before we have had a chance to address them.
            </p>
            <p className="mt-3">
              Report vulnerabilities to:{" "}
              <a href={`mailto:${SECURITY_EMAIL}`} className="text-primary underline underline-offset-2 font-semibold">
                {SECURITY_EMAIL}
              </a>
            </p>
            <p className="mt-2 text-muted-foreground">
              Please include: a description of the vulnerability, steps to reproduce, potential impact,
              and your contact details. We aim to acknowledge reports within 48 hours and provide
              a resolution timeline within 5 business days.
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-border flex flex-wrap gap-4 text-xs text-muted-foreground">
          <Link href="/legal/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          <Link href="/legal/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
          <Link href="/legal/gdpr" className="hover:text-foreground transition-colors">GDPR Policy</Link>
          <Link href="/contact" className="hover:text-foreground transition-colors">Contact Us</Link>
        </div>
      </div>
    </div>
  );
}
