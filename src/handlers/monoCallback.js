/**
 * Mono Callback Handler
 * Called after Nigerian user connects their bank via Mono Connect
 */

const express = require('express');
const router = express.Router();
const mono = require('../services/mono');
const sessionStore = require('../services/sessionStore');
const messenger = require('../services/messenger');
const { getPlatform } = require('../utils/countryDetect');
const logger = require('../utils/logger');

// ─── MONO WEBHOOK (server-side events) ───────────────
router.post('/webhook', express.json(), async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    logger.info('Mono webhook full payload:', JSON.stringify(body));

    const event = body.event;
    const data = body.data;

    if (!event) return;

    if (event === 'mono.events.account_connected' ||
        event === 'mono.events.reauthorisation_required' ||
        event === 'mono.events.account_updated') {

      const code = data?.code;
      if (!code) {
        logger.warn('No code in Mono webhook');
        return;
      }

      // Exchange code for account ID
      const result = await mono.exchangeCode(code);
      const accountId = result?.id;
      if (!accountId) {
        logger.warn('No accountId from Mono exchange');
        return;
      }

      // Try to get phone number from multiple possible locations
      let phoneNumber = null;

      // Option 1: meta.ref (base64 encoded phone)
      if (data?.meta?.ref) {
        try {
          phoneNumber = Buffer.from(data.meta.ref, 'base64').toString('utf8');
        } catch(e) {
          phoneNumber = data.meta.ref;
        }
      }

      // Option 2: meta.data (direct phone)
      if (!phoneNumber && data?.meta?.data) {
        phoneNumber = data.meta.data;
      }

      // Option 3: look up state from Redis
      if (!phoneNumber && data?.meta?.ref) {
        try {
          const { Redis } = require('@upstash/redis');
          const redis = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
          });
          phoneNumber = await redis.get(`mono:state:${data.meta.ref}`);
          if (phoneNumber) logger.info(`Found phone from Redis state: ${phoneNumber}`);
        } catch(e) {}
      }

      if (!phoneNumber) {
        logger.warn('Could not identify phone number from Mono webhook:', JSON.stringify(data));
        return;
      }

      // Clean phone number
      phoneNumber = String(phoneNumber).replace(/\D/g, '');

      await sessionStore.update(phoneNumber, {
        monoAccountId: accountId,
        bankConnected: true,
      });

      const platform = getPlatform(phoneNumber);
      await messenger.sendText(phoneNumber,
        `🎉 *Bank connected successfully!*\n\n` +
        `I can now fetch your real balance and transactions.\n\n` +
        `Try:\n• *"What's my balance?"*\n• *"Show my transactions"*`
      );

      logger.info(`Mono bank connected for ${phoneNumber}: ${accountId} via ${platform}`);
    }
  } catch (err) {
    logger.error('Mono webhook error:', err.message, err.stack);
  }
});

// ─── MONO CONNECT CALLBACK (browser redirect) ────────
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  logger.info(`Mono callback: code=${!!code}, state=${state}`);

  let phoneNumber;
  try {
    phoneNumber = state ? Buffer.from(state, 'base64').toString('utf8') : null;
    // Clean phone number
    if (phoneNumber) phoneNumber = phoneNumber.replace(/\D/g, '');
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

        const platform = getPlatform(phoneNumber);
        await messenger.sendText(phoneNumber,
          `🎉 *Bank connected!*\n\n` +
          `Try:\n• *"What's my balance?"*\n• *"Show my transactions"*`
        );

        logger.info(`Mono callback bank connected for ${phoneNumber}: ${accountId}`);
      }
    }

    res.send(`
      <html>
      <head><meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body{font-family:sans-serif;text-align:center;padding:60px 20px;background:#0f1923;color:#e2e8f0}
        h2{color:#00d4aa}p{color:#8b949e}
      </style>
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
