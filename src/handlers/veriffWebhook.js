/**
 * Veriff Webhook Handler
 */

const express = require('express');
const router = express.Router();
const veriffService = require('../services/veriff');
const sessionStore = require('../services/sessionStore');
const whatsappService = require('../services/whatsapp');
const logger = require('../utils/logger');

// ─── GET — Veriff health check ────────────────────────
router.get('/webhook', (req, res) => {
  res.sendStatus(200);
});

// ─── POST — Veriff webhook results ────────────────────
router.post('/webhook', express.json(), async (req, res) => {
  res.sendStatus(200);

  try {
    const signature = req.headers['x-hmac-signature'];
    const payload = req.body;

    logger.info('Veriff webhook received:', JSON.stringify(payload).substring(0, 200));

    // Verify signature
    // Temporarily disabled for testing
// if (!veriffService.verifyWebhookSignature(payload, signature)) {
//   logger.warn('Invalid Veriff webhook signature');
//   return;
// }
    const { verification } = payload;
    if (!verification) return;

    const phoneNumber = verification.vendorData;
    const status = verification.status;
    const code = verification.code;

    logger.info(`Veriff result for ${phoneNumber}: ${status} (code: ${code})`);

    if (!phoneNumber) {
      logger.warn('No phone number in Veriff webhook vendorData');
      return;
    }

    const { text, verified } = veriffService.getStatusMessage(status, code);

    await sessionStore.update(phoneNumber, {
      kycStatus: status,
      kycVerified: verified,
      kycSessionId: verification.id,
    });

    await whatsappService.sendText(phoneNumber, text);

  } catch (err) {
    logger.error('Veriff webhook error:', err.message);
  }
});

// ─── STATUS CHECK ─────────────────────────────────────
router.get('/status/:sessionId', async (req, res) => {
  try {
    const status = await veriffService.getSessionStatus(req.params.sessionId);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
