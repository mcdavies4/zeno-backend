/**
 * Virtual Account Service
 * Each Nigerian user gets a permanent WEMA Bank account number
 * User funds it → Zeno wallet credited → User can send to anyone
 */

const axios = require('axios');
const logger = require('../utils/logger');

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

// ─── CREATE VIRTUAL ACCOUNT ───────────────────────────
async function createVirtualAccount({ phoneNumber, name, email }) {
  const firstName = name.split(' ')[0] || 'Zeno';
  const lastName = name.split(' ').slice(1).join(' ') || 'User';

  // tx_ref must be unique per user — use phone number
  const txRef = `ZENO-VA-${phoneNumber.replace(/\D/g, '')}`;

  try {
    const response = await api.post('/virtual-account-numbers', {
      email: email || `${phoneNumber}@zeno.app`,
      phonenumber: phoneNumber.replace(/\D/g, '').replace(/^234/, '0'),
      firstname: firstName,
      lastname: lastName,
      narration: `Zeno Wallet - ${firstName}`,
      tx_ref: txRef,
      is_permanent: true,
      amount: 0, // Static account — accept any amount
    });

    const data = response.data?.data;
    if (!data?.account_number) throw new Error('No account number returned');

    logger.info(`Virtual account created for ${phoneNumber}: ${data.account_number} (${data.bank_name})`);

    return {
      accountNumber: data.account_number,
      bankName: data.bank_name,
      txRef,
    };
  } catch (err) {
    logger.error('Virtual account creation failed:', err.response?.data || err.message);
    throw err;
  }
}

// ─── GET WALLET BALANCE ───────────────────────────────
function getWalletBalance(session) {
  return session.walletBalance || 0;
}

function formatWalletMessage(session) {
  const balance = getWalletBalance(session);
  const va = session.virtualAccount;

  if (!va) return null;

  return (
    `💳 *Your Zeno Wallet*\n\n` +
    `💰 Balance: *₦${balance.toLocaleString('en', { minimumFractionDigits: 2 })}*\n\n` +
    `*Fund your wallet:*\n` +
    `🏦 Bank: *${va.bankName}*\n` +
    `🔢 Account: *${va.accountNumber}*\n` +
    `👤 Name: Zeno Wallet\n\n` +
    `_Transfer any amount to this account from any Nigerian bank. Funds arrive instantly._`
  );
}

// ─── CREDIT WALLET (called from webhook) ─────────────
async function creditWallet(phoneNumber, amount, session, sessionStore, messenger) {
  const currentBalance = getWalletBalance(session);
  const newBalance = currentBalance + amount;

  await sessionStore.update(phoneNumber, { walletBalance: newBalance });

  await messenger.sendText(phoneNumber,
    `✅ *Wallet Funded!*\n\n` +
    `• Amount received: *₦${amount.toLocaleString('en', { minimumFractionDigits: 2 })}*\n` +
    `• New balance: *₦${newBalance.toLocaleString('en', { minimumFractionDigits: 2 })}*\n\n` +
    `You can now send money to anyone. Say *"Send ₦5000 to John"* to get started!`
  );

  logger.info(`Wallet credited: ${phoneNumber} +₦${amount} = ₦${newBalance}`);
  return newBalance;
}

// ─── DEBIT WALLET (before sending transfer) ──────────
function canAffordTransfer(session, amount, fee) {
  const balance = getWalletBalance(session);
  const total = amount + (fee?.totalFee || 0);

  if (balance < total) {
    const shortfall = total - balance;
    return {
      canAfford: false,
      balance,
      total,
      shortfall,
      message:
        `❌ *Insufficient Wallet Balance*\n\n` +
        `• Transfer + fee: *₦${total.toLocaleString('en', { minimumFractionDigits: 2 })}*\n` +
        `• Your balance: *₦${balance.toLocaleString('en', { minimumFractionDigits: 2 })}*\n` +
        `• Shortfall: *₦${shortfall.toLocaleString('en', { minimumFractionDigits: 2 })}*\n\n` +
        `Fund your wallet to continue. Say *"My account"* to see your account number.`,
    };
  }

  return { canAfford: true, balance, total };
}

function debitWallet(session, amount, fee) {
  const total = amount + (fee?.totalFee || 0);
  const newBalance = getWalletBalance(session) - total;
  return { walletBalance: Math.max(0, newBalance) };
}

module.exports = {
  createVirtualAccount,
  getWalletBalance,
  formatWalletMessage,
  creditWallet,
  canAffordTransfer,
  debitWallet,
};
