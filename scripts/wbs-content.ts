import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });
import { db as prisma } from "../src/lib/db.js";

const PROJECT_ID = "cmo07iu0b000004ldq6430lo6";

async function main() {
  // WBS by full name
  const wbs = await prisma.agentArtefact.findFirst({
    where: { projectId: PROJECT_ID, name: "Work Breakdown Structure" },
    select: { id: true, name: true, status: true, content: true },
  });
  console.log("\n=== WBS (Work Breakdown Structure) ===");
  if (wbs) {
    console.log(`[${wbs.status}] id:${wbs.id}`);
    console.log(wbs.content?.slice(0, 2000));
  } else console.log("NOT FOUND");

  // All artefacts with name + status
  const all = await prisma.agentArtefact.findMany({
    where: { projectId: PROJECT_ID },
    select: { id: true, name: true, status: true, metadata: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\n=== ALL ARTEFACTS (${all.length}) ===`);
  all.forEach(a => console.log(`  [${a.status}] "${a.name}" — ${a.id}  meta:${JSON.stringify(a.metadata)?.slice(0,80)}`));

  // Atlas tasks (check if any WBS came through there too)
  const ATLAS_ID = "cmo0l8s2i000004kz32r8fetx";
  const atlasArts = await prisma.agentArtefact.findMany({
    where: { projectId: ATLAS_ID },
    select: { name: true, status: true },
  });
  console.log(`\n=== ATLAS ARTEFACTS (${atlasArts.length}) ===`);
  atlasArts.forEach(a => console.log(`  [${a.status}] ${a.name}`));
}

main().catch(console.error).finally(() => prisma.$disconnect());
