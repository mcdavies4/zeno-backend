/**
 * Veriff Webhook Handler
 */

const express = require('express');
const router = express.Router();
const veriffService = require('../services/veriff');
const sessionStore = require('../services/sessionStore');
const messenger = require('../services/messenger');
const logger = require('../utils/logger');

router.get('/webhook', (req, res) => res.sendStatus(200));

router.post('/webhook', express.json({ strict: false }), async (req, res) => {
  res.sendStatus(200);

  try {
    const payload = req.body;
    logger.info('Veriff webhook headers:', JSON.stringify(req.headers));
    logger.info('Veriff webhook full payload:', JSON.stringify(payload));
    logger.info('Veriff payload type:', typeof payload, 'keys:', Object.keys(payload || {}).join(','));

    // Veriff sends different payload formats — handle all of them
    const verification =
      payload?.verification ||
      payload?.data?.verification ||
      payload?.technicalData?.verification ||
      null;

    if (!verification) {
      // Maybe the whole payload IS the verification object
      if (payload?.status && payload?.vendorData) {
        logger.info('Veriff payload is flat format');
        await processVerification(payload);
        return;
      }
      logger.warn('Could not find verification in payload:', JSON.stringify(payload));
      return;
    }

    await processVerification(verification);

  } catch (err) {
    logger.error('Veriff webhook error:', err.message, err.stack);
  }
});

async function processVerification(verification) {
  const rawPhone = verification.vendorData || '';
  const phoneNumber = rawPhone.replace(/\D/g, '');

  if (!phoneNumber) {
    logger.warn('No phone in Veriff vendorData:', rawPhone);
    return;
  }

  const status = verification.status;
  const code = verification.code;
  logger.info(`Veriff result for ${phoneNumber}: status=${status} code=${code}`);

  const { text, verified } = veriffService.getStatusMessage(status, code);

  await sessionStore.update(phoneNumber, {
    kycStatus: status,
    kycVerified: verified,
    kycSessionId: verification.id,
  });

  await messenger.sendText(phoneNumber, text);
  logger.info(`Veriff notification sent to ${phoneNumber}: ${status}`);
}

router.get('/status/:sessionId', async (req, res) => {
  try {
    const status = await veriffService.getSessionStatus(req.params.sessionId);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
