/**
 * iDenfy Webhook Handler
 * Receives verification results and notifies users on WhatsApp/Telegram
 */

const express = require('express');
const router = express.Router();
const idenfyService = require('../services/idenfy');
const sessionStore = require('../services/sessionStore');
const messenger = require('../services/messenger');
const logger = require('../utils/logger');

// Health check
router.get('/webhook', (req, res) => res.sendStatus(200));

// Verification result webhook
router.post('/webhook', express.json(), async (req, res) => {
  res.sendStatus(200);

  try {
    const payload = req.body;
    const signature = req.headers['idenfy-signature'];

    logger.info('iDenfy webhook received:', JSON.stringify(payload).substring(0, 200));

    // Verify signature (temporarily disabled for testing — enable in production)
    // if (!idenfyService.verifyWebhookSignature(payload, signature)) {
    //   logger.warn('Invalid iDenfy webhook signature');
    //   return;
    // }

    const status = payload.status;
    const scanRef = payload.scanRef;
    const clientId = payload.clientId; // This is the phone number we set

    if (!clientId) {
      logger.warn('No clientId in iDenfy webhook');
      return;
    }

    // Reconstruct phone number from clientId
    // clientId was set as last 20 digits of phone number
    // We need to find the user by scanning sessions
    // Better: store scanRef → phoneNumber mapping in Redis during session creation

    // For now use clientId directly as phone number
    const phoneNumber = clientId;

    logger.info(`iDenfy result for ${phoneNumber}: ${status}`);

    const { text, verified } = idenfyService.getStatusMessage(
      status,
      payload.autoDocument,
      payload.autoFace
    );

    await sessionStore.update(phoneNumber, {
      kycStatus: status.toLowerCase(),
      kycVerified: verified,
      kycSessionId: scanRef,
    });

    await messenger.sendText(phoneNumber, text);
    logger.info(`iDenfy notification sent to ${phoneNumber}`);

  } catch (err) {
    logger.error('iDenfy webhook error:', err.message);
  }
});

module.exports = router;
