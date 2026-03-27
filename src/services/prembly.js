/**
 * Prembly (IdentityPass) KYC Service
 * Nigeria-focused: NIN, BVN, document verification
 * API: https://api.myidentitypay.com
 */

const axios = require('axios');
const logger = require('../utils/logger');

const BASE_URL = 'https://api.myidentitypay.com';

function getHeaders() {
  return {
    'x-api-key': process.env.PREMBLY_API_KEY,
    'app-id': process.env.PREMBLY_APP_ID,
    'Content-Type': 'application/json',
  };
}

// ─── VERIFY BVN ──────────────────────────────────────
async function verifyBVN(bvn) {
  try {
    const response = await axios.post(
      `${BASE_URL}/api/v2/biometrics/merchant/data/verification/bvn_advance`,
      { number: bvn },
      { headers: getHeaders(), timeout: 30000 }
    );
    const data = response.data;
    logger.info(`Prembly BVN verify: ${data.detail}`);
    return {
      success: data.status === true,
      message: data.detail,
      data: data.data || null,
    };
  } catch (err) {
    logger.error('Prembly BVN error:', err.response?.data || err.message);
    throw err;
  }
}

// ─── VERIFY NIN ──────────────────────────────────────
async function verifyNIN(nin) {
  try {
    const response = await axios.post(
      `${BASE_URL}/api/v2/biometrics/merchant/data/verification/nin`,
      { number: nin },
      { headers: getHeaders(), timeout: 30000 }
    );
    const data = response.data;
    logger.info(`Prembly NIN verify: ${data.detail}`);
    return {
      success: data.status === true,
      message: data.detail,
      data: data.data || null,
    };
  } catch (err) {
    logger.error('Prembly NIN error:', err.response?.data || err.message);
    throw err;
  }
}

// ─── PARSE KYC INPUT ─────────────────────────────────
// Detect whether user entered a BVN (11 digits) or NIN (11 digits)
// BVN starts with 2, NIN has different prefix patterns
function detectIdType(number) {
  const clean = number.replace(/\s/g, '');
  if (!/^\d{11}$/.test(clean)) return null;
  // BVN always starts with 2
  if (clean.startsWith('2')) return 'BVN';
  return 'NIN';
}

// ─── FORMAT VERIFICATION RESULT ──────────────────────
function formatVerificationMessage(result, idType) {
  if (!result.success) {
    return {
      text:
        `❌ *Verification Failed*\n\n` +
        `We couldn't verify your ${idType}. Please check the number and try again.\n\n` +
        `Type *"verify my identity"* to try again.`,
      verified: false,
    };
  }

  const d = result.data;
  const name = [d?.firstName || d?.firstname, d?.lastName || d?.surname]
    .filter(Boolean).join(' ') || 'Verified';

  return {
    text:
      `✅ *Identity Verified!*\n\n` +
      `Welcome, *${name}*! Your ${idType} has been verified successfully.\n\n` +
      `You now have full access to Zeno:\n` +
      `💸 Send money\n` +
      `💰 Check your balance\n` +
      `📊 Track your spending\n` +
      `📱 Pay bills & airtime\n\n` +
      `Welcome to Zeno! 🎉`,
    verified: true,
    name,
  };
}

// ─── KYC PROMPT MESSAGE ──────────────────────────────
function getKYCPromptMessage() {
  return (
    `🪪 *Verify Your Identity*\n\n` +
    `To keep your account secure and comply with CBN regulations, please verify your identity.\n\n` +
    `Simply reply with your:\n` +
    `• *BVN* (11-digit Bank Verification Number), or\n` +
    `• *NIN* (11-digit National Identity Number)\n\n` +
    `Example: *22345678901*\n\n` +
    `🔒 Your information is encrypted and never shared.`
  );
}

module.exports = {
  verifyBVN,
  verifyNIN,
  detectIdType,
  formatVerificationMessage,
  getKYCPromptMessage,
};
