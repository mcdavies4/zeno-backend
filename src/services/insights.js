/**
 * Financial Insights Service
 * Spending analysis, alerts and beneficiary management
 */

const sessionStore = require('./sessionStore');
const logger = require('../utils/logger');

// ─── SPENDING ANALYSIS ────────────────────────────────
function categoriseTransaction(description) {
  const desc = (description || '').toLowerCase();
  if (/uber|bolt|taxi|lyft|transport|bus|train|tfl|rail/.test(desc)) return 'Transport';
  if (/restaurant|food|eat|kfc|mcdonalds|pizza|chicken|suya|sharwarma|cafe|coffee|starbucks|costa|burger/.test(desc)) return 'Food & Dining';
  if (/amazon|shoprite|jumia|konga|walmart|tesco|asda|sainsbury|market|shop|store/.test(desc)) return 'Shopping';
  if (/dstv|netflix|spotify|apple|google|airtime|data|mtn|airtel|glo|9mobile|broadband|wifi/.test(desc)) return 'Bills & Subscriptions';
  if (/transfer|send|payment|zeno/.test(desc)) return 'Transfers';
  if (/salary|income|credit|deposit/.test(desc)) return 'Income';
  if (/atm|cash|withdrawal/.test(desc)) return 'Cash';
  if (/hospital|pharmacy|doctor|health|medical/.test(desc)) return 'Health';
  return 'Other';
}

function analyseSpending(transactions, symbol = '£') {
  if (!transactions?.length) return null;

  const debits = transactions.filter(tx => tx.amount < 0 || tx.type === 'debit');
  const credits = transactions.filter(tx => tx.amount > 0 && tx.type !== 'debit');

  const totalSpent = debits.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const totalReceived = credits.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  // Group by category
  const categories = {};
  debits.forEach(tx => {
    const cat = categoriseTransaction(tx.description);
    if (!categories[cat]) categories[cat] = 0;
    categories[cat] += Math.abs(tx.amount);
  });

  // Sort categories
  const sorted = Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return { totalSpent, totalReceived, categories: sorted, count: debits.length };
}

function formatAnalysis(analysis, symbol = '£', period = 'recently') {
  if (!analysis) return `No transactions found ${period}.`;

  const { totalSpent, totalReceived, categories, count } = analysis;
  let msg = `📊 *Spending Analysis*\n\n`;
  msg += `💸 Total spent: *${symbol}${totalSpent.toFixed(2)}*\n`;
  if (totalReceived > 0) msg += `💰 Total received: *${symbol}${totalReceived.toFixed(2)}*\n`;
  msg += `📝 Transactions: *${count}*\n\n`;

  if (categories.length > 0) {
    msg += `*Top spending categories:*\n`;
    categories.forEach(([cat, amount]) => {
      const pct = ((amount / totalSpent) * 100).toFixed(0);
      msg += `• ${cat}: ${symbol}${amount.toFixed(2)} (${pct}%)\n`;
    });
  }

  return msg.trim();
}

// ─── ALERTS ───────────────────────────────────────────
function checkAlerts(session, newBalance, transactions = []) {
  const alerts = session.alerts || {};
  const triggered = [];

  // Low balance alert
  if (alerts.lowBalance && newBalance < alerts.lowBalance) {
    triggered.push(`⚠️ *Low Balance Alert*\n\nYour balance is now *${session.bankingCountry === 'NG' ? '₦' : '£'}${newBalance.toFixed(2)}*, which is below your alert threshold of ${session.bankingCountry === 'NG' ? '₦' : '£'}${alerts.lowBalance}.`);
  }

  // Large transaction alert
  if (alerts.largeTransaction && transactions.length > 0) {
    const large = transactions.filter(tx => Math.abs(tx.amount) >= alerts.largeTransaction);
    large.forEach(tx => {
      triggered.push(`🔔 *Large Transaction Alert*\n\n${tx.amount < 0 ? 'Spent' : 'Received'} *${session.bankingCountry === 'NG' ? '₦' : '£'}${Math.abs(tx.amount).toFixed(2)}* — ${tx.description}`);
    });
  }

  return triggered;
}

function parseAlertCommand(text) {
  const lower = text.toLowerCase();

  // "alert me when balance below £500" or "low balance alert £200"
  const balanceMatch = lower.match(/(?:balance|low).*?[£₦$]?\s*(\d+(?:,\d+)?(?:\.\d+)?)/);
  if (balanceMatch && (lower.includes('balance') || lower.includes('low'))) {
    return { type: 'lowBalance', amount: parseFloat(balanceMatch[1].replace(',', '')) };
  }

  // "alert me for transactions over £100"
  const txMatch = lower.match(/(?:transaction|transfer|spend).*?[£₦$]?\s*(\d+(?:,\d+)?(?:\.\d+)?)/);
  if (txMatch && (lower.includes('over') || lower.includes('above') || lower.includes('more than'))) {
    return { type: 'largeTransaction', amount: parseFloat(txMatch[1].replace(',', '')) };
  }

  return null;
}

// ─── BENEFICIARIES ────────────────────────────────────
function saveBeneficiary(session, name, details) {
  const beneficiaries = session.beneficiaries || {};
  const key = name.toLowerCase().trim();
  beneficiaries[key] = { name, ...details, savedAt: Date.now() };
  return beneficiaries;
}

function getBeneficiary(session, name) {
  const beneficiaries = session.beneficiaries || {};
  const key = name.toLowerCase().trim();

  // Exact match
  if (beneficiaries[key]) return beneficiaries[key];

  // Partial match
  const match = Object.keys(beneficiaries).find(k => k.includes(key) || key.includes(k));
  return match ? beneficiaries[match] : null;
}

function listBeneficiaries(session) {
  const beneficiaries = session.beneficiaries || {};
  const list = Object.values(beneficiaries);
  if (!list.length) return null;

  let msg = `👥 *Saved Beneficiaries*\n\n`;
  list.forEach((b, i) => {
    msg += `${i + 1}. *${b.name}*`;
    if (b.accountNumber) msg += ` — ****${b.accountNumber.slice(-4)}`;
    if (b.bankName) msg += ` (${b.bankName})`;
    if (b.sortCode) msg += ` — ${b.sortCode}`;
    msg += '\n';
  });
  return msg.trim();
}

module.exports = {
  analyseSpending,
  formatAnalysis,
  categoriseTransaction,
  checkAlerts,
  parseAlertCommand,
  saveBeneficiary,
  getBeneficiary,
  listBeneficiaries,
};
