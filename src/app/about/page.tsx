import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — Projectoolbox",
  description: "The team and story behind Projectoolbox.",
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[760px] mx-auto px-6 py-16">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-10 transition-colors">
          ← Back to Projectoolbox
        </Link>

        <h1 className="text-4xl font-bold mb-4">About Projectoolbox</h1>

        <div className="space-y-6 text-sm leading-relaxed text-foreground/90">
          <p className="text-base text-muted-foreground">
            Projectoolbox is built by <strong className="text-foreground">PMGT Solutions Ltd</strong> —
            a project management training and consultancy firm based in the UK.
          </p>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Our Story</h2>
            <p>
              We&apos;ve spent years training project managers across construction, defence, pharma, government,
              and technology sectors. We&apos;ve seen brilliant PMs buried under status reports, risk registers,
              and governance paperwork — time they should be spending on decisions, stakeholders, and delivery.
            </p>
            <p className="mt-3">
              Projectoolbox was built to change that. We wanted to give every project manager
              an AI co-pilot that understands PM methodology — not just a chatbot, but an autonomous agent
              that actively manages the project alongside you.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Our Mission</h2>
            <p>
              To make world-class project governance accessible to every team — not just those with
              large PMOs and dedicated resources.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Our Training Background</h2>
            <p>
              We run a 5-day <em>AI in Project Management</em> training programme through{" "}
              <a href="https://pmgts.uk" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                PMGTS
              </a>.
              Everything we teach — risk management, earned value, PRINCE2, Agile governance —
              is embedded into the Projectoolbox platform. It&apos;s not just a tool; it&apos;s decades
              of PM knowledge in an agent.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-3">Get in Touch</h2>
            <p>
              We&apos;d love to hear from you. Whether you&apos;re a prospective customer, partner, or just curious —
              reach out at{" "}
              <a href="mailto:contact@projectoolbox.com" className="text-primary underline underline-offset-2">
                contact@projectoolbox.com
              </a>{" "}
              or use our{" "}
              <Link href="/contact" className="text-primary underline underline-offset-2">contact form</Link>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
