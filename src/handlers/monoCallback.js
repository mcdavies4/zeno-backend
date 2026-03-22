/**
 * Mono Callback Handler
 */

const express = require('express');
const router = express.Router();
const mono = require('../services/mono');
const sessionStore = require('../services/sessionStore');
const messenger = require('../services/messenger');
const logger = require('../utils/logger');

// Helper to decode phone from meta.ref
function decodePhone(ref) {
  if (!ref) return null;
  try {
    const decoded = Buffer.from(String(ref), 'base64').toString('utf8');
    const cleaned = decoded.replace(/\D/g, '');
    if (cleaned.length >= 10) return cleaned;
  } catch(e) {}
  // Try as plain number
  const plain = String(ref).replace(/\D/g, '');
  return plain.length >= 10 ? plain : null;
}

// ─── MONO WEBHOOK ─────────────────────────────────────
router.post('/webhook', express.json(), async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    logger.info('Mono webhook:', JSON.stringify(body));

    const event = body.event;
    const data = body.data;
    if (!event || !data) return;

    // account_connected — new Initiate API sends data.id as accountId
    // and data.meta.ref as the reference we set
    if (event === 'mono.events.account_connected') {
      const accountId = data?.id || data?.account?._id;
      const ref = data?.meta?.ref;

      logger.info(`account_connected: accountId=${accountId}, ref=${ref}`);

      const phoneNumber = decodePhone(ref);
      if (!phoneNumber) {
        logger.warn('No phone in account_connected, waiting for account_updated');
        return;
      }

      if (accountId) {
        await sessionStore.update(phoneNumber, {
          monoAccountId: accountId,
          bankConnected: true,
        });
        await messenger.sendText(phoneNumber,
          `🎉 *Bank connected successfully!*\n\nTry:\n• *"What's my balance?"*\n• *"Show my transactions"*`
        );
        logger.info(`Mono connected: ${phoneNumber} → ${accountId}`);
      }
    }

    // account_updated — fires after connection with full data including meta.ref
    if (event === 'mono.events.account_updated') {
      const accountId = data?.account?._id;
      const balance = data?.account?.balance;
      const ref = data?.meta?.ref;

      logger.info(`account_updated: accountId=${accountId}, ref=${ref}, balance=${balance}`);

      if (!accountId) return;

      // Get phone from ref
      let phoneNumber = decodePhone(ref);

      // Fallback: Redis lookup
      if (!phoneNumber) {
        try {
          const { Redis } = require('@upstash/redis');
          const redis = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
          });
          const keys = await redis.keys('mono:state:*');
          logger.info(`Redis keys: ${JSON.stringify(keys)}`);
          for (const key of (keys || [])) {
            const val = await redis.get(key);
            logger.info(`Redis ${key} = ${val}`);
            const cleaned = val ? String(val).replace(/\D/g, '') : null;
            if (cleaned?.length >= 10) {
              phoneNumber = cleaned;
              break;
            }
          }
        } catch(e) {
          logger.warn('Redis fallback failed:', e.message);
        }
      }

      if (!phoneNumber) {
        logger.warn('No phone found for account_updated');
        return;
      }

      // Skip if already connected with same accountId
      const session = await sessionStore.get(phoneNumber);
      if (session.monoAccountId === accountId && session.bankConnected) {
        logger.info(`Already connected for ${phoneNumber}`);
        return;
      }

      await sessionStore.update(phoneNumber, {
        monoAccountId: accountId,
        bankConnected: true,
        balance: balance ? balance / 100 : 0,
      });

      await messenger.sendText(phoneNumber,
        `🎉 *Bank connected successfully!*\n\nTry:\n• *"What's my balance?"*\n• *"Show my transactions"*`
      );

      logger.info(`Mono connected via account_updated: ${phoneNumber} → ${accountId}`);
    }

  } catch (err) {
    logger.error('Mono webhook error:', err.message, err.stack);
  }
});

// ─── MONO CONNECT CALLBACK (browser redirect) ─────────
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  logger.info(`Mono callback: code=${!!code}, state=${state}`);

  let phoneNumber = decodePhone(state);

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
        logger.info(`Mono callback: ${phoneNumber} → ${accountId}`);
      }
    }

    res.send(`<html>
      <head><meta name="viewport" content="width=device-width,initial-scale=1">
      <style>body{font-family:sans-serif;text-align:center;padding:60px 20px;background:#0f1923;color:#e2e8f0}h2{color:#00d4aa}p{color:#8b949e}</style>
      </head><body>
        <div style="font-size:3rem">✅</div>
        <h2>Bank Connected!</h2>
        <p>Return to WhatsApp or Telegram to continue.</p>
      </body></html>`);

  } catch(err) {
    logger.error('Mono callback error:', err.message);
    res.send(`<html><body style="text-align:center;padding:60px;background:#0f1923;color:#e2e8f0">
      <h2 style="color:#ef4444">Connection Failed</h2><p>Please try again.</p>
    </body></html>`);
  }
});

module.exports = router;
