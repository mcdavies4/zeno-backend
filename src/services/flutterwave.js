/**
 * Flutterwave Payments Service — Nigeria
 * Handles NGN bank transfers via Flutterwave
 */

const axios = require('axios');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

const SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;
const BASE_URL = 'https://api.flutterwave.com/v3';

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// ─── VERIFY BANK ACCOUNT ──────────────────────────────
async function verifyBankAccount(accountNumber, bankCode) {
  try {
    const response = await api.post('/accounts/resolve', {
      account_number: accountNumber,
      account_bank: bankCode,
    });
    return response.data.data; // { account_name, account_number }
  } catch (err) {
    logger.error('Flutterwave verify account failed:', err.response?.data || err.message);
    throw err;
  }
}

// ─── GET LIST OF BANKS ────────────────────────────────
async function getBanks() {
  try {
    const response = await api.get('/banks/NG');
    return response.data.data;
  } catch (err) {
    logger.error('Flutterwave get banks failed:', err.response?.data || err.message);
    return [];
  }
}

// ─── SEND PAYMENT ─────────────────────────────────────
async function sendPayment(params) {
  const {
    recipientName,
    recipientAccountNumber,
    recipientBankCode,
    amount,
    reference,
    narration,
  } = params;

  if (!recipientAccountNumber || !recipientBankCode) {
    const err = new Error('Missing account number or bank code');
    err.userMessage = 'I need the recipient\'s account number and bank to complete this transfer.';
    throw err;
  }

  if (amount <= 0 || amount > 10000000) {
    const err = new Error('Invalid amount');
    err.userMessage = 'Transfer amount must be between ₦1 and ₦10,000,000.';
    throw err;
  }

  const payload = {
    account_bank: recipientBankCode,
    account_number: recipientAccountNumber,
    amount,
    narration: narration || reference || 'Zeno Transfer',
    currency: 'NGN',
    reference: uuidv4(),
    callback_url: `${process.env.VERIFF_CALLBACK_URL}/flutterwave/webhook`,
    debit_currency: 'NGN',
  };

  logger.info(`Initiating Flutterwave transfer: ₦${amount} to ${recipientName} (${recipientAccountNumber})`);

  try {
    const response = await api.post('/transfers', payload);
    const transfer = response.data.data;

    logger.info(`Flutterwave transfer initiated: id=${transfer.id}, status=${transfer.status}`);

    // Poll for completion
    const finalStatus = await pollTransferStatus(transfer.id);

    if (finalStatus.status === 'SUCCESSFUL') {
      return {
        transactionId: finalStatus.id,
        status: 'SUCCESS',
        newBalance: null, // fetch separately
      };
    } else {
      const err = new Error(`Transfer ${finalStatus.status}`);
      err.userMessage = `The transfer could not be completed (${finalStatus.status}). Please try again.`;
      throw err;
    }

  } catch (err) {
    if (err.response) {
      logger.error('Flutterwave API error:', err.response.data);
      const wrapped = new Error(err.response.data?.message || 'Payment failed');
      wrapped.userMessage = mapFlutterwaveError(err.response.data);
      throw wrapped;
    }
    throw err;
  }
}

// ─── POLL TRANSFER STATUS ─────────────────────────────
async function pollTransferStatus(transferId, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const response = await api.get(`/transfers/${transferId}`);
    const status = response.data.data.status;
    logger.info(`Flutterwave transfer ${transferId} status: ${status} (attempt ${i + 1})`);
    if (['SUCCESSFUL', 'FAILED', 'CANCELLED'].includes(status)) {
      return response.data.data;
    }
  }
  throw new Error('Transfer status polling timed out');
}

// ─── ERROR MAPPING ────────────────────────────────────
function mapFlutterwaveError(apiErr) {
  const msg = apiErr?.message?.toLowerCase() || '';
  if (msg.includes('insufficient')) return "You don't have enough funds for this transfer.";
  if (msg.includes('invalid account')) return "The account number doesn't appear to be valid.";
  if (msg.includes('limit')) return "This transfer exceeds your daily limit.";
  return "The transfer could not be completed. Please try again.";
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { sendPayment, verifyBankAccount, getBanks };
