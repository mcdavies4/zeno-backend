/**
 * Mono Callback Handler
 */

const express = require('express');
const router = express.Router();
const mono = require('../services/mono');
const sessionStore = require('../services/sessionStore');
const messenger = require('../services/messenger');
const logger = require('../utils/logger');

// ─── MONO WEBHOOK ─────────────────────────────────────
router.post('/webhook', express.json(), async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    logger.info('Mono webhook received:', JSON.stringify(body));

    const event = body.event;
    const data = body.data;

    if (!event) return;

    logger.info(`Mono event type: ${event}`);

    // account_connected — user just connected their bank
    if (event === 'mono.events.account_connected') {
      // Mono sends account._id directly in account_connected
      const accountId = data?.account?._id;
      const code = data?.code; // sometimes code is sent

      logger.info(`Mono account_connected: accountId=${accountId}, code=${!!code}`);

      // Get phone number from state stored in Redis
      let phoneNumber = null;

      // Try meta fields
      if (data?.meta?.ref) {
        try {
          phoneNumber = Buffer.from(String(data.meta.ref), 'base64').toString('utf8');
          phoneNumber = phoneNumber.replace(/\D/g, '');
        } catch(e) {
          phoneNumber = String(data.meta.ref).replace(/\D/g, '');
        }
      }

      if (!phoneNumber && data?.meta?.data) {
        phoneNumber = String(data.meta.data).replace(/\D/g, '');
      }

      // Try Redis lookup by state
      if (!phoneNumber) {
        try {
          const { Redis } = require('@upstash/redis');
          const redis = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
          });
          // Try all pending states
          const keys = await redis.keys('mono:state:*');
          logger.info(`Mono Redis keys found: ${keys?.length}`);
          if (keys?.length > 0) {
            phoneNumber = await redis.get(keys[0]);
            if (phoneNumber) phoneNumber = String(phoneNumber).replace(/\D/g, '');
          }
        } catch(e) {
          logger.warn('Redis lookup failed:', e.message);
        }
      }

      if (!phoneNumber) {
        logger.warn('Could not find phone number for Mono webhook');
        logger.warn('Full payload:', JSON.stringify(body));
        return;
      }

      // If we have accountId directly, use it
      if (accountId) {
        await sessionStore.update(phoneNumber, {
          monoAccountId: accountId,
          bankConnected: true,
        });
        await messenger.sendText(phoneNumber,
          `🎉 *Bank connected successfully!*\n\n` +
          `Try:\n• *"What's my balance?"*\n• *"Show my transactions"*`
        );
        logger.info(`Mono bank connected for ${phoneNumber}: ${accountId}`);
        return;
      }

      // Otherwise exchange code
      if (code) {
        const result = await mono.exchangeCode(code);
        const newAccountId = result?.id;
        if (newAccountId) {
          await sessionStore.update(phoneNumber, {
            monoAccountId: newAccountId,
            bankConnected: true,
          });
          await messenger.sendText(phoneNumber,
            `🎉 *Bank connected successfully!*\n\n` +
            `Try:\n• *"What's my balance?"*\n• *"Show my transactions"*`
          );
          logger.info(`Mono bank connected for ${phoneNumber}: ${newAccountId}`);
        }
      }
    }

    // account_updated — fires right after account_connected with full account data
    if (event === 'mono.events.account_updated') {
      const accountId = data?.account?._id;
      const balance = data?.account?.balance;
      logger.info(`Mono account_updated: ${accountId}, balance: ${balance}`);

      if (!accountId) return;

      // Get phone number from Redis
      let phoneNumber = null;
      try {
        const { Redis } = require('@upstash/redis');
        const redis = new Redis({
          url: process.env.UPSTASH_REDIS_REST_URL,
          token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
        const keys = await redis.keys('mono:state:*');
        logger.info(`Mono Redis keys: ${JSON.stringify(keys)}`);
        if (keys?.length > 0) {
          // Get most recent key
          phoneNumber = await redis.get(keys[keys.length - 1]);
          if (phoneNumber) phoneNumber = String(phoneNumber).replace(/\D/g, '');
        }
      } catch(e) {
        logger.warn('Redis lookup failed:', e.message);
      }

      if (!phoneNumber) {
        logger.warn('No phone found for account_updated');
        return;
      }

      // Check if already connected to avoid duplicate messages
      const session = await sessionStore.get(phoneNumber);
      if (session.monoAccountId === accountId) {
        logger.info(`Mono already connected for ${phoneNumber}`);
        return;
      }

      const balanceInNaira = balance ? balance / 100 : 0;

      await sessionStore.update(phoneNumber, {
        monoAccountId: accountId,
        bankConnected: true,
        balance: balanceInNaira,
      });

      await messenger.sendText(phoneNumber,
        `🎉 *Bank connected successfully!*

` +
        `Try:
• *"What's my balance?"*
• *"Show my transactions"*`
      );

      logger.info(`Mono bank connected via account_updated for ${phoneNumber}: ${accountId}`);
    }

  } catch (err) {
    logger.error('Mono webhook error:', err.message, err.stack);
  }
});

// ─── MONO CONNECT CALLBACK (browser redirect) ─────────
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  logger.info(`Mono callback: code=${!!code}, state=${state}`);

  let phoneNumber = null;

  // Decode state
  if (state) {
    try {
      const decoded = Buffer.from(state, 'base64').toString('utf8');
      phoneNumber = decoded.replace(/\D/g, '');
    } catch(e) {
      phoneNumber = state.replace(/\D/g, '');
    }
  }

  // Also try Redis
  if (!phoneNumber && state) {
    try {
      const { Redis } = require('@upstash/redis');
      const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      const stored = await redis.get(`mono:state:${state}`);
      if (stored) phoneNumber = String(stored).replace(/\D/g, '');
    } catch(e) {}
  }

  logger.info(`Mono callback phone: ${phoneNumber}`);

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
        logger.info(`Mono callback connected: ${phoneNumber} → ${accountId}`);
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
    res.send(`<html><body style="text-align:center;padding:60px;background:#0f1923;color:#e2e8f0">
      <h2 style="color:#ef4444">Connection Failed</h2>
      <p>Please try again.</p>
    </body></html>`);
  }
});

module.exports = router;
