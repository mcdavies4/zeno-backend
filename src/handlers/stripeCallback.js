/**

- Stripe Callback Handler
- Handles Financial Connections callback after user links bank
  */

const express = require(‘express’);
const router = express.Router();
const sessionStore = require(’../services/sessionStore’);
const messenger = require(’../services/messenger’);
const logger = require(’../utils/logger’);

// ─── FINANCIAL CONNECTIONS CALLBACK ──────────────────
router.get(’/callback’, async (req, res) => {
const { phone, session: sessionId } = req.query;
logger.info(`Stripe FC callback: phone=${phone}, session=${sessionId}`);

const phoneNumber = phone?.replace(/\D/g, ‘’);

try {
if (phoneNumber) {
const stripeService = require(’../services/stripe’);
const session = await sessionStore.get(phoneNumber);

```
  if (session.stripeCustomerId) {
    // Get connected accounts
    const accounts = await stripeService.getConnectedAccounts(session.stripeCustomerId);

    if (accounts.length > 0) {
      const account = accounts[0];
      await sessionStore.update(phoneNumber, {
        stripeAccountId: account.id,
        bankConnected: true,
        bankName: account.institution_name || 'UK Bank',
      });

      await messenger.sendText(phoneNumber,
        `✅ *Bank Connected!*\n\n` +
        `🏦 ${account.institution_name || 'Your bank'} linked successfully.\n\n` +
        `Try:\n• *"What's my balance?"*\n• *"Show my transactions"*`
      );

      logger.info(`Stripe bank connected for ${phoneNumber}: ${account.id}`);
    }
  }
}

res.send(`
  <html>
  <head><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:sans-serif;text-align:center;padding:60px 20px;background:#0f1923;color:#e2e8f0}h2{color:#00d4aa}</style>
  </head>
  <body>
    <div style="font-size:3rem">✅</div>
    <h2>Bank Connected!</h2>
    <p style="color:#8b949e">Return to WhatsApp or Telegram to continue.</p>
    <p style="margin-top:20px">
      <a href="https://wa.me/447459233682" style="color:#25d366;margin-right:16px">Open WhatsApp</a>
      <a href="https://t.me/ZenoUKbot" style="color:#229ed9">Open Telegram</a>
    </p>
  </body></html>
`);
```

} catch (err) {
logger.error(‘Stripe callback error:’, err.message);
res.send(`<html><body style="text-align:center;padding:60px;background:#0f1923;color:#e2e8f0"> <h2 style="color:#ef4444">Connection Failed</h2> <p>Please try again from WhatsApp or Telegram.</p> </body></html>`);
}
});

// ─── IDENTITY CALLBACK ───────────────────────────────
router.get(’/identity-callback’, async (req, res) => {
const { phone } = req.query;
const phoneNumber = phone?.replace(/\D/g, ‘’);
logger.info(`Stripe Identity callback: phone=${phoneNumber}`);

res.send(`<html> <head><meta name="viewport" content="width=device-width,initial-scale=1"> <style>body{font-family:sans-serif;text-align:center;padding:60px 20px;background:#0f1923;color:#e2e8f0}h2{color:#00d4aa}</style> </head> <body> <div style="font-size:3rem">✅</div> <h2>Verification Submitted!</h2> <p style="color:#8b949e">Your documents are being reviewed. We'll message you on WhatsApp or Telegram shortly.</p> <p style="margin-top:20px"> <a href="https://wa.me/447459233682" style="color:#25d366;margin-right:16px">Open WhatsApp</a> <a href="https://t.me/ZenoUKbot" style="color:#229ed9">Open Telegram</a> </p> </body></html>`);
});

// ─── STRIPE WEBHOOK ───────────────────────────────────
router.post(’/webhook’, express.raw({ type: ‘application/json’ }), async (req, res) => {
const sig = req.headers[‘stripe-signature’];
let event;

try {
const Stripe = require(‘stripe’);
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || ‘’);
} catch (err) {
logger.error(‘Stripe webhook signature failed:’, err.message);
return res.sendStatus(400);
}

res.sendStatus(200);

try {
logger.info(`Stripe webhook: ${event.type}`);

```
if (event.type === 'financial_connections.account.created') {
  const account = event.data.object;
  logger.info(`FC account created: ${account.id}`);
}

if (event.type === 'payment_intent.succeeded') {
  const pi = event.data.object;
  logger.info(`Payment succeeded: ${pi.id}`);
}

// ── Stripe Identity Events ──────────────────────
if (event.type === 'identity.verification_session.verified' ||
    event.type === 'identity.verification_session.requires_input') {

  const vs = event.data.object;
  const phoneNumber = vs.metadata?.phoneNumber?.replace(/\D/g, '');
  logger.info(`Stripe Identity ${event.type}: ${vs.id}, phone=${phoneNumber}, status=${vs.status}`);

  if (!phoneNumber) {
    logger.warn('No phone in Stripe Identity metadata');
    return;
  }

  const stripeService = require('../services/stripe');
  const { text, verified } = stripeService.getIdentityStatusMessage(vs.status);

  await sessionStore.update(phoneNumber, {
    kycStatus: vs.status,
    kycVerified: verified,
    kycSessionId: vs.id,
  });

  await messenger.sendText(phoneNumber, text);
  logger.info(`Stripe Identity result sent to ${phoneNumber}: ${vs.status}`);
}
```

} catch (err) {
logger.error(‘Stripe webhook processing error:’, err.message);
}
});

module.exports = router;
