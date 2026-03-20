/**
 * Veriff Webhook Handler
 *
 * Receives verification results from Veriff
 * and notifies users on WhatsApp.
 */

const express = require('express');
const router = express.Router();
const veriffService = require('../services/veriff');
const sessionStore = require('../services/sessionStore');
const whatsappService = require('../services/whatsapp');
const logger = require('../utils/logger');

// ─── WEBHOOK ──────────────────────────────────────────
router.post('/webhook', express.json(), async (req, res) => {
  // Respond immediately
  res.sendStatus(200);

  try {
    const signature = req.headers['x-hmac-signature'];
    const payload = req.body;

    logger.info('Veriff webhook received:', JSON.stringify(payload).substring(0, 200));

    // Verify signature
   if (process.env.NODE_ENV === 'production' && !veriffService.verifyWebhookSignature(payload, signature)) {
  logger.warn('Invalid Veriff webhook signature');
  return;
}

    const { action, verification } = payload;

    if (!verification) return;

    const phoneNumber = verification.vendorData; // we stored phone number here
    const status = verification.status;
    const code = verification.code;

    logger.info(`Veriff result for ${phoneNumber}: ${status} (code: ${code})`);

    if (!phoneNumber) {
      logger.warn('No phone number in Veriff webhook vendorData');
      return;
    }

    // Get status message
    const { text, verified } = veriffService.getStatusMessage(status, code);

    // Update user session
    await sessionStore.update(phoneNumber, {
      kycStatus: status,
      kycVerified: verified,
      kycSessionId: verification.id,
    });

    // Notify user on WhatsApp
    await whatsappService.sendText(phoneNumber, text);

  } catch (err) {
    logger.error('Veriff webhook error:', err.message);
  }
});

// ─── MANUAL STATUS CHECK ──────────────────────────────
router.get('/status/:sessionId', async (req, res) => {
  try {
    const status = await veriffService.getSessionStatus(req.params.sessionId);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
