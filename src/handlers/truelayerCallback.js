/**
 * TrueLayer OAuth Callback
 *
 * After user connects their bank on TrueLayer,
 * they get redirected here with a code.
 * We exchange it for tokens and save to their session.
 */

const express = require('express');
const router = express.Router();
const { exchangeCodeForToken } = require('../services/truelayer');
const sessionStore = require('../services/sessionStore');
const whatsappService = require('../services/whatsapp');
const logger = require('../utils/logger');

router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  // Decode phone number from state
  let phoneNumber;
  try {
    phoneNumber = Buffer.from(state, 'base64').toString('utf8');
  } catch (e) {
    return res.status(400).send('Invalid state parameter');
  }

  // Handle user cancellation
  if (error) {
    logger.warn(`TrueLayer auth cancelled for ${phoneNumber}: ${error}`);
    await whatsappService.sendText(phoneNumber,
      "No worries! You can connect your bank anytime by asking me *'connect my bank'*. 😊"
    );
    return res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>Cancelled</h2>
        <p>You can close this window and return to WhatsApp.</p>
      </body></html>
    `);
  }

  try {
    // Exchange code for access + refresh tokens
    const tokens = await exchangeCodeForToken(code);

    // Save tokens to user session
    await sessionStore.update(phoneNumber, {
      truelayerAccessToken: tokens.access_token,
      truelayerRefreshToken: tokens.refresh_token,
      truelayerExpiresAt: Date.now() + (tokens.expires_in * 1000),
      bankConnected: true,
    });

    logger.info(`Bank connected successfully for ${phoneNumber}`);

    // Notify user on WhatsApp
    await whatsappService.sendText(phoneNumber,
      `🎉 *Bank connected successfully!*\n\n` +
      `I can now fetch your real balance and transactions.\n\n` +
      `Try asking:\n` +
      `• *"What's my balance?"*\n` +
      `• *"Show my recent transactions"*`
    );

    // Show success page
    res.send(`
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; text-align: center; padding: 60px 20px; background: #06090d; color: #e6edf3; }
          .icon { font-size: 4rem; margin-bottom: 16px; }
          h2 { font-size: 1.5rem; margin-bottom: 8px; color: #00d4aa; }
          p { color: #8b949e; }
        </style>
      </head>
      <body>
        <div class="icon">✅</div>
        <h2>Bank Connected!</h2>
        <p>You can close this window and return to WhatsApp.</p>
      </body>
      </html>
    `);

  } catch (err) {
    logger.error(`TrueLayer callback error for ${phoneNumber}:`, err.message);

    await whatsappService.sendText(phoneNumber,
      "⚠️ Something went wrong connecting your bank. Please try again by saying *'connect my bank'*."
    );

    res.status(500).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#06090d;color:#e6edf3">
        <h2 style="color:#ff4d6d">Connection Failed</h2>
        <p>Please close this window and try again on WhatsApp.</p>
      </body></html>
    `);
  }
});

module.exports = router;
