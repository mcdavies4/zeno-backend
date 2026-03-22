/**
 * iDenfy Webhook Handler
 */

const express = require('express');
const router = express.Router();
const idenfyService = require('../services/idenfy');
const sessionStore = require('../services/sessionStore');
const messenger = require('../services/messenger');
const logger = require('../utils/logger');

router.get('/webhook', (req, res) => res.sendStatus(200));

router.post('/webhook', express.json(), async (req, res) => {
  res.sendStatus(200);

  try {
    const payload = req.body;

    // Log full payload to understand structure
    logger.info('iDenfy webhook full payload:', JSON.stringify(payload));

    // iDenfy payload structure:
    // { final: { status: 'APPROVED'|'DENIED'|... }, scanRef: '...', clientId: '...' }
    // OR: { status: { overall: 'APPROVED' }, scanRef: '...', clientId: '...' }
    // OR: { status: 'APPROVED', scanRef: '...', clientId: '...' }

    const scanRef = payload.scanRef;
    const clientId = payload.clientId;

    if (!clientId) {
      logger.warn('No clientId in iDenfy webhook');
      return;
    }

    // Extract status — handle all possible payload formats
    let status;
    if (typeof payload.status === 'string') {
      status = payload.status;
    } else if (payload.status?.overall) {
      status = payload.status.overall;
    } else if (payload.final?.status) {
      status = payload.final.status;
    } else if (payload.autoDocument?.status) {
      status = payload.autoDocument.status;
    } else {
      status = 'REVIEWING';
    }

    const phoneNumber = clientId.replace(/\D/g, '');

    logger.info(`iDenfy result for ${phoneNumber}: status=${status}, scanRef=${scanRef}`);

    const { text, verified } = idenfyService.getStatusMessage(status);

    await sessionStore.update(phoneNumber, {
      kycStatus: status.toLowerCase(),
      kycVerified: verified,
      kycSessionId: scanRef,
    });

    await messenger.sendText(phoneNumber, text);
    logger.info(`iDenfy notification sent to ${phoneNumber}: ${status}`);

  } catch (err) {
    logger.error('iDenfy webhook error:', err.message, err.stack);
  }
});

module.exports = router;
