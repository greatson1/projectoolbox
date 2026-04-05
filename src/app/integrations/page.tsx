import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Integrations — Projectoolbox",
  description: "Connect Projectoolbox to Jira, Slack, Microsoft Teams, GitHub, Confluence, and more.",
};

const INTEGRATIONS = [
  { name: "Jira", category: "Issue Tracking", desc: "Sync tasks, epics, and sprints. Agent updates Jira tickets automatically based on project progress.", status: "available", icon: "🔵" },
  { name: "Slack", category: "Messaging", desc: "Receive agent notifications, approve decisions, and chat with your AI PM directly in Slack.", status: "available", icon: "💬" },
  { name: "Microsoft Teams", category: "Messaging", desc: "Full Teams integration — agent joins meetings, posts updates, and handles approvals in Teams channels.", status: "available", icon: "🟦" },
  { name: "GitHub", category: "Development", desc: "Link pull requests and issues to project tasks. Agent tracks delivery progress against the code.", status: "available", icon: "⚫" },
  { name: "Confluence", category: "Documentation", desc: "Publish artefacts, risk registers, and project plans directly to your Confluence space.", status: "available", icon: "📄" },
  { name: "Google Meet", category: "Meetings", desc: "Agent joins Google Meet calls via Recall.ai to transcribe, extract actions, and update the project plan.", status: "available", icon: "🟢" },
  { name: "Zoom", category: "Meetings", desc: "Same meeting intelligence on Zoom — transcription, action extraction, automated plan updates.", status: "available", icon: "🔵" },
  { name: "Microsoft Project", category: "Scheduling", desc: "Import and export .mpp schedules. Agent tracks variance against your Microsoft Project baseline.", status: "coming-soon", icon: "📊" },
  { name: "SAP", category: "ERP", desc: "Pull budget actuals and resource data from SAP to feed your agent&apos;s cost and EVM analysis.", status: "coming-soon", icon: "🏢" },
  { name: "Azure DevOps", category: "Development", desc: "Connect Azure Boards, Pipelines, and Repos for a unified view of delivery across your DevOps stack.", status: "coming-soon", icon: "🔷" },
  { name: "Salesforce", category: "CRM", desc: "Link project delivery to opportunity and customer records in Salesforce.", status: "coming-soon", icon: "☁️" },
  { name: "ServiceNow", category: "ITSM", desc: "Create and update ServiceNow tickets from project events and agent decisions.", status: "coming-soon", icon: "🟩" },
];

const CATEGORIES = Array.from(new Set(INTEGRATIONS.map(i => i.category)));

export default function IntegrationsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1000px] mx-auto px-6 py-16">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-10 transition-colors">
          ← Back to Projectoolbox
        </Link>

        <h1 className="text-4xl font-bold mb-3">Integrations</h1>
        <p className="text-base text-muted-foreground mb-10 max-w-[560px]">
          Your agent works alongside your existing tools. Connect Projectoolbox to your stack
          in minutes — no rip-and-replace required.
        </p>

        <div className="space-y-10">
          {CATEGORIES.map(category => {
            const items = INTEGRATIONS.filter(i => i.category === category);
            return (
              <div key={category}>
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">{category}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {items.map(integration => (
                    <div key={integration.name}
                      className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{integration.icon}</span>
                          <h3 className="text-sm font-semibold text-foreground">{integration.name}</h3>
                        </div>
                        {integration.status === "available" ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/10 text-green-600">Available</span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Coming Soon</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: integration.desc }} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-14 rounded-2xl border border-primary/20 bg-primary/5 p-8 text-center">
          <h2 className="text-xl font-bold mb-2">Need a custom integration?</h2>
          <p className="text-sm text-muted-foreground mb-5">
            Enterprise customers can request custom connectors. We also publish an open API
            so your team can build integrations to any internal system.
          </p>
          <Link href="/contact">
            <span className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-semibold px-5 py-2.5 hover:opacity-90 transition-opacity">
              Talk to us about Enterprise
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
