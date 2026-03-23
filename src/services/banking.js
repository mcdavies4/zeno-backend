/**
 * Unified Banking Service
 * UK  → Stripe Financial Connections
 * NG  → Mono
 */

const stripeService = require('./stripe');
const mono = require('./mono');
const { detectCountry } = require('../utils/countryDetect');
const sessionStore = require('./sessionStore');
const logger = require('../utils/logger');

function getCountry(phoneNumber, session) {
  return detectCountry(phoneNumber, session);
}

// ─── GENERATE AUTH LINK ───────────────────────────────
async function generateAuthLink(phoneNumber, session) {
  const country = getCountry(phoneNumber, session);

  if (country.code === 'NG') {
    return await mono.generateAuthLink(phoneNumber);
  }

  // UK → Stripe Financial Connections
  const fc = await stripeService.createFinancialConnectionSession({
    phoneNumber,
    email: session.email,
    name: session.name,
  });

  // Store customer ID for later use
  await sessionStore.update(phoneNumber, { stripeCustomerId: fc.customerId });

  return fc.url;
}

// ─── GET BALANCE ──────────────────────────────────────
async function getBalance(phoneNumber, session) {
  const country = getCountry(phoneNumber, session);

  if (country.code === 'NG') {
    return mono.getBalance(phoneNumber, session);
  }

  // UK → Stripe
  try {
    if (!session.stripeAccountId) {
      return { success: false, error: 'No bank connected' };
    }
    const balance = await stripeService.getBalance(session.stripeAccountId);
    return {
      success: true,
      balances: [{
        name: balance.accountName,
        available: balance.available,
        current: balance.current,
        currency: 'GBP',
        provider: balance.institutionName,
        last4: balance.last4,
      }],
    };
  } catch (err) {
    logger.error('Stripe balance error:', err.message);
    return { success: false, error: err.message };
  }
}

// ─── GET TRANSACTIONS ─────────────────────────────────
async function getTransactions(phoneNumber, session) {
  const country = getCountry(phoneNumber, session);

  if (country.code === 'NG') {
    return mono.getTransactions(phoneNumber, session);
  }

  // UK → Stripe
  try {
    if (!session.stripeAccountId) {
      return { success: false, error: 'No bank connected' };
    }
    const transactions = await stripeService.getTransactions(session.stripeAccountId);
    return { success: true, transactions };
  } catch (err) {
    logger.error('Stripe transactions error:', err.message);
    return { success: false, error: err.message };
  }
}

// ─── FORMAT MESSAGES ──────────────────────────────────
function formatBalanceMessage(balances, phoneNumber, session) {
  const country = getCountry(phoneNumber, session);

  if (country.code === 'NG') return mono.formatBalanceMessage(balances);

  // UK → Stripe format
  if (!balances?.length) return `No balance data available.`;
  const b = balances[0];
  return (
    `💰 *Your Balance*\n\n` +
    `🏦 ${b.provider || 'Your Bank'} (****${b.last4 || '****'})\n` +
    `Available: *£${b.available.toLocaleString('en', { minimumFractionDigits: 2 })}*\n` +
    `Current: £${b.current.toLocaleString('en', { minimumFractionDigits: 2 })}`
  );
}

function formatTransactionsMessage(transactions, phoneNumber, session) {
  const country = getCountry(phoneNumber, session);
  if (country.code === 'NG') return mono.formatTransactionsMessage(transactions);
  return stripeService.formatTransactionsMessage(transactions);
}

// ─── IS BANK CONNECTED ────────────────────────────────
function isBankConnected(session, phoneNumber) {
  const country = getCountry(phoneNumber, session);
  if (country.code === 'NG') return !!session.monoAccountId;
  return !!(session.stripeAccountId || session.bankConnected);
}

module.exports = {
  generateAuthLink,
  getBalance,
  getTransactions,
  formatBalanceMessage,
  formatTransactionsMessage,
  isBankConnected,
};
