import Link from "next/link";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Changelog — Projectoolbox" };
const ENTRIES = [
  { date: "April 2026", tag: "Launch", title: "Projectoolbox Early Access", items: ["Multi-step signup with agent configuration", "Credit-based pricing (Free, Starter, Professional, Business)", "6-capability AI PM platform: agent deployment, HITL governance, meeting intelligence, knowledge base, EVM tracking, multi-methodology support", "Google OAuth and email/password authentication", "Dashboard with agent fleet management"] },
];
export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[680px] mx-auto px-6 py-16">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-10 transition-colors">← Back to Projectoolbox</Link>
        <h1 className="text-4xl font-bold mb-2">Changelog</h1>
        <p className="text-sm text-muted-foreground mb-10">What&apos;s new in Projectoolbox.</p>
        <div className="space-y-12">
          {ENTRIES.map(entry => (
            <div key={entry.title}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{entry.date}</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary">{entry.tag}</span>
              </div>
              <h2 className="text-xl font-bold text-foreground mb-3">{entry.title}</h2>
              <ul className="space-y-2">
                {entry.items.map(item => (
                  <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="text-green-500 mt-0.5 flex-shrink-0">✓</span>{item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
