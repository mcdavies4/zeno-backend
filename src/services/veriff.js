/**
 * Veriff KYC Service
 */

const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

const API_KEY = process.env.VERIFF_API_KEY;
const API_SECRET = process.env.VERIFF_API_SECRET;
const BASE_URL = process.env.VERIFF_BASE_URL || 'https://stationapi.veriff.com';

// ─── CREATE SESSION ───────────────────────────────────
async function createSession(user) {
  try {
    const nameParts = (user.name || `${user.firstName || ''} ${user.lastName || ''}`).trim().split(' ');
    const firstName = user.firstName || nameParts[0] || 'User';
    const lastName = user.lastName || nameParts.slice(1).join(' ') || '';

    // Deep link back to WhatsApp or Telegram after verification
    const phone = String(user.phoneNumber).replace(/\D/g, '');
    const isTelegram = phone.length <= 10 && !phone.startsWith('44') && !phone.startsWith('234') && !phone.startsWith('1');
    const callbackUrl = isTelegram
      ? `https://t.me/ZenoUKbot`
      : `https://wa.me/447459233682?text=I+just+completed+my+verification`;

    const payload = {
      verification: {
        callback: callbackUrl,
        person: { firstName, lastName },
        vendorData: String(user.phoneNumber),
        timestamp: new Date().toISOString(),
      },
    };

    logger.info(`Creating Veriff session for ${user.phoneNumber}`);

    const response = await axios.post(
      `${BASE_URL}/v1/sessions`,
      payload,
      {
        headers: {
          'X-AUTH-CLIENT': API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const session = response.data.verification;
    logger.info(`Veriff session created for ${user.phoneNumber}: ${session.id}`);

    return {
      sessionId: session.id,
      sessionUrl: session.url,
      status: session.status,
    };

  } catch (err) {
    logger.error('Veriff create session error:', err.response?.data || err.message);
    throw err;
  }
}

// ─── GET SESSION STATUS ───────────────────────────────
async function getSessionStatus(sessionId) {
  try {
    const response = await axios.get(
      `${BASE_URL}/v1/sessions/${sessionId}`,
      { headers: { 'X-AUTH-CLIENT': API_KEY }, timeout: 10000 }
    );
    return response.data.verification;
  } catch (err) {
    logger.error('Veriff get session error:', err.response?.data || err.message);
    throw err;
  }
}

// ─── VERIFY WEBHOOK SIGNATURE ─────────────────────────
function verifyWebhookSignature(payload, signature) {
  try {
    const hmac = crypto
      .createHmac('sha256', API_SECRET)
      .update(Buffer.from(JSON.stringify(payload), 'utf8'))
      .digest('hex')
      .toLowerCase();
    return hmac === signature?.toLowerCase();
  } catch (err) {
    logger.error('Webhook signature error:', err.message);
    return false;
  }
}

// ─── STATUS MESSAGES ──────────────────────────────────
function getStatusMessage(status, code) {
  const messages = {
    approved: {
      text:
        `✅ *Identity Verified!*\n\n` +
        `Your identity has been confirmed. You now have full access to Zeno!\n\n` +
        `You can now:\n` +
        `💸 Send money\n` +
        `💰 Check your balance\n` +
        `📊 Track your spending\n\n` +
        `Welcome to Zeno! 🎉`,
      verified: true,
    },
    declined: {
      text:
        `❌ *Verification Failed*\n\n` +
        `We couldn't verify your identity. Common reasons:\n` +
        `• ID was blurry or expired\n` +
        `• Selfie didn't match ID photo\n` +
        `• Unsupported document type\n\n` +
        `Type *"verify my identity"* to try again.`,
      verified: false,
    },
    resubmission_requested: {
      text:
        `⚠️ *Resubmission Required*\n\n` +
        `We need clearer photos. Please try again with:\n` +
        `• Better lighting\n` +
        `• All 4 corners of your ID visible\n` +
        `• A clear selfie\n\n` +
        `Type *"verify my identity"* to get a new link.`,
      verified: false,
    },
    expired: {
      text:
        `⏰ *Verification Link Expired*\n\n` +
        `Your link has expired. Type *"verify my identity"* to get a new one.`,
      verified: false,
    },
    abandoned: {
      text:
        `⚠️ *Verification Incomplete*\n\n` +
        `You didn't complete verification. Type *"verify my identity"* to try again.`,
      verified: false,
    },
  };

  return messages[status] || {
    text: `⚠️ Verification status: *${status}*. Type *"verify my identity"* if you need help.`,
    verified: false,
  };
}

module.exports = {
  createSession,
  getSessionStatus,
  verifyWebhookSignature,
  getStatusMessage,
};
