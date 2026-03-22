/**
 * iDenfy KYC Service
 *
 * Replaces Veriff — cheaper, pay only for approved verifications
 * Supports UK + Nigeria + 200 countries
 *
 * Docs: https://documentation.idenfy.com
 */

const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

const API_KEY = process.env.IDENFY_API_KEY;
const API_SECRET = process.env.IDENFY_API_SECRET;
const BASE_URL = 'https://ivs.idenfy.com';

// ─── GENERATE AUTH TOKEN ──────────────────────────────
function generateBasicAuth() {
  const credentials = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');
  return `Basic ${credentials}`;
}

// ─── CREATE VERIFICATION SESSION ─────────────────────
async function createSession(user) {
  try {
    // Generate a unique client ID for this user
    const clientId = user.phoneNumber.replace(/\D/g, '').slice(-20);

    const payload = {
      clientId,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      callbackUrl: `${process.env.IDENFY_CALLBACK_URL || process.env.VERIFF_CALLBACK_URL}/idenfy/webhook`,
      // Allow all document types for both UK and Nigeria
      documents: ['ID_CARD', 'PASSPORT', 'DRIVER_LICENSE', 'RESIDENCE_PERMIT'],
      // No country restriction — works for both UK and Nigeria
      expiryTime: 604800, // 7 days in seconds
      showInstructions: true,
      phoneNumber: user.phoneNumber,
    };

    const response = await axios.post(
      `${BASE_URL}/api/v2/token`,
      payload,
      {
        headers: {
          Authorization: generateBasicAuth(),
          'Content-Type': 'application/json',
        },
      }
    );

    const data = response.data;
    logger.info(`iDenfy session created for ${user.phoneNumber}: ${data.scanRef}`);

    return {
      sessionId: data.scanRef,
      sessionUrl: `https://ivs.idenfy.com/api/v2/redirect?authToken=${data.authToken}`,
      status: 'created',
    };

  } catch (err) {
    logger.error('iDenfy create session error:', err.response?.data || err.message);
    throw err;
  }
}

// ─── GET SESSION STATUS ───────────────────────────────
async function getSessionStatus(scanRef) {
  try {
    const response = await axios.get(
      `${BASE_URL}/api/v2/status`,
      {
        headers: { Authorization: generateBasicAuth() },
        params: { scanRef },
      }
    );
    return response.data;
  } catch (err) {
    logger.error('iDenfy get session error:', err.response?.data || err.message);
    throw err;
  }
}

// ─── VERIFY WEBHOOK SIGNATURE ─────────────────────────
function verifyWebhookSignature(payload, signature) {
  try {
    const hmac = crypto
      .createHmac('sha256', API_SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');
    return hmac === signature;
  } catch (err) {
    logger.error('iDenfy signature verification error:', err.message);
    return false;
  }
}

// ─── MAP STATUS TO USER MESSAGE ───────────────────────
function getStatusMessage(status, autoDocument, autoFace) {
  // iDenfy statuses: APPROVED, DENIED, SUSPECTED, REVIEWING, EXPIRED, DELETED
  switch (status) {
    case 'APPROVED':
      return {
        text:
          `✅ *Identity Verified!*\n\n` +
          `Your account is now fully verified. You can now:\n` +
          `💸 Send money\n` +
          `💰 Check balance\n` +
          `📊 Track spending\n\n` +
          `Welcome to Zeno! 🎉`,
        verified: true,
      };

    case 'DENIED':
      return {
        text:
          `❌ *Verification Failed*\n\n` +
          `We couldn't verify your identity. Common reasons:\n` +
          `• ID was blurry or expired\n` +
          `• Selfie didn't match ID\n` +
          `• Unsupported document type\n\n` +
          `Please try again by typing *'verify my identity'*.`,
        verified: false,
      };

    case 'SUSPECTED':
      return {
        text:
          `⚠️ *Verification Under Review*\n\n` +
          `Your verification is being manually reviewed. ` +
          `This usually takes a few minutes. We'll notify you once complete.`,
        verified: false,
      };

    case 'REVIEWING':
      return {
        text:
          `🔍 *Verification In Progress*\n\n` +
          `Our team is reviewing your documents. ` +
          `You'll receive a message shortly with the result.`,
        verified: false,
      };

    case 'EXPIRED':
      return {
        text:
          `⏰ *Verification Link Expired*\n\n` +
          `Your verification link has expired. ` +
          `Type *'verify my identity'* to get a new one.`,
        verified: false,
      };

    default:
      return {
        text: `⚠️ Verification status: ${status}. Type *'verify my identity'* if you need help.`,
        verified: false,
      };
  }
}

module.exports = {
  createSession,
  getSessionStatus,
  verifyWebhookSignature,
  getStatusMessage,
};
