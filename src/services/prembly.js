/**
 * Prembly (IdentityPass) KYC Service
 * Nigeria: NIN and BVN verification
 */

const axios = require('axios');
const logger = require('../utils/logger');

const BASE_URL = 'https://api.prembly.com';

function getHeaders() {
  return {
    'x-api-key': process.env.PREMBLY_API_KEY,
    'Content-Type': 'application/json',
  };
}

// ─── VERIFY NIN ──────────────────────────────────────
async function verifyNIN(nin) {
  try {
    logger.info(`Prembly: verifying NIN: ${nin}, key prefix: ${(process.env.PREMBLY_API_KEY || '').substring(0, 8)}`);
    const response = await axios.post(
      `${BASE_URL}/identitypass/verification/nin`,
      { number: nin },
      { headers: getHeaders(), timeout: 30000 }
    );
    const data = response.data;
    logger.info(`Prembly NIN response: ${JSON.stringify(data).substring(0, 200)}`);
    return {
      success: data.status === true,
      message: data.detail,
      data: data.data || null,
    };
  } catch (err) {
    logger.error(`Prembly NIN error: ${err.message}`);
    logger.error(`Prembly NIN status: ${err.response?.status}`);
    logger.error(`Prembly NIN response: ${JSON.stringify(err.response?.data)}`);
    logger.error(`Prembly NIN response: ${JSON.stringify(err.response?.data)}`);
    logger.error(`Prembly API key: ${(process.env.PREMBLY_API_KEY || 'NOT SET').substring(0, 12)}...`);
    throw err;
  }
}

// ─── VERIFY BVN ──────────────────────────────────────
async function verifyBVN(bvn) {
  try {
    logger.info(`Prembly: verifying BVN: ${bvn}, key prefix: ${(process.env.PREMBLY_API_KEY || '').substring(0, 8)}`);
    const response = await axios.post(
      `${BASE_URL}/identitypass/verification/bvn`,
      { number: bvn },
      { headers: getHeaders(), timeout: 30000 }
    );
    const data = response.data;
    logger.info(`Prembly BVN response: ${JSON.stringify(data).substring(0, 200)}`);
    return {
      success: data.status === true,
      message: data.detail,
      data: data.data || null,
    };
  } catch (err) {
    logger.error(`Prembly BVN error: ${err.message}`);
    logger.error(`Prembly BVN status: ${err.response?.status}`);
    logger.error(`Prembly BVN response: ${JSON.stringify(err.response?.data)}`);
    logger.error(`Prembly BVN request body: ${JSON.stringify({ number: bvn })}`);
    throw err;
  }
}

// ─── DETECT ID TYPE ───────────────────────────────────
function detectIdType(number) {
  const clean = String(number).replace(/\s/g, '');
  if (!/^\d{11}$/.test(clean)) return null;
  if (clean.startsWith('2')) return 'BVN';
  return 'NIN';
}

// ─── FORMAT RESULT ────────────────────────────────────
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

  const d = result.data || {};
  const name = [d.firstName || d.firstname, d.lastName || d.surname]
    .filter(Boolean).join(' ') || 'Verified';

  return {
    text:
      `✅ *Identity Verified!*\n\n` +
      `Welcome, *${name}*! Your ${idType} has been verified.\n\n` +
      `You now have full access to Zeno:\n` +
      `💸 Send money\n` +
      `💰 Check balance\n` +
      `📊 Track spending\n` +
      `📱 Pay bills & airtime\n\n` +
      `Welcome to Zeno! 🎉`,
    verified: true,
    name,
  };
}

// ─── KYC PROMPT ───────────────────────────────────────
function getKYCPromptMessage() {
  return (
    `🪪 *Verify Your Identity*\n\n` +
    `To keep your account secure, please verify your identity.\n\n` +
    `Reply with your:\n` +
    `• *BVN* (11-digit Bank Verification Number), or\n` +
    `• *NIN* (11-digit National Identity Number)\n\n` +
    `Example: *22345678901*\n\n` +
    `🔒 Encrypted and never shared.`
  );
}

module.exports = { verifyBVN, verifyNIN, detectIdType, formatVerificationMessage, getKYCPromptMessage };
