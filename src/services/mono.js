/**
 * Mono Open Banking Service — Nigeria
 * Handles balance and transaction fetching for Nigerian banks
 * Supports: GTBank, Access, Zenith, UBA, First Bank, Kuda, etc.
 */

const axios = require('axios');
const sessionStore = require('./sessionStore');
const logger = require('../utils/logger');

const SECRET_KEY = process.env.MONO_SECRET_KEY;
const BASE_URL = 'https://api.withmono.com';

// ─── GENERATE AUTH LINK ───────────────────────────────
async function generateAuthLink(phoneNumber) {
  const state = Buffer.from(phoneNumber).toString('base64');

  // Store phone number in Redis so webhook can look it up
  try {
    const { Redis } = require('@upstash/redis');
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    // Store for 24 hours
    await redis.setex(`mono:state:${state}`, 86400, phoneNumber);
    logger.info(`Mono state stored for ${phoneNumber}`);
  } catch(e) {
    logger.warn('Could not store Mono state in Redis:', e.message);
  }

  return `https://connect.withmono.com/?key=${process.env.MONO_PUBLIC_KEY}&state=${state}`;
}

// ─── EXCHANGE CODE FOR ACCOUNT ID ────────────────────
async function exchangeCode(code) {
  try {
    const response = await axios.post(
      `${BASE_URL}/v2/accounts/auth`,
      { code },
      { headers: { 'mono-sec-key': SECRET_KEY, 'Content-Type': 'application/json' } }
    );
    return response.data; // { id: account_id }
  } catch (err) {
    logger.error('Mono code exchange failed:', err.response?.data || err.message);
    throw err;
  }
}

// ─── FETCH ACCOUNT INFO ───────────────────────────────
async function getAccountInfo(accountId) {
  try {
    const response = await axios.get(
      `${BASE_URL}/v2/accounts/${accountId}`,
      { headers: { 'mono-sec-key': SECRET_KEY } }
    );
    return response.data;
  } catch (err) {
    logger.error('Mono get account failed:', err.response?.data || err.message);
    throw err;
  }
}

// ─── FETCH BALANCE ────────────────────────────────────
async function getBalance(phoneNumber, session) {
  try {
    const accountId = session.monoAccountId;
    if (!accountId) return { success: false, needsConnection: true };

    const account = await getAccountInfo(accountId);

    const balance = account.account?.balance / 100 || 0; // Mono returns kobo
    const accountName = account.account?.name || 'Your Account';
    const bankName = account.account?.institution?.name || 'Your Bank';

    await sessionStore.update(phoneNumber, { balance });

    return {
      success: true,
      balances: [{
        accountName: `${bankName} — ${accountName}`,
        accountNumber: account.account?.accountNumber || '****',
        currency: 'NGN',
        available: balance,
        current: balance,
      }],
    };

  } catch (err) {
    logger.error('Mono balance fetch failed:', err.message);
    if (err.message === 'NO_ACCOUNT') return { success: false, needsConnection: true };
    return { success: false, message: 'Could not fetch balance right now.' };
  }
}

// ─── FETCH TRANSACTIONS ───────────────────────────────
async function getTransactions(phoneNumber, session) {
  try {
    const accountId = session.monoAccountId;
    if (!accountId) return { success: false, needsConnection: true };

    const response = await axios.get(
      `${BASE_URL}/v2/accounts/${accountId}/transactions`,
      {
        headers: { 'mono-sec-key': SECRET_KEY },
        params: { paginate: false, limit: 10 },
      }
    );

    const transactions = (response.data.data || []).slice(0, 10).map(tx => ({
      description: tx.narration,
      amount: tx.amount / 100, // kobo to naira
      currency: 'NGN',
      date: tx.date?.split('T')[0],
      type: tx.type,
    }));

    await sessionStore.update(phoneNumber, { recentTransactions: transactions });
    return { success: true, transactions };

  } catch (err) {
    logger.error('Mono transactions fetch failed:', err.message);
    return { success: false, message: 'Could not fetch transactions.' };
  }
}

// ─── FORMAT MESSAGES ──────────────────────────────────
function formatBalanceMessage(balances) {
  const b = balances[0];
  return (
    `💰 *Your Balance*\n\n` +
    `*${b.accountName}*\n` +
    `Balance: *₦${b.available.toLocaleString('en-NG', { minimumFractionDigits: 2 })}*\n` +
    `Account: ****${b.accountNumber.slice(-4)}`
  );
}

function formatTransactionsMessage(transactions) {
  let msg = `📋 *Recent Transactions*\n\n`;
  transactions.forEach(tx => {
    const sign = tx.type === 'debit' ? '↑' : '↓';
    const amount = Math.abs(tx.amount).toLocaleString('en-NG', { minimumFractionDigits: 2 });
    msg += `${sign} ₦${amount} — ${tx.description}\n_${tx.date}_\n\n`;
  });
  return msg.trim();
}

module.exports = {
  generateAuthLink,
  exchangeCode,
  getBalance,
  getTransactions,
  formatBalanceMessage,
  formatTransactionsMessage,
};
