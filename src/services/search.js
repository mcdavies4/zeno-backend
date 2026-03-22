/**
 * Transaction Search & Exchange Rate Service
 */

const axios = require('axios');
const logger = require('../utils/logger');

// ─── TRANSACTION SEARCH ───────────────────────────────
function searchTransactions(transactions, query) {
  if (!transactions?.length) return [];

  const q = query.toLowerCase();

  // Parse amount filter: "over 100", "above 500", "more than 200"
  const amountMatch = q.match(/(?:over|above|more than|greater than|under|below|less than)\s*[£₦$]?\s*(\d+)/);
  const amountFilter = amountMatch ? {
    value: parseFloat(amountMatch[1]),
    direction: q.includes('under') || q.includes('below') || q.includes('less') ? 'under' : 'over',
  } : null;

  // Parse date filter: "this month", "last month", "this week"
  const now = new Date();
  let dateFilter = null;
  if (q.includes('this month')) {
    dateFilter = { from: new Date(now.getFullYear(), now.getMonth(), 1) };
  } else if (q.includes('last month')) {
    dateFilter = {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      to: new Date(now.getFullYear(), now.getMonth(), 0),
    };
  } else if (q.includes('this week')) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    dateFilter = { from: weekStart };
  } else if (q.includes('today')) {
    dateFilter = { from: new Date(now.toDateString()) };
  }

  // Extract merchant/keyword (remove filter words)
  const stopWords = ['show', 'find', 'search', 'all', 'my', 'payments', 'transactions', 'spending', 'this', 'last', 'month', 'week', 'today', 'over', 'above', 'under', 'below', 'more', 'than', 'less', 'greater'];
  const keywords = q
    .replace(/[£₦$\d]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.includes(w));

  return transactions.filter(tx => {
    const desc = (tx.description || tx.narration || '').toLowerCase();
    const amount = Math.abs(tx.amount);
    const txDate = tx.date ? new Date(tx.date) : null;

    // Amount filter
    if (amountFilter) {
      if (amountFilter.direction === 'over' && amount < amountFilter.value) return false;
      if (amountFilter.direction === 'under' && amount > amountFilter.value) return false;
    }

    // Date filter
    if (dateFilter && txDate) {
      if (dateFilter.from && txDate < dateFilter.from) return false;
      if (dateFilter.to && txDate > dateFilter.to) return false;
    }

    // Keyword filter — match any keyword
    if (keywords.length > 0) {
      return keywords.some(k => desc.includes(k));
    }

    return true;
  });
}

function formatSearchResults(results, symbol, query) {
  if (!results.length) return `No transactions found matching "${query}".`;

  const total = results.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  let msg = `🔍 *Search Results* (${results.length} found)\n\n`;

  results.slice(0, 10).forEach(tx => {
    const date = tx.date ? new Date(tx.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    const sign = tx.amount < 0 || tx.type === 'debit' ? '-' : '+';
    const desc = (tx.description || tx.narration || 'Unknown').substring(0, 30);
    msg += `• ${date} | ${sign}${symbol}${Math.abs(tx.amount).toFixed(2)} — ${desc}\n`;
  });

  if (results.length > 10) msg += `\n_...and ${results.length - 10} more_\n`;
  msg += `\n💰 *Total: ${symbol}${total.toFixed(2)}*`;

  return msg;
}

// ─── EXCHANGE RATE ────────────────────────────────────
async function getExchangeRate(from, to) {
  try {
    // Use free exchangerate-api
    const response = await axios.get(
      `https://api.exchangerate-api.com/v4/latest/${from.toUpperCase()}`,
      { timeout: 5000 }
    );

    const rate = response.data.rates[to.toUpperCase()];
    if (!rate) throw new Error(`Rate not found for ${to}`);

    return { rate, from: from.toUpperCase(), to: to.toUpperCase() };
  } catch(err) {
    logger.error('Exchange rate error:', err.message);
    throw err;
  }
}

function parseExchangeQuery(text) {
  const lower = text.toLowerCase();

  // Pairs to check
  const pairs = [
    { pattern: /(?:gbp|pound|£).*(?:ngn|naira|₦)|(?:ngn|naira|₦).*(?:gbp|pound|£)/, from: 'GBP', to: 'NGN' },
    { pattern: /(?:usd|dollar|\$).*(?:ngn|naira|₦)|(?:ngn|naira|₦).*(?:usd|dollar|\$)/, from: 'USD', to: 'NGN' },
    { pattern: /(?:usd|dollar|\$).*(?:gbp|pound|£)|(?:gbp|pound|£).*(?:usd|dollar|\$)/, from: 'USD', to: 'GBP' },
    { pattern: /(?:gbp|pound|£).*(?:usd|dollar|\$)|(?:usd|dollar|\$).*(?:gbp|pound|£)/, from: 'GBP', to: 'USD' },
    { pattern: /(?:eur|euro|€).*(?:ngn|naira|₦)|(?:ngn|naira|₦).*(?:eur|euro|€)/, from: 'EUR', to: 'NGN' },
    { pattern: /(?:eur|euro|€).*(?:gbp|pound|£)|(?:gbp|pound|£).*(?:eur|euro|€)/, from: 'EUR', to: 'GBP' },
  ];

  for (const pair of pairs) {
    if (pair.pattern.test(lower)) {
      // Check if amount specified: "how much is £500 in naira"
      const amountMatch = lower.match(/[£₦$€]?\s*(\d+(?:,\d+)?)/);
      const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '')) : 1;
      return { ...pair, amount };
    }
  }

  // Generic: "exchange rate today"
  if (lower.includes('exchange') || lower.includes('rate') || lower.includes('convert')) {
    return { from: 'GBP', to: 'NGN', amount: 1 };
  }

  return null;
}

module.exports = {
  searchTransactions,
  formatSearchResults,
  getExchangeRate,
  parseExchangeQuery,
};
