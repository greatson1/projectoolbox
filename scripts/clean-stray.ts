import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

import { db } from "../src/lib/db";

async function main() {
  // Find the Halo agent
  const agent = await db.agent.findFirst({
    where: { name: { contains: "Halo" } },
    select: { id: true, name: true },
  });
  console.log("Agent:", agent);

  if (!agent) {
    console.log("No Halo agent found — nothing to clean");
    await db.$disconnect();
    return;
  }

  // List all artefacts for this agent
  const artefacts = await db.agentArtefact.findMany({
    where: { agentId: agent.id },
    select: { id: true, name: true, createdAt: true },
  });
  console.log("\nArtefacts:");
  artefacts.forEach(a => console.log(`  [${a.id}] "${a.name.slice(0, 100)}" — ${a.createdAt}`));

  // Find stray artefacts: name starts with "Generate" (saved raw from DOCUMENT_GENERATION handler)
  const strayArtefacts = artefacts.filter(a =>
    a.name.toLowerCase().startsWith("generate ") ||
    a.name.length > 100 // Truncated descriptions saved as names
  );
  console.log("\nStray artefacts to delete:", strayArtefacts.map(a => a.id));

  if (strayArtefacts.length > 0) {
    for (const a of strayArtefacts) {
      await db.agentArtefact.delete({ where: { id: a.id } });
      console.log(`  Deleted artefact ${a.id}: "${a.name.slice(0, 80)}"`);
    }
  }

  // Find all AI-identified risks
  const agentDeployment = await db.agentDeployment.findFirst({
    where: { agentId: agent.id },
    select: { projectId: true },
  });

  if (agentDeployment?.projectId) {
    const risks = await db.risk.findMany({
      where: { projectId: agentDeployment.projectId, category: "AI-identified" },
      select: { id: true, title: true, createdAt: true },
    });
    console.log("\nAI-identified risks:");
    risks.forEach(r => console.log(`  [${r.id}] "${(r.title || "").slice(0, 100)}" — ${r.createdAt}`));

    // Delete risks with names that are clearly verbose action descriptions (>80 chars or start with action verbs)
    const strayRisks = risks.filter(r => {
      const t = (r.title || "").toLowerCase();
      return t.length > 80 ||
        t.startsWith("identify") ||
        t.startsWith("create risk") ||
        t.startsWith("log risk") ||
        t.startsWith("flag risk") ||
        t.startsWith("document risk") ||
        t.startsWith("register risk") ||
        t.startsWith("add risk");
    });
    console.log("\nStray risks to delete:", strayRisks.map(r => r.id));

    for (const r of strayRisks) {
      await db.risk.delete({ where: { id: r.id } });
      console.log(`  Deleted risk ${r.id}: "${(r.title || "").slice(0, 80)}"`);
    }
  }

  console.log("\nDone.");
  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
