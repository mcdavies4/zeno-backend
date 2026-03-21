/**
 * Mono Callback Handler
 * Called after Nigerian user connects their bank via Mono Connect
 */

const express = require('express');
const router = express.Router();
const mono = require('../services/mono');
const sessionStore = require('../services/sessionStore');
const messenger = require('../services/messenger');
const logger = require('../utils/logger');

// ─── MONO WEBHOOK (server-side events) ───────────────
router.post('/webhook', express.json(), async (req, res) => {
  res.sendStatus(200);

  try {
    const { event, data } = req.body;
    logger.info(`Mono webhook: ${event}`);

    if (event === 'mono.events.account_connected') {
      const code = data?.code;
      const meta = data?.meta;

      if (!code) return;

      // Exchange code for account ID
      const result = await mono.exchangeCode(code);
      const accountId = result?.id;

      if (!accountId) return;

      // We need to find which user this belongs to
      // Mono sends the state we set in the auth link
      const phoneNumber = meta?.ref ? Buffer.from(meta.ref, 'base64').toString('utf8') : null;

      if (phoneNumber) {
        await sessionStore.update(phoneNumber, {
          monoAccountId: accountId,
          bankConnected: true,
        });

        await messenger.sendText(phoneNumber,
          `🎉 *Bank connected successfully!*\n\n` +
          `I can now fetch your real balance and transactions.\n\n` +
          `Try:\n• *"What's my balance?"*\n• *"Show my transactions"*`
        );

        logger.info(`Mono bank connected for ${phoneNumber}: ${accountId}`);
      }
    }
  } catch (err) {
    logger.error('Mono webhook error:', err.message);
  }
});

// ─── MONO CONNECT CALLBACK (browser redirect) ────────
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  logger.info(`Mono callback: code=${!!code}, state=${state}`);

  let phoneNumber;
  try {
    phoneNumber = state ? Buffer.from(state, 'base64').toString('utf8') : null;
  } catch(e) {
    phoneNumber = state;
  }

  try {
    if (code && phoneNumber) {
      const result = await mono.exchangeCode(code);
      const accountId = result?.id;

      if (accountId) {
        await sessionStore.update(phoneNumber, {
          monoAccountId: accountId,
          bankConnected: true,
        });

        await messenger.sendText(phoneNumber,
          `🎉 *Bank connected!*\n\nTry:\n• *"What's my balance?"*\n• *"Show my transactions"*`
        );
      }
    }

    res.send(`
      <html>
      <head><meta name="viewport" content="width=device-width, initial-scale=1">
      <style>body{font-family:sans-serif;text-align:center;padding:60px 20px;background:#0f1923;color:#e2e8f0}h2{color:#00d4aa}p{color:#8b949e}</style>
      </head>
      <body>
        <div style="font-size:3rem">✅</div>
        <h2>Bank Connected!</h2>
        <p>Return to WhatsApp or Telegram to continue.</p>
      </body></html>
    `);
  } catch(err) {
    logger.error('Mono callback error:', err.message);
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f1923;color:#e2e8f0">
        <h2 style="color:#ef4444">Connection Failed</h2>
        <p>Please try again on WhatsApp or Telegram.</p>
      </body></html>
    `);
  }
});

module.exports = router;
