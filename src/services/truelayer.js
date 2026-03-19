/**
 * TrueLayer Open Banking Service
 *
 * Handles:
 * - Generating auth links for users to connect their bank
 * - Fetching real account balances
 * - Fetching real transactions
 */

const axios = require('axios');
const sessionStore = require('./sessionStore');
const logger = require('../utils/logger');

const CLIENT_ID = process.env.TRUELAYER_CLIENT_ID;
const CLIENT_SECRET = process.env.TRUELAYER_CLIENT_SECRET;
const REDIRECT_URI = process.env.TRUELAYER_REDIRECT_URI;

// Sandbox vs Live
const IS_SANDBOX = process.env.NODE_ENV !== 'production';
const AUTH_URL = IS_SANDBOX
  ? 'https://auth.truelayer-sandbox.com'
  : 'https://auth.truelayer.com';
const API_URL = IS_SANDBOX
  ? 'https://api.truelayer-sandbox.com'
  : 'https://api.truelayer.com';

// UK banks supported via TrueLayer
const SUPPORTED_PROVIDERS = [
  'monzo', 'starling', 'barclays', 'hsbc',
  'lloyds', 'natwest', 'santander', 'revolut',
];

// ─── GENERATE AUTH LINK ───────────────────────────────
/**
 * Generate a TrueLayer auth link for the user to connect their bank.
 * Send this link to the user on WhatsApp.
 */
function generateAuthLink(phoneNumber) {
  const state = Buffer.from(phoneNumber).toString('base64');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: 'info accounts balance transactions',
    redirect_uri: REDIRECT_URI,
    providers: 'uk-ob-all uk-oauth-all',
    state,
  });

  return `${AUTH_URL}/?${params.toString()}`;
}

// ─── EXCHANGE CODE FOR TOKEN ──────────────────────────
/**
 * Called from your /callback route after user connects their bank.
 */
async function exchangeCodeForToken(code) {
  try {
    const response = await axios.post(`${AUTH_URL}/connect/token`, {
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
    }, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    return response.data; // { access_token, refresh_token, expires_in }
  } catch (err) {
    logger.error('TrueLayer token exchange failed:', err.response?.data || err.message);
    throw err;
  }
}

// ─── REFRESH TOKEN ────────────────────────────────────
async function refreshAccessToken(refreshToken) {
  try {
    const response = await axios.post(`${AUTH_URL}/connect/token`, {
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
    }, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    return response.data;
  } catch (err) {
    logger.error('TrueLayer token refresh failed:', err.response?.data || err.message);
    throw err;
  }
}

// ─── GET VALID ACCESS TOKEN ───────────────────────────
async function getValidToken(session, phoneNumber) {
  if (!session.truelayerAccessToken) {
    throw new Error('NO_TOKEN');
  }

  // Check if token is expired (with 5 min buffer)
  const expiresAt = session.truelayerExpiresAt || 0;
  if (Date.now() > expiresAt - 300000) {
    // Refresh the token
    const newTokens = await refreshAccessToken(session.truelayerRefreshToken);
    await sessionStore.update(phoneNumber, {
      truelayerAccessToken: newTokens.access_token,
      truelayerRefreshToken: newTokens.refresh_token,
      truelayerExpiresAt: Date.now() + (newTokens.expires_in * 1000),
    });
    return newTokens.access_token;
  }

  return session.truelayerAccessToken;
}

// ─── FETCH ACCOUNTS ───────────────────────────────────
async function getAccounts(accessToken) {
  try {
    const response = await axios.get(`${API_URL}/data/v1/accounts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data.results;
  } catch (err) {
    logger.error('TrueLayer get accounts failed:', err.response?.data || err.message);
    throw err;
  }
}

// ─── FETCH BALANCE ────────────────────────────────────
async function getBalance(phoneNumber, session) {
  try {
    const accessToken = await getValidToken(session, phoneNumber);
    const accounts = await getAccounts(accessToken);

    if (!accounts || accounts.length === 0) {
      return { success: false, message: "No accounts found." };
    }

    // Fetch balance for each account
    const balances = await Promise.all(
      accounts.map(async (account) => {
        const res = await axios.get(
          `${API_URL}/data/v1/accounts/${account.account_id}/balance`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        return {
          accountName: account.display_name || account.account_type,
          accountNumber: account.account_number?.number || '****',
          sortCode: account.account_number?.sort_code || '',
          currency: res.data.results[0]?.currency || 'GBP',
          available: res.data.results[0]?.available || 0,
          current: res.data.results[0]?.current || 0,
        };
      })
    );

    // Cache balance in session
    await sessionStore.update(phoneNumber, {
      balance: balances[0]?.available || 0,
      lastBalanceFetch: Date.now(),
    });

    return { success: true, balances };

  } catch (err) {
    if (err.message === 'NO_TOKEN') {
      return { success: false, needsConnection: true };
    }
    logger.error('Balance fetch failed:', err.message);
    return { success: false, message: 'Could not fetch balance right now.' };
  }
}

// ─── FETCH TRANSACTIONS ───────────────────────────────
async function getTransactions(phoneNumber, session, days = 30) {
  try {
    const accessToken = await getValidToken(session, phoneNumber);
    const accounts = await getAccounts(accessToken);

    if (!accounts || accounts.length === 0) {
      return { success: false, message: "No accounts found." };
    }

    const from = new Date();
    from.setDate(from.getDate() - days);
    const fromStr = from.toISOString().split('T')[0];

    const account = accounts[0]; // Use primary account
    const res = await axios.get(
      `${API_URL}/data/v1/accounts/${account.account_id}/transactions`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { from: fromStr },
      }
    );

    const transactions = res.data.results.slice(0, 10).map(tx => ({
      description: tx.description,
      amount: tx.amount,
      currency: tx.currency,
      date: tx.timestamp?.split('T')[0],
      type: tx.transaction_type,
    }));

    // Cache in session
    await sessionStore.update(phoneNumber, { recentTransactions: transactions });

    return { success: true, transactions };

  } catch (err) {
    if (err.message === 'NO_TOKEN') {
      return { success: false, needsConnection: true };
    }
    logger.error('Transactions fetch failed:', err.message);
    return { success: false, message: 'Could not fetch transactions right now.' };
  }
}

// ─── FORMAT BALANCE MESSAGE ───────────────────────────
function formatBalanceMessage(balances) {
  if (balances.length === 1) {
    const b = balances[0];
    return (
      `💰 *Your Balance*\n\n` +
      `*${b.accountName}*\n` +
      `Available: *£${b.available.toFixed(2)}*\n` +
      `Current: £${b.current.toFixed(2)}\n` +
      `Account: ****${b.accountNumber.slice(-4)}`
    );
  }

  // Multiple accounts
  let msg = `💰 *Your Balances*\n\n`;
  balances.forEach(b => {
    msg += `*${b.accountName}*: £${b.available.toFixed(2)}\n`;
  });
  return msg;
}

// ─── FORMAT TRANSACTIONS MESSAGE ──────────────────────
function formatTransactionsMessage(transactions) {
  let msg = `📋 *Recent Transactions*\n\n`;
  transactions.forEach(tx => {
    const sign = tx.amount < 0 ? '↑' : '↓';
    const amount = Math.abs(tx.amount).toFixed(2);
    msg += `${sign} £${amount} — ${tx.description}\n_${tx.date}_\n\n`;
  });
  return msg.trim();
}

module.exports = {
  generateAuthLink,
  exchangeCodeForToken,
  getBalance,
  getTransactions,
  formatBalanceMessage,
  formatTransactionsMessage,
};
