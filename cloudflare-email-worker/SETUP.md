# Agent Email Setup Guide — Projectoolbox

## Architecture

```
Inbound:  Cloudflare Email Routing → Email Worker → POST /api/webhooks/inbound-email
Outbound: Resend API ← agents.projectoolbox.com (verified subdomain)
```

## Step 1: Resend DNS Records (for SENDING from agent addresses)

Add these DNS records at your domain registrar (Namecheap) for `projectoolbox.com`:

| Type | Name | Value | Priority |
|------|------|-------|----------|
| TXT  | `resend._domainkey.agents` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC37OQw7OdQaFIZP2wJ/wAIBW77YIT7XWbg3oMERz8saVimnTbKrmYyvAxAsRhQKT5t59J7uADrcDtNSLCkWOym1O8tG0zLjZNHAtmc4fXX+TfjwFwbxgL7P5YdtpgmJtPemg6zeM6DfhoErPF6cNtvfW2Hly17CqQgwl7BJsDcNQIDAQAB` | — |
| MX   | `send.agents` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| TXT  | `send.agents` | `v=spf1 include:amazonses.com ~all` | — |

After adding, verify at: https://resend.com/domains

## Step 2: Cloudflare Email Routing (for RECEIVING emails)

### Option A: Move DNS to Cloudflare (recommended)

1. **Add site to Cloudflare**: https://dash.cloudflare.com → Add a site → `projectoolbox.com`
2. **Update nameservers** at Namecheap to Cloudflare's (provided during setup)
3. **Enable Email Routing**: Cloudflare Dashboard → projectoolbox.com → Email → Email Routing
4. **Deploy the Email Worker**:
   ```bash
   cd cloudflare-email-worker
   npm install
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put WEBHOOK_SECRET  # optional, set matching INBOUND_EMAIL_SECRET in .env
   ```
5. **Create routing rule**: Email Routing → Routing rules → Catch-all → Route to Worker → `projectoolbox-email-worker`
6. This catches ALL `*@agents.projectoolbox.com` and `*@projectoolbox.com` emails

### Option B: Keep current DNS + use email forwarding

If you don't want to move DNS to Cloudflare:

1. **Set up a catch-all forwarder** at Namecheap:
   - Go to Domain List → projectoolbox.com → Email Forwarding
   - Add catch-all: `*@agents.projectoolbox.com` → forward to a mailbox
   - This won't auto-process emails, but captures them

2. **Use Resend inbound** (when available for your plan):
   - Add MX records pointing `agents.projectoolbox.com` to Resend's inbound servers
   - Configure webhook URL: `https://projectoolbox.com/api/webhooks/inbound-email`

## Step 3: Environment Variables

Add to `.env` (and Vercel):

```env
# Optional: secure the inbound webhook
INBOUND_EMAIL_SECRET="your-secret-here"
```

## Step 4: Test the Flow

### Test sending (agent → external):
```bash
node -e "
fetch('http://localhost:3000/api/agents/AGENT_ID/email', { method: 'POST' })
  .then(r => r.json()).then(console.log);
"
```

### Test receiving (simulate inbound):
```bash
curl -X POST http://localhost:3000/api/webhooks/inbound-email \
  -H "Content-Type: application/json" \
  -d '{
    "from": "sarah@example.com",
    "to": "maya@agents.projectoolbox.com",
    "subject": "Sprint Planning Minutes",
    "text": "Sarah: We need to prioritize the API migration...\nTom: I agree, the deadline is next Friday.\nAction: Tom to complete API docs by Wednesday."
  }'
```

## How It Works End-to-End

1. **User generates agent email** → `maya@agents.projectoolbox.com`
2. **Someone sends email** to that address (meeting invite, notes, update)
3. **Cloudflare receives** the email → Email Worker parses it → POSTs to webhook
4. **Webhook classifies** the email:
   - **Calendar invite** → creates CalendarEvent, agent generates pre-meeting brief
   - **Meeting notes/transcript** → creates Meeting record, AI processes into actions/decisions/risks, sends follow-up email
   - **Status update** → logs as agent activity, saves for project intelligence
   - **General email** → logs activity with preview
5. **Agent can reply** via Resend using its `@agents.projectoolbox.com` address
