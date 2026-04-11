import { db } from "./src/lib/db";
async function main() {
  const a = await db.agentArtefact.findFirst({ where: { name: "Feasibility Study" } });
  console.log("FORMAT:", a?.format);
  console.log("CONTENT:", (a?.content || "").slice(0, 3000));
  await db.$disconnect();
}
main();
