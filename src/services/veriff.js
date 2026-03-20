/**
 * Veriff KYC Service
 *
 * Handles:
 * - Creating verification sessions
 * - Sending KYC links to users via WhatsApp
 * - Processing webhook results
 */

const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

const API_KEY = process.env.VERIFF_API_KEY;
const API_SECRET = process.env.VERIFF_API_SECRET;
const BASE_URL = process.env.VERIFF_BASE_URL || 'https://stationapi.veriff.com';

// ─── CREATE VERIFICATION SESSION ─────────────────────
async function createSession(user) {
  try {
    const payload = {
      verification: {
        callback: `${process.env.VERIFF_CALLBACK_URL || process.env.RAILWAY_PUBLIC_DOMAIN}/veriff/webhook`,
        person: {
          firstName: user.firstName || '',
          lastName: user.lastName || '',
        },
        document: {
          country: 'GB',
        },
        vendorData: user.phoneNumber, // store phone number to identify user
        timestamp: new Date().toISOString(),
      },
    };

    const response = await axios.post(
      `${BASE_URL}/v1/sessions`,
      payload,
      {
        headers: {
          'X-AUTH-CLIENT': API_KEY,
          'Content-Type': 'application/json',
        },
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
      {
        headers: { 'X-AUTH-CLIENT': API_KEY },
      }
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
    logger.error('Webhook signature verification error:', err.message);
    return false;
  }
}

// ─── MAP VERIFF STATUS TO USER MESSAGE ────────────────
function getStatusMessage(status, code) {
  const messages = {
    approved: {
      text: `✅ *Identity Verified!*\n\nYour account is now fully verified. You can now:\n💸 Send money\n💰 Check balance\n📊 Track spending\n\nWelcome to Zeno! 🎉`,
      verified: true,
    },
    declined: {
      text: `❌ *Verification Failed*\n\nWe couldn't verify your identity. Common reasons:\n• ID was blurry or expired\n• Selfie didn't match ID\n• Unsupported document type\n\nPlease try again by typing *'verify my identity'*.`,
      verified: false,
    },
    resubmission_requested: {
      text: `⚠️ *Additional Information Needed*\n\nWe need you to resubmit your verification. Please tap the link again and try with a clearer photo of your ID.\n\nType *'verify my identity'* to get a new link.`,
      verified: false,
    },
    expired: {
      text: `⏰ *Verification Link Expired*\n\nYour verification link has expired. Type *'verify my identity'* to get a new one.`,
      verified: false,
    },
    abandoned: {
      text: `⚠️ *Verification Incomplete*\n\nYou didn't complete the verification. Type *'verify my identity'* to try again.`,
      verified: false,
    },
  };

  return messages[status] || {
    text: `⚠️ Verification status: ${status}. Type *'verify my identity'* if you need help.`,
    verified: false,
  };
}

module.exports = {
  createSession,
  getSessionStatus,
  verifyWebhookSignature,
  getStatusMessage,
};
