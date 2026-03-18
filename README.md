# Zeno — WhatsApp AI Banking Assistant (UK)

A production-ready Node.js backend that connects WhatsApp users to an AI banking assistant powered by Claude. Users can send money, check balances, and manage their finances by chatting naturally on WhatsApp.

---

## Architecture

```
WhatsApp User
     │
     ▼
Meta Cloud API (WhatsApp Business)
     │  webhook POST /webhook
     ▼
Express Server (this codebase)
     │
     ├──► Claude API (intent parsing & NLP)
     │
     └──► Modulr Finance API (UK Faster Payments)
```

---

## Project Structure

```
zeno-backend/
├── src/
│   ├── index.js                    # Server entry point
│   ├── handlers/
│   │   ├── webhook.js              # WhatsApp webhook (verify + receive)
│   │   └── messageHandler.js       # Routes messages to correct logic
│   └── services/
│       ├── claude.js               # AI intent parsing (Claude API)
│       ├── whatsapp.js             # WhatsApp Cloud API (send messages)
│       ├── transfer.js             # UK payments via Modulr
│       ├── sessionStore.js         # Per-user state management
│       └── bankDetailsCollector.js # Collect sort code / account number
├── .env.example                    # All required environment variables
└── package.json
```

---

## Quick Start

### 1. Clone and install

```bash
git clone <your-repo>
cd zeno-backend
npm install
cp .env.example .env
```

### 2. Fill in your `.env`

See `.env.example` for all required variables. You need:

- **WhatsApp**: Phone Number ID + Access Token from Meta Developer Console
- **Claude**: API key from console.anthropic.com
- **Modulr**: API key + secret from Modulr Developer Portal

### 3. Run locally

```bash
npm run dev
```

### 4. Expose to the internet (for WhatsApp webhook)

WhatsApp needs a public HTTPS URL. Use ngrok for development:

```bash
npx ngrok http 3000
# Copy the https URL, e.g. https://abc123.ngrok.io
```

### 5. Register webhook on Meta

1. Go to [Meta Developers](https://developers.facebook.com/apps/)
2. Select your app → WhatsApp → Configuration
3. Edit Webhook URL: `https://your-domain.com/webhook`
4. Verify Token: matches `WHATSAPP_VERIFY_TOKEN` in your `.env`
5. Subscribe to: `messages`

---

## Deployment (Production)

### Option A — Railway (easiest)

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set all `.env` variables in Railway dashboard.

### Option B — Render

1. Push to GitHub
2. Create a new Web Service on render.com
3. Connect your repo, set build command: `npm install`
4. Set start command: `node src/index.js`
5. Add environment variables

### Option C — VPS (Ubuntu)

```bash
# Install Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and run with PM2
npm install -g pm2
git clone <your-repo> /var/www/zeno
cd /var/www/zeno && npm install
pm2 start src/index.js --name zeno
pm2 save && pm2 startup

# Set up Nginx reverse proxy + Let's Encrypt SSL
sudo apt install nginx certbot
# (configure nginx to proxy port 3000)
```

---

## Conversation Flows

### Transfer with full details
```
User:  "Send £50 to John Smith, sort code 20-00-00, account 12345678"
Zeno:  [Confirmation card with buttons: ✅ Confirm / ❌ Cancel]
User:  ✅ Confirm
Zeno:  "Please enter your 4-digit PIN"
User:  1234
Zeno:  "✅ Transfer complete! £50 sent to John Smith. New balance: £450.00"
```

### Transfer with missing details
```
User:  "Send fifty quid to my mum"
Zeno:  "To send £50 to your mum, I need their sort code. Please enter it (e.g. 20-00-00):"
User:  20-00-00
Zeno:  "Got it! Now their 8-digit account number:"
User:  12345678
Zeno:  [Confirmation card]
```

### Balance check
```
User:  "What's my balance?"
Zeno:  "Your current balance is £450.00 💰"
```

---

## UK Compliance Checklist

Before going live with real money, you **must** complete:

### Regulatory
- [ ] **FCA Authorisation** — Register as an Authorised Payment Institution (API) or Electronic Money Institution (EMI), OR partner with one (e.g. Modulr, ClearBank are already FCA-authorised)
- [ ] **AML Policy** — Written Anti-Money Laundering policy
- [ ] **KYC/CDD** — Know Your Customer process for every user (ID + address verification). Use Onfido, Jumio, or Stripe Identity
- [ ] **Transaction Monitoring** — Flag suspicious activity (ComplyAdvantage or similar)
- [ ] **Sanctions Screening** — Check users against UK/EU/US sanctions lists

### Technical Security
- [ ] **Hash PINs** — Never store PINs in plaintext. Use bcrypt with salt rounds ≥ 12
- [ ] **Encrypt sensitive data** — Account numbers and sort codes at rest
- [ ] **Redis sessions** — Replace in-memory sessionStore with Redis for production
- [ ] **Audit logging** — Log every transaction attempt with timestamps
- [ ] **Rate limiting** — Per-user transfer limits (already partially implemented)
- [ ] **2FA / Step-up auth** — Consider SMS OTP in addition to PIN for large transfers

### WhatsApp
- [ ] **Business Verification** — Verify your business in Meta Business Manager
- [ ] **Permanent access token** — Generate a System User token (never expires)
- [ ] **Message templates approved** — For outbound notifications (transfer receipts, alerts)

---

## Banking Partner Options (UK)

| Provider | Best For | Notes |
|----------|----------|-------|
| **Modulr** | Embedded payments, FPS/BACS | Already FCA-authorised, fastest to integrate |
| **ClearBank** | High volume, direct clearing | Requires more compliance work |
| **Yapily** | Open Banking (pay from user's own bank) | No need to hold funds |
| **Railsr** | Full banking-as-a-service | Cards, accounts, payments |
| **Stripe** | If targeting SME payments | Strong KYC tools built-in |

---

## Environment Variables

See `.env.example` for full list. Minimum required:

```
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
ANTHROPIC_API_KEY=
MODULR_API_KEY=
MODULR_API_SECRET=
MODULR_ACCOUNT_ID=
```

---

## License

MIT — see LICENSE file.

> ⚠️ **Disclaimer**: This codebase is a functional starting point. It is not financial advice. Operating a payment service in the UK requires FCA authorisation. Engage a compliance consultant before handling real money.
