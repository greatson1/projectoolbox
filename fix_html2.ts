/**
 * fix_html2.ts
 * Line-by-line cleaner for malformed HTML in artefacts.
 */
import { db } from "./src/lib/db";

function fixHtml(raw: string): string {
  // Step 1: Replace <p></ul></p> with </ul>
  let s = raw.replace(/<p><\/ul><\/p>/gi, "</ul>");

  // Step 2: Line-by-line — detect orphan <li> runs and wrap them in <ul>
  const lines = s.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check if this line is an orphan <li>:
    // starts with <li> but previous meaningful line doesn't end with <ul> or <li>
    if (/^<li\b/i.test(trimmed)) {
      // Look at the last pushed output line to see if we're already in a list
      const lastOut = out.filter(l => l.trim()).at(-1) ?? "";
      const lastIsListItem = /<\/li>$/i.test(lastOut.trim()) || /<ul>$/i.test(lastOut.trim()) || /<ol>$/i.test(lastOut.trim());

      if (!lastIsListItem) {
        // Orphan <li> — open a <ul>
        out.push("<ul>");
      }
      out.push(line);

      // Check if the NEXT non-empty line is also a <li>
      // If not, close the list
      let nextMeaningful = "";
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim()) { nextMeaningful = lines[j].trim(); break; }
      }
      if (!/^<li\b/i.test(nextMeaningful)) {
        // Check if there's already a closing </ul> or </ol> coming up
        // i.e. the current li was the LAST in the opened auto-ul
        const lastOutNow = out.filter(l => l.trim()).at(-1) ?? "";
        // If we opened a <ul> above, we need to close it
        // Check if there's a matching </ul> coming
        const hasExplicitClose = lines.slice(i + 1, i + 5).some(l => /<\/ul>|<\/ol>/i.test(l));
        // Also need to check whether we auto-opened the <ul>
        // Find the last <ul> in out — if it's not closed by a </ul> yet, auto-close
        let opens = 0;
        for (const o of out) {
          opens += (o.match(/<ul>/gi) || []).length;
          opens -= (o.match(/<\/ul>/gi) || []).length;
        }
        if (opens > 0 && !hasExplicitClose) {
          out.push("</ul>");
        }
      }
    } else {
      out.push(line);
    }
  }

  s = out.join("\n");

  // Step 3: Wrap standalone <strong>...</strong> lines in <p> if not inside a block element
  s = s.replace(/^(<strong>[^<\n]+<\/strong>[^<\n]*)$/gm, "<p>$1</p>");

  // Step 4: Remove empty paragraphs and excess blank lines
  s = s.replace(/<p>\s*<\/p>\n?/gi, "");
  s = s.replace(/\n{3,}/g, "\n\n");

  return s;
}

async function main() {
  const arts = await db.agentArtefact.findMany({ where: { format: "html" } });
  console.log(`Found ${arts.length} HTML artefact(s).\n`);

  for (const art of arts) {
    const before = art.content ?? "";
    const after = fixHtml(before);

    if (after === before) {
      console.log(`  — no change: ${art.name}`);
      continue;
    }

    await db.agentArtefact.update({ where: { id: art.id }, data: { content: after } });
    console.log(`  ✅ fixed: "${art.name}" (${before.length} → ${after.length} chars)`);
  }

  await db.$disconnect();
  console.log("\n✅ Done.");
}

main().catch(console.error);
