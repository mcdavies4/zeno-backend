/**
 * Veriff Webhook Handler
 */

const express = require('express');
const router = express.Router();
const veriffService = require('../services/veriff');
const sessionStore = require('../services/sessionStore');
const messenger = require('../services/messenger');
const logger = require('../utils/logger');

// GET — health check
router.get('/webhook', (req, res) => res.sendStatus(200));

// POST — Veriff decision webhook
router.post('/webhook', express.json(), async (req, res) => {
  res.sendStatus(200);

  try {
    const payload = req.body;
    logger.info('Veriff webhook received:', JSON.stringify(payload).substring(0, 300));

    const { verification } = payload;
    if (!verification) {
      logger.warn('No verification object in Veriff webhook');
      return;
    }

    // Phone number stored in vendorData during session creation
    const rawPhone = verification.vendorData || '';
    const phoneNumber = rawPhone.replace(/\D/g, '');

    if (!phoneNumber) {
      logger.warn('No phone number in Veriff vendorData:', rawPhone);
      return;
    }

    const status = verification.status;
    const code = verification.code;
    logger.info(`Veriff result for ${phoneNumber}: status=${status} code=${code}`);

    const { text, verified } = veriffService.getStatusMessage(status, code);

    // Update session
    await sessionStore.update(phoneNumber, {
      kycStatus: status,
      kycVerified: verified,
      kycSessionId: verification.id,
    });

    // Send message — works for both WhatsApp and Telegram
    await messenger.sendText(phoneNumber, text);
    logger.info(`Veriff result sent to ${phoneNumber}: ${status}, verified=${verified}`);

  } catch (err) {
    logger.error('Veriff webhook error:', err.message, err.stack);
  }
});

// Status check endpoint
router.get('/status/:sessionId', async (req, res) => {
  try {
    const status = await veriffService.getSessionStatus(req.params.sessionId);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
