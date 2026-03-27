/**
 * Unified Banking Service
 * UK  → TrueLayer (Open Banking - read only)
 * NG  → Mono
 * Payments → Stripe (when approved)
 */

const truelayer = require('./truelayer');
const mono = require('./mono');
const { detectCountry } = require('../utils/countryDetect');
const logger = require('../utils/logger');

function getCountry(phoneNumber, session) {
  return detectCountry(phoneNumber, session);
}

async function generateAuthLink(phoneNumber, session) {
  const country = getCountry(phoneNumber, session);
  if (country.code === 'NG') return await mono.generateAuthLink(phoneNumber);
  return truelayer.generateAuthLink(phoneNumber);
}

async function getBalance(phoneNumber, session) {
  const country = getCountry(phoneNumber, session);
  if (country.code === 'NG') return mono.getBalance(phoneNumber, session);
  return truelayer.getBalance(phoneNumber, session);
}

async function getTransactions(phoneNumber, session) {
  const country = getCountry(phoneNumber, session);
  if (country.code === 'NG') return mono.getTransactions(phoneNumber, session);
  return truelayer.getTransactions(phoneNumber, session);
}

function formatBalanceMessage(balances, phoneNumber, session) {
  const country = getCountry(phoneNumber, session);
  if (country.code === 'NG') return mono.formatBalanceMessage(balances);
  return truelayer.formatBalanceMessage(balances);
}

function formatTransactionsMessage(transactions, phoneNumber, session) {
  const country = getCountry(phoneNumber, session);
  if (country.code === 'NG') return mono.formatTransactionsMessage(transactions);
  return truelayer.formatTransactionsMessage(transactions);
}

function isBankConnected(session, phoneNumber) {
  const country = getCountry(phoneNumber, session);
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
