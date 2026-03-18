const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const messageHandler = require('./messageHandler');
const logger = require('../utils/logger');

// ─── WEBHOOK VERIFICATION (one-time setup) ────────────
// Meta calls GET /webhook to verify your endpoint
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    logger.info('WhatsApp webhook verified successfully');
    return res.status(200).send(challenge);
  }

  logger.warn('Webhook verification failed — token mismatch');
  res.sendStatus(403);
});

// ─── INCOMING MESSAGES ────────────────────────────────
router.post('/', verifySignature, async (req, res) => {
  // Respond 200 immediately — WhatsApp requires fast acknowledgement
  // (it will retry if you don't respond within 20s)
  res.sendStatus(200);

  try {
    const body = JSON.parse(req.body.toString());

    // Only handle whatsapp_business_account events
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const messages = value.messages || [];
        const contacts = value.contacts || [];

        for (const message of messages) {
          const from = message.from; // sender's WhatsApp number (E.164 format)
          const contactName = contacts.find(c => c.wa_id === from)?.profile?.name || 'there';

          logger.info(`Message from ${from} (${contactName}): type=${message.type}`);

          await messageHandler.handle({
            from,
            contactName,
            message,
            phoneNumberId: value.metadata?.phone_number_id,
          });
        }
      }
    }
  } catch (err) {
    logger.error('Error processing webhook:', err);
  }
});

// ─── SIGNATURE VERIFICATION MIDDLEWARE ────────────────
// Ensures the request genuinely came from Meta
function verifySignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    logger.warn('Missing x-hub-signature-256 header');
    return res.sendStatus(401);
  }

  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
    .update(req.body)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    logger.warn('Invalid webhook signature');
    return res.sendStatus(401);
  }

  next();
}

module.exports = router;
