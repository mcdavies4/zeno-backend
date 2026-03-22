/**
 * TrueLayer OAuth Callback
 */

const express = require('express');
const router = express.Router();
const { exchangeCodeForToken } = require('../services/truelayer');
const sessionStore = require('../services/sessionStore');
const messenger = require('../services/messenger');
const { getPlatform } = require('../utils/countryDetect');
const logger = require('../utils/logger');

router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  logger.info(`TrueLayer callback: code=${!!code}, state=${state}, error=${error}`);

  let phoneNumber;
  try {
    if (!state) throw new Error('No state');
    const decoded = Buffer.from(state, 'base64').toString('utf8');
    phoneNumber = /^\+?\d{7,15}$/.test(decoded) ? decoded : state;
  } catch (e) {
    logger.error('Invalid state:', state, e.message);
    return res.send(successPage('Almost there!', 'Please return to your chat app.'));
  }

  const platform = getPlatform(phoneNumber);

  if (error) {
    logger.warn(`TrueLayer cancelled for ${phoneNumber}: ${error}`);
    if (phoneNumber) {
      await messenger.sendText(phoneNumber,
        `No worries! Connect your bank anytime by asking me *'connect my bank'*. 😊`
      );
    }
    return res.send(successPage('Cancelled', 'You can close this window.'));
  }

  try {
    const tokens = await exchangeCodeForToken(code);

    await sessionStore.update(phoneNumber, {
      truelayerAccessToken: tokens.access_token,
      truelayerRefreshToken: tokens.refresh_token,
      truelayerExpiresAt: Date.now() + (tokens.expires_in * 1000),
      bankConnected: true,
    });

    logger.info(`Bank connected for ${phoneNumber} via ${platform}`);

    if (phoneNumber) {
      await messenger.sendText(phoneNumber,
        `🎉 *Bank connected successfully!*\n\n` +
        `Try asking:\n` +
        `• *"What's my balance?"*\n` +
        `• *"Show my recent transactions"*`
      );
    }

    res.send(successPage(
      'Bank Connected! ✅',
      `You can close this window and return to ${platform}.`
    ));

  } catch (err) {
    logger.error(`TrueLayer error for ${phoneNumber}:`, err.message);
    if (phoneNumber) {
      await messenger.sendText(phoneNumber,
        `⚠️ Something went wrong connecting your bank. Please try again by saying *'connect my bank'*.`
      );
    }
    res.status(500).send(successPage(
      'Connection Failed',
      `Please try again on ${platform}.`
    ));
  }
});

function successPage(title, message) {
  return `
    <html>
    <head><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body{font-family:sans-serif;text-align:center;padding:60px 20px;background:#06090d;color:#e6edf3}
      h2{color:#00d4aa}p{color:#8b949e}
    </style></head>
    <body>
      <div style="font-size:3rem">✅</div>
      <h2>${title}</h2>
      <p>${message}</p>
    </body>
    </html>`;
}

module.exports = router;
