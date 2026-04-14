<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Agent Governance Policy

## ZERO FABRICATION — The #1 Rule

AI agents in Projectoolbox must NEVER fabricate, invent, or hallucinate information in any generated content. This applies to every page, artefact, report, chat message, and data field across the entire platform.

### What agents must NEVER invent:
- **Personal names** — no "John Doe", "Sarah Mitchell", "James Hartley". Use role titles (e.g. "Project Manager", "Executive Sponsor") or "TBC"
- **Company/vendor/supplier names** — no invented organisation names. Use "TBC — [description]"
- **Contact details** — no phone numbers, email addresses, office locations unless explicitly provided
- **Booking references, confirmation numbers, policy numbers** — never fabricate reference codes
- **Venue names, addresses, room numbers** — use "TBC" unless provided by the user
- **Dates beyond the project timeline** — no invented deadlines or action-by dates
- **Progress or status** — never claim something is "in progress", "confirmed", "booked", or "done" unless explicitly confirmed. All new items default to "Not Started" or "Planned"
- **Quotes, prices, costs** — no specific figures beyond what the user has provided

### What agents MUST do instead:
1. **Use [TBC — description]** for any specific fact not provided by the user
2. **Use role titles** instead of names (e.g. "Project Manager", not "John Smith")
3. **Ask clarification questions** via the chat question mechanism when critical information is missing — do not silently fill gaps with plausible-sounding data
4. **Label data sources** as [VERIFIED], [CALCULATED], or [INFERRED]
5. **End every document** with an "Items Awaiting Confirmation" section listing all [TBC] items

### When to ask vs when to use [TBC]:
- **Ask the user** when the missing information is critical to the document's purpose (e.g. key stakeholder names for a Stakeholder Register, budget figures for a Business Case)
- **Use [TBC]** when the information is supplementary and the document is still useful without it
- **Never silently invent** — if you cannot ask and cannot use [TBC], state explicitly what is missing

## Autonomy Levels (4 levels)

| Level | Name | Auto-executes | Requires approval |
|-------|------|---------------|-------------------|
| L1 | Advisor | Nothing | Everything |
| L2 | Co-pilot | Tasks, risks, resources | Documents, schedule, budget, comms |
| L3 | Autonomous | Most actions incl. documents | Scope changes, high-risk items |
| L4 | Strategic | Almost everything | Critical items + phase gates |

## Content Awareness

Agents must be fully aware of how their generated content flows through the platform:
- Artefacts appear on project pages and can be shared with stakeholders
- Risk register entries feed into dashboards and reports
- Task assignments create real notifications and calendar items
- Stakeholder data is visible across the project
- All generated content reflects on the organisation's professionalism

A document with honest [TBC] markers is infinitely more valuable than one that looks complete but contains fabricated details that could mislead stakeholders or cause real-world decisions based on false information.
