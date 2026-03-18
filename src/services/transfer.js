const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = process.env.MODULR_BASE_URL || 'https://api-sandbox.modulrfinance.com';
const API_KEY = process.env.MODULR_API_KEY;
const API_SECRET = process.env.MODULR_API_SECRET;
const SOURCE_ACCOUNT_ID = process.env.MODULR_ACCOUNT_ID;

// ─── MODULR API CLIENT ────────────────────────────────
// Modulr uses HMAC-SHA1 authentication
function buildModulrHeaders(nonce, timestamp) {
  const signingString = `date: ${timestamp}\nx-mod-nonce: ${nonce}`;
  const signature = crypto
    .createHmac('sha1', API_SECRET)
    .update(signingString)
    .digest('base64');

  return {
    'Content-Type': 'application/json',
    Authorization: `Signature keyId="${API_KEY}",algorithm="hmac-sha1",headers="date x-mod-nonce",signature="${signature}"`,
    Date: timestamp,
    'x-mod-nonce': nonce,
  };
}

function getModulrClient() {
  const nonce = uuidv4();
  const timestamp = new Date().toUTCString();

  return axios.create({
    baseURL: BASE_URL,
    headers: buildModulrHeaders(nonce, timestamp),
    timeout: 15000,
  });
}

// ─── SEND PAYMENT (UK Faster Payments) ───────────────
/**
 * @param {object} params
 * @param {string} params.fromUser        - sender's WhatsApp number (used for lookup)
 * @param {string} params.recipientName   - beneficiary name
 * @param {string} params.recipientSortCode    - e.g. "20-00-00"
 * @param {string} params.recipientAccountNumber - 8-digit UK account number
 * @param {number} params.amount          - amount in GBP (e.g. 50.00)
 * @param {string} params.reference       - payment reference (max 18 chars for FPS)
 * @param {string} params.currency        - always "GBP" for UK
 */
async function sendPayment(params) {
  const {
    recipientName,
    recipientSortCode,
    recipientAccountNumber,
    amount,
    reference,
  } = params;

  // Validate required fields
  if (!recipientSortCode || !recipientAccountNumber) {
    const err = new Error('Missing sort code or account number');
    err.userMessage = 'I need the recipient\'s sort code and account number to complete this transfer. Please provide them.';
    throw err;
  }

  if (amount <= 0 || amount > 250000) {
    const err = new Error('Invalid amount');
    err.userMessage = 'The transfer amount must be between £0.01 and £250,000.';
    throw err;
  }

  // Format sort code (remove dashes for API)
  const cleanSortCode = recipientSortCode.replace(/-/g, '');

  // Build Modulr payment request
  const payload = {
    sourceAccountId: SOURCE_ACCOUNT_ID,
    externalReference: uuidv4(),   // your internal reference
    payments: [{
      destination: {
        type: 'SCAN',  // Sort Code + Account Number
        name: recipientName,
        sortCode: cleanSortCode,
        accountNumber: recipientAccountNumber,
      },
      currency: 'GBP',
      amount: amount.toFixed(2),
      reference: (reference || 'Zeno Transfer').substring(0, 18),
      paymentDate: new Date().toISOString().split('T')[0], // today YYYY-MM-DD
    }],
  };

  logger.info(`Initiating Modulr payment: £${amount} to ${recipientName} (${cleanSortCode}/${recipientAccountNumber})`);

  try {
    const client = getModulrClient();
    const response = await client.post('/v1/payments', payload);
    const payment = response.data;

    logger.info(`Modulr payment submitted: id=${payment.id}, status=${payment.status}`);

    // Poll for completion (Faster Payments usually settle in < 5 seconds)
    const finalStatus = await pollPaymentStatus(client, payment.id);

    if (finalStatus.status === 'PROCESSED') {
      // Fetch updated balance
      const newBalance = await getAccountBalance();

      return {
        transactionId: finalStatus.id,
        status: 'SUCCESS',
        newBalance,
      };
    } else {
      const err = new Error(`Payment ${finalStatus.status}`);
      err.userMessage = `The transfer was not completed (status: ${finalStatus.status}). Please try again.`;
      throw err;
    }

  } catch (err) {
    if (err.response) {
      const apiErr = err.response.data;
      logger.error('Modulr API error:', apiErr);

      // Map Modulr error codes to user-friendly messages
      const userMessage = mapModulrError(apiErr);
      const wrappedErr = new Error(apiErr.title || 'Payment failed');
      wrappedErr.userMessage = userMessage;
      throw wrappedErr;
    }
    throw err;
  }
}

// ─── POLL PAYMENT STATUS ──────────────────────────────
async function pollPaymentStatus(client, paymentId, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(1000);
    const res = await client.get(`/v1/payments/${paymentId}`);
    const status = res.data.status;

    logger.info(`Payment ${paymentId} status: ${status} (attempt ${i + 1})`);

    if (['PROCESSED', 'DECLINED', 'FAILED', 'RETURNED'].includes(status)) {
      return res.data;
    }
  }
  throw new Error('Payment status polling timed out');
}

// ─── GET ACCOUNT BALANCE ──────────────────────────────
async function getAccountBalance() {
  try {
    const client = getModulrClient();
    const res = await client.get(`/v1/accounts/${SOURCE_ACCOUNT_ID}`);
    return parseFloat(res.data.balance);
  } catch (err) {
    logger.error('Could not fetch balance:', err.message);
    return null;
  }
}

// ─── ERROR MAPPING ────────────────────────────────────
function mapModulrError(apiErr) {
  const code = apiErr.errors?.[0]?.errorCode || '';
  const map = {
    'INSUFFICIENT_FUNDS': "You don't have enough funds for this transfer.",
    'INVALID_SORTCODE': "The sort code doesn't appear to be valid. Please check and try again.",
    'INVALID_ACCOUNT_NUMBER': "The account number doesn't look right. Please check and try again.",
    'ACCOUNT_CLOSED': "The recipient's account appears to be closed.",
    'PAYMENT_LIMIT_EXCEEDED': "This transfer exceeds the daily payment limit.",
    'BENEFICIARY_REJECTED': "The recipient's bank has rejected this payment.",
  };
  return map[code] || "The transfer could not be completed. Please try again or contact support.";
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { sendPayment, getAccountBalance };
