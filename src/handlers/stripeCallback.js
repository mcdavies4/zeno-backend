/**
 * Stripe Callback Handler
 * Handles Financial Connections and Identity callbacks
 */

const express = require('express');
const router = express.Router();
const sessionStore = require('../services/sessionStore');
const messenger = require('../services/messenger');
const logger = require('../utils/logger');

// ── Financial Connections callback ────────────────────
router.get('/callback', async (req, res) => {
  const { phone } = req.query;
  const phoneNumber = phone ? phone.replace(/\D/g, '') : null;
  logger.info(`Stripe FC callback: phone=${phoneNumber}`);

  try {
    if (phoneNumber) {
      const stripeService = require('../services/stripe');
      const session = await sessionStore.get(phoneNumber);

      if (session.stripeCustomerId) {
        const accounts = await stripeService.getConnectedAccounts(session.stripeCustomerId);
        if (accounts.length > 0) {
          const account = accounts[0];
          await sessionStore.update(phoneNumber, {
            stripeAccountId: account.id,
            bankConnected: true,
            bankName: account.institution_name || 'UK Bank',
          });
          await messenger.sendText(phoneNumber,
            `✅ *Bank Connected!*\n\n🏦 ${account.institution_name || 'Your bank'} linked successfully.\n\nTry:\n• *"What's my balance?"*\n• *"Show my transactions"*`
          );
        }
      }
    }

    res.send(`<html>
      <head><meta name="viewport" content="width=device-width,initial-scale=1">
      <style>body{font-family:sans-serif;text-align:center;padding:60px 20px;background:#0f1923;color:#e2e8f0}h2{color:#00d4aa}a{color:#25d366;margin:8px}</style>
      </head><body>
        <div style="font-size:3rem">✅</div>
        <h2>Bank Connected!</h2>
        <p style="color:#8b949e">Return to WhatsApp or Telegram to continue.</p>
        <p><a href="https://wa.me/447459233682">Open WhatsApp</a> <a href="https://t.me/ZenoUKbot" style="color:#229ed9">Open Telegram</a></p>
      </body></html>`);
  } catch (err) {
    logger.error('Stripe callback error:', err.message);
    res.send(`<html><body style="text-align:center;padding:60px;background:#0f1923;color:#e2e8f0">
      <h2 style="color:#ef4444">Connection Failed</h2><p>Please try again.</p>
    </body></html>`);
  }
});

// ── Identity callback ─────────────────────────────────
router.get('/identity-callback', async (req, res) => {
  const { phone } = req.query;
  const phoneNumber = phone ? phone.replace(/\D/g, '') : null;
  logger.info(`Stripe Identity callback: phone=${phoneNumber}`);

  res.send(`<html>
    <head><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:sans-serif;text-align:center;padding:60px 20px;background:#0f1923;color:#e2e8f0}h2{color:#00d4aa}a{color:#25d366;margin:8px}</style>
    </head><body>
      <div style="font-size:3rem">✅</div>
      <h2>Verification Submitted!</h2>
      <p style="color:#8b949e">Your documents are being reviewed. We'll message you on WhatsApp or Telegram shortly.</p>
      <p><a href="https://wa.me/447459233682">Open WhatsApp</a> <a href="https://t.me/ZenoUKbot" style="color:#229ed9">Open Telegram</a></p>
    </body></html>`);
});

// ── Stripe Webhook ────────────────────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const Stripe = require('stripe');
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (secret) {
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    logger.error('Stripe webhook error:', err.message);
    return res.sendStatus(400);
  }

  res.sendStatus(200);

  try {
    logger.info(`Stripe webhook: ${event.type}`);

    // Financial Connections
    if (event.type === 'financial_connections.account.created') {
      logger.info(`FC account created: ${event.data.object.id}`);
    }

    // Payments
    if (event.type === 'payment_intent.succeeded') {
      logger.info(`Payment succeeded: ${event.data.object.id}`);
    }

    // Identity verification
    if (event.type === 'identity.verification_session.verified' ||
        event.type === 'identity.verification_session.requires_input') {

      const vs = event.data.object;
      const rawId = vs.metadata && vs.metadata.phoneNumber
        ? vs.metadata.phoneNumber
        : null;

      logger.info(`Stripe Identity ${event.type}: id=${rawId}, status=${vs.status}`);

      if (!rawId) {
        logger.warn('No phoneNumber in Stripe Identity metadata');
        return;
      }

      const stripeService = require('../services/stripe');
      const { text, verified } = stripeService.getIdentityStatusMessage(vs.status);

      // Store with the original ID (could be phone number or Telegram chat ID)
      await sessionStore.update(rawId, {
        kycStatus: vs.status,
        kycVerified: verified,
        kycSessionId: vs.id,
      });

      // messenger.sendText handles both WhatsApp (phone) and Telegram (chatId)
      await messenger.sendText(rawId, text);
      logger.info(`Identity result sent to ${rawId}: ${vs.status}`);
    }

  } catch (err) {
    logger.error('Stripe webhook processing error:', err.message);
  }
});

module.exports = router;
