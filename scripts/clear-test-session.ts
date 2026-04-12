/**
 * Clears KB items and chat messages for the test agent so the clarification session fires fresh.
 * Run: npx tsx scripts/clear-test-session.ts
 */
import { config } from "dotenv";
const _env = config({ override: true });
if (_env.parsed) { for (const [k, v] of Object.entries(_env.parsed)) process.env[k] = v.replace(/^["']|["']$/g, ""); }
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter } as any);

const AGENT_ID = "cmnu82xef000104laknkdej5e";
const PROJECT_ID = "cmnu82vu0000004las3x17rct";

async function main() {
  const d1 = await db.knowledgeBaseItem.deleteMany({ where: { agentId: AGENT_ID, projectId: PROJECT_ID } });
  const d2 = await db.chatMessage.deleteMany({ where: { agentId: AGENT_ID } });
  console.log(`✅ Deleted ${d1.count} KB items, ${d2.count} chat messages`);
  await db.$disconnect();
}

main().catch(console.error);
