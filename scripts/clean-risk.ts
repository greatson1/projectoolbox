import { db } from "../src/lib/db";

async function main() {
  const del = await db.risk.deleteMany({
    where: { title: { contains: "Conduct initial risk assessment" } },
  });
  console.log("Deleted risks:", del.count);
  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
