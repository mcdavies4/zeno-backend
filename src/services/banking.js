/**
 * Unified Banking Service
 * Routes balance/transaction requests to the correct
 * banking provider based on user's country.
 *
 * UK  → TrueLayer
 * NG  → Mono
 * CA  → TrueLayer (coming soon)
 */

const truelayer = require('./truelayer');
const mono = require('./mono');
const { detectCountry } = require('../utils/countryDetect');
const logger = require('../utils/logger');

// ─── GENERATE AUTH LINK ───────────────────────────────
function generateAuthLink(phoneNumber) {
  const country = detectCountry(phoneNumber);
  if (country.code === 'NG') return mono.generateAuthLink(phoneNumber);
  return truelayer.generateAuthLink(phoneNumber);
}

// ─── GET BALANCE ──────────────────────────────────────
async function getBalance(phoneNumber, session) {
  const country = detectCountry(phoneNumber);
  if (country.code === 'NG') return mono.getBalance(phoneNumber, session);
  return truelayer.getBalance(phoneNumber, session);
}

// ─── GET TRANSACTIONS ─────────────────────────────────
async function getTransactions(phoneNumber, session) {
  const country = detectCountry(phoneNumber);
  if (country.code === 'NG') return mono.getTransactions(phoneNumber, session);
  return truelayer.getTransactions(phoneNumber, session);
}

// ─── FORMAT BALANCE MESSAGE ───────────────────────────
function formatBalanceMessage(balances, phoneNumber) {
  const country = detectCountry(phoneNumber);
  if (country.code === 'NG') return mono.formatBalanceMessage(balances);
  return truelayer.formatBalanceMessage(balances);
}

// ─── FORMAT TRANSACTIONS MESSAGE ──────────────────────
function formatTransactionsMessage(transactions, phoneNumber) {
  const country = detectCountry(phoneNumber);
  if (country.code === 'NG') return mono.formatTransactionsMessage(transactions);
  return truelayer.formatTransactionsMessage(transactions);
}

// ─── IS BANK CONNECTED ────────────────────────────────
function isBankConnected(session, phoneNumber) {
  const country = detectCountry(phoneNumber);
  if (country.code === 'NG') return !!session.monoAccountId;
  return !!session.bankConnected;
}

module.exports = {
  generateAuthLink,
  getBalance,
  getTransactions,
  formatBalanceMessage,
  formatTransactionsMessage,
  isBankConnected,
};
