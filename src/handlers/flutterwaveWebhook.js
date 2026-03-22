/**
 * Flutterwave Webhook Handler
 * Handles incoming wallet top-ups via virtual accounts
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const sessionStore = require('../services/sessionStore');
const virtualAccount = require('../services/virtualAccount');
const messenger = require('../services/messenger');
const logger = require('../utils/logger');

router.post('/webhook', express.json(), async (req, res) => {
  // Verify webhook signature
  const hash = crypto
    .createHmac('sha256', process.env.FLUTTERWAVE_SECRET_HASH || process.env.FLUTTERWAVE_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');

  const signature = req.headers['verif-hash'];
  if (signature && signature !== hash) {
    logger.warn('Flutterwave webhook signature mismatch');
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  try {
    const { event, data } = req.body;
    logger.info(`Flutterwave webhook: ${event}`, JSON.stringify(data));

    // Only handle successful bank transfer payments (virtual account top-ups)
    if (event !== 'charge.completed') return;
    if (data?.status !== 'successful') return;
    if (data?.payment_type !== 'bank_transfer') return;

    const txRef = data?.tx_ref || '';
    const amount = data?.amount;

    if (!txRef || !amount) return;

    // Match tx_ref to user — format: ZENO-VA-{phoneNumber}
    if (!txRef.startsWith('ZENO-VA-')) return;

    const phoneNumber = txRef.replace('ZENO-VA-', '');
    if (!phoneNumber) return;

    logger.info(`Wallet top-up: ${phoneNumber} ₦${amount}`);

    const session = await sessionStore.get(phoneNumber);
    if (!session) {
      logger.warn(`No session found for ${phoneNumber}`);
      return;
    }

    // Credit the wallet
    await virtualAccount.creditWallet(phoneNumber, amount, session, sessionStore, messenger);

  } catch (err) {
    logger.error('Flutterwave webhook error:', err.message, err.stack);
  }
});

module.exports = router;
